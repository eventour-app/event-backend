const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  customerName: { type: String },
  rating: { type: Number, min: 0, max: 5, required: true },
  comment: { type: String },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

reviewSchema.set('toJSON', { transform: (doc, ret) => { ret.id = ret._id; delete ret._id; delete ret.__v; return ret; } });

module.exports = mongoose.model('Review', reviewSchema);
