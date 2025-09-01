// models/Business.js
const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // reference to logged-in user
    required: true,
  },
  serviceType: { type: String, required: true },
  ownerName: { type: String },
  businessName: { type: String},
  email: { type: String},
  phone: { type: String},
  whatsapp: { type: String },
  location: {
    address: { type: String },
    gps: { type: String }, // you can store coordinates like "lat,long"
  },
  workingDays: [{ type: String }], // e.g. ["Mon","Tue","Wed"]
  openingTime: { type: String },
  closingTime: { type: String },
  gstNumber: { type: String }, // optional
  createdAt: { type: Date, default: Date.now },
  bankAccount: { type: String },
  ifscCode: { type: String },
  // 👇 New field: nested array of services
  services: [
    {
      serviceName: { type: String, required: true },
      price: { type: String, required: true },
      discount: { type: String }, // optional
      images: [String],           // array of image URLs
    }
  ]
});

module.exports = mongoose.model("Business", businessSchema);
