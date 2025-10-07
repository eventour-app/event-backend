const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Customer = require('../models/customer');
const Otp = require('../models/Otp');
const { sendOtp: sendOtpMessage } = require('../utils/messenger');


// Login API (password)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const normalizedEmail = String(email).toLowerCase().trim();
    const customer = await Customer.findOne({ email: normalizedEmail });
    if (!customer) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }
    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }
    const token = jwt.sign(
      { id: customer.id, email: customer.email, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, customerId: customer.id, customer: customer.toJSON(), role: 'customer' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// OTP: send
// POST /api/customer/auth/send-otp { identifier }
router.post('/send-otp', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ message: 'identifier is required' });
    const norm = String(identifier).toLowerCase().trim();

    const now = Date.now();
    const existing = await Otp.findOne({ identifier: norm, role: 'customer' }).sort({ createdAt: -1 });
    if (existing && existing.lastSentAt && now - existing.lastSentAt.getTime() < 30 * 1000) {
      const wait = 30 - Math.ceil((now - existing.lastSentAt.getTime()) / 1000);
      return res.status(429).json({ message: `Please wait ${wait}s before requesting another OTP` });
    }

    const code = (Math.floor(100000 + Math.random() * 900000)).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.create({ identifier: norm, role: 'customer', code, expiresAt, lastSentAt: new Date() });
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      try {
        await sendOtpMessage(norm, code, 'customer');
        return res.json({ message: 'OTP sent' });
      } catch (e) {
        console.error('OTP delivery failed (customer):', e.message);
        return res.json({ message: 'OTP sent' });
      }
    }
    res.json({ message: 'OTP sent', devCode: code });
  } catch (err) {
    console.error('send-otp customer error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// OTP: verify
// POST /api/customer/auth/verify-otp { identifier, code, name, contact }
router.post('/verify-otp', async (req, res) => {
  try {
    const { identifier, code, name, contact } = req.body;
    if (!identifier || !code) return res.status(400).json({ message: 'identifier and code are required' });
    const norm = String(identifier).toLowerCase().trim();

    const record = await Otp.findOne({ identifier: norm, role: 'customer' }).sort({ createdAt: -1 });
    if (!record) return res.status(400).json({ message: 'OTP not found. Please request a new one.' });
    if (record.expiresAt < new Date()) return res.status(400).json({ message: 'OTP expired' });
    if (record.code !== String(code)) return res.status(400).json({ message: 'Invalid OTP' });

    let customer = await Customer.findOne({ email: norm });
    if (!customer) {
      // Create customer with minimal info
      const tempPassword = Math.random().toString(36);
      customer = await Customer.create({
        name: name || 'Guest',
        email: norm.includes('@') ? norm : `${norm}@placeholder.local`,
        contact: contact || 'N/A',
        password: tempPassword,
      });
    }

    await Otp.deleteMany({ identifier: norm, role: 'customer' });

    const token = jwt.sign(
      { id: customer.id, email: customer.email, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, customerId: customer.id, customer: customer.toJSON(), role: 'customer' });
  } catch (err) {
    console.error('verify-otp customer error:', err);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword, adminKey } = req.body;
    if (!email || !newPassword || !adminKey) {
      return res.status(400).json({ error: 'email, newPassword, and adminKey are required.' });
    }
    if (!process.env.ADMIN_RESET_KEY || adminKey !== process.env.ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const customer = await Customer.findOne({ email: normalizedEmail });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    customer.password = newPassword; // pre-save hook will hash
    await customer.save();
    return res.json({ message: 'Password reset successful.' });
  } catch (err) {
    console.error('reset-password error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
