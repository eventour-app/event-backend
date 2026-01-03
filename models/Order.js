const mongoose = require('mongoose');

// Order model capturing bookings between customers and vendors
// Flexible date fields: scheduledAt (ISO) OR legacy date+time strings.
const orderSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  customerId: { type: String, ref: 'Customer', index: true }, // uuid string from Customer model
  customerName: { type: String },
  customerPhone: { type: String },
  status: { type: String, enum: ['pending','accepted','upcoming','in_progress','on_the_way','completed','cancelled','declined'], default: 'pending', index: true },
  total: { type: Number, required: true },

  // Scheduling variants
  scheduledAt: { type: Date },  // preferred
  date: { type: String },       // optional legacy
  time: { type: String },       // optional legacy
  startTime: { type: Date },    // alternative start marker

  serviceName: { type: String },
  packageName: { type: String },
  location: { type: String },   // textual location or venue
  venue: { type: String },      // synonym
  notes: { type: String },

  // Cancellation/Decline reason tracking
  cancellationReason: { type: String },      // The selected reason
  cancellationNote: { type: String },        // Custom note if "Other" is selected
  cancelledBy: { type: String, enum: ['vendor', 'customer', 'system'] }, // Who cancelled
  cancelledAt: { type: Date },               // When cancelled

  messages: [
    {
      senderRole: { type: String, enum: ['vendor','customer','system'], default: 'system' },
      body: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    }
  ],
}, { timestamps: true });

orderSchema.set('toJSON', { transform: (doc, ret) => { ret.id = ret._id; return ret; } });

module.exports = mongoose.model('Order', orderSchema);
