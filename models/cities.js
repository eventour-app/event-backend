const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  state: String,
  country: String,
}, { timestamps: true });

module.exports = mongoose.model('City', citySchema);


// // routes/cities.js
// const express = require('express');
// const City = require('../models/City');
// const router = express.Router();

// // Get all cities
// router.get('/', async (req, res) => {
//   try {
//     const cities = await City.find();
//     res.json(cities);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// module.exports = router;

