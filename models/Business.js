// models/Business.js
const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // reference to logged-in user
    required: true,
  },
  serviceType: { 
    type: String, 
    required: true,
    enum: ['Pandit', 'photographer', 'food caterer', 'banquet hall', 'Decorator', 'DJ', 'Makeup Artist', 'Mehendi Artist', 'Choreographer', 'Tent House', 'Florist', 'Invitation Card Designer', 'Event Planner']
  },
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
    city: { type: String }, // Added for banquet halls
    locality: { type: String }, // Added for banquet halls
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
  // Banquet Hall specific fields
  propertyType: { type: String, enum: ['hotel', 'guest house', 'lodge', 'homestay', 'banquet hall', 'resort', 'convention center'] }, // Basic Property Info
  numberOfFloors: { type: Number },
  yearOfConstruction: { type: Number },
  // Property Infrastructure
  totalRooms: { type: Number },
  roomTypes: [{
    type: { type: String },
    count: { type: Number },
    maxOccupancy: { type: Number },
    hasAttachedBathroom: { type: Boolean, default: false },
    roomSize: { type: String },
  }],
  maxOccupancyPerRoom: { type: Number },
  attachedBathrooms: { type: Boolean },
  roomSize: { type: String }, // e.g., '200 sq ft'
  // Banquet hall capacity
  totalHallCapacity: { type: Number },
  hallArea: { type: String },
  diningCapacity: { type: Number },
  gstNumber: { type: String }, // optional
  cinNumber: { type: String }, // optional
  panNumber: { type: String }, // optional
  aadhaarNumber: { type: String }, // optional
  businessType: { 
    type: String, 
    enum: [
      'individual', 'Individual',
      'partnership', 'Partnership',
      'LLP', 'LLP (Limited Liability Partnership)',
      'Pvt Ltd', 'Pvt Ltd (Private Limited)', 'Private Limited',
      'proprietorship', 'Proprietorship'
    ] 
  }, // Added for banquet halls
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
  // For Pandit service type, language preferences
  languages: [{ type: String }],
  // Banquet Hall Amenities
  amenities: {
    wifi: { type: Boolean, default: false },
    ac: { type: Boolean, default: false }, // AC/Non-AC
    projector: { type: Boolean, default: false },
    elevator: { type: Boolean, default: false },
    parking: { type: Boolean, default: false },
    reception: { type: Boolean, default: false },
    cctv: { type: Boolean, default: false },
    inHouseCaterers: { type: Boolean, default: false },
    swimmingPool: { type: Boolean, default: false },
    djSound: { type: Boolean, default: false },
    generator: { type: Boolean, default: false },
    valetParking: { type: Boolean, default: false },
    decorServices: { type: Boolean, default: false },
    brideGroomRoom: { type: Boolean, default: false },
    outdoorArea: { type: Boolean, default: false },
    terrace: { type: Boolean, default: false },
  },
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
      description: { type: String }, // short description (max 200 chars)
      // For PANDIT service type - category (e.g., 'Ceremonies', 'Homam', 'Poojas')
      type: { type: String },
      // For PANDIT service type - specific service (e.g., 'Ganesh Puja', 'Hindu Wedding')
      subtype: { type: String },
      // For PANDIT service type - duration in hours
      hours: { type: Number, min: 0.5 },
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
          // For Pandit - subtype name (e.g., 'Ganesh Puja', 'Hindu Wedding')
          subtype: { type: String },
          // For Pandit - duration in hours
          hours: { type: Number, min: 0.5 },
          price: { type: String, required: true },
          discount: { type: String },
          description: { type: String },
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
  // Additional legal documents for banquet halls
  tradeLicense: Buffer,
  fireSafetyNoc: Buffer,
  propertyOwnershipProof: Buffer,
    tradeLicenseUrl: String,
    fireSafetyNocUrl: String,
    propertyOwnershipProofUrl: String,
  // Banquet Hall Photos
  exteriorPhotos: [{ type: String }], // URLs
  receptionPhotos: [{ type: String }],
  roomPhotos: [{ type: String }],
  bathroomPhotos: [{ type: String }],
  lobbyPhotos: [{ type: String }],
  hallPhotos: [{ type: String }],
  diningAreaPhotos: [{ type: String }],
  outdoorAreaPhotos: [{ type: String }],
  parkingPhotos: [{ type: String }],
  // Cancellation & refund policy agreement
  cancellationPolicyAgreed: { type: Boolean, default: false },
  cancellationPolicy: {
    fullRefundDays: { type: Number, default: 30 },
    partialRefundDays: { type: Number, default: 15 },
    partialRefundPercent: { type: Number, default: 50 },
    noRefundDays: { type: Number, default: 7 },
  },
  // Banquet hall pricing
  pricing: {
    basePrice: { type: Number },
    pricingType: { type: String, enum: ['per_day', 'per_plate', 'per_event', 'custom'] },
    vegPlatePrice: { type: Number },
    nonVegPlatePrice: { type: Number },
    roomRentPerNight: { type: Number },
  },
  // FSSAI License for in-house catering
  fssaiLicenseUrl: { type: String },
});

module.exports = mongoose.model("Business", businessSchema);
