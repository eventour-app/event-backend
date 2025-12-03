const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');
const Business = require('../models/Business');
const { normalizePhone } = require('../utils/messenger');

const router = express.Router();


// GET /api/users/:id - get user profile + their businesses

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    // Enforce self-access only (avoid leaking user data)
    // server middleware sets req.userId = decoded.sub || decoded.id
    if (!req.userId || String(req.userId) !== String(id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

  const user = await User.findById(id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Exclude heavy/binary buffers from businesses; keep URL fields
    const projection = {
      logo: 0,
      govtId: 0,
      registrationProof: 0,
      cancelledCheque: 0,
      ownerPhoto: 0,
      previewPhoto: 0,
      __v: 0,
    };

    const businesses = await Business.find({ userId: id })
      .select(projection)
      .sort({ createdAt: -1 })
      .lean();

  return res.json({ user, businesses });
  } catch (err) {
    console.error('GET /api/users/:id error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});


// PATCH /api/users/:id - update user profile (self only)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    if (!req.userId || String(req.userId) !== String(id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const {
      name,
      email,
      phone,
      bio,
      address = {},
      city,
      country,
      state,
      postalCode,
      addressLine1,
      addressLine2,
    } = req.body || {};

    // Basic validations
    const set = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Invalid name' });
      set.name = name.trim();
    }
    if (email !== undefined) {
      if (typeof email !== 'string' || !email.includes('@')) return res.status(400).json({ message: 'Invalid email' });
      set.email = email.toLowerCase().trim();
    }
    if (phone !== undefined) {
      if (typeof phone !== 'string') return res.status(400).json({ message: 'Invalid phone' });
      const normalized = normalizePhone(phone);
      const digits = normalized.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        return res.status(400).json({ message: 'Phone must be a valid number (8-15 digits after country code)' });
      }
      // Enforce uniqueness across users (excluding self)
      const existing = await User.findOne({ phone: normalized, _id: { $ne: id } });
      if (existing) return res.status(409).json({ message: 'Phone already in use' });
      set.phone = normalized;
    }
    if (bio !== undefined) {
      if (typeof bio !== 'string') return res.status(400).json({ message: 'Invalid bio' });
      set.bio = bio.trim();
    }

    // Merge address from nested and top-level fields
    const addr = {};
    const pick = (obj, k) => (obj && obj[k] !== undefined ? obj[k] : undefined);
    const addrFields = ['city', 'country', 'state', 'postalCode', 'addressLine1', 'addressLine2'];
    addrFields.forEach((f) => {
      const nestedVal = pick(address, f);
      const topVal = pick({ city, country, state, postalCode, addressLine1, addressLine2 }, f);
      const chosen = nestedVal !== undefined ? nestedVal : topVal;
      if (chosen !== undefined) {
        if (typeof chosen !== 'string') return; // ignore invalid types silently
        addr[f] = chosen.trim();
        set[f] = addr[f]; // keep top-level in sync via pre hook as well
      }
    });
    if (Object.keys(addr).length > 0) {
      set.address = addr;
    }

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Perform update; pre('findOneAndUpdate') keeps address mirrors in sync
    const updated = await User.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { new: true, runValidators: true }
    ).select('-passwordHash');

    if (!updated) return res.status(404).json({ message: 'User not found' });
    return res.json(updated);
  } catch (err) {
    console.error('PATCH /api/users/:id error:', err);
    if (err && err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      return res.status(409).json({ message: 'Email already in use' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
