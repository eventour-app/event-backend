const express = require("express");
const router = express.Router();
const Business = require("../models/Business");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { processImage, toDataUrl } = require('../utils/imageProcessor');
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const upload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsRoot),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
}) });

function parseDataUrl(data) {
  if (!data || typeof data !== 'string') return null;
  const match = data.match(/^data:(.+);base64,(.*)$/);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }
  try {
    return { mimeType: 'application/octet-stream', buffer: Buffer.from(data, 'base64') };
  } catch {
    return null;
  }
}

router.all('/register', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Use POST /api/business/onboard' })
);

// NEW: Single consolidated onboarding endpoint accepting nested JSON
// POST /api/business/onboard
// Expected payload shape:
// {
//   businessId?: string, // if provided, we update; else create
//   userId: string,
//   serviceType: string,
//   businessInfo: {
//     ownerName, businessName, email, phone, whatsapp,
//     location: { address, street, houseNo, plotNo, area, landmark, pincode, state, gps },
//     workingDays: string[], openingTime, closingTime, gstNumber,
//     bankAccount, ifscCode,
//     isRegisteredBusiness?: boolean,
//     serviceDetail?: string
//   },
//   logo?: string, // data URL or base64
//   documents?: { govtId?: string, registrationProof?: string, cancelledCheque?: string }, // data URLs/base64
//   photos?: { ownerPhoto?: string, previewPhoto?: string }, // data URLs/base64
//   services?: [
//     { serviceName: string, price: string, discount?: string, images?: string[] } // image data URLs/base64
//   ]
// }
router.post('/onboard', async (req, res) => {
  try {
    const {
      businessId,
      userId,
      serviceType,
      businessInfo = {},
      documents = {},
      photos = {},
      services = [],
      logo,
    } = req.body || {};

    if (!userId || !serviceType) {
      return res.status(400).json({ message: 'userId and serviceType are required' });
    }

    let business = null;
    if (businessId) {
      business = await Business.findById(businessId);
      if (!business) return res.status(404).json({ message: 'Business not found' });
    } else {
      business = new Business({ userId, serviceType, verificationStatus: 'draft' });
    }

    const basic = {};
    const fields = [
      'ownerName', 'businessName', 'email', 'phone', 'whatsapp',
      'workingDays', 'openingTime', 'closingTime', 'gstNumber',
      'bankAccount', 'ifscCode', 'isRegisteredBusiness', 'serviceDetail'
    ];
    for (const f of fields) if (businessInfo[f] !== undefined) basic[f] = businessInfo[f];
  if (businessInfo.location) basic.location = businessInfo.location;
  basic.userId = userId; // ensure association doesn't get lost
    basic.serviceType = serviceType; // ensure stored
    business.set(basic);

    if (logo) {
      const parsed = parseDataUrl(logo);
      if (!parsed) return res.status(400).json({ message: 'Invalid logo format; expected data URL or base64 string' });
      const processed = await processImage(parsed.buffer, 'logo');
      business.logo = {
        data: processed.buffer,
        contentType: processed.mimeType,
        sizeKb: processed.sizeKb,
        width: processed.width,
        height: processed.height,
      };
    }

    if (documents && typeof documents === 'object') {
      if (documents.govtId) {
        const p = parseDataUrl(documents.govtId);
        if (!p) return res.status(400).json({ message: 'Invalid govtId format' });
        const processed = await processImage(p.buffer, 'doc');
        business.govtId = processed.buffer;
      }
      if (documents.registrationProof) {
        const p = parseDataUrl(documents.registrationProof);
        if (!p) return res.status(400).json({ message: 'Invalid registrationProof format' });
        const processed = await processImage(p.buffer, 'doc');
        business.registrationProof = processed.buffer;
      }
      if (documents.cancelledCheque) {
        const p = parseDataUrl(documents.cancelledCheque);
        if (!p) return res.status(400).json({ message: 'Invalid cancelledCheque format' });
        const processed = await processImage(p.buffer, 'doc');
        business.cancelledCheque = processed.buffer;
      }
    }

    if (photos && typeof photos === 'object') {
      if (photos.ownerPhoto) {
        const p = parseDataUrl(photos.ownerPhoto);
        if (!p) return res.status(400).json({ message: 'Invalid ownerPhoto format' });
        const processed = await processImage(p.buffer, 'doc');
        business.ownerPhoto = processed.buffer;
      }
      if (photos.previewPhoto) {
        const p = parseDataUrl(photos.previewPhoto);
        if (!p) return res.status(400).json({ message: 'Invalid previewPhoto format' });
        const processed = await processImage(p.buffer, 'doc');
        business.previewPhoto = processed.buffer;
      }
    }

    if (Array.isArray(services) && services.length) {
      const normalized = [];
      for (const s of services) {
        if (!s || !s.serviceName || !s.price) continue;
        const item = {
          serviceName: s.serviceName,
          price: s.price,
          discount: s.discount,
          images: [],
        };
        if (Array.isArray(s.images) && s.images.length) {
          for (const img of s.images) {
            const p = parseDataUrl(img);
            if (!p) continue; // skip invalid entries silently
            const processed = await processImage(p.buffer, 'service');
            item.images.push(toDataUrl(processed));
          }
        }
        normalized.push(item);
      }
      if (normalized.length) business.services = normalized;
    }

    const saved = await business.save();
    res.status(businessId ? 200 : 201).json({
      message: 'Onboarding data saved',
      business: saved,
    });
  } catch (err) {
    console.error('Onboard endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/onboard-multipart',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'govtId', maxCount: 1 },
    { name: 'registrationProof', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 },
    { name: 'ownerPhoto', maxCount: 1 },
    { name: 'previewPhoto', maxCount: 1 },
    { name: 'serviceImages', maxCount: 30 }, // optional bulk images
  ]),
  async (req, res) => {
    try {
      const { businessId, userId, serviceType } = req.body || {};
      if (!userId || !serviceType) {
        return res.status(400).json({ message: 'userId and serviceType are required' });
      }

      // Parse JSON fields
      let businessInfo = {};
      let services = [];
      if (req.body.businessInfo) {
        try { businessInfo = JSON.parse(req.body.businessInfo); } catch { return res.status(400).json({ message: 'businessInfo must be valid JSON' }); }
      }
      if (req.body.services) {
        try { services = JSON.parse(req.body.services); } catch { return res.status(400).json({ message: 'services must be valid JSON' }); }
      }

      // Find or create business
      let business = null;
      if (businessId) {
        business = await Business.findById(businessId);
        if (!business) return res.status(404).json({ message: 'Business not found' });
      } else {
        // New listings default to draft verificationStatus
        business = new Business({ userId, serviceType, verificationStatus: 'draft' });
      }

      // Assign core info
      const basic = {};
      const fields = [
        'ownerName','businessName','email','phone','whatsapp','workingDays','openingTime','closingTime','gstNumber','bankAccount','ifscCode','isRegisteredBusiness','serviceDetail'
      ];
      for (const f of fields) if (businessInfo[f] !== undefined) basic[f] = businessInfo[f];
      if (businessInfo.location) basic.location = businessInfo.location;
      basic.userId = userId;
      basic.serviceType = serviceType;
      business.set(basic);

      const baseUrl = `${req.protocol}://${req.get('host')}`; // e.g., http://localhost:4000
      const fileUrl = (f) => `${baseUrl}/uploads/${path.basename(f.path)}`;

      // Helper to process and downscale images on disk in-place
      async function downscaleInPlace(filePath, kind) {
        const image = sharp(filePath);
        // Set reasonable sizes per kind
        const sizes = { logo: 512, doc: 1600, service: 1600, photo: 1024 };
        const max = sizes[kind] || 1600;
        await image
          .rotate()
          .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(`${filePath}.tmp`);
        await fs.promises.rename(`${filePath}.tmp`, filePath);
      }

      const files = req.files || {};
      // Single-file fields
      if (files.logo?.[0]) {
        await downscaleInPlace(files.logo[0].path, 'logo');
        business.logoUrl = fileUrl(files.logo[0]);
      }
      if (files.govtId?.[0]) {
        await downscaleInPlace(files.govtId[0].path, 'doc');
        business.govtIdUrl = fileUrl(files.govtId[0]);
      }
      if (files.registrationProof?.[0]) {
        await downscaleInPlace(files.registrationProof[0].path, 'doc');
        business.registrationProofUrl = fileUrl(files.registrationProof[0]);
      }
      if (files.cancelledCheque?.[0]) {
        await downscaleInPlace(files.cancelledCheque[0].path, 'doc');
        business.cancelledChequeUrl = fileUrl(files.cancelledCheque[0]);
      }
      if (files.ownerPhoto?.[0]) {
        await downscaleInPlace(files.ownerPhoto[0].path, 'photo');
        business.ownerPhotoUrl = fileUrl(files.ownerPhoto[0]);
      }
      if (files.previewPhoto?.[0]) {
        await downscaleInPlace(files.previewPhoto[0].path, 'photo');
        business.previewPhotoUrl = fileUrl(files.previewPhoto[0]);
      }

    
      if (Array.isArray(services) && services.length) {
        const normalized = [];
        for (let i = 0; i < services.length; i++) {
          const s = services[i];
          if (!s || !s.serviceName || !s.price) continue;
          const item = { serviceName: s.serviceName, price: s.price, discount: s.discount, images: [] };
          // If client provided imageIndices mapping, use it; else if files.serviceImages exist, attach all
          if (Array.isArray(s.imageIndices) && files.serviceImages?.length) {
            for (const idx of s.imageIndices) {
              const f = files.serviceImages[idx];
              if (!f) continue;
              await downscaleInPlace(f.path, 'service');
              item.images.push(fileUrl(f));
            }
          } else if (files.serviceImages?.length) {
            for (const f of files.serviceImages) {
              await downscaleInPlace(f.path, 'service');
              item.images.push(fileUrl(f));
            }
          }
          normalized.push(item);
        }
        if (normalized.length) business.services = normalized;
      }

  const saved = await business.save();
      res.status(businessId ? 200 : 201).json({ message: 'Onboarding data saved (multipart)', business: saved });
    } catch (err) {
      console.error('onboard-multipart error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);


router.put('/:businessId/status', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status } = req.body || {};
    if (!['online', 'offline'].includes(status)) {
      return res.status(400).json({ message: 'status must be online or offline' });
    }
    const updated = await Business.findByIdAndUpdate(
      businessId,
      { $set: { status } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Business not found' });
    res.json({ message: 'Status updated', business: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.put('/:businessId/verification', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { verificationStatus } = req.body || {};
    if (!['draft', 'verified'].includes(verificationStatus)) {
      return res.status(400).json({ message: 'verificationStatus must be draft or verified' });
    }
    const updated = await Business.findByIdAndUpdate(
      businessId,
      { $set: { verificationStatus } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Business not found' });
    res.json({ message: 'Verification status updated', business: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.put('/:businessId/contract', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { accepted } = req.body || {};
    const updated = await Business.findByIdAndUpdate(
      businessId,
      { $set: { partnerContractAccepted: !!accepted } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Business not found' });
    res.json({ message: 'Contract flag updated', business: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/user/:userId/online', async (req, res) => {
  try {
    const { userId } = req.params;
    const listings = await Business.find({ userId, status: 'online' });
    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.all('/add-service/:businessId', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Use POST /api/business/onboard with services[]' })
);


router.all('/update/:businessId', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Use POST /api/business/onboard with businessId' })
);


router.all('/docs/:businessId', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Use POST /api/business/onboard with documents{}' })
);


router.all('/', (req, res, next) => {
  if (req.method === 'POST') {
    return res.status(410).json({ message: 'Deprecated. Use POST /api/business/onboard' });
  }
  return next();
});

// Get all listings for a user (any status)
router.get("/user/:userId", async (req, res) => {
  try {
    const businesses = await Business.find({ userId: req.params.userId });
    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Deprecated: file upload endpoints (use POST /api/business/onboard with base64/data-urls)
router.all('/logo/:businessId', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Send logo in POST /api/business/onboard as data URL' })
);
router.all('/service-images/:businessId/:serviceIndex', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Send service images in POST /api/business/onboard' })
);

module.exports = router;

// Deprecated: legacy fetch-by-user at root path caused conflicts with other routes
router.all('/:userId', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Use GET /api/business/user/:userId or /api/business/user/:userId/online' })
);
