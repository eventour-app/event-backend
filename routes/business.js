const express = require("express");
const router = express.Router();
const Business = require("../models/Business");
const mongoose = require('mongoose');
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
      packages: rawPackages = [],
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
      // New listings should be visible to user app immediately
      business = new Business({
        userId,
        serviceType,
        verificationStatus: 'verified',
        status: 'online',
      });
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

    // Normalize services and pre-assign _id so packages can reference them within the same request
    let normalizedServices = [];
    if (Array.isArray(services) && services.length) {
      for (const s of services) {
        if (!s || !s.serviceName || !s.price) continue;
        const item = {
          _id: new mongoose.Types.ObjectId(),
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
        normalizedServices.push(item);
      }
      if (normalizedServices.length) business.services = normalizedServices;
    }

    // Packages: allow referencing existing services via selectedServiceIds, or newly provided services via selectedServiceIndices
    let packages = [];
    try {
      const pk = typeof rawPackages === 'string' ? JSON.parse(rawPackages) : rawPackages;
      if (Array.isArray(pk)) packages = pk;
    } catch {
      return res.status(400).json({ message: 'packages must be an array (or JSON stringified array)' });
    }

    // If this is a create (no businessId), enforce at least one service or package
    if (!businessId) {
      const hasServices = Array.isArray(normalizedServices) && normalizedServices.length > 0;
      const hasPackages = Array.isArray(packages) && packages.length > 0;
      if (!hasServices && !hasPackages) {
        return res.status(400).json({ message: 'At least one service or one package is required to create a listing' });
      }
    }

    if (Array.isArray(packages) && packages.length) {
      // Build a map of serviceId -> service combining existing (for updates) and new services from this request
      const serviceMap = new Map();
      // existing services if updating
      if (business && Array.isArray(business.services)) {
        for (const s of business.services) serviceMap.set(String(s._id), s);
      }
      // newly provided services
      for (const s of normalizedServices) serviceMap.set(String(s._id), s);

      const out = [];
      for (const p of packages) {
        if (!p || !p.name || !p.price) continue;
        let selectedIds = [];
        if (Array.isArray(p.selectedServiceIds) && p.selectedServiceIds.length) {
          selectedIds = p.selectedServiceIds.map(String);
        } else if (Array.isArray(p.selectedServiceIndices) && p.selectedServiceIndices.length) {
          // Map indices to ids from normalizedServices only
          for (const idx of p.selectedServiceIndices) {
            const i = Number(idx);
            if (Number.isInteger(i) && i >= 0 && i < normalizedServices.length) {
              selectedIds.push(String(normalizedServices[i]._id));
            }
          }
        }
        // Validate all ids exist in our map
        const invalid = selectedIds.filter(id => !serviceMap.has(String(id)));
        if (invalid.length) {
          return res.status(400).json({ message: 'One or more selectedServiceIds do not exist on this listing', invalid });
        }
        if (selectedIds.length === 0) continue; // skip empty package

        out.push({
          name: String(p.name).trim(),
          selectedServiceIds: selectedIds,
          price: String(p.price),
          description: p.description ? String(p.description) : undefined,
          createdAt: new Date(),
          active: p.active !== undefined ? !!p.active : true,
        });
      }
      if (out.length) {
        business.packages = business.packages || [];
        // For onboarding, append packages to any existing ones
        business.packages.push(...out);
      }
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
      let packages = [];
      if (req.body.businessInfo) {
        try { businessInfo = JSON.parse(req.body.businessInfo); } catch { return res.status(400).json({ message: 'businessInfo must be valid JSON' }); }
      }
      if (req.body.services) {
        try { services = JSON.parse(req.body.services); } catch { return res.status(400).json({ message: 'services must be valid JSON' }); }
      }
      if (req.body.packages) {
        try { packages = JSON.parse(req.body.packages); } catch { return res.status(400).json({ message: 'packages must be valid JSON' }); }
      }

      // Find or create business
      let business = null;
      if (businessId) {
        business = await Business.findById(businessId);
        if (!business) return res.status(404).json({ message: 'Business not found' });
      } else {
        // Make new listings public by default so they show in the user app immediately
        business = new Business({
          userId,
          serviceType,
          verificationStatus: 'verified',
          status: 'online',
        });
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

    
      // Normalize services with pre-assigned _id for package referencing
      let normalizedServices = [];
      if (Array.isArray(services) && services.length) {
        for (let i = 0; i < services.length; i++) {
          const s = services[i];
          if (!s || !s.serviceName || !s.price) continue;
          const item = { _id: new mongoose.Types.ObjectId(), serviceName: s.serviceName, price: s.price, discount: s.discount, images: [] };
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
          normalizedServices.push(item);
        }
        if (normalizedServices.length) business.services = normalizedServices;
      }

      // If this is create, ensure at least one service or package
      if (!businessId) {
        const hasServices = Array.isArray(normalizedServices) && normalizedServices.length > 0;
        const hasPackages = Array.isArray(packages) && packages.length > 0;
        if (!hasServices && !hasPackages) {
          return res.status(400).json({ message: 'At least one service or one package is required to create a listing' });
        }
      }

      // Handle packages referencing services
      if (Array.isArray(packages) && packages.length) {
        const serviceMap = new Map();
        if (business && Array.isArray(business.services)) {
          for (const s of business.services) serviceMap.set(String(s._id), s);
        }
        for (const s of normalizedServices) serviceMap.set(String(s._id), s);

        const out = [];
        for (const p of packages) {
          if (!p || !p.name || !p.price) continue;
          let selectedIds = [];
          if (Array.isArray(p.selectedServiceIds) && p.selectedServiceIds.length) {
            selectedIds = p.selectedServiceIds.map(String);
          } else if (Array.isArray(p.selectedServiceIndices) && p.selectedServiceIndices.length) {
            for (const idx of p.selectedServiceIndices) {
              const i = Number(idx);
              if (Number.isInteger(i) && i >= 0 && i < normalizedServices.length) {
                selectedIds.push(String(normalizedServices[i]._id));
              }
            }
          }
          const invalid = selectedIds.filter(id => !serviceMap.has(String(id)));
          if (invalid.length) {
            return res.status(400).json({ message: 'One or more selectedServiceIds do not exist on this listing', invalid });
          }
          if (selectedIds.length === 0) continue;
          out.push({
            name: String(p.name).trim(),
            selectedServiceIds: selectedIds,
            price: String(p.price),
            description: p.description ? String(p.description) : undefined,
            createdAt: new Date(),
            active: p.active !== undefined ? !!p.active : true,
          });
        }
        if (out.length) {
          business.packages = business.packages || [];
          business.packages.push(...out);
        }
      }

      const saved = await business.save();
      res.status(businessId ? 200 : 201).json({ message: 'Onboarding data saved (multipart)', business: saved });
    } catch (err) {
      console.error('onboard-multipart error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);


  // ---------------- Packages Endpoints ----------------
  // Create a package for a business (listing)
  // POST /api/business/:businessId/packages
  // body: { name: string, selectedServiceIds: string[], price: string, description?: string }
  router.post('/:businessId/packages', async (req, res) => {
    try {
      const { businessId } = req.params;
      const { name, selectedServiceIds, price, description } = req.body || {};

      if (!name || !price || !Array.isArray(selectedServiceIds) || selectedServiceIds.length === 0) {
        return res.status(400).json({ message: 'name, price and selectedServiceIds[] are required' });
      }

      const business = await Business.findById(businessId);
      if (!business) return res.status(404).json({ message: 'Business not found' });

      // Validate that all selected service IDs belong to this business.services
      const serviceIdSet = new Set(business.services.map(s => String(s._id)));
      const invalid = selectedServiceIds.filter(id => !serviceIdSet.has(String(id)));
      if (invalid.length) {
        return res.status(400).json({ message: 'One or more selectedServiceIds do not exist on this listing', invalid });
      }

      const pkg = {
        name: String(name).trim(),
        selectedServiceIds: selectedServiceIds.map(String),
        price: String(price),
        description: description ? String(description) : undefined,
        createdAt: new Date(),
        active: true,
      };

      business.packages = business.packages || [];
      business.packages.push(pkg);
      await business.save();

      // Return the created package (last item)
      const created = business.packages[business.packages.length - 1];
      res.status(201).json({ message: 'Package created', package: created });
    } catch (err) {
      console.error('create package error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List packages for a business with selected service details expanded
  // GET /api/business/:businessId/packages
  router.get('/:businessId/packages', async (req, res) => {
    try {
      const { businessId } = req.params;
      const business = await Business.findById(businessId).lean();
      if (!business) return res.status(404).json({ message: 'Business not found' });

      const servicesById = new Map((business.services || []).map(s => [String(s._id), s]));
      const packages = (business.packages || []).map(p => ({
        ...p,
        selectedServices: (p.selectedServiceIds || []).map(id => servicesById.get(String(id))).filter(Boolean),
      }));

      res.json({ packages });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// ---------------- Add Services to an existing listing ----------------
// POST /api/business/:businessId/services
// body: { services: [{ serviceName, price, discount?, images?: string[] (data URLs or URLs) }] }
router.post('/:businessId/services', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { services = [] } = req.body || {};
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ message: 'services[] is required with at least one item' });
    }
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: 'Business not found' });

    const toAdd = [];
    for (const s of services) {
      if (!s || !s.serviceName || !s.price) continue;
      const item = {
        _id: new mongoose.Types.ObjectId(),
        serviceName: String(s.serviceName),
        price: String(s.price),
        discount: s.discount ? String(s.discount) : undefined,
        images: [],
      };
      if (Array.isArray(s.images) && s.images.length) {
        for (const img of s.images) {
          if (typeof img === 'string' && img.startsWith('data:')) {
            const p = parseDataUrl(img);
            if (!p) continue;
            const processed = await processImage(p.buffer, 'service');
            item.images.push(toDataUrl(processed));
          } else if (typeof img === 'string') {
            // Accept plain URLs as-is
            item.images.push(img);
          }
        }
      }
      toAdd.push(item);
    }
    if (!toAdd.length) {
      return res.status(400).json({ message: 'No valid services provided' });
    }
    business.services = business.services || [];
    business.services.push(...toAdd);
    await business.save();
    res.status(201).json({ message: 'Services added', services: toAdd });
  } catch (err) {
    console.error('add services error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Update online/offline status with optional scheduling support
// PUT /api/business/:businessId/status
// Body supports:
// - { status: 'online' }
//   => clears offlineSince/offlineUntil
// - { status: 'offline', mode: 'preset', preset: '1h'|'2h'|'5h' }
// - { status: 'offline', mode: 'custom', durationMinutes?: number, durationHours?: number }
// - { status: 'offline', mode: 'until-back' } // manual toggle back online
router.put('/:businessId/status', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, mode, preset, durationMinutes, durationHours, until } = req.body || {};
    if (!['online', 'offline'].includes(status)) {
      return res.status(400).json({ message: 'status must be online or offline' });
    }

    const update = { status };
    if (status === 'online') {
      update.offlineSince = null;
      update.offlineUntil = null;
    } else {
      // status === 'offline'
      update.offlineSince = new Date();
      let untilDate = null;
      if (mode === 'preset') {
        const map = { '1h': 60, '2h': 120, '5h': 300 };
        const mins = map[preset];
        if (!mins) return res.status(400).json({ message: 'Invalid preset. Use 1h, 2h, or 5h' });
        untilDate = new Date(Date.now() + mins * 60 * 1000);
      } else if (mode === 'custom') {
        const mins = (Number(durationMinutes) || 0) + (Number(durationHours) || 0) * 60;
        if (!Number.isFinite(mins) || mins <= 0) {
          return res.status(400).json({ message: 'Provide durationMinutes and/or durationHours > 0' });
        }
        untilDate = new Date(Date.now() + mins * 60 * 1000);
      } else if (mode === 'until-back' || mode === 'manual' || mode === undefined) {
        // Explicit manual mode or unspecified mode => stay offline until manual online
        untilDate = null;
      } else if (mode === 'until-timestamp') {
        const ts = new Date(until);
        if (isNaN(ts.getTime())) return res.status(400).json({ message: 'Invalid until timestamp' });
        if (ts.getTime() <= Date.now()) return res.status(400).json({ message: 'until must be in the future' });
        untilDate = ts;
      } else {
        return res.status(400).json({ message: 'Invalid mode' });
      }
      update.offlineUntil = untilDate;
    }

    const updated = await Business.findByIdAndUpdate(
      businessId,
      { $set: update },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Business not found' });
    res.json({ message: 'Status updated', business: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Availability snapshot
// GET /api/business/:businessId/availability
// Returns: { status, offlineSince, offlineUntil, remainingSeconds, serverTime }
router.get('/:businessId/availability', async (req, res) => {
  try {
    const { businessId } = req.params;
    const doc = await Business.findById(businessId).select('status offlineSince offlineUntil').lean();
    if (!doc) return res.status(404).json({ message: 'Business not found' });
    let remainingSeconds = null;
    if (doc.status === 'offline' && doc.offlineUntil) {
      remainingSeconds = Math.max(0, Math.ceil((new Date(doc.offlineUntil).getTime() - Date.now()) / 1000));
    }
    res.json({ ...doc, remainingSeconds, serverTime: new Date() });
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

// ---------------- Listing Details (vendor-side) ----------------
// GET /api/business/:businessId
// Returns full listing with services and packages, expanding selected services on packages
router.get('/:businessId', async (req, res, next) => {
  // Avoid clashing with other defined, more specific routes by ensuring this runs before the legacy catch-all
  try {
    const { businessId } = req.params;
    const projection = {
      logo: 0,
      govtId: 0,
      registrationProof: 0,
      cancelledCheque: 0,
      ownerPhoto: 0,
      previewPhoto: 0,
      __v: 0,
    };
    const doc = await Business.findById(businessId).select(projection).lean();
    if (!doc) return res.status(404).json({ message: 'Listing not found' });
    const servicesById = new Map((doc.services || []).map(s => [String(s._id), s]));
    const packages = (doc.packages || []).map(p => ({
      _id: p._id,
      name: p.name,
      price: p.price,
      description: p.description,
      createdAt: p.createdAt,
      active: p.active,
      selectedServiceIds: p.selectedServiceIds,
      selectedServices: (p.selectedServiceIds || []).map(id => servicesById.get(String(id))).filter(Boolean),
    }));
    return res.json({ ...doc, packages });
  } catch (err) {
    return next(err);
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
