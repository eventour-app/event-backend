const express = require("express");
const router = express.Router();
const Business = require("../models/Business");

// Save Business Info
router.post("/register", async (req, res) => {
  try {
    const {
      userId,
      ownerName,
      businessName,
      email,
      phone,
      whatsapp,
      location,
      workingDays,
      openingTime,
      closingTime,
      gstNumber,
      bankAccount,
      ifscCode
    } = req.body;

    const newBusiness = new Business({
      userId,
      ownerName,
      businessName,
      email,
      phone,
      whatsapp,
      location,
      workingDays,
      openingTime,
      closingTime,
      gstNumber,
      bankAccount,
      ifscCode
    });

    await newBusiness.save();
    res.status(201).json({ message: "Business registered successfully", business: newBusiness });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch Business Info by user
router.get("/:userId", async (req, res) => {
  try {
    const business = await Business.findOne({ userId: req.params.userId });
    res.json(business);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new service to an existing business
router.put("/add-service/:businessId", async (req, res) => {
  try {
    const { serviceName, price, discount, images } = req.body;

    const business = await Business.findByIdAndUpdate(
      req.params.businessId,
      {
        $push: {
          services: { serviceName, price, discount, images }
        }
      },
      { new: true }
    );

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    res.json({
      message: "Service added successfully",
      business
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Update business info after initial creation
router.put("/update/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;

    const updatedBusiness = await Business.findByIdAndUpdate(
      businessId,
      { $set: req.body },
      { new: true }
    );

    if (!updatedBusiness) {
      return res.status(404).json({ message: "Business not found" });
    }

    res.json({ message: "Business updated", business: updatedBusiness });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// routes/business.js
router.post("/", async (req, res) => {
  try {
    const { userId, serviceType } = req.body;
    if (!userId || !serviceType) {
      return res.status(400).json({ message: "userId and serviceType are required" });
    }

    const business = new Business({
      userId,
      serviceType,
      name: "",
      address: "",
      phone: "",
      services: []
    });

    await business.save();
    res.status(201).json(business);
  } catch (err) {
    console.error("Error creating business:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:userId", async (req, res) => {
  try {
    const businesses = await Business.find({ userId: req.params.userId });
    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;
