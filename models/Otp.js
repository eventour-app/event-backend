const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true, index: true }, // email or phone
  role: { type: String, enum: ['vendor', 'customer'], required: true, index: true },
  provider: { type: String, enum: ['local', 'firebase', 'twilio'], default: 'local', index: true },
  code: { type: String, required: function() { return this.provider === 'local'; } },
  firebaseSessionInfo: { type: String }, // legacy when provider === 'firebase'
  channel: { type: String, enum: ['sms','whatsapp','email'], default: 'sms' }, // for twilio/local
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
}, { timestamps: true });

// TTL index to auto-remove expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
