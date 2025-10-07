const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { initFirebase } = require('../utils/firebase');
const Customer = require('../models/customer');
const User = require('../models/user');

const router = express.Router();

function signVendor(user) {
  return jwt.sign({ sub: user._id, email: user.email, role: 'vendor' }, process.env.JWT_SECRET, { expiresIn: '7d' });
}
function signCustomer(customer) {
  return jwt.sign({ id: customer.id, email: customer.email, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/firebase/login { idToken, role: 'customer' | 'vendor', name? }
router.post('/login', async (req, res) => {
  try {
    const { idToken, role = 'customer', name } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const admin = initFirebase();
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase not configured' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const phone = decoded.phone_number; // E.164 like +91800...
    const uid = decoded.uid;
    const email = decoded.email || undefined;
    const displayName = name || decoded.name || (phone ? `User ${phone.slice(-4)}` : 'User');

    if (role === 'vendor') {
      // Upsert minimal vendor User model
      let user = null;
      if (email) user = await User.findOne({ email });
      if (!user) {
        const fallbackEmail = email || `${uid || phone || Date.now()}@firebase.local`;
        const passwordHash = await bcrypt.hash(Math.random().toString(36), 10);
        user = await User.create({ name: displayName, email: fallbackEmail, passwordHash });
      }
  const token = signVendor(user);
  return res.json({ token, userId: user._id.toString(), user: { id: user._id, name: user.name, email: user.email }, role: 'vendor' });
    }

    // Default: customer
    const normalizedEmail = (email || `${uid || phone || Date.now()}@firebase.local`).toLowerCase();
    let customer = await Customer.findOne({ email: normalizedEmail });
    if (!customer) {
      const tempPassword = Math.random().toString(36);
      customer = await Customer.create({
        name: displayName,
        email: normalizedEmail,
        contact: phone ? phone.replace(/\D/g, '') : 'N/A',
        password: tempPassword,
      });
    }
    const token = signCustomer(customer);
    return res.json({ token, customer: customer.toJSON(), role: 'customer' });
  } catch (e) {
    console.error('firebase login error:', e);
    return res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
