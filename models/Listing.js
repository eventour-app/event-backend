const mongoose = require('mongoose');

// Represents public listing publish status for a Business.
// For now single listing per business; model allows future expansion.
const listingSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  status: { type: String, enum: ['draft', 'published', 'unpublished'], default: 'published', index: true },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  publishedAt: { type: Date, default: Date.now },
  unpublishedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Listing', listingSchema);
