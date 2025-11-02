const express = require('express');
const router = express.Router();
const Customer = require('../models/customer');
const Business = require('../models/Business');
const { URL } = require('url');

// Build a public base URL for serving images
function getBaseUrl(req) {
  const envBase = process.env.PUBLIC_BASE_URL && String(process.env.PUBLIC_BASE_URL).trim();
  if (envBase) return envBase.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// Normalize a possibly absolute/relative image URL to the current/public base
function normalizeImageUrl(value, req) {
  if (!value) return value;
  if (typeof value !== 'string') return value;
  if (value.startsWith('data:')) return value; // keep data URLs as-is
  const base = getBaseUrl(req);
  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const u = new URL(value);
      // If it already points at /uploads/*, rewrite origin to our base
      if (u.pathname && u.pathname.startsWith('/uploads/')) {
        return `${base}${u.pathname}`;
      }
      // Otherwise leave absolute URLs alone
      return value;
    }
  } catch {
    // fall through and try to treat as relative
  }
  // Handle relative paths like "/uploads/..." or "uploads/..."
  const rel = value.startsWith('/') ? value : `/${value}`;
  if (rel.startsWith('/uploads/')) return `${base}${rel}`;
  return value;
}

function normalizeBusinessDocImages(doc, req) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  // Normalize top-level URL fields if present
  for (const k of ['logoUrl', 'govtIdUrl', 'registrationProofUrl', 'cancelledChequeUrl', 'ownerPhotoUrl', 'previewPhotoUrl']) {
    if (out[k]) out[k] = normalizeImageUrl(out[k], req);
  }
  // Normalize services[].images
  if (Array.isArray(out.services)) {
    out.services = out.services.map(s => {
      if (!s || typeof s !== 'object') return s;
      const copy = { ...s };
      if (Array.isArray(copy.images)) {
        copy.images = copy.images.map(v => normalizeImageUrl(v, req));
      }
      return copy;
    });
  }
  // Also normalize package selectedServices if the route expanded them
  if (Array.isArray(out.packages)) {
    out.packages = out.packages.map(p => {
      if (!p || typeof p !== 'object') return p;
      const copy = { ...p };
      if (Array.isArray(copy.selectedServices)) {
        copy.selectedServices = copy.selectedServices.map(s => {
          if (!s || typeof s !== 'object') return s;
          const sc = { ...s };
          if (Array.isArray(sc.images)) sc.images = sc.images.map(v => normalizeImageUrl(v, req));
          return sc;
        });
      }
      return copy;
    });
  }
  return out;
}

// Utility: escape regex special chars for safe exact-match regex
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Registration API
router.post('/register', async (req, res) => {
  const { name, email, contact, password, confirmPassword } = req.body;
  // Validate required fields
  if (!name || !email || !contact || !password || !confirmPassword) {
    return res.status(400).json({ error: 'All fields (name, email, contact, password, confirmPassword) are required.' });
  }
  // Validate email format
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }
  // Validate contact number (basic check)
  if (!/^\d{7,15}$/.test(contact)) {
    return res.status(400).json({ error: 'Contact number must be 7-15 digits.' });
  }
  // Validate password length
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  // Check password match
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  try {
    // Normalize email for lookup and storage
    const normalizedEmail = String(email).toLowerCase().trim();

    const existingCustomer = await Customer.findOne({ email: normalizedEmail });
    if (existingCustomer) {
      return res.status(409).json({ error: 'Email already exists.' });
    }
    // Do NOT hash here; the model's pre('save') hook will hash the password
    const customer = new Customer({
      name,
      email: normalizedEmail,
      contact,
      password
    });
    await customer.save();
    res.status(201).json({ message: 'Customer registered successfully.' });
  } catch (err) {
    console.error('Registration error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;

router.get('/listings', async (req, res) => {
  try {
    const {
      serviceType, // preferred param
      category,    // alias supported
      categories,  // optional CSV list
      q,
      state,
      pincode,
      page = 1,
      limit = 20,
      sort = '-createdAt',
      visibility = 'public', // public => online + verified
      status, // optional override (e.g., 'online'|'offline')
      verificationStatus, // optional override ('verified'|'draft')
    } = req.query || {};

    const filter = {};
    // Visibility presets unless overridden
    if (visibility === 'public') {
      filter.status = 'online';
      filter.verificationStatus = 'verified';
    } else if (visibility === 'online') {
      filter.status = 'online';
    } else if (visibility === 'verified') {
      filter.verificationStatus = 'verified';
    } // visibility==='all' -> no default filters

    // Allow explicit overrides
    if (status) filter.status = status;
    if (verificationStatus) filter.verificationStatus = verificationStatus;

    // Category/serviceType filtering (case-insensitive, supports alias and CSV)
    const cat = (category ?? serviceType);
    if (categories) {
      const list = String(categories)
        .split(',')
        .map(s => s && String(s).trim())
        .filter(Boolean);
      if (list.length) {
        filter.$or = filter.$or || [];
        for (const c of list) {
          filter.$or.push({ serviceType: { $regex: `^${escapeRegex(c)}$`, $options: 'i' } });
        }
      }
    } else if (cat && String(cat).trim()) {
      filter.serviceType = { $regex: `^${escapeRegex(String(cat).trim())}$`, $options: 'i' };
    }
    if (state) filter['location.state'] = state;
    if (pincode) filter['location.pincode'] = pincode;

    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { businessName: regex },
        { serviceType: regex },
        { 'location.address': regex },
        { 'services.serviceName': regex },
      ];
    }

    // Map sort aliases
    const sortMap = {
      createdAt: { createdAt: 1 },
      '-createdAt': { createdAt: -1 },
      name: { businessName: 1 },
      '-name': { businessName: -1 },
    };
    const sortSpec = sortMap[String(sort)] || sortMap['-createdAt'];

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const projection = {
      // Exclude heavy/binary fields; keep URL fields
      logo: 0,
      govtId: 0,
      registrationProof: 0,
      cancelledCheque: 0,
      ownerPhoto: 0,
      previewPhoto: 0,
      __v: 0,
    };

    const [itemsRaw, total] = await Promise.all([
      Business.find(filter)
        .select(projection)
        .sort(sortSpec)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Business.countDocuments(filter),
    ]);

    // Normalize image URLs and attach a lightweight availability snapshot for list view
    const items = itemsRaw.map(doc0 => normalizeBusinessDocImages(doc0, req));
    const itemsWithAvailability = items.map(doc => {
      const isOnline = doc.status === 'online';
      let remainingSeconds = null;
      if (!isOnline && doc.offlineUntil) {
        remainingSeconds = Math.max(0, Math.ceil((new Date(doc.offlineUntil).getTime() - Date.now()) / 1000));
      }
      return {
        ...doc,
        availability: {
          status: doc.status,
          offlineSince: doc.offlineSince || null,
          offlineUntil: doc.offlineUntil || null,
          remainingSeconds,
          isOnline,
        }
      };
    });

    return res.json({
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      items: itemsWithAvailability,
    });
  } catch (err) {
    console.error('listings browse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer/listings/:id - public details endpoint
router.get('/listings/:id', async (req, res) => {
  try {
    const projection = {
      logo: 0,
      govtId: 0,
      registrationProof: 0,
      cancelledCheque: 0,
      ownerPhoto: 0,
      previewPhoto: 0,
      __v: 0,
    };
  const raw = await Business.findById(req.params.id).select(projection).lean();
  if (!raw) return res.status(404).json({ message: 'Listing not found' });
  const doc = normalizeBusinessDocImages(raw, req);

    // Build packages with selected services expanded
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

    // Availability snapshot for details view
    const isOnline = doc.status === 'online';
    let remainingSeconds = null;
    if (!isOnline && doc.offlineUntil) {
      remainingSeconds = Math.max(0, Math.ceil((new Date(doc.offlineUntil).getTime() - Date.now()) / 1000));
    }
    const availability = {
      status: doc.status,
      offlineSince: doc.offlineSince || null,
      offlineUntil: doc.offlineUntil || null,
      remainingSeconds,
      isOnline,
      serverTime: new Date(),
    };

    res.json({
      ...doc,
      packages,
      availability,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer/listings/:id/services - list of services for a listing
router.get('/listings/:id/services', async (req, res) => {
  try {
    const doc = await Business.findById(req.params.id).select({ services: 1 }).lean();
    if (!doc) return res.status(404).json({ message: 'Listing not found' });
    res.json({ services: doc.services || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer/listings/:id/packages - list of packages with selected services expanded
router.get('/listings/:id/packages', async (req, res) => {
  try {
    const doc = await Business.findById(req.params.id).select({ services: 1, packages: 1 }).lean();
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
    res.json({ packages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer/listings/:id/availability - public availability snapshot for a listing
router.get('/listings/:id/availability', async (req, res) => {
  try {
    const doc = await Business.findById(req.params.id).select('status offlineSince offlineUntil').lean();
    if (!doc) return res.status(404).json({ message: 'Listing not found' });
    const isOnline = doc.status === 'online';
    let remainingSeconds = null;
    if (!isOnline && doc.offlineUntil) {
      remainingSeconds = Math.max(0, Math.ceil((new Date(doc.offlineUntil).getTime() - Date.now()) / 1000));
    }
    res.json({
      status: doc.status,
      offlineSince: doc.offlineSince || null,
      offlineUntil: doc.offlineUntil || null,
      remainingSeconds,
      isOnline,
      serverTime: new Date(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
