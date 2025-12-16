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
  // Minimum number of days in advance a user must book an event/service from this business.
  // Required during onboarding (create) and may be updated later.
  minBookingNoticeDays: {
    type: Number,
    required: [true, 'Minimum advance booking days is required'],
    min: [0, 'Minimum advance booking days cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: 'Minimum advance booking days must be a whole number',
    },
    index: true,
  },
  gstNumber: { type: String }, // optional
  cinNumber: { type: String }, // optional
  panNumber: { type: String }, // optional
  aadhaarNumber: { type: String }, // optional
  createdAt: { type: Date, default: Date.now },
  bankAccount: { type: String },
  ifscCode: { type: String },
 
  status: { type: String, enum: ['online', 'offline'], default: 'offline', index: true },
  verificationStatus: { type: String, enum: ['draft', 'verified'], default: 'draft', index: true },
  // Profile verification status - initially unverified, set to verified by admin
  profileVerified: { type: Boolean, default: false, index: true },
  partnerContractAccepted: { type: Boolean, default: false },
  // Agreement signing details
  agreementSigned: { type: Boolean, default: false },
  agreementSignedAt: { type: Date },
  agreementSignature: { type: String }, // Base64 signature image or signature text
  isRegisteredBusiness: { type: Boolean, default: false },
  serviceDetail: { type: String },
  // Vendor specialization selections
  // Fixed options provided by backend; stored as string arrays
  themes: [{ type: String }],
  eventTypes: [{ type: String }],
  // Timed offline support
  // When status === 'offline' and offlineUntil is a future date, listing auto-restores to online at that time
  // When status === 'offline' and offlineUntil is null, vendor must manually toggle back online
  offlineSince: { type: Date, default: null },
  offlineUntil: { type: Date, default: null, index: true },
  services: [
    {
      serviceName: { type: String, required: true },
      price: { type: String, required: true },
      discount: { type: String }, // optional
      description: { type: String, required: true }, // short description (max 200 chars)
      // For FOOD CATERER service types, this caps how many plates a user can order
      maxPlates: { type: Number, min: 1 },
      // For PHOTOGRAPHER listings, optional tiered rates by hours
      // Example: [{ hours: 2, charge: "4999" }, { hours: 4, charge: "8999" }]
      rates: [
        new mongoose.Schema({
          hours: { type: Number, min: 1, required: true },
          charge: { type: String, required: true },
        }, { _id: false, id: false })
      ],
      images: [String],           // array of image URLs
      // Service locations - where the vendor can provide this service
      // Options: Terrace, Car boot, Living room, Cabinet, Lawn, Backyard, Apartment
      serviceLocations: [{ type: String }],
      // Indicates if this service has sub-services
      hasSubServices: { type: String, enum: ['yes', 'no'], default: 'no' },
      // Sub-services (nested, same structure as service but without further nesting)
      subServices: [
        new mongoose.Schema({
          serviceName: { type: String, required: true },
          price: { type: String, required: true },
          discount: { type: String },
          description: { type: String, required: true },
          maxPlates: { type: Number, min: 1 },
          images: [String],
        }, { _id: true, id: false })
      ],
    }
  ]
  ,
  // Aggregate rating snapshot (updated when new reviews come in)
  ratingAvg: { type: Number, min: 0, max: 5, default: null },
  ratingCount: { type: Number, default: 0 },
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
