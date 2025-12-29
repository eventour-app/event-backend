const express = require('express');
const router = express.Router();
const Customer = require('../models/customer');
const Business = require('../models/Business');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Review = require('../models/Review');
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

// ---------------- Orders (User-side) ----------------
// Helper: map vendor Order shape for customer consumption (mostly same)
function mapOrder(o) {
  return {
    _id: o._id,
    status: o.status,
    total: o.total,
    scheduledAt: o.scheduledAt || null,
    startTime: o.startTime || null,
    date: o.date || null,
    time: o.time || null,
    createdAt: o.createdAt,
    businessId: o.businessId,
    customer: { name: o.customerName, phone: o.customerPhone },
    serviceName: o.serviceName,
    packageName: o.packageName,
    location: o.location || o.venue || null,
    venue: o.venue || o.location || null,
    notes: o.notes || null,
    // Cancellation details
    cancellationReason: o.cancellationReason || null,
    cancellationNote: o.cancellationNote || null,
    cancelledBy: o.cancelledBy || null,
    cancelledAt: o.cancelledAt || null,
  };
}

// POST /api/customer/orders - place an order
// Body: { businessId, items: { serviceId? or packageId?, serviceName?, packageName? }, scheduledAt? | date+time, location?, notes?, contact? }
router.post('/orders', async (req, res) => {
  try {
    const {
      businessId,
      serviceName,
      packageName,
      scheduledAt,
      date,
      time,
      location,
      venue,
      notes,
      total,
      customerName,
      customerPhone,
    } = req.body || {};

    if (!businessId || (!serviceName && !packageName)) {
      return res.status(400).json({ message: 'businessId and (serviceName or packageName) are required' });
    }
    const biz = await Business.findById(businessId).select('status verificationStatus').lean();
    if (!biz) return res.status(404).json({ message: 'Listing not found' });
    if (!(biz.status === 'online' && biz.verificationStatus === 'verified')) {
      return res.status(400).json({ message: 'Vendor is currently unavailable' });
    }

    // Identify customer from token if present
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    let customerId = undefined;
    try {
      if (token) {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        if (decoded && decoded.role === 'customer') customerId = decoded.id;
      }
    } catch {}

    const order = await Order.create({
      businessId,
      customerId,
      customerName: customerName || 'Customer',
      customerPhone: customerPhone || null,
      status: 'pending',
      total: Number(total) || 0,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      date: date || undefined,
      time: time || undefined,
      serviceName: serviceName || undefined,
      packageName: packageName || undefined,
      location: location || venue || undefined,
      venue: venue || location || undefined,
      notes: notes || undefined,
      messages: [{ senderRole: 'system', body: 'Order placed' }],
    });

    // Optional: create a booking transaction record (gross)
    if (order.total && order.total > 0) {
      await Transaction.create({ businessId, orderId: order._id, type: 'booking', amount: order.total, status: 'pending' });
    }

    return res.status(201).json({ order: mapOrder(order.toObject()) });
  } catch (err) {
    console.error('create customer order error:', err);
    return res.status(500).json({ message: 'Failed to place order' });
  }
});

// GET /api/customer/orders - list customer orders (by token) with pagination
router.get('/orders', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing Bearer token' });
    let customerId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'customer') return res.status(403).json({ message: 'Forbidden' });
      customerId = decoded.id;
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const { page = 1, limit = 20, status } = req.query;
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));
    const filter = { customerId };
    if (status) {
      const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length) filter.status = { $in: statuses };
    }
    const totalItems = await Order.countDocuments(filter);
    const orders = await Order.find(filter).sort({ createdAt: -1 }).skip((p-1)*l).limit(l).lean();
    res.json({ orders: orders.map(mapOrder), page: p, limit: l, totalItems, totalPages: Math.ceil(totalItems / l) });
  } catch (err) {
    console.error('list customer orders error:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// GET /api/customer/orders/:orderId - fetch one order (must own)
router.get('/orders/:orderId', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing Bearer token' });
    let customerId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'customer') return res.status(403).json({ message: 'Forbidden' });
      customerId = decoded.id;
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const order = await Order.findById(req.params.orderId).lean();
    if (!order || order.customerId !== customerId) return res.status(404).json({ message: 'Order not found' });
    res.json({ order: mapOrder(order) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch order' });
  }
});

// PUT /api/customer/orders/:orderId/cancel - customer cancels pending/accepted
// Body: { reason?: string, note?: string }
router.put('/orders/:orderId/cancel', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing Bearer token' });
    let customerId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'customer') return res.status(403).json({ message: 'Forbidden' });
      customerId = decoded.id;
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const order = await Order.findById(req.params.orderId);
    if (!order || order.customerId !== customerId) return res.status(404).json({ message: 'Order not found' });
    if (!['pending','accepted','upcoming'].includes(order.status)) {
      return res.status(400).json({ message: 'Only pending/accepted/upcoming orders can be cancelled' });
    }
    
    // Get cancellation reason from body
    const { reason, note } = req.body || {};
    
    order.status = 'cancelled';
    
    // Store cancellation reason if provided
    if (reason) {
      order.cancellationReason = reason;
      order.cancellationNote = note || null;
      order.cancelledBy = 'customer';
      order.cancelledAt = new Date();
      const reasonText = note ? `${reason}: ${note}` : reason;
      order.messages.push({ senderRole: 'customer', body: `Order cancelled by customer. Reason: ${reasonText}` });
    } else {
      order.cancelledBy = 'customer';
      order.cancelledAt = new Date();
      order.messages.push({ senderRole: 'customer', body: 'Order cancelled by customer' });
    }
    
    await order.save();
    // Mark any pending booking transaction as failed/cancelled
    await Transaction.updateMany({ orderId: order._id, type: 'booking', status: { $in: ['pending','processing'] } }, { $set: { status: 'failed' } });
    res.json({ order: { _id: order._id, status: order.status, updatedAt: order.updatedAt } });
  } catch (err) {
    console.error('cancel order error:', err);
    res.status(500).json({ message: 'Failed to cancel order' });
  }
});

// POST /api/customer/orders/:orderId/message { body }
router.post('/orders/:orderId/message', async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body || typeof body !== 'string') return res.status(400).json({ message: 'Message body required' });
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing Bearer token' });
    let customerId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'customer') return res.status(403).json({ message: 'Forbidden' });
      customerId = decoded.id;
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const order = await Order.findById(req.params.orderId);
    if (!order || order.customerId !== customerId) return res.status(404).json({ message: 'Order not found' });
    order.messages.push({ senderRole: 'customer', body });
    await order.save();
    res.status(201).json({ message: 'Message added', orderId: order._id });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add message' });
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

// GET /api/customer/listings/:id/reviews?limit=3
router.get('/listings/:id/reviews', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 3));
    const businessId = req.params.id;
    const reviews = await Review.find({ businessId }).sort({ createdAt: -1 }).limit(limit).lean();
    const averageRatingAgg = await Review.aggregate([
      { $match: { businessId: require('mongoose').Types.ObjectId.createFromHexString(businessId) } },
      { $group: { _id: null, avg: { $avg: '$rating' } } }
    ]);
    const averageRating = averageRatingAgg.length ? Number(averageRatingAgg[0].avg.toFixed(2)) : null;
    res.json({ reviews: reviews.map(r => ({ id: r._id, customerName: r.customerName, rating: r.rating, comment: r.comment, createdAt: r.createdAt })), averageRating });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch reviews' });
  }
});

// Public quote endpoint for FOOD CATERER (read-only)
router.get('/listings/:id/services/:serviceId/quote', async (req, res) => {
  try {
    const { id, serviceId } = req.params;
    const plates = Number(req.query.plates);
    if (!Number.isFinite(plates) || plates <= 0) {
      return res.status(400).json({ message: 'plates must be a positive number' });
    }
    const business = await Business.findById(id).lean();
    if (!business) return res.status(404).json({ message: 'Listing not found' });
    if (!/food\s*caterer/i.test(business.serviceType || '')) {
      return res.status(400).json({ message: 'Quote endpoint is only available for FOOD CATERER service' });
    }
    const svc = (business.services || []).find(s => String(s._id) === String(serviceId));
    if (!svc) return res.status(404).json({ message: 'Service item not found' });
    function parsePrice(str) {
      if (typeof str === 'number') return str;
      if (typeof str !== 'string') return NaN;
      const n = Number(str.replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : NaN;
    }
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
    const perPlate = parsePrice(svc.price);
    if (!Number.isFinite(perPlate) || perPlate <= 0) {
      return res.status(400).json({ message: 'Invalid service price' });
    }
    const disc = parseDiscount(svc.discount);
    if (Number.isFinite(svc.maxPlates) && svc.maxPlates > 0 && plates > svc.maxPlates) {
      return res.status(400).json({ message: 'Requested plates exceed vendor limit', maxPlates: svc.maxPlates });
    }
    const total = perPlate * plates;
    let discountAmount = disc.type === 'percent' ? total * (disc.value / 100) : disc.value;
    discountAmount = Math.max(0, Math.min(discountAmount, total));
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
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to compute quote' });
  }
});
