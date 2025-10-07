const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const Otp = require('../models/Otp');
const { sendOtp: sendOtpMessage } = require('../utils/messenger');

const router = express.Router();

// helper to sign token
const signToken = (user) =>
  jwt.sign({ sub: user._id, email: user.email, role: 'vendor' }, process.env.JWT_SECRET, { expiresIn: '7d' });

// register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email & password required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = signToken(user);

    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
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
    if (!token) {
    res.status(201).json({ token, userId: user._id.toString(), user: { id: user._id, name: user.name, email: user.email } });
    }

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

// --- OTP LOGIN for Vendors ---
// POST /api/auth/send-otp { identifier: emailOrPhone }
router.post('/send-otp', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ message: 'identifier (email or phone) is required' });

    const norm = String(identifier).toLowerCase().trim();

    // throttle: allow resend every 30s
    const now = Date.now();
    const existing = await Otp.findOne({ identifier: norm, role: 'vendor' }).sort({ createdAt: -1 });
    if (existing && existing.lastSentAt && now - existing.lastSentAt.getTime() < 30 * 1000) {
      const wait = 30 - Math.ceil((now - existing.lastSentAt.getTime()) / 1000);
      return res.status(429).json({ message: `Please wait ${wait}s before requesting another OTP` });
    }

    const code = (Math.floor(100000 + Math.random() * 900000)).toString(); // 6-digit
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    await Otp.create({ identifier: norm, role: 'vendor', code, expiresAt, lastSentAt: new Date() });

    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      try {
        await sendOtpMessage(norm, code, 'vendor');
        return res.json({ message: 'OTP sent' });
      } catch (e) {
        console.error('OTP delivery failed (vendor):', e.message);
        // still return success to avoid user enumeration; optionally include a hint in non-prod
        return res.json({ message: 'OTP sent' });
      }
    }
    // Dev mode - return the code to the caller
    res.json({ message: 'OTP sent', devCode: code });
  } catch (err) {
    console.error('send-otp vendor error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-otp { identifier, code }
router.post('/verify-otp', async (req, res) => {
  try {
    const { identifier, code, name } = req.body;
    if (!identifier || !code) return res.status(400).json({ message: 'identifier and code are required' });
    const norm = String(identifier).toLowerCase().trim();

    const record = await Otp.findOne({ identifier: norm, role: 'vendor' }).sort({ createdAt: -1 });
    if (!record) return res.status(400).json({ message: 'OTP not found. Please request a new one.' });
    if (record.expiresAt < new Date()) return res.status(400).json({ message: 'OTP expired' });
    if (record.code !== String(code)) return res.status(400).json({ message: 'Invalid OTP' });

    // upsert vendor user by email/phone as email field if it includes '@'
    const isEmail = norm.includes('@');
    const email = isEmail ? norm : undefined;
    let user = email ? await User.findOne({ email }) : null;
    if (!user) {
      // Create minimal user without password when OTP login
      const fakePasswordHash = await bcrypt.hash(Math.random().toString(36), 10);
      user = await User.create({ name: name || 'Vendor', email: email || `${norm}@placeholder.local`, passwordHash: fakePasswordHash });
    }

    // Consume OTP (delete)
    await Otp.deleteMany({ identifier: norm, role: 'vendor' });

    const token = signToken(user);
      res.json({ token, userId: user._id.toString(), user: { id: user._id, name: user.name, email: user.email }, role: 'vendor' });
  } catch (err) {
    console.error('verify-otp vendor error:', err);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

module.exports = router;
