const mongoose = require('mongoose');

// Address subdocument schema
const addressSchema = new mongoose.Schema({
  city: { type: String, trim: true },
  country: { type: String, trim: true },
  state: { type: String, trim: true },
  postalCode: { type: String, trim: true },
  addressLine1: { type: String, trim: true },
  addressLine2: { type: String, trim: true },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },

  // Profile fields
  phone: { type: String, trim: true }, // E.164 preferred
  bio: { type: String, trim: true },

  // Address (nested and top-level duplicates for UI flexibility)
  address: addressSchema,
  city: { type: String, trim: true },
  country: { type: String, trim: true },
  state: { type: String, trim: true },
  postalCode: { type: String, trim: true },
  addressLine1: { type: String, trim: true },
  addressLine2: { type: String, trim: true },
}, { timestamps: true });

// Sync helper: keep top-level address fields and nested address in sync on save
function syncAddress(doc) {
  if (!doc) return;
  const fields = ['city', 'country', 'state', 'postalCode', 'addressLine1', 'addressLine2'];
  if (!doc.address) doc.address = {};
  fields.forEach((f) => {
    const addrVal = doc.address && doc.address[f];
    const topVal = doc[f];
    if (addrVal !== undefined && addrVal !== null && addrVal !== '') {
      // prefer nested if provided
      doc[f] = addrVal;
    } else if (topVal !== undefined && topVal !== null && topVal !== '') {
      doc.address[f] = topVal;
    }
  });
}

userSchema.pre('save', function(next) {
  syncAddress(this);
  next();
});

// Sync in findOneAndUpdate as well (since many controllers use atomic updates)
userSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  const $set = update.$set || {};
  const addr = ($set.address !== undefined) ? $set.address : update.address;

  const fields = ['city', 'country', 'state', 'postalCode', 'addressLine1', 'addressLine2'];
  const ensureSet = (k, v) => {
    if (!$set[k] && v !== undefined) $set[k] = v;
  };

  // Build a merged address based on incoming updates
  let mergedAddress = {};
  fields.forEach((f) => {
    if (addr && addr[f] !== undefined) {
      mergedAddress[f] = addr[f];
    } else if ($set[f] !== undefined) {
      mergedAddress[f] = $set[f];
    }
  });

  if (Object.keys(mergedAddress).length > 0) {
    // Apply to nested address
    $set.address = Object.assign({}, addr || {}, mergedAddress);
    // Also mirror to top-level
    fields.forEach((f) => ensureSet(f, mergedAddress[f]));
  }

  // Normalize phone and email inputs if present
  if ($set.email && typeof $set.email === 'string') {
    $set.email = $set.email.toLowerCase().trim();
  }
  if ($set.phone && typeof $set.phone === 'string') {
    $set.phone = $set.phone.trim();
  }

  // write back the composed update
  if (Object.keys($set).length > 0) {
    update.$set = $set;
  }
  this.setUpdate(update);
  next();
});

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
