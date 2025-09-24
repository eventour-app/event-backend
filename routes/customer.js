const express = require('express');
const router = express.Router();
const Customer = require('../models/customer');

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
