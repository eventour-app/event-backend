const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Customer = require('../models/customer');

// Login API
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    // Normalize email for consistent lookup
    const normalizedEmail = String(email).toLowerCase().trim();
    const customer = await Customer.findOne({ email: normalizedEmail });
    if (!customer) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }
    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }
    // JWT token
    const token = jwt.sign(
      { id: customer.id, email: customer.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
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
