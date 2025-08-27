const express = require("express");
const City = require("../models/cities"); // your schema
const router = express.Router();

// GET all cities
router.get("/", async (req, res) => {
  try {
    const cities = await City.find();
    res.json(cities);
  } catch (err) {
    res.status(500).json({ message: "Error fetching cities" });
  }
});

module.exports = router;
