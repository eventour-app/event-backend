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
    street: { type: String },
    houseNo: { type: String },
    plotNo: { type: String },
    area: { type: String },
    landmark: { type: String },
    pincode: { type: String },
    state: { type: String },
    // GPS coordinates string "lat,long"
    gps: { type: String },
  },
  workingDays: [{ type: String }], // e.g. ["Mon","Tue","Wed"]
  openingTime: { type: String },
  closingTime: { type: String },
  gstNumber: { type: String }, // optional
  createdAt: { type: Date, default: Date.now },
  bankAccount: { type: String },
  ifscCode: { type: String },
 
  status: { type: String, enum: ['online', 'offline'], default: 'offline', index: true },
  verificationStatus: { type: String, enum: ['draft', 'verified'], default: 'draft', index: true },
  partnerContractAccepted: { type: Boolean, default: false },
  isRegisteredBusiness: { type: Boolean, default: false },
  serviceDetail: { type: String },
  services: [
    {
      serviceName: { type: String, required: true },
      price: { type: String, required: true },
      discount: { type: String }, // optional
      images: [String],           // array of image URLs
    }
  ]
});

// Packages associated with a listing (business)
// Each package references selected service subdocument IDs from `services`
businessSchema.add({
  packages: [
    new mongoose.Schema({
      name: { type: String, required: true, trim: true },
      // references to business.services subdocument _ids
      selectedServiceIds: [{ type: mongoose.Schema.Types.ObjectId, required: true }],
      price: { type: String, required: true },
      description: { type: String },
      createdAt: { type: Date, default: Date.now },
      active: { type: Boolean, default: true },
    }, { _id: true, id: false })
  ]
});

businessSchema.add({
  logo: {
    data: Buffer,
    contentType: String,
    sizeKb: Number,
    width: Number,
    height: Number,
  },
    logoUrl: String,
  govtId: Buffer,
  registrationProof: Buffer,
  cancelledCheque: Buffer,
    govtIdUrl: String,
    registrationProofUrl: String,
    cancelledChequeUrl: String,
  ownerPhoto: Buffer,
  previewPhoto: Buffer,
    ownerPhotoUrl: String,
    previewPhotoUrl: String,
});

module.exports = mongoose.model("Business", businessSchema);
