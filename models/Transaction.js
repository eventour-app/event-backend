const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  // Optional link to order when this transaction is for a booking
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true },
  type: { type: String, enum: ['booking','withdrawal','commission'], required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  mode: { type: String },  // e.g. UPI, bank-transfer
  status: { type: String, enum: ['pending','completed','failed','processing'], default: 'completed', index: true },
  date: { type: Date, default: Date.now },
}, { timestamps: true });

transactionSchema.set('toJSON', { transform: (doc, ret) => { ret.id = ret._id; return ret; } });

module.exports = mongoose.model('Transaction', transactionSchema);
