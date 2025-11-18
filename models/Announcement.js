const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  title: { type: String, required: true },
  desc: { type: String },
  icon: { type: String, enum: ['card-outline','pricetag-outline','alert-circle-outline','image-outline','megaphone-outline'], default: 'megaphone-outline' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

announcementSchema.set('toJSON', { transform: (doc, ret) => { ret.id = ret._id; delete ret._id; delete ret.__v; return ret; } });

module.exports = mongoose.model('Announcement', announcementSchema);
