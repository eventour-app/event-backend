const express = require("express");
const router = express.Router();
const Business = require("../models/Business");
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { processImage, toDataUrl } = require('../utils/imageProcessor');
const { THEMES, EVENT_TYPES, SERVICE_LOCATIONS, PANDIT_LANGUAGES, PANDIT_SERVICES } = require('../utils/vendorSpecializations');
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

// Build a public base URL for serving images
function getBaseUrl(req) {
  const envBase = process.env.PUBLIC_BASE_URL && String(process.env.PUBLIC_BASE_URL).trim();
  if (envBase) return envBase.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`; // e.g., http://localhost:4000
}

// Normalize an incoming image reference into a storable URL
// Accepts:
//  - data URLs (data:image/...;base64,...) -> will be processed and saved separately
//  - absolute http/https URLs -> kept as-is
//  - relative 'uploads/...' or '/uploads/...' -> rewritten to absolute URL on this server
function normalizeIncomingImageUrl(value, req) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('data:')) return value; // handled by processing path
  const base = getBaseUrl(req);
  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value; // already absolute; store as-is
    }
  } catch {
    // fallthrough
  }
  // Handle relative variants
  const rel = value.startsWith('/') ? value : `/${value}`;
  if (rel.startsWith('/uploads/')) return `${base}${rel}`;
  return null; // unsupported arbitrary relative paths
}

// Persist a processed image buffer to /uploads and return its public URL
async function saveBufferAsUpload(processed, prefix, req) {
  const ext = processed.ext || (processed.mimeType === 'image/png' ? 'png' : 'jpg');
  const safePrefix = (prefix || 'img').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safePrefix}.${ext}`;
  const fpath = path.join(uploadsRoot, fname);
  await fs.promises.writeFile(fpath, processed.buffer);
  const base = getBaseUrl(req);
  return `${base}/uploads/${fname}`;
}

router.all('/register', (req, res) =>
  res.status(410).json({ message: 'Deprecated. Use POST /api/business/onboard' })
);

// GET /api/business/options
router.get('/options', (req, res) => {
  res.json({
    themes: THEMES,
    eventTypes: EVENT_TYPES,
    serviceLocations: SERVICE_LOCATIONS,
    panditLanguages: PANDIT_LANGUAGES,
    panditServices: PANDIT_SERVICES,
  });
});

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
//     workingDays: string[], openingTime, closingTime,
//     gstNumber, cinNumber, panNumber, aadhaarNumber,
//     bankAccount, ifscCode,
//     isRegisteredBusiness?: boolean,
//     serviceDetail?: string,
//     themes?: string[], // for non-Pandit
//     eventTypes?: string[], // for non-Pandit
//     languages?: string[] // for Pandit
//   },
//   logo?: string, // data URL or base64
//   documents?: { govtId?: string, registrationProof?: string, cancelledCheque?: string }, // data URLs/base64
//   photos?: { ownerPhoto?: string, previewPhoto?: string }, // data URLs/base64
//   services?: [
//     {
//       serviceName: string,
//       price: string,
//       discount?: string,
//       description?: string, // short description (max 200 chars)
//       maxPlates?: number,
//       images?: string[], // image data URLs/base64
//       serviceLocations?: string[], // where service is provided: Terrace, Car boot, Living room, Cabinet, Lawn, Backyard, Apartment
//       hasSubServices?: 'yes' | 'no', // enum indicating if sub-services exist
//       subServices?: [ // only used when hasSubServices is 'yes'
//         {
//           serviceName: string,
//           price: string,
//           discount?: string,
//           description?: string,
//           maxPlates?: number,
//           images?: string[]
//         }
//       ]
//     }
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
      minBookingNoticeDays,
    } = req.body || {};

    if (!userId || !serviceType) {
      return res.status(400).json({ message: 'userId and serviceType are required' });
    }
    // Accept minBookingNoticeDays from root or businessInfo
    const effectiveMinBooking = (
      minBookingNoticeDays !== undefined && minBookingNoticeDays !== null
    ) ? minBookingNoticeDays : businessInfo.minBookingNoticeDays;
    // Validate minBookingNoticeDays on create (no businessId) or if provided on update
    if (!businessId) {
      if (effectiveMinBooking === undefined || effectiveMinBooking === null) {
        return res.status(400).json({ message: 'minBookingNoticeDays is required' });
      }
    }
    if (effectiveMinBooking !== undefined && effectiveMinBooking !== null) {
      const val = Number(effectiveMinBooking);
      if (!Number.isInteger(val) || val < 0) {
        return res.status(400).json({ message: 'minBookingNoticeDays must be a whole number >= 0' });
      }
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
      'workingDays', 'openingTime', 'closingTime', 'gstNumber', 'cinNumber', 'panNumber', 'aadhaarNumber',
      'bankAccount', 'ifscCode', 'isRegisteredBusiness', 'serviceDetail',
      'themes', 'eventTypes', 'languages'
    ];
    for (const f of fields) if (businessInfo[f] !== undefined) basic[f] = businessInfo[f];
  if (businessInfo.location) basic.location = businessInfo.location;
  basic.userId = userId; // ensure association doesn't get lost
    basic.serviceType = serviceType; // ensure stored
    business.set(basic);
  if (effectiveMinBooking !== undefined && effectiveMinBooking !== null) business.minBookingNoticeDays = Number(effectiveMinBooking);

    // Validation for Pandit service type
    if (serviceType === 'Pandit') {
      if (!basic.gstNumber) return res.status(400).json({ message: 'GST Number is required for Pandit service type' });
      if (!basic.cinNumber) return res.status(400).json({ message: 'CIN Number is required for Pandit service type' });
      if (!businessInfo.languages || !Array.isArray(businessInfo.languages) || businessInfo.languages.length === 0) {
        return res.status(400).json({ message: 'At least one language must be selected for Pandit service type' });
      }
    }

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
      // Also persist to disk for public consumption
      business.logoUrl = await saveBufferAsUpload(processed, 'logo', req);
    }

    if (documents && typeof documents === 'object') {
      if (documents.govtId) {
        const p = parseDataUrl(documents.govtId);
        if (!p) return res.status(400).json({ message: 'Invalid govtId format' });
        const processed = await processImage(p.buffer, 'doc');
        business.govtId = processed.buffer;
        business.govtIdUrl = await saveBufferAsUpload(processed, 'govtId', req);
      }
      if (documents.registrationProof) {
        const p = parseDataUrl(documents.registrationProof);
        if (!p) return res.status(400).json({ message: 'Invalid registrationProof format' });
        const processed = await processImage(p.buffer, 'doc');
        business.registrationProof = processed.buffer;
        business.registrationProofUrl = await saveBufferAsUpload(processed, 'registrationProof', req);
      }
      if (documents.cancelledCheque) {
        const p = parseDataUrl(documents.cancelledCheque);
        if (!p) return res.status(400).json({ message: 'Invalid cancelledCheque format' });
        const processed = await processImage(p.buffer, 'doc');
        business.cancelledCheque = processed.buffer;
        business.cancelledChequeUrl = await saveBufferAsUpload(processed, 'cancelledCheque', req);
      }
    }

    if (photos && typeof photos === 'object') {
      if (photos.ownerPhoto) {
        const p = parseDataUrl(photos.ownerPhoto);
        if (!p) return res.status(400).json({ message: 'Invalid ownerPhoto format' });
        const processed = await processImage(p.buffer, 'doc');
        business.ownerPhoto = processed.buffer;
        business.ownerPhotoUrl = await saveBufferAsUpload(processed, 'ownerPhoto', req);
      }
      if (photos.previewPhoto) {
        const p = parseDataUrl(photos.previewPhoto);
        if (!p) return res.status(400).json({ message: 'Invalid previewPhoto format' });
        const processed = await processImage(p.buffer, 'doc');
        business.previewPhoto = processed.buffer;
        business.previewPhotoUrl = await saveBufferAsUpload(processed, 'previewPhoto', req);
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
          description: s.description,
          maxPlates: s.maxPlates !== undefined ? Number(s.maxPlates) : undefined,
          images: [],
          serviceLocations: Array.isArray(s.serviceLocations) ? s.serviceLocations.map(String) : [],
          hasSubServices: s.hasSubServices === 'yes' ? 'yes' : 'no',
          subServices: [],
        };
        // Photographer-specific tiered rates (hours → charge)
        // Accept when listing serviceType includes "photographer" (case-insensitive)
        if (/photographer/i.test(String(serviceType || ''))) {
          if (Array.isArray(s.rates)) {
            const rates = [];
            for (const r of s.rates) {
              if (!r) continue;
              const hours = Number(r.hours);
              const charge = r.charge;
              if (!Number.isInteger(hours) || hours <= 0) continue;
              if (typeof charge !== 'string' || !String(charge).trim()) continue;
              rates.push({ hours, charge: String(charge) });
            }
            if (rates.length) item.rates = rates;
          }
        }
        
        // Invitation Card Designer / Card Printing specific fields
        if (/invitation card designer/i.test(String(serviceType || ''))) {
          // Card specifications
          if (s.numberOfPages !== undefined) item.numberOfPages = Number(s.numberOfPages);
          if (s.isLaminated !== undefined) item.isLaminated = Boolean(s.isLaminated);
          if (s.laminationType) item.laminationType = String(s.laminationType);
          
          // Dimensions
          if (s.cardWidth !== undefined) item.cardWidth = Number(s.cardWidth);
          if (s.cardHeight !== undefined) item.cardHeight = Number(s.cardHeight);
          if (s.dimensionUnit) item.dimensionUnit = String(s.dimensionUnit);
          
          // Paper details
          if (s.paperThickness) item.paperThickness = String(s.paperThickness);
          if (s.paperMaterial) item.paperMaterial = String(s.paperMaterial);
          
          // Available colors
          if (Array.isArray(s.availableColors)) {
            item.availableColors = s.availableColors.map(String);
          }
          
          // Bulk discounts
          if (Array.isArray(s.bulkDiscounts)) {
            item.bulkDiscounts = s.bulkDiscounts
              .filter(d => d && d.quantity)
              .map(d => ({
                quantity: Number(d.quantity),
                discountPercent: d.discountPercent !== undefined ? Number(d.discountPercent) : undefined,
                discountPrice: d.discountPrice !== undefined ? Number(d.discountPrice) : undefined,
              }));
          }
          
          // Additional props/design
          if (s.additionalPropsDesign) item.additionalPropsDesign = String(s.additionalPropsDesign);
          
          // Envelope details
          if (s.includesEnvelope !== undefined) item.includesEnvelope = Boolean(s.includesEnvelope);
          if (s.envelopeDesign) item.envelopeDesign = String(s.envelopeDesign);
          if (s.envelopeColor) item.envelopeColor = String(s.envelopeColor);
          item.envelopeImages = [];
          if (Array.isArray(s.envelopeImages) && s.envelopeImages.length) {
            for (const img of s.envelopeImages) {
              if (typeof img !== 'string') continue;
              if (img.startsWith('data:')) {
                const p = parseDataUrl(img);
                if (!p) continue;
                const processed = await processImage(p.buffer, 'envelope');
                const url = await saveBufferAsUpload(processed, 'envelope', req);
                item.envelopeImages.push(url);
              } else {
                const normalized = normalizeIncomingImageUrl(img, req);
                if (normalized) item.envelopeImages.push(normalized);
              }
            }
          }
          
          // Wax seal details
          if (s.hasWaxSeal !== undefined) item.hasWaxSeal = Boolean(s.hasWaxSeal);
          if (s.waxSealColor) item.waxSealColor = String(s.waxSealColor);
          if (s.waxSealDesign) item.waxSealDesign = String(s.waxSealDesign);
          if (s.waxSealPrice !== undefined) item.waxSealPrice = Number(s.waxSealPrice);
          item.waxSealImages = [];
          if (Array.isArray(s.waxSealImages) && s.waxSealImages.length) {
            for (const img of s.waxSealImages) {
              if (typeof img !== 'string') continue;
              if (img.startsWith('data:')) {
                const p = parseDataUrl(img);
                if (!p) continue;
                const processed = await processImage(p.buffer, 'waxseal');
                const url = await saveBufferAsUpload(processed, 'waxseal', req);
                item.waxSealImages.push(url);
              } else {
                const normalized = normalizeIncomingImageUrl(img, req);
                if (normalized) item.waxSealImages.push(normalized);
              }
            }
          }
          
          // Card type and production details
          if (s.cardType) item.cardType = String(s.cardType);
          if (s.minimumOrderQuantity !== undefined) item.minimumOrderQuantity = Number(s.minimumOrderQuantity);
          if (s.productionTimeInDays !== undefined) item.productionTimeInDays = Number(s.productionTimeInDays);
        }
        
        if (Array.isArray(s.images) && s.images.length) {
          for (const img of s.images) {
            if (typeof img !== 'string') continue;
            if (img.startsWith('data:')) {
              const p = parseDataUrl(img);
              if (!p) continue; // skip invalid entries silently
              const processed = await processImage(p.buffer, 'service');
              // Save to disk and store as public URL rather than giant data URLs
              const url = await saveBufferAsUpload(processed, 'service', req);
              item.images.push(url);
            } else {
              const normalized = normalizeIncomingImageUrl(img, req);
              if (normalized) item.images.push(normalized);
            }
          }
        }
        // Handle sub-services if hasSubServices is 'yes'
        if (item.hasSubServices === 'yes' && Array.isArray(s.subServices) && s.subServices.length) {
          for (const sub of s.subServices) {
            if (!sub || !sub.serviceName || !sub.price) continue;
            const subItem = {
              _id: new mongoose.Types.ObjectId(),
              serviceName: sub.serviceName,
              price: sub.price,
              discount: sub.discount,
              description: sub.description,
              maxPlates: sub.maxPlates !== undefined ? Number(sub.maxPlates) : undefined,
              images: [],
            };
            // Process sub-service images
            if (Array.isArray(sub.images) && sub.images.length) {
              for (const img of sub.images) {
                if (typeof img !== 'string') continue;
                if (img.startsWith('data:')) {
                  const p = parseDataUrl(img);
                  if (!p) continue;
                  const processed = await processImage(p.buffer, 'service');
                  const url = await saveBufferAsUpload(processed, 'service', req);
                  subItem.images.push(url);
                } else {
                  const normalized = normalizeIncomingImageUrl(img, req);
                  if (normalized) subItem.images.push(normalized);
                }
              }
            }
            item.subServices.push(subItem);
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
      let { minBookingNoticeDays } = req.body || {};

      // Parse JSON fields
      let businessInfo = {};
      let services = [];
      let packages = [];
      if (req.body.businessInfo) {
        try { businessInfo = JSON.parse(req.body.businessInfo); } catch { return res.status(400).json({ message: 'businessInfo must be valid JSON' }); }
      }
      // Allow minBookingNoticeDays from businessInfo if not provided at root
      if (minBookingNoticeDays === undefined || minBookingNoticeDays === null) {
        if (businessInfo && businessInfo.minBookingNoticeDays !== undefined && businessInfo.minBookingNoticeDays !== null) {
          minBookingNoticeDays = businessInfo.minBookingNoticeDays;
        }
      }
      // Validate presence on create
      if (!businessId) {
        if (minBookingNoticeDays === undefined || minBookingNoticeDays === null) {
          return res.status(400).json({ message: 'minBookingNoticeDays is required' });
        }
      }
      // Validate format if provided
      if (minBookingNoticeDays !== undefined && minBookingNoticeDays !== null) {
        const val = Number(minBookingNoticeDays);
        if (!Number.isInteger(val) || val < 0) {
          return res.status(400).json({ message: 'minBookingNoticeDays must be a whole number >= 0' });
        }
        minBookingNoticeDays = val;
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
        'ownerName','businessName','email','phone','whatsapp','workingDays','openingTime','closingTime','gstNumber','cinNumber','panNumber','aadhaarNumber',
        'bankAccount','ifscCode','isRegisteredBusiness','serviceDetail'
      ];
      for (const f of fields) if (businessInfo[f] !== undefined) basic[f] = businessInfo[f];
      if (businessInfo.location) basic.location = businessInfo.location;
      basic.userId = userId;
      basic.serviceType = serviceType;
      business.set(basic);
  if (minBookingNoticeDays !== undefined) business.minBookingNoticeDays = minBookingNoticeDays;

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
          const item = { _id: new mongoose.Types.ObjectId(), serviceName: s.serviceName, price: s.price, discount: s.discount, maxPlates: s.maxPlates !== undefined ? Number(s.maxPlates) : undefined, images: [] };
          // Photographer-specific tiered rates
          if (/photographer/i.test(String(serviceType || ''))) {
            if (Array.isArray(s.rates)) {
              const rates = [];
              for (const r of s.rates) {
                if (!r) continue;
                const hours = Number(r.hours);
                const charge = r.charge;
                if (!Number.isInteger(hours) || hours <= 0) continue;
                if (typeof charge !== 'string' || !String(charge).trim()) continue;
                rates.push({ hours, charge: String(charge) });
              }
              if (rates.length) item.rates = rates;
            }
          }
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

  // List services for a business (vendor-side)
  // GET /api/business/:businessId/services
  // Returns all services with full details for all service types (Pandit, Photographer, Food Caterer, Card Printer, etc.)
  router.get('/:businessId/services', async (req, res) => {
    try {
      const { businessId } = req.params;
      const business = await Business.findById(businessId).lean();
      if (!business) return res.status(404).json({ message: 'Business not found' });
      
      // Return full service objects with all fields for all service types
      const services = (business.services || []).map(s => {
        const service = {
          _id: s._id,
          serviceName: s.serviceName,
          price: s.price,
          discount: s.discount,
          description: s.description,
          images: s.images || [],
          serviceLocations: s.serviceLocations || [],
          hasSubServices: s.hasSubServices || 'no',
          
          // Pandit-specific fields
          type: s.type,
          subtype: s.subtype,
          hours: s.hours,
          
          // Food Caterer specific
          maxPlates: s.maxPlates,
          
          // Photographer specific - tiered rates
          rates: s.rates || [],
          
          // Invitation Card Designer / Card Printing specific fields
          numberOfPages: s.numberOfPages,
          isLaminated: s.isLaminated,
          laminationType: s.laminationType,
          cardWidth: s.cardWidth,
          cardHeight: s.cardHeight,
          dimensionUnit: s.dimensionUnit,
          paperThickness: s.paperThickness,
          paperMaterial: s.paperMaterial,
          availableColors: s.availableColors || [],
          bulkDiscounts: s.bulkDiscounts || [],
          additionalPropsDesign: s.additionalPropsDesign,
          includesEnvelope: s.includesEnvelope,
          envelopeDesign: s.envelopeDesign,
          envelopeImages: s.envelopeImages || [],
          envelopeColor: s.envelopeColor,
          hasWaxSeal: s.hasWaxSeal,
          waxSealColor: s.waxSealColor,
          waxSealDesign: s.waxSealDesign,
          waxSealImages: s.waxSealImages || [],
          waxSealPrice: s.waxSealPrice,
          cardType: s.cardType,
          minimumOrderQuantity: s.minimumOrderQuantity,
          productionTimeInDays: s.productionTimeInDays,
          
          // Sub-services (for Pandit and others)
          subServices: (s.subServices || []).map(sub => ({
            _id: sub._id,
            serviceName: sub.serviceName,
            subtype: sub.subtype,
            hours: sub.hours,
            price: sub.price,
            discount: sub.discount,
            description: sub.description,
            maxPlates: sub.maxPlates,
            images: sub.images || [],
          })),
        };
        
        // Clean up undefined values for cleaner response
        Object.keys(service).forEach(key => {
          if (service[key] === undefined) delete service[key];
        });
        
        return service;
      });
      
      res.json({ 
        services, 
        total: services.length,
        serviceType: business.serviceType,
        business: {
          _id: business._id,
          businessName: business.businessName,
          serviceType: business.serviceType,
        }
      });
    } catch (err) {
      console.error('get services error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get single service details
  // GET /api/business/:businessId/services/:serviceId
  // Returns full service details for any service type
  router.get('/:businessId/services/:serviceId', async (req, res) => {
    try {
      const { businessId, serviceId } = req.params;
      
      const business = await Business.findById(businessId).lean();
      if (!business) return res.status(404).json({ message: 'Business not found' });
      
      const s = (business.services || []).find(svc => String(svc._id) === String(serviceId));
      if (!s) return res.status(404).json({ message: 'Service not found' });
      
      // Build full service object with all fields
      const service = {
        _id: s._id,
        serviceName: s.serviceName,
        price: s.price,
        discount: s.discount,
        description: s.description,
        images: s.images || [],
        serviceLocations: s.serviceLocations || [],
        hasSubServices: s.hasSubServices || 'no',
        
        // Pandit-specific fields
        type: s.type,
        subtype: s.subtype,
        hours: s.hours,
        
        // Food Caterer specific
        maxPlates: s.maxPlates,
        
        // Photographer specific - tiered rates
        rates: s.rates || [],
        
        // Invitation Card Designer / Card Printing specific fields
        numberOfPages: s.numberOfPages,
        isLaminated: s.isLaminated,
        laminationType: s.laminationType,
        cardWidth: s.cardWidth,
        cardHeight: s.cardHeight,
        dimensionUnit: s.dimensionUnit,
        paperThickness: s.paperThickness,
        paperMaterial: s.paperMaterial,
        availableColors: s.availableColors || [],
        bulkDiscounts: s.bulkDiscounts || [],
        additionalPropsDesign: s.additionalPropsDesign,
        includesEnvelope: s.includesEnvelope,
        envelopeDesign: s.envelopeDesign,
        envelopeImages: s.envelopeImages || [],
        envelopeColor: s.envelopeColor,
        hasWaxSeal: s.hasWaxSeal,
        waxSealColor: s.waxSealColor,
        waxSealDesign: s.waxSealDesign,
        waxSealImages: s.waxSealImages || [],
        waxSealPrice: s.waxSealPrice,
        cardType: s.cardType,
        minimumOrderQuantity: s.minimumOrderQuantity,
        productionTimeInDays: s.productionTimeInDays,
        
        // Sub-services
        subServices: (s.subServices || []).map(sub => ({
          _id: sub._id,
          serviceName: sub.serviceName,
          subtype: sub.subtype,
          hours: sub.hours,
          price: sub.price,
          discount: sub.discount,
          description: sub.description,
          maxPlates: sub.maxPlates,
          images: sub.images || [],
        })),
      };
      
      // Clean up undefined values
      Object.keys(service).forEach(key => {
        if (service[key] === undefined) delete service[key];
      });
      
      res.json({ 
        service,
        business: {
          _id: business._id,
          businessName: business.businessName,
          serviceType: business.serviceType,
        }
      });
    } catch (err) {
      console.error('get service error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Update a package
  // PUT /api/business/:businessId/packages/:packageId
  // Body (any subset): { name?, price?, description?, active?, selectedServiceIds?: string[] }
  router.put('/:businessId/packages/:packageId', async (req, res) => {
    try {
      const { businessId, packageId } = req.params;
      const { name, price, description, active, selectedServiceIds } = req.body || {};

      const business = await Business.findById(businessId);
      if (!business) return res.status(404).json({ message: 'Business not found' });
      const pkg = (business.packages || []).find(p => String(p._id) === String(packageId));
      if (!pkg) return res.status(404).json({ message: 'Package not found' });

      if (name !== undefined) pkg.name = String(name).trim();
      if (price !== undefined) pkg.price = String(price);
      if (description !== undefined) pkg.description = description === null ? undefined : String(description);
      if (active !== undefined) pkg.active = !!active;

      if (selectedServiceIds !== undefined) {
        if (!Array.isArray(selectedServiceIds) || selectedServiceIds.length === 0) {
          return res.status(400).json({ message: 'selectedServiceIds must be a non-empty array' });
        }
        const serviceIdSet = new Set((business.services || []).map(s => String(s._id)));
        const ids = selectedServiceIds.map(String);
        const invalid = ids.filter(id => !serviceIdSet.has(id));
        if (invalid.length) {
          return res.status(400).json({ message: 'One or more selectedServiceIds do not exist on this listing', invalid });
        }
        // de-duplicate while preserving order
        const seen = new Set();
        const unique = [];
        for (const id of ids) { if (!seen.has(id)) { seen.add(id); unique.push(id); } }
        pkg.selectedServiceIds = unique;
      }

      await business.save();
      const servicesById = new Map((business.services || []).map(s => [String(s._id), s]));
      const out = {
        _id: pkg._id,
        name: pkg.name,
        price: pkg.price,
        description: pkg.description,
        active: pkg.active,
        selectedServiceIds: pkg.selectedServiceIds,
        selectedServices: (pkg.selectedServiceIds || []).map(id => servicesById.get(String(id))).filter(Boolean),
      };
      return res.json({ message: 'Package updated', package: out });
    } catch (err) {
      console.error('update package error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Delete a package
  // DELETE /api/business/:businessId/packages/:packageId
  router.delete('/:businessId/packages/:packageId', async (req, res) => {
    try {
      const { businessId, packageId } = req.params;
      const business = await Business.findById(businessId);
      if (!business) return res.status(404).json({ message: 'Business not found' });
      const before = (business.packages || []).length;
      business.packages = (business.packages || []).filter(p => String(p._id) !== String(packageId));
      const removed = before - (business.packages || []).length;
      if (!removed) return res.status(404).json({ message: 'Package not found' });
      await business.save();
      return res.json({ message: 'Package deleted' });
    } catch (err) {
      console.error('delete package error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

// ---------------- Add Services to an existing listing ----------------
// POST /api/business/:businessId/services
// body: { services: [{ serviceName, price?, discount?, description?, images?: string[], serviceLocations?: string[], hasSubServices?: 'yes'|'no', subServices?: [...], ...cardPrintingFields }] }
// For Pandit vendors: serviceName = category, subServices[] with subtype, hours, price, description
// For Invitation Card Designer: includes numberOfPages, isLaminated, laminationType, cardWidth, cardHeight, etc.
router.post('/:businessId/services', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { services = [] } = req.body || {};
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ message: 'services[] is required with at least one item' });
    }
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: 'Business not found' });

    const isPandit = business.serviceType === 'Pandit';
    const isCardPrinter = /invitation card designer/i.test(String(business.serviceType || ''));

    const toAdd = [];
    for (const s of services) {
      if (!s || !s.serviceName) continue;
      // For Pandit: price at service level is optional (calculated from subServices)
      // For other vendors: price is required
      if (!isPandit && !s.price) continue;

      // For Pandit, always set hasSubServices to 'yes'
      const hasSubServices = isPandit ? 'yes' : (s.hasSubServices === 'yes' ? 'yes' : 'no');

      // Calculate price from subServices for Pandit if not provided
      let servicePrice = s.price ? String(s.price) : undefined;
      if (isPandit && !servicePrice && Array.isArray(s.subServices) && s.subServices.length) {
        const prices = s.subServices.map(sub => parseFloat(sub.price) || 0).filter(p => p > 0);
        if (prices.length) servicePrice = String(Math.min(...prices));
      }
      if (!servicePrice) servicePrice = '0'; // fallback

      const item = {
        _id: new mongoose.Types.ObjectId(),
        serviceName: String(s.serviceName),
        price: servicePrice,
        discount: s.discount ? String(s.discount) : undefined,
        description: s.description ? String(s.description) : undefined,
        maxPlates: s.maxPlates !== undefined ? Number(s.maxPlates) : undefined,
        images: [],
        serviceLocations: Array.isArray(s.serviceLocations) ? s.serviceLocations.map(String) : [],
        hasSubServices: hasSubServices,
        subServices: [],
      };
      
      // ========== INVITATION CARD DESIGNER / Card Printing specific fields ==========
      if (isCardPrinter) {
        // Card specifications
        if (s.numberOfPages !== undefined) item.numberOfPages = Number(s.numberOfPages);
        if (s.isLaminated !== undefined) item.isLaminated = Boolean(s.isLaminated);
        if (s.laminationType) item.laminationType = String(s.laminationType);
        
        // Dimensions
        if (s.cardWidth !== undefined) item.cardWidth = Number(s.cardWidth);
        if (s.cardHeight !== undefined) item.cardHeight = Number(s.cardHeight);
        if (s.dimensionUnit) item.dimensionUnit = String(s.dimensionUnit);
        
        // Paper details
        if (s.paperThickness) item.paperThickness = String(s.paperThickness);
        if (s.paperMaterial) item.paperMaterial = String(s.paperMaterial);
        
        // Available colors
        if (Array.isArray(s.availableColors)) {
          item.availableColors = s.availableColors.map(String);
        }
        
        // Bulk discounts
        if (Array.isArray(s.bulkDiscounts)) {
          item.bulkDiscounts = s.bulkDiscounts
            .filter(d => d && d.quantity)
            .map(d => ({
              quantity: Number(d.quantity),
              discountPercent: d.discountPercent !== undefined ? Number(d.discountPercent) : undefined,
              discountPrice: d.discountPrice !== undefined ? Number(d.discountPrice) : undefined,
            }));
        }
        
        // Additional props/design
        if (s.additionalPropsDesign) item.additionalPropsDesign = String(s.additionalPropsDesign);
        
        // Envelope details
        if (s.includesEnvelope !== undefined) item.includesEnvelope = Boolean(s.includesEnvelope);
        if (s.envelopeDesign) item.envelopeDesign = String(s.envelopeDesign);
        if (s.envelopeColor) item.envelopeColor = String(s.envelopeColor);
        item.envelopeImages = [];
        if (Array.isArray(s.envelopeImages) && s.envelopeImages.length) {
          for (const img of s.envelopeImages) {
            if (typeof img === 'string' && img.startsWith('data:')) {
              const p = parseDataUrl(img);
              if (!p) continue;
              const processed = await processImage(p.buffer, 'envelope');
              const url = await saveBufferAsUpload(processed, 'envelope', req);
              item.envelopeImages.push(url);
            } else if (typeof img === 'string') {
              const normalized = normalizeIncomingImageUrl(img, req);
              if (normalized) item.envelopeImages.push(normalized);
            }
          }
        }
        
        // Wax seal details
        if (s.hasWaxSeal !== undefined) item.hasWaxSeal = Boolean(s.hasWaxSeal);
        if (s.waxSealColor) item.waxSealColor = String(s.waxSealColor);
        if (s.waxSealDesign) item.waxSealDesign = String(s.waxSealDesign);
        if (s.waxSealPrice !== undefined) item.waxSealPrice = Number(s.waxSealPrice);
        item.waxSealImages = [];
        if (Array.isArray(s.waxSealImages) && s.waxSealImages.length) {
          for (const img of s.waxSealImages) {
            if (typeof img === 'string' && img.startsWith('data:')) {
              const p = parseDataUrl(img);
              if (!p) continue;
              const processed = await processImage(p.buffer, 'waxseal');
              const url = await saveBufferAsUpload(processed, 'waxseal', req);
              item.waxSealImages.push(url);
            } else if (typeof img === 'string') {
              const normalized = normalizeIncomingImageUrl(img, req);
              if (normalized) item.waxSealImages.push(normalized);
            }
          }
        }
        
        // Card type and production details
        if (s.cardType) item.cardType = String(s.cardType);
        if (s.minimumOrderQuantity !== undefined) item.minimumOrderQuantity = Number(s.minimumOrderQuantity);
        if (s.productionTimeInDays !== undefined) item.productionTimeInDays = Number(s.productionTimeInDays);
      }
      
      if (Array.isArray(s.images) && s.images.length) {
        for (const img of s.images) {
          if (typeof img === 'string' && img.startsWith('data:')) {
            const p = parseDataUrl(img);
            if (!p) continue;
            const processed = await processImage(p.buffer, 'service');
            const url = await saveBufferAsUpload(processed, 'service', req);
            item.images.push(url);
          } else if (typeof img === 'string') {
            const normalized = normalizeIncomingImageUrl(img, req);
            if (normalized) item.images.push(normalized);
          }
        }
      }
      // Handle sub-services if hasSubServices is 'yes'
      if (item.hasSubServices === 'yes' && Array.isArray(s.subServices) && s.subServices.length) {
        for (const sub of s.subServices) {
          if (!sub || !sub.price) continue;
          // For Pandit: use subtype as serviceName if serviceName not provided
          const subServiceName = sub.serviceName || sub.subtype || '';
          if (!subServiceName) continue;
          const subItem = {
            _id: new mongoose.Types.ObjectId(),
            serviceName: String(subServiceName),
            subtype: sub.subtype ? String(sub.subtype) : undefined,
            hours: sub.hours !== undefined ? Number(sub.hours) : undefined,
            price: String(sub.price),
            discount: sub.discount ? String(sub.discount) : undefined,
            description: sub.description ? String(sub.description) : undefined,
            maxPlates: sub.maxPlates !== undefined ? Number(sub.maxPlates) : undefined,
            images: [],
          };
          if (Array.isArray(sub.images) && sub.images.length) {
            for (const img of sub.images) {
              if (typeof img === 'string' && img.startsWith('data:')) {
                const p = parseDataUrl(img);
                if (!p) continue;
                const processed = await processImage(p.buffer, 'service');
                const url = await saveBufferAsUpload(processed, 'service', req);
                subItem.images.push(url);
              } else if (typeof img === 'string') {
                const normalized = normalizeIncomingImageUrl(img, req);
                if (normalized) subItem.images.push(normalized);
              }
            }
          }
          item.subServices.push(subItem);
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


// Update a single service on a listing
// PUT /api/business/:businessId/services/:serviceId
// Body (any subset): { serviceName?, price?, discount?, description?, type?, subtype?, hours?, maxPlates?, images?: string[], serviceLocations?: string[], hasSubServices?, subServices?: [...], ...cardPrintingFields }
router.put('/:businessId/services/:serviceId', async (req, res) => {
  try {
    const { businessId, serviceId } = req.params;
    const { 
      serviceName, price, discount, description, type, subtype, hours, maxPlates, images, serviceLocations, hasSubServices, subServices,
      // Card printing specific fields
      numberOfPages, isLaminated, laminationType, cardWidth, cardHeight, dimensionUnit,
      paperThickness, paperMaterial, availableColors, bulkDiscounts, additionalPropsDesign,
      includesEnvelope, envelopeDesign, envelopeImages, envelopeColor,
      hasWaxSeal, waxSealColor, waxSealDesign, waxSealImages, waxSealPrice,
      cardType, minimumOrderQuantity, productionTimeInDays
    } = req.body || {};

    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: 'Business not found' });

    const svc = (business.services || []).find(s => String(s._id) === String(serviceId));
    if (!svc) return res.status(404).json({ message: 'Service not found' });

    if (serviceName !== undefined) svc.serviceName = String(serviceName);
    if (price !== undefined) svc.price = String(price);
    if (discount !== undefined) svc.discount = discount === null ? undefined : String(discount);
    if (description !== undefined) svc.description = description === null ? undefined : String(description);
    // Pandit-specific fields
    if (type !== undefined) svc.type = type === null ? undefined : String(type);
    if (subtype !== undefined) svc.subtype = subtype === null ? undefined : String(subtype);
    if (hours !== undefined) svc.hours = hours === null ? undefined : Number(hours);
    if (maxPlates !== undefined) {
      const val = Number(maxPlates);
      if (!Number.isInteger(val) || val <= 0) return res.status(400).json({ message: 'maxPlates must be a positive integer' });
      svc.maxPlates = val;
    }
    if (hasSubServices !== undefined) {
      svc.hasSubServices = hasSubServices === 'yes' ? 'yes' : 'no';
    }
    // Handle serviceLocations - replace entire array if provided
    if (serviceLocations !== undefined) {
      if (!Array.isArray(serviceLocations)) return res.status(400).json({ message: 'serviceLocations must be an array of strings' });
      svc.serviceLocations = serviceLocations.map(String);
    }

    // ========== INVITATION CARD DESIGNER / Card Printing specific fields ==========
    const isCardPrinter = /invitation card designer/i.test(String(business.serviceType || ''));
    
    if (isCardPrinter) {
      // Card specifications
      if (numberOfPages !== undefined) svc.numberOfPages = numberOfPages === null ? undefined : Number(numberOfPages);
      if (isLaminated !== undefined) svc.isLaminated = isLaminated === null ? undefined : Boolean(isLaminated);
      if (laminationType !== undefined) svc.laminationType = laminationType === null ? undefined : String(laminationType);
      
      // Dimensions
      if (cardWidth !== undefined) svc.cardWidth = cardWidth === null ? undefined : Number(cardWidth);
      if (cardHeight !== undefined) svc.cardHeight = cardHeight === null ? undefined : Number(cardHeight);
      if (dimensionUnit !== undefined) svc.dimensionUnit = dimensionUnit === null ? undefined : String(dimensionUnit);
      
      // Paper details
      if (paperThickness !== undefined) svc.paperThickness = paperThickness === null ? undefined : String(paperThickness);
      if (paperMaterial !== undefined) svc.paperMaterial = paperMaterial === null ? undefined : String(paperMaterial);
      
      // Available colors
      if (availableColors !== undefined) {
        if (availableColors === null) {
          svc.availableColors = [];
        } else if (Array.isArray(availableColors)) {
          svc.availableColors = availableColors.map(String);
        }
      }
      
      // Bulk discounts
      if (bulkDiscounts !== undefined) {
        if (bulkDiscounts === null) {
          svc.bulkDiscounts = [];
        } else if (Array.isArray(bulkDiscounts)) {
          svc.bulkDiscounts = bulkDiscounts
            .filter(d => d && d.quantity)
            .map(d => ({
              quantity: Number(d.quantity),
              discountPercent: d.discountPercent !== undefined ? Number(d.discountPercent) : undefined,
              discountPrice: d.discountPrice !== undefined ? Number(d.discountPrice) : undefined,
            }));
        }
      }
      
      // Additional props/design
      if (additionalPropsDesign !== undefined) svc.additionalPropsDesign = additionalPropsDesign === null ? undefined : String(additionalPropsDesign);
      
      // Envelope details
      if (includesEnvelope !== undefined) svc.includesEnvelope = includesEnvelope === null ? undefined : Boolean(includesEnvelope);
      if (envelopeDesign !== undefined) svc.envelopeDesign = envelopeDesign === null ? undefined : String(envelopeDesign);
      if (envelopeColor !== undefined) svc.envelopeColor = envelopeColor === null ? undefined : String(envelopeColor);
      
      // Handle envelope images
      if (envelopeImages !== undefined) {
        if (envelopeImages === null) {
          svc.envelopeImages = [];
        } else if (Array.isArray(envelopeImages)) {
          const out = [];
          for (const img of envelopeImages) {
            if (typeof img !== 'string') continue;
            if (img.startsWith('data:')) {
              const p = parseDataUrl(img);
              if (!p) continue;
              const processed = await processImage(p.buffer, 'envelope');
              const url = await saveBufferAsUpload(processed, 'envelope', req);
              out.push(url);
            } else {
              const normalized = normalizeIncomingImageUrl(img, req);
              if (normalized) out.push(normalized);
            }
          }
          svc.envelopeImages = out;
        }
      }
      
      // Wax seal details
      if (hasWaxSeal !== undefined) svc.hasWaxSeal = hasWaxSeal === null ? undefined : Boolean(hasWaxSeal);
      if (waxSealColor !== undefined) svc.waxSealColor = waxSealColor === null ? undefined : String(waxSealColor);
      if (waxSealDesign !== undefined) svc.waxSealDesign = waxSealDesign === null ? undefined : String(waxSealDesign);
      if (waxSealPrice !== undefined) svc.waxSealPrice = waxSealPrice === null ? undefined : Number(waxSealPrice);
      
      // Handle wax seal images
      if (waxSealImages !== undefined) {
        if (waxSealImages === null) {
          svc.waxSealImages = [];
        } else if (Array.isArray(waxSealImages)) {
          const out = [];
          for (const img of waxSealImages) {
            if (typeof img !== 'string') continue;
            if (img.startsWith('data:')) {
              const p = parseDataUrl(img);
              if (!p) continue;
              const processed = await processImage(p.buffer, 'waxseal');
              const url = await saveBufferAsUpload(processed, 'waxseal', req);
              out.push(url);
            } else {
              const normalized = normalizeIncomingImageUrl(img, req);
              if (normalized) out.push(normalized);
            }
          }
          svc.waxSealImages = out;
        }
      }
      
      // Card type and production details
      if (cardType !== undefined) svc.cardType = cardType === null ? undefined : String(cardType);
      if (minimumOrderQuantity !== undefined) svc.minimumOrderQuantity = minimumOrderQuantity === null ? undefined : Number(minimumOrderQuantity);
      if (productionTimeInDays !== undefined) svc.productionTimeInDays = productionTimeInDays === null ? undefined : Number(productionTimeInDays);
    }

    // If images are provided, replace the entire images array after normalizing
    if (images !== undefined) {
      if (!Array.isArray(images)) return res.status(400).json({ message: 'images must be an array of strings' });
      const out = [];
      for (const img of images) {
        if (typeof img !== 'string') continue;
        if (img.startsWith('data:')) {
          const p = parseDataUrl(img);
          if (!p) continue;
          const processed = await processImage(p.buffer, 'service');
          const url = await saveBufferAsUpload(processed, 'service', req);
          out.push(url);
        } else {
          const normalized = normalizeIncomingImageUrl(img, req);
          if (normalized) out.push(normalized);
        }
      }
      svc.images = out;
    }

    // Handle sub-services update - replace entire subServices array if provided
    if (subServices !== undefined) {
      if (!Array.isArray(subServices)) return res.status(400).json({ message: 'subServices must be an array' });
      const isPandit = business.serviceType === 'Pandit';
      const processedSubs = [];
      for (const sub of subServices) {
        // For Pandit: use subtype as serviceName if serviceName not provided
        const subServiceName = sub.serviceName || sub.subtype || '';
        if (!sub || !subServiceName || !sub.price) continue;
        const subItem = {
          _id: sub._id ? new mongoose.Types.ObjectId(sub._id) : new mongoose.Types.ObjectId(),
          serviceName: String(subServiceName),
          // Pandit-specific fields
          subtype: sub.subtype ? String(sub.subtype) : undefined,
          hours: sub.hours !== undefined ? Number(sub.hours) : undefined,
          price: String(sub.price),
          discount: sub.discount ? String(sub.discount) : undefined,
          description: sub.description ? String(sub.description) : undefined,
          maxPlates: sub.maxPlates !== undefined ? Number(sub.maxPlates) : undefined,
          images: [],
        };
        if (Array.isArray(sub.images) && sub.images.length) {
          for (const img of sub.images) {
            if (typeof img !== 'string') continue;
            if (img.startsWith('data:')) {
              const p = parseDataUrl(img);
              if (!p) continue;
              const processed = await processImage(p.buffer, 'service');
              const url = await saveBufferAsUpload(processed, 'service', req);
              subItem.images.push(url);
            } else {
              const normalized = normalizeIncomingImageUrl(img, req);
              if (normalized) subItem.images.push(normalized);
            }
          }
        }
        processedSubs.push(subItem);
      }
      svc.subServices = processedSubs;
    }

    await business.save();
    return res.json({ message: 'Service updated', service: svc });
  } catch (err) {
    console.error('update service error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Delete a single service and remove it from any packages; packages left empty are removed
// DELETE /api/business/:businessId/services/:serviceId
router.delete('/:businessId/services/:serviceId', async (req, res) => {
  try {
    const { businessId, serviceId } = req.params;
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: 'Business not found' });

    const beforeCount = (business.services || []).length;
    business.services = (business.services || []).filter(s => String(s._id) !== String(serviceId));
    const removed = beforeCount - business.services.length;
    if (!removed) return res.status(404).json({ message: 'Service not found' });

    let packagesAffected = 0;
    let packagesRemoved = 0;
    if (Array.isArray(business.packages)) {
      const next = [];
      for (const p of business.packages) {
        const origLen = (p.selectedServiceIds || []).length;
        p.selectedServiceIds = (p.selectedServiceIds || []).filter(id => String(id) !== String(serviceId));
        if (p.selectedServiceIds.length === 0) {
          packagesRemoved += 1; // drop empty package
          continue;
        }
        if (p.selectedServiceIds.length !== origLen) packagesAffected += 1;
        next.push(p);
      }
      business.packages = next;
    }

    await business.save();
    return res.json({ message: 'Service deleted', packagesAffected, packagesRemoved });
  } catch (err) {
    console.error('delete service error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Delete a single sub-service from a service (useful for Pandit)
// DELETE /api/business/:businessId/services/:serviceId/subservices/:subServiceId
router.delete('/:businessId/services/:serviceId/subservices/:subServiceId', async (req, res) => {
  try {
    const { businessId, serviceId, subServiceId } = req.params;
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: 'Business not found' });

    const svc = (business.services || []).find(s => String(s._id) === String(serviceId));
    if (!svc) return res.status(404).json({ message: 'Service not found' });

    const beforeCount = (svc.subServices || []).length;
    svc.subServices = (svc.subServices || []).filter(sub => String(sub._id) !== String(subServiceId));
    const removed = beforeCount - svc.subServices.length;
    if (!removed) return res.status(404).json({ message: 'SubService not found' });

    // Update parent service price to min of remaining subServices
    if (svc.subServices.length > 0) {
      const prices = svc.subServices.map(s => parseFloat(s.price) || 0).filter(p => p > 0);
      if (prices.length) svc.price = String(Math.min(...prices));
    }

    await business.save();
    return res.json({ message: 'SubService deleted', remainingSubServices: svc.subServices.length });
  } catch (err) {
    console.error('delete subservice error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Update a single sub-service within a service (useful for Pandit)
// PUT /api/business/:businessId/services/:serviceId/subservices/:subServiceId
// Body: { subtype?, hours?, price?, description?, discount?, images? }
router.put('/:businessId/services/:serviceId/subservices/:subServiceId', async (req, res) => {
  try {
    const { businessId, serviceId, subServiceId } = req.params;
    const { subtype, hours, price, description, discount, images } = req.body || {};

    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: 'Business not found' });

    const svc = (business.services || []).find(s => String(s._id) === String(serviceId));
    if (!svc) return res.status(404).json({ message: 'Service not found' });

    const subSvc = (svc.subServices || []).find(sub => String(sub._id) === String(subServiceId));
    if (!subSvc) return res.status(404).json({ message: 'SubService not found' });

    // Update fields
    if (subtype !== undefined) {
      subSvc.subtype = subtype === null ? undefined : String(subtype);
      subSvc.serviceName = String(subtype); // Keep serviceName in sync with subtype
    }
    if (hours !== undefined) subSvc.hours = hours === null ? undefined : Number(hours);
    if (price !== undefined) subSvc.price = String(price);
    if (description !== undefined) subSvc.description = description === null ? undefined : String(description);
    if (discount !== undefined) subSvc.discount = discount === null ? undefined : String(discount);

    // Handle images
    if (images !== undefined) {
      if (!Array.isArray(images)) return res.status(400).json({ message: 'images must be an array' });
      const out = [];
      for (const img of images) {
        if (typeof img !== 'string') continue;
        if (img.startsWith('data:')) {
          const p = parseDataUrl(img);
          if (!p) continue;
          const processed = await processImage(p.buffer, 'service');
          const url = await saveBufferAsUpload(processed, 'service', req);
          out.push(url);
        } else {
          const normalized = normalizeIncomingImageUrl(img, req);
          if (normalized) out.push(normalized);
        }
      }
      subSvc.images = out;
    }

    // Update parent service price to min of all subServices
    const prices = svc.subServices.map(s => parseFloat(s.price) || 0).filter(p => p > 0);
    if (prices.length) svc.price = String(Math.min(...prices));

    await business.save();
    return res.json({ message: 'SubService updated', subService: subSvc });
  } catch (err) {
    console.error('update subservice error:', err);
    return res.status(500).json({ error: err.message });
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

// Quote calculation for FOOD CATERER service items
// GET /api/business/:businessId/services/:serviceId/quote?plates=100
// Returns: { serviceName, perPlate, plates, total, discountPercent, totalAfterDiscount, breakdown }
router.get('/:businessId/services/:serviceId/quote', async (req, res) => {
  try {
    const { businessId, serviceId } = req.params;
    const plates = Number(req.query.plates);
    if (!Number.isFinite(plates) || plates <= 0) {
      return res.status(400).json({ message: 'plates must be a positive number' });
    }

    const business = await Business.findById(businessId).lean();
    if (!business) return res.status(404).json({ message: 'Business not found' });
    if (!/food\s*caterer/i.test(business.serviceType || '')) {
      return res.status(400).json({ message: 'Quote endpoint is only available for FOOD CATERER service' });
    }
    const svc = (business.services || []).find(s => String(s._id) === String(serviceId));
    if (!svc) return res.status(404).json({ message: 'Service item not found' });

    // Parse per-plate price (supports strings like "Rs. 100 per plate" or "100")
    function parsePrice(str) {
      if (typeof str === 'number') return str;
      if (typeof str !== 'string') return NaN;
      const n = Number(str.replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : NaN;
    }
    const perPlate = parsePrice(svc.price);
    if (!Number.isFinite(perPlate) || perPlate <= 0) {
      return res.status(400).json({ message: 'Invalid service price; must be a positive number (in string is ok)' });
    }

    // Parse discount as percentage if like "20%" or as flat if a number string
    function parseDiscount(str) {
      if (!str) return { type: 'percent', value: 0 };
      if (typeof str === 'number') return { type: 'flat', value: str };
      if (typeof str === 'string') {
        const pct = str.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
        if (pct) return { type: 'percent', value: Number(pct[1]) };
        const val = Number(str.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(val)) return { type: 'flat', value: val };
      }
      return { type: 'percent', value: 0 };
    }
    const disc = parseDiscount(svc.discount);

    // Enforce maxPlates if provided by vendor
    if (Number.isFinite(svc.maxPlates) && svc.maxPlates > 0 && plates > svc.maxPlates) {
      return res.status(400).json({ message: `Requested plates exceed vendor limit`, maxPlates: svc.maxPlates });
    }

    const total = perPlate * plates;
    let discountAmount = 0;
    if (disc.type === 'percent') discountAmount = total * (disc.value / 100);
    else discountAmount = disc.value; // flat
    if (discountAmount < 0) discountAmount = 0;
    if (discountAmount > total) discountAmount = total;
    const after = total - discountAmount;

    res.json({
      serviceId: String(svc._id),
      serviceName: svc.serviceName,
      perPlate,
      plates,
      total,
      discountPercent: disc.type === 'percent' ? disc.value : null,
      discountFlat: disc.type === 'flat' ? disc.value : null,
      totalAfterDiscount: after,
      breakdown: {
        label: `${svc.serviceName} - Rs. ${perPlate} per plate`,
        lines: [
          { label: 'No. of plate', value: plates },
          { label: 'Total', value: total },
          { label: 'Discount Applied', value: disc.type === 'percent' ? `${disc.value}%` : `Rs. ${disc.value}` },
          { label: 'After discount', value: after }
        ]
      }
    });
  } catch (err) {
    console.error('quote error:', err);
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

// Lookup by business contact phone to prefill onboarding extra fields
// GET /api/business/lookup/by-phone?phone=XXXXXXXXXX
// Returns 404 if not found. If found: { businessId, phone, ownerName, businessName, gstNumber, cinNumber, panNumber, aadhaarNumber }
router.get('/lookup/by-phone', async (req, res) => {
  try {
    const { phone } = req.query || {};
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ message: 'phone query param is required' });
    }
    const doc = await Business.findOne({ phone }).select('phone ownerName businessName gstNumber cinNumber panNumber aadhaarNumber').lean();
    if (!doc) return res.status(404).json({ message: 'No business found for phone' });
    return res.json({
      businessId: doc._id,
      phone: doc.phone,
      ownerName: doc.ownerName,
      businessName: doc.businessName,
      gstNumber: doc.gstNumber,
      cinNumber: doc.cinNumber,
      panNumber: doc.panNumber,
      aadhaarNumber: doc.aadhaarNumber,
    });
  } catch (err) {
    console.error('lookup by phone error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================================================================
// NEW VENDOR ONBOARDING APIs (5 Steps: Service Type, Business Info, Documents, Theme, Agreement)
// ========================================================================================

/**
 * POST /api/business/vendor-onboard
 * 
 * Creates or updates vendor onboarding data with 5 steps:
 * 1. Service Type
 * 2. Business Info (contact, email, phone, whatsapp, full name, business name, gst, cin, aadhar, pan, 
 *    minimum advance booking days, address details, working days, opening/closing time)
 * 3. Business Details (documents - govtId, registrationProof, cancelledCheque, ownerPhoto, logo, previewPhoto)
 * 4. Theme Selection (optional - themes array)
 * 5. Agreement Signing (agreementSigned, agreementSignature)
 * 
 * NOTE: For banquet/venue-specific details, use POST /api/business/banquet-service
 * 
 * Payload structure:
 * {
 *   businessId?: string,              // If provided, update existing; else create new
 *   userId: string,                   // Required
 *   
 *   // Step 1: Service Type
 *   serviceType: string,              // Required
 *   
 *   // Step 2: Business Info
 *   businessInfo: {
 *     ownerName: string,
 *     businessName: string,
 *     email: string,
 *     phone: string,
 *     whatsapp: string,
 *     gstNumber: string,
 *     cinNumber: string,
 *     panNumber: string,
 *     aadhaarNumber: string,
 *     minBookingNoticeDays: number,
 *     location: {
 *       address: string,
 *       street: string,
 *       houseNo: string,
 *       plotNo: string,
 *       area: string,
 *       landmark: string,
 *       pincode: string,
 *       state: string,
 *       gps: string
 *     },
 *     workingDays: string[],
 *     openingTime: string,
 *     closingTime: string,
 *     bankAccount: string,
 *     ifscCode: string,
 *     isRegisteredBusiness: boolean,
 *     serviceDetail: string
 *   },
 *   
 *   // Step 3: Business Details (Documents) - can be data URLs or base64 strings
 *   documents: {
 *     logo: string,
 *     govtId: string,
 *     registrationProof: string,
 *     cancelledCheque: string,
 *     ownerPhoto: string,
 *     previewPhoto: string
 *   },
 *   
 *   // Step 4: Theme Selection (optional, not for Pandit)
 *   themes: string[],
 *   eventTypes: string[],
 *   
 *   // Step 4 (For Pandit only): Language Preferences
 *   languages: string[],              // Required for Pandit - e.g., ['Hindi', 'Tamil', 'Sanskrit']
 *   
 *   // Step 5: Agreement Signing
 *   agreementSigned: boolean,
 *   agreementSignature: string        // Base64 signature image or text
 * }
 */
router.post('/vendor-onboard', async (req, res) => {
  try {
    const {
      businessId,
      userId,
      serviceType,
      businessInfo = {},
      documents = {},
      themes = [],
      eventTypes = [],
      languages = [],
      agreementSigned,
      agreementSignature,
    } = req.body || {};

    // Validation
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }
    if (!serviceType) {
      return res.status(400).json({ message: 'serviceType is required' });
    }

    // Get minBookingNoticeDays from businessInfo
    const minBookingNoticeDays = businessInfo.minBookingNoticeDays;
    
    // Validate minBookingNoticeDays on create
    if (!businessId) {
      if (minBookingNoticeDays === undefined || minBookingNoticeDays === null) {
        return res.status(400).json({ message: 'minBookingNoticeDays is required' });
      }
    }
    if (minBookingNoticeDays !== undefined && minBookingNoticeDays !== null) {
      const val = Number(minBookingNoticeDays);
      if (!Number.isInteger(val) || val < 0) {
        return res.status(400).json({ message: 'minBookingNoticeDays must be a whole number >= 0' });
      }
    }

    let business = null;
    if (businessId) {
      business = await Business.findById(businessId);
      if (!business) return res.status(404).json({ message: 'Business not found' });
    } else {
      // Create new business - initially in draft state, profileVerified = false
      business = new Business({
        userId,
        serviceType,
        verificationStatus: 'draft',
        status: 'offline',
        profileVerified: false,
      });
    }

    // Step 1: Service Type
    business.serviceType = serviceType;
    business.userId = userId;

    // Step 2: Business Info
    const businessInfoFields = [
      'ownerName', 'businessName', 'email', 'phone', 'whatsapp',
      'workingDays', 'openingTime', 'closingTime',
      'gstNumber', 'cinNumber', 'panNumber', 'aadhaarNumber', 'businessType',
      'bankAccount', 'ifscCode', 'isRegisteredBusiness', 'serviceDetail'
    ];
    for (const field of businessInfoFields) {
      if (businessInfo[field] !== undefined) {
        business[field] = businessInfo[field];
      }
    }
    if (businessInfo.location) {
      business.location = businessInfo.location;
    }
    if (minBookingNoticeDays !== undefined && minBookingNoticeDays !== null) {
      business.minBookingNoticeDays = Number(minBookingNoticeDays);
    }

    // Step 3: Business Details (Documents)
    if (documents && typeof documents === 'object') {
      // Logo
      if (documents.logo) {
        const parsed = parseDataUrl(documents.logo);
        if (!parsed) return res.status(400).json({ message: 'Invalid logo format; expected data URL or base64 string' });
        const processed = await processImage(parsed.buffer, 'logo');
        business.logo = {
          data: processed.buffer,
          contentType: processed.mimeType,
          sizeKb: processed.sizeKb,
          width: processed.width,
          height: processed.height,
        };
        business.logoUrl = await saveBufferAsUpload(processed, 'logo', req);
      }

      // Govt ID
      if (documents.govtId) {
        const parsed = parseDataUrl(documents.govtId);
        if (!parsed) return res.status(400).json({ message: 'Invalid govtId format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.govtId = processed.buffer;
        business.govtIdUrl = await saveBufferAsUpload(processed, 'govtId', req);
      }

      // Registration Proof
      if (documents.registrationProof) {
        const parsed = parseDataUrl(documents.registrationProof);
        if (!parsed) return res.status(400).json({ message: 'Invalid registrationProof format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.registrationProof = processed.buffer;
        business.registrationProofUrl = await saveBufferAsUpload(processed, 'registrationProof', req);
      }

      // Cancelled Cheque
      if (documents.cancelledCheque) {
        const parsed = parseDataUrl(documents.cancelledCheque);
        if (!parsed) return res.status(400).json({ message: 'Invalid cancelledCheque format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.cancelledCheque = processed.buffer;
        business.cancelledChequeUrl = await saveBufferAsUpload(processed, 'cancelledCheque', req);
      }

      // Owner Photo
      if (documents.ownerPhoto) {
        const parsed = parseDataUrl(documents.ownerPhoto);
        if (!parsed) return res.status(400).json({ message: 'Invalid ownerPhoto format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.ownerPhoto = processed.buffer;
        business.ownerPhotoUrl = await saveBufferAsUpload(processed, 'ownerPhoto', req);
      }

      // Preview Photo
      if (documents.previewPhoto) {
        const parsed = parseDataUrl(documents.previewPhoto);
        if (!parsed) return res.status(400).json({ message: 'Invalid previewPhoto format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.previewPhoto = processed.buffer;
        business.previewPhotoUrl = await saveBufferAsUpload(processed, 'previewPhoto', req);
      }
    }

    // Step 4: Theme Selection (optional - not for Pandit)
    if (serviceType !== 'Pandit') {
      if (Array.isArray(themes) && themes.length > 0) {
        business.themes = themes.filter(t => typeof t === 'string' && t.trim());
      }
      if (Array.isArray(eventTypes) && eventTypes.length > 0) {
        business.eventTypes = eventTypes.filter(t => typeof t === 'string' && t.trim());
      }
    }

    // Step 4 (For Pandit): Language Preferences
    if (serviceType === 'Pandit') {
      if (Array.isArray(languages) && languages.length > 0) {
        business.languages = languages.filter(l => typeof l === 'string' && l.trim());
      } else if (!businessId) {
        // Languages required for new Pandit registrations
        return res.status(400).json({ message: 'languages are required for Pandit service type' });
      }
    }

    // Step 5: Agreement Signing
    if (agreementSigned !== undefined) {
      business.agreementSigned = !!agreementSigned;
      if (agreementSigned) {
        business.agreementSignedAt = new Date();
        business.partnerContractAccepted = true;
      }
    }
    if (agreementSignature !== undefined) {
      business.agreementSignature = agreementSignature;
    }

    const saved = await business.save();

    // Prepare response without Buffer data (return URLs only)
    const response = saved.toObject();
    delete response.logo;
    delete response.govtId;
    delete response.registrationProof;
    delete response.cancelledCheque;
    delete response.ownerPhoto;
    delete response.previewPhoto;

    res.status(businessId ? 200 : 201).json({
      message: businessId ? 'Vendor onboarding updated' : 'Vendor onboarding created',
      business: response,
    });
  } catch (err) {
    console.error('Vendor onboard endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================================================================
// BANQUET/VENUE SERVICE API - For venue-specific details
// ========================================================================================

/**
 * POST /api/business/banquet-service
 * 
 * Creates or updates banquet/venue-specific service details for an existing business.
 * This endpoint is specifically for Banquet Hall, Wedding Venue, Party Hall vendors.
 * 
 * Prerequisites: Business must already exist (created via vendor-onboard)
 * 
 * Payload structure:
 * {
 *   businessId: string,               // Required - the existing business ID
 *   
 *   // Property Details
 *   propertyType: string,             // e.g., "Banquet Hall", "Wedding Venue", "Party Hall"
 *   numberOfFloors: number,
 *   yearOfConstruction: number,
 *   totalRooms: number,
 *   roomTypes: string[],              // e.g., ["Deluxe", "Suite", "Standard"]
 *   maxOccupancyPerRoom: number,
 *   attachedBathrooms: number,
 *   roomSize: string,                 // e.g., "500 sq ft"
 *   
 *   // Amenities
 *   amenities: {
 *     parking: boolean,
 *     wifi: boolean,
 *     ac: boolean,
 *     catering: boolean,
 *     decoration: boolean,
 *     dj: boolean,
 *     stage: boolean,
 *     generator: boolean,
 *     // ... other amenities
 *   },
 *   
 *   // Photos (URLs or data URLs)
 *   exteriorPhotos: string[],
 *   receptionPhotos: string[],
 *   roomPhotos: string[],
 *   bathroomPhotos: string[],
 *   lobbyPhotos: string[],
 *   
 *   // Documents (data URLs or base64)
 *   documents: {
 *     tradeLicense: string,
 *     fireSafetyNoc: string,
 *     propertyOwnershipProof: string
 *   },
 *   
 *   // Policy
 *   cancellationPolicyAgreed: boolean
 * }
 */
router.post('/banquet-service', async (req, res) => {
  try {
    const {
      businessId,
      propertyType,
      numberOfFloors,
      yearOfConstruction,
      totalRooms,
      roomTypes,
      maxOccupancyPerRoom,
      attachedBathrooms,
      roomSize,
      amenities,
      exteriorPhotos,
      receptionPhotos,
      roomPhotos,
      bathroomPhotos,
      lobbyPhotos,
      documents = {},
      cancellationPolicyAgreed,
    } = req.body || {};

    // Validation
    if (!businessId) {
      return res.status(400).json({ message: 'businessId is required' });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ message: 'Business not found' });
    }

    // Update property details
    if (propertyType !== undefined) business.propertyType = propertyType;
    if (numberOfFloors !== undefined) business.numberOfFloors = numberOfFloors;
    if (yearOfConstruction !== undefined) business.yearOfConstruction = yearOfConstruction;
    if (totalRooms !== undefined) business.totalRooms = totalRooms;
    if (roomTypes !== undefined) business.roomTypes = roomTypes;
    if (maxOccupancyPerRoom !== undefined) business.maxOccupancyPerRoom = maxOccupancyPerRoom;
    if (attachedBathrooms !== undefined) business.attachedBathrooms = attachedBathrooms;
    if (roomSize !== undefined) business.roomSize = roomSize;

    // Update amenities
    if (amenities && typeof amenities === 'object') {
      business.amenities = { ...business.amenities, ...amenities };
    }

    // Update photos
    if (Array.isArray(exteriorPhotos)) business.exteriorPhotos = exteriorPhotos;
    if (Array.isArray(receptionPhotos)) business.receptionPhotos = receptionPhotos;
    if (Array.isArray(roomPhotos)) business.roomPhotos = roomPhotos;
    if (Array.isArray(bathroomPhotos)) business.bathroomPhotos = bathroomPhotos;
    if (Array.isArray(lobbyPhotos)) business.lobbyPhotos = lobbyPhotos;

    // Handle documents
    if (documents && typeof documents === 'object') {
      // Trade License
      if (documents.tradeLicense) {
        const parsed = parseDataUrl(documents.tradeLicense);
        if (!parsed) return res.status(400).json({ message: 'Invalid tradeLicense format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.tradeLicense = processed.buffer;
        business.tradeLicenseUrl = await saveBufferAsUpload(processed, 'tradeLicense', req);
      }

      // Fire Safety NOC
      if (documents.fireSafetyNoc) {
        const parsed = parseDataUrl(documents.fireSafetyNoc);
        if (!parsed) return res.status(400).json({ message: 'Invalid fireSafetyNoc format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.fireSafetyNoc = processed.buffer;
        business.fireSafetyNocUrl = await saveBufferAsUpload(processed, 'fireSafetyNoc', req);
      }

      // Property Ownership Proof
      if (documents.propertyOwnershipProof) {
        const parsed = parseDataUrl(documents.propertyOwnershipProof);
        if (!parsed) return res.status(400).json({ message: 'Invalid propertyOwnershipProof format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.propertyOwnershipProof = processed.buffer;
        business.propertyOwnershipProofUrl = await saveBufferAsUpload(processed, 'propertyOwnershipProof', req);
      }
    }

    // Cancellation policy
    if (cancellationPolicyAgreed !== undefined) {
      business.cancellationPolicyAgreed = !!cancellationPolicyAgreed;
    }

    const saved = await business.save();

    // Prepare response without Buffer data
    const response = saved.toObject();
    delete response.logo;
    delete response.govtId;
    delete response.registrationProof;
    delete response.cancelledCheque;
    delete response.ownerPhoto;
    delete response.previewPhoto;
    delete response.tradeLicense;
    delete response.fireSafetyNoc;
    delete response.propertyOwnershipProof;

    res.status(200).json({
      message: 'Banquet service details updated',
      business: response,
    });
  } catch (err) {
    console.error('Banquet service endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================================================================
// PANDIT SERVICE API - For creating Pandit/Priest service listings
// ========================================================================================

/**
 * POST /api/business/pandit-service
 * 
 * Creates or updates a Pandit service listing.
 * Each service has a category (e.g., Ceremonies, Homam) and selected sub-services with hours and price.
 * 
 * Prerequisites: Business must already exist with serviceType = 'Pandit'
 * 
 * Payload structure:
 * {
 *   businessId: string,               // Required - the existing business ID
 *   
 *   // Service Details
 *   serviceCategory: string,          // Required - e.g., 'Ceremonies', 'Homam', 'Poojas'
 *   
 *   // Selected sub-services with pricing
 *   subServices: [
 *     {
 *       name: string,                 // e.g., 'Hindu Wedding', 'Ganapathi Homam'
 *       hours: number,                // Duration in hours
 *       price: string,                // Price for this sub-service
 *       description?: string          // Optional description
 *     }
 *   ],
 *   
 *   // Optional service images
 *   images?: string[]                 // Array of image URLs or data URLs
 * }
 * 
 * Available service categories and sub-options can be fetched from GET /api/business/options
 */
router.post('/pandit-service', async (req, res) => {
  try {
    const {
      businessId,
      serviceCategory,
      subServices = [],
      images = [],
    } = req.body || {};

    // Validation
    if (!businessId) {
      return res.status(400).json({ message: 'businessId is required' });
    }
    if (!serviceCategory) {
      return res.status(400).json({ message: 'serviceCategory is required' });
    }
    if (!Array.isArray(subServices) || subServices.length === 0) {
      return res.status(400).json({ message: 'At least one sub-service is required' });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ message: 'Business not found' });
    }

    // Validate that business is of Pandit type
    if (business.serviceType !== 'Pandit') {
      return res.status(400).json({ message: 'This endpoint is only for Pandit service type' });
    }

    // Validate service category exists in PANDIT_SERVICES
    if (!PANDIT_SERVICES[serviceCategory]) {
      return res.status(400).json({ 
        message: 'Invalid service category',
        validCategories: Object.keys(PANDIT_SERVICES)
      });
    }

    // Validate sub-services
    const validSubServiceNames = PANDIT_SERVICES[serviceCategory].map(s => s.name);
    for (const sub of subServices) {
      if (!sub.name || !sub.price) {
        return res.status(400).json({ message: 'Each sub-service must have name and price' });
      }
      if (!validSubServiceNames.includes(sub.name)) {
        return res.status(400).json({ 
          message: `Invalid sub-service name: ${sub.name}`,
          validOptions: validSubServiceNames
        });
      }
      if (sub.hours !== undefined && (typeof sub.hours !== 'number' || sub.hours < 0)) {
        return res.status(400).json({ message: 'hours must be a positive number' });
      }
    }

    // Process images if they are data URLs
    const processedImages = [];
    for (const img of images) {
      if (typeof img === 'string') {
        if (img.startsWith('data:')) {
          const parsed = parseDataUrl(img);
          if (parsed) {
            const processed = await processImage(parsed.buffer, 'photo');
            const url = await saveBufferAsUpload(processed, 'pandit-service', req);
            processedImages.push(url);
          }
        } else if (img.startsWith('http://') || img.startsWith('https://')) {
          processedImages.push(img);
        }
      }
    }

    // Create the service entry
    const newService = {
      serviceName: serviceCategory,
      price: subServices[0]?.price || '0', // Main price from first sub-service or custom
      description: `${serviceCategory} services by Pandit`,
      hasSubServices: 'yes',
      subServices: subServices.map(sub => ({
        serviceName: sub.name,
        price: sub.price,
        description: sub.description || `${sub.name} - ${sub.hours || 1} hour(s)`,
        // Store hours in description for now, or we can add a custom field
      })),
      images: processedImages,
    };

    // Check if service category already exists, update it; else add new
    const existingServiceIndex = business.services.findIndex(
      s => s.serviceName === serviceCategory
    );

    if (existingServiceIndex >= 0) {
      // Update existing service
      business.services[existingServiceIndex] = {
        ...business.services[existingServiceIndex].toObject(),
        ...newService,
      };
    } else {
      // Add new service
      business.services.push(newService);
    }

    const saved = await business.save();

    // Prepare response
    const response = saved.toObject();
    delete response.logo;
    delete response.govtId;
    delete response.registrationProof;
    delete response.cancelledCheque;
    delete response.ownerPhoto;
    delete response.previewPhoto;

    res.status(200).json({
      message: existingServiceIndex >= 0 ? 'Pandit service updated' : 'Pandit service created',
      business: response,
    });
  } catch (err) {
    console.error('Pandit service endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/business/pandit-options
 * 
 * Returns all available options for Pandit service creation.
 * Includes service categories, sub-services with default hours, and available languages.
 */
router.get('/pandit-options', (req, res) => {
  res.json({
    languages: PANDIT_LANGUAGES,
    serviceCategories: Object.keys(PANDIT_SERVICES),
    services: PANDIT_SERVICES,
  });
});

/**
 * POST /api/business/vendor-onboard-multipart
 * 
 * Same as vendor-onboard but accepts multipart/form-data for file uploads.
 * NOTE: For banquet/venue-specific details, use POST /api/business/banquet-service
 */
router.post('/vendor-onboard-multipart',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'govtId', maxCount: 1 },
    { name: 'registrationProof', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 },
    { name: 'ownerPhoto', maxCount: 1 },
    { name: 'previewPhoto', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { businessId, userId, serviceType, agreementSigned, agreementSignature } = req.body || {};

      if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
      }
      if (!serviceType) {
        return res.status(400).json({ message: 'serviceType is required' });
      }

      // Parse JSON fields
      let businessInfo = {};
      let themes = [];
      let eventTypes = [];

      if (req.body.businessInfo) {
        try {
          businessInfo = JSON.parse(req.body.businessInfo);
        } catch {
          return res.status(400).json({ message: 'businessInfo must be valid JSON' });
        }
      }
      if (req.body.themes) {
        try {
          themes = JSON.parse(req.body.themes);
        } catch {
          return res.status(400).json({ message: 'themes must be valid JSON array' });
        }
      }
      if (req.body.eventTypes) {
        try {
          eventTypes = JSON.parse(req.body.eventTypes);
        } catch {
          return res.status(400).json({ message: 'eventTypes must be valid JSON array' });
        }
      }

      // Get minBookingNoticeDays
      let minBookingNoticeDays = req.body.minBookingNoticeDays;
      if (minBookingNoticeDays === undefined || minBookingNoticeDays === null) {
        minBookingNoticeDays = businessInfo.minBookingNoticeDays;
      }

      // Validate minBookingNoticeDays on create
      if (!businessId) {
        if (minBookingNoticeDays === undefined || minBookingNoticeDays === null) {
          return res.status(400).json({ message: 'minBookingNoticeDays is required' });
        }
      }
      if (minBookingNoticeDays !== undefined && minBookingNoticeDays !== null) {
        const val = Number(minBookingNoticeDays);
        if (!Number.isInteger(val) || val < 0) {
          return res.status(400).json({ message: 'minBookingNoticeDays must be a whole number >= 0' });
        }
        minBookingNoticeDays = val;
      }

      let business = null;
      if (businessId) {
        business = await Business.findById(businessId);
        if (!business) return res.status(404).json({ message: 'Business not found' });
      } else {
        business = new Business({
          userId,
          serviceType,
          verificationStatus: 'draft',
          status: 'offline',
          profileVerified: false,
        });
      }

      // Step 1: Service Type
      business.serviceType = serviceType;
      business.userId = userId;

      // Step 2: Business Info
      const businessInfoFields = [
        'ownerName', 'businessName', 'email', 'phone', 'whatsapp',
        'workingDays', 'openingTime', 'closingTime',
        'gstNumber', 'cinNumber', 'panNumber', 'aadhaarNumber', 'businessType',
        'bankAccount', 'ifscCode', 'isRegisteredBusiness', 'serviceDetail'
      ];
      for (const field of businessInfoFields) {
        if (businessInfo[field] !== undefined) {
          business[field] = businessInfo[field];
        }
      }
      if (businessInfo.location) {
        business.location = businessInfo.location;
      }
      if (minBookingNoticeDays !== undefined) {
        business.minBookingNoticeDays = minBookingNoticeDays;
      }

      // Step 3: Documents (from multipart files)
      const baseUrl = getBaseUrl(req);
      const fileUrl = (f) => `${baseUrl}/uploads/${path.basename(f.path)}`;

      // Helper to process and downscale images on disk in-place
      async function downscaleInPlace(filePath, kind) {
        const image = sharp(filePath);
        const sizes = { logo: 512, doc: 1600, photo: 1024 };
        const max = sizes[kind] || 1600;
        await image
          .rotate()
          .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(`${filePath}.tmp`);
        await fs.promises.rename(`${filePath}.tmp`, filePath);
      }

      const files = req.files || {};

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

      // Step 4: Theme Selection (optional)
      if (Array.isArray(themes) && themes.length > 0) {
        business.themes = themes.filter(t => typeof t === 'string' && t.trim());
      }
      if (Array.isArray(eventTypes) && eventTypes.length > 0) {
        business.eventTypes = eventTypes.filter(t => typeof t === 'string' && t.trim());
      }

      // Step 5: Agreement Signing
      if (agreementSigned !== undefined) {
        business.agreementSigned = agreementSigned === 'true' || agreementSigned === true;
        if (business.agreementSigned) {
          business.agreementSignedAt = new Date();
          business.partnerContractAccepted = true;
        }
      }
      if (agreementSignature !== undefined) {
        business.agreementSignature = agreementSignature;
      }

      const saved = await business.save();

      // Prepare response without Buffer data
      const response = saved.toObject();
      delete response.logo;
      delete response.govtId;
      delete response.registrationProof;
      delete response.cancelledCheque;
      delete response.ownerPhoto;
      delete response.previewPhoto;

      res.status(businessId ? 200 : 201).json({
        message: businessId ? 'Vendor onboarding updated' : 'Vendor onboarding created',
        business: response,
      });
    } catch (err) {
      console.error('Vendor onboard multipart error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/business/vendor/:userId
 * 
 * Get all vendor/business details by user ID including document URLs
 */
router.get('/vendor/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Find business by userId
    const business = await Business.findOne({ userId }).lean();

    if (!business) {
      return res.status(404).json({ message: 'Vendor not found for this user' });
    }

    // Remove binary buffer data, keep only URLs
    const response = {
      _id: business._id,
      userId: business.userId,
      
      // Step 1: Service Type
      serviceType: business.serviceType,
      
      // Step 2: Business Info
      ownerName: business.ownerName,
      businessName: business.businessName,
      email: business.email,
      phone: business.phone,
      whatsapp: business.whatsapp,
      gstNumber: business.gstNumber,
      cinNumber: business.cinNumber,
      panNumber: business.panNumber,
      aadhaarNumber: business.aadhaarNumber,
      minBookingNoticeDays: business.minBookingNoticeDays,
      location: business.location,
      workingDays: business.workingDays,
      openingTime: business.openingTime,
      closingTime: business.closingTime,
      bankAccount: business.bankAccount,
      ifscCode: business.ifscCode,
      isRegisteredBusiness: business.isRegisteredBusiness,
      serviceDetail: business.serviceDetail,
      
      // Step 3: Document URLs (no binary data)
      logoUrl: business.logoUrl,
      govtIdUrl: business.govtIdUrl,
      registrationProofUrl: business.registrationProofUrl,
      cancelledChequeUrl: business.cancelledChequeUrl,
      ownerPhotoUrl: business.ownerPhotoUrl,
      previewPhotoUrl: business.previewPhotoUrl,
      
      // Step 4: Themes
      themes: business.themes,
      eventTypes: business.eventTypes,
      languages: business.languages,
      
      // Step 5: Agreement
      agreementSigned: business.agreementSigned,
      agreementSignedAt: business.agreementSignedAt,
      partnerContractAccepted: business.partnerContractAccepted,
      
      // Status fields
      status: business.status,
      verificationStatus: business.verificationStatus,
      profileVerified: business.profileVerified,
      
      // Other fields
      ratingAvg: business.ratingAvg,
      ratingCount: business.ratingCount,
      createdAt: business.createdAt,
      
      // Services with all fields explicitly mapped
      services: (business.services || []).map(s => ({
        _id: s._id,
        serviceName: s.serviceName,
        price: s.price,
        discount: s.discount,
        description: s.description,
        maxPlates: s.maxPlates,
        rates: s.rates,
        images: s.images,
        hasSubServices: s.hasSubServices || 'no',
        subServices: (s.subServices || []).map(sub => ({
          _id: sub._id,
          serviceName: sub.serviceName,
          price: sub.price,
          discount: sub.discount,
          description: sub.description,
          maxPlates: sub.maxPlates,
          images: sub.images,
        })),
      })),
      packages: business.packages,
    };

    res.json({
      message: 'Vendor details retrieved successfully',
      vendor: response,
    });
  } catch (err) {
    console.error('Get vendor by userId error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/business/vendor/:userId
 * 
 * Update all vendor/business details by user ID including documents
 * 
 * Same payload structure as POST vendor-onboard but userId comes from URL
 */
router.put('/vendor/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      serviceType,
      businessInfo = {},
      documents = {},
      themes,
      eventTypes,
      agreementSigned,
      agreementSignature,
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Find business by userId
    const business = await Business.findOne({ userId });

    if (!business) {
      return res.status(404).json({ message: 'Vendor not found for this user' });
    }

    // Step 1: Service Type (if provided)
    if (serviceType !== undefined) {
      business.serviceType = serviceType;
    }

    // Step 2: Business Info
    const businessInfoFields = [
      'ownerName', 'businessName', 'email', 'phone', 'whatsapp',
      'workingDays', 'openingTime', 'closingTime',
      'gstNumber', 'cinNumber', 'panNumber', 'aadhaarNumber',
      'bankAccount', 'ifscCode', 'isRegisteredBusiness', 'serviceDetail'
    ];
    for (const field of businessInfoFields) {
      if (businessInfo[field] !== undefined) {
        business[field] = businessInfo[field];
      }
    }
    if (businessInfo.location !== undefined) {
      business.location = businessInfo.location;
    }
    if (businessInfo.minBookingNoticeDays !== undefined && businessInfo.minBookingNoticeDays !== null) {
      const val = Number(businessInfo.minBookingNoticeDays);
      if (!Number.isInteger(val) || val < 0) {
        return res.status(400).json({ message: 'minBookingNoticeDays must be a whole number >= 0' });
      }
      business.minBookingNoticeDays = val;
    }

    // Step 3: Business Details (Documents)
    if (documents && typeof documents === 'object') {
      // Logo
      if (documents.logo) {
        const parsed = parseDataUrl(documents.logo);
        if (!parsed) return res.status(400).json({ message: 'Invalid logo format; expected data URL or base64 string' });
        const processed = await processImage(parsed.buffer, 'logo');
        business.logo = {
          data: processed.buffer,
          contentType: processed.mimeType,
          sizeKb: processed.sizeKb,
          width: processed.width,
          height: processed.height,
        };
        business.logoUrl = await saveBufferAsUpload(processed, 'logo', req);
      }

      // Govt ID
      if (documents.govtId) {
        const parsed = parseDataUrl(documents.govtId);
        if (!parsed) return res.status(400).json({ message: 'Invalid govtId format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.govtId = processed.buffer;
        business.govtIdUrl = await saveBufferAsUpload(processed, 'govtId', req);
      }

      // Registration Proof
      if (documents.registrationProof) {
        const parsed = parseDataUrl(documents.registrationProof);
        if (!parsed) return res.status(400).json({ message: 'Invalid registrationProof format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.registrationProof = processed.buffer;
        business.registrationProofUrl = await saveBufferAsUpload(processed, 'registrationProof', req);
      }

      // Cancelled Cheque
      if (documents.cancelledCheque) {
        const parsed = parseDataUrl(documents.cancelledCheque);
        if (!parsed) return res.status(400).json({ message: 'Invalid cancelledCheque format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.cancelledCheque = processed.buffer;
        business.cancelledChequeUrl = await saveBufferAsUpload(processed, 'cancelledCheque', req);
      }

      // Owner Photo
      if (documents.ownerPhoto) {
        const parsed = parseDataUrl(documents.ownerPhoto);
        if (!parsed) return res.status(400).json({ message: 'Invalid ownerPhoto format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.ownerPhoto = processed.buffer;
        business.ownerPhotoUrl = await saveBufferAsUpload(processed, 'ownerPhoto', req);
      }

      // Preview Photo
      if (documents.previewPhoto) {
        const parsed = parseDataUrl(documents.previewPhoto);
        if (!parsed) return res.status(400).json({ message: 'Invalid previewPhoto format' });
        const processed = await processImage(parsed.buffer, 'doc');
        business.previewPhoto = processed.buffer;
        business.previewPhotoUrl = await saveBufferAsUpload(processed, 'previewPhoto', req);
      }
    }

    // Step 4: Theme Selection
    if (themes !== undefined) {
      if (Array.isArray(themes)) {
        business.themes = themes.filter(t => typeof t === 'string' && t.trim());
      } else {
        business.themes = [];
      }
    }
    if (eventTypes !== undefined) {
      if (Array.isArray(eventTypes)) {
        business.eventTypes = eventTypes.filter(t => typeof t === 'string' && t.trim());
      } else {
        business.eventTypes = [];
      }
    }

    // Step 5: Agreement Signing
    if (agreementSigned !== undefined) {
      business.agreementSigned = !!agreementSigned;
      if (agreementSigned && !business.agreementSignedAt) {
        business.agreementSignedAt = new Date();
        business.partnerContractAccepted = true;
      }
    }
    if (agreementSignature !== undefined) {
      business.agreementSignature = agreementSignature;
    }

    const saved = await business.save();

    // Prepare response without Buffer data
    const response = saved.toObject();
    delete response.logo;
    delete response.govtId;
    delete response.registrationProof;
    delete response.cancelledCheque;
    delete response.ownerPhoto;
    delete response.previewPhoto;

    res.json({
      message: 'Vendor details updated successfully',
      vendor: response,
    });
  } catch (err) {
    console.error('Update vendor by userId error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/business/vendor/:userId/multipart
 * 
 * Update vendor details with multipart/form-data for file uploads
 */
router.put('/vendor/:userId/multipart',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'govtId', maxCount: 1 },
    { name: 'registrationProof', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 },
    { name: 'ownerPhoto', maxCount: 1 },
    { name: 'previewPhoto', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { serviceType, agreementSigned, agreementSignature } = req.body || {};

      if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
      }

      // Find business by userId
      const business = await Business.findOne({ userId });

      if (!business) {
        return res.status(404).json({ message: 'Vendor not found for this user' });
      }

      // Parse JSON fields
      let businessInfo = {};
      let themes = [];
      let eventTypes = [];

      if (req.body.businessInfo) {
        try {
          businessInfo = JSON.parse(req.body.businessInfo);
        } catch {
          return res.status(400).json({ message: 'businessInfo must be valid JSON' });
        }
      }
      if (req.body.themes) {
        try {
          themes = JSON.parse(req.body.themes);
        } catch {
          return res.status(400).json({ message: 'themes must be valid JSON array' });
        }
      }
      if (req.body.eventTypes) {
        try {
          eventTypes = JSON.parse(req.body.eventTypes);
        } catch {
          return res.status(400).json({ message: 'eventTypes must be valid JSON array' });
        }
      }

      // Step 1: Service Type (if provided)
      if (serviceType !== undefined) {
        business.serviceType = serviceType;
      }

      // Step 2: Business Info
      const businessInfoFields = [
        'ownerName', 'businessName', 'email', 'phone', 'whatsapp',
        'workingDays', 'openingTime', 'closingTime',
        'gstNumber', 'cinNumber', 'panNumber', 'aadhaarNumber',
        'bankAccount', 'ifscCode', 'isRegisteredBusiness', 'serviceDetail'
      ];
      for (const field of businessInfoFields) {
        if (businessInfo[field] !== undefined) {
          business[field] = businessInfo[field];
        }
      }
      if (businessInfo.location !== undefined) {
        business.location = businessInfo.location;
      }
      if (businessInfo.minBookingNoticeDays !== undefined && businessInfo.minBookingNoticeDays !== null) {
        const val = Number(businessInfo.minBookingNoticeDays);
        if (!Number.isInteger(val) || val < 0) {
          return res.status(400).json({ message: 'minBookingNoticeDays must be a whole number >= 0' });
        }
        business.minBookingNoticeDays = val;
      }

      // Step 3: Documents (from multipart files)
      const baseUrl = getBaseUrl(req);
      const fileUrl = (f) => `${baseUrl}/uploads/${path.basename(f.path)}`;

      async function downscaleInPlace(filePath, kind) {
        const image = sharp(filePath);
        const sizes = { logo: 512, doc: 1600, photo: 1024 };
        const max = sizes[kind] || 1600;
        await image
          .rotate()
          .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(`${filePath}.tmp`);
        await fs.promises.rename(`${filePath}.tmp`, filePath);
      }

      const files = req.files || {};

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

      // Step 4: Theme Selection
      if (themes.length > 0 || req.body.themes) {
        business.themes = themes.filter(t => typeof t === 'string' && t.trim());
      }
      if (eventTypes.length > 0 || req.body.eventTypes) {
        business.eventTypes = eventTypes.filter(t => typeof t === 'string' && t.trim());
      }

      // Step 5: Agreement Signing
      if (agreementSigned !== undefined) {
        business.agreementSigned = agreementSigned === 'true' || agreementSigned === true;
        if (business.agreementSigned && !business.agreementSignedAt) {
          business.agreementSignedAt = new Date();
          business.partnerContractAccepted = true;
        }
      }
      if (agreementSignature !== undefined) {
        business.agreementSignature = agreementSignature;
      }

      const saved = await business.save();

      // Prepare response without Buffer data
      const response = saved.toObject();
      delete response.logo;
      delete response.govtId;
      delete response.registrationProof;
      delete response.cancelledCheque;
      delete response.ownerPhoto;
      delete response.previewPhoto;

      res.json({
        message: 'Vendor details updated successfully',
        vendor: response,
      });
    } catch (err) {
      console.error('Update vendor multipart error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PATCH /api/business/vendor/:userId/verify
 * 
 * Admin endpoint to set vendor profile as verified
 */
router.patch('/vendor/:userId/verify', async (req, res) => {
  try {
    const { userId } = req.params;
    const { verified } = req.body || {};

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const business = await Business.findOne({ userId });

    if (!business) {
      return res.status(404).json({ message: 'Vendor not found for this user' });
    }

    business.profileVerified = verified !== undefined ? !!verified : true;
    
    // If verified, also update status to make listing live
    if (business.profileVerified) {
      business.verificationStatus = 'verified';
      business.status = 'online';
    }

    await business.save();

    res.json({
      message: business.profileVerified ? 'Vendor verified successfully' : 'Vendor verification status updated',
      profileVerified: business.profileVerified,
      verificationStatus: business.verificationStatus,
      status: business.status,
    });
  } catch (err) {
    console.error('Verify vendor error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
