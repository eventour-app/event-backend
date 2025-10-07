const express = require('express');
const router = express.Router();
const Customer = require('../models/customer');
const Business = require('../models/Business');

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
      serviceType,
      q,
      state,
      pincode,
      page = 1,
      limit = 20,
      sort = '-createdAt',
      visibility = 'public',
    } = req.query || {};

    const filter = {};
    if (visibility === 'public') {
      filter.status = 'online';
      filter.verificationStatus = 'verified';
    }
    if (serviceType) filter.serviceType = serviceType;
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

    const [items, total] = await Promise.all([
      Business.find(filter)
        .select(projection)
        .sort(sortSpec)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Business.countDocuments(filter),
    ]);

    res.json({
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      items,
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
    const doc = await Business.findById(req.params.id).select(projection).lean();
    if (!doc) return res.status(404).json({ message: 'Listing not found' });

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

    res.json({
      ...doc,
      packages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
