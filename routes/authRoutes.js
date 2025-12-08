const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const Otp = require('../models/Otp');
const { normalizePhone } = require('../utils/phone');
const twilioVerify = require('../utils/twilio');

const router = express.Router();

// helper to sign token
const signToken = (user) =>
  jwt.sign({ sub: user._id, email: user.email, role: 'vendor' }, process.env.JWT_SECRET, { expiresIn: '7d' });

// register (Vendor)
// Body: { name?, email, password, phone }
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!email || !password || !phone) return res.status(400).json({ message: 'email, password and phone are required' });

    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedPhone = normalizePhone(phone);

    const [emailExists, phoneExists] = await Promise.all([
      User.findOne({ email: normalizedEmail }),
      User.findOne({ phone: normalizedPhone }),
    ]);
    if (emailExists) return res.status(409).json({ message: 'Email already in use' });
    if (phoneExists) return res.status(409).json({ message: 'Phone already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email: normalizedEmail, phone: normalizedPhone, passwordHash });
    const token = signToken(user);

    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone } });
  } catch (e) {
    res.status(500).json({ message: 'Register failed' });
  }
});

// login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

  const token = signToken(user);
  res.json({ token, userId: user._id.toString(), user: { id: user._id, name: user.name, email: user.email } });
});

// get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1]; // Bearer <token>
    if (!token) return res.status(401).json({ message: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// --- OTP LOGIN for Vendors (PHONE-ONLY, must be registered) ---
// POST /api/auth/send-otp { phone }
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ message: 'phone is required' });
    const norm = normalizePhone(phone);

    // Only allow OTP for registered numbers
    const user = await User.findOne({ phone: norm });
    if (!user) return res.status(404).json({ message: 'Phone number is not registered' });

    // throttle: allow resend every 30s
    const now = Date.now();
    const existing = await Otp.findOne({ identifier: norm, role: 'vendor' }).sort({ createdAt: -1 });
    if (existing && existing.lastSentAt && now - existing.lastSentAt.getTime() < 30 * 1000) {
      const wait = 30 - Math.ceil((now - existing.lastSentAt.getTime()) / 1000);
      return res.status(429).json({ message: `Please wait ${wait}s before requesting another OTP` });
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    // Use Twilio Verify for SMS OTP
    if (!twilioVerify.isConfigured()) {
      return res.status(500).json({ message: 'Twilio Verify is not configured (set TWILIO_* env vars)' });
    }
    try {
      const resp = await twilioVerify.sendVerification(norm, 'sms');
      await Otp.create({ identifier: norm, role: 'vendor', provider: 'twilio', channel: 'sms', expiresAt, lastSentAt: new Date() });
      return res.json({ message: 'OTP sent', provider: 'twilio', sid: resp.sid });
    } catch (e) {
      const msg = (e && e.message) || 'Failed to send OTP';
      console.error('Twilio send OTP failed:', msg);
      return res.status(500).json({ message: 'Failed to send OTP', error: msg });
    }
  } catch (err) {
    console.error('send-otp vendor error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-otp { phone, code }
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ message: 'phone and code are required' });
    const norm = normalizePhone(phone);

    const record = await Otp.findOne({ identifier: norm, role: 'vendor' }).sort({ createdAt: -1 });
    if (!record) return res.status(400).json({ message: 'OTP not found. Please request a new one.' });
    if (record.expiresAt < new Date()) return res.status(400).json({ message: 'OTP expired' });
    if (record.provider !== 'twilio') {
      return res.status(400).json({ message: 'Unsupported OTP provider (expected twilio)' });
    }
    try {
      const resp = await twilioVerify.checkVerification(norm, String(code));
      if (resp.status !== 'approved') {
        return res.status(400).json({ message: 'Invalid OTP' });
      }
    } catch (e) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Only allow login for existing vendor accounts with this phone
    const user = await User.findOne({ phone: norm });
    if (!user) return res.status(404).json({ message: 'Phone number is not registered' });

    // Consume OTP (delete)
    await Otp.deleteMany({ identifier: norm, role: 'vendor' });

    const token = signToken(user);
    res.json({ token, userId: user._id.toString(), user: { id: user._id, name: user.name, email: user.email, phone: user.phone }, role: 'vendor' });
  } catch (err) {
    console.error('verify-otp vendor error:', err);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

module.exports = router;
