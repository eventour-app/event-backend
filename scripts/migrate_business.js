
require('dotenv').config();
const mongoose = require('mongoose');
const Business = require('../models/Business');

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI missing in environment');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const cursor = Business.find().cursor();
  let updatedCount = 0;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    let changed = false;

    // Default status
    if (!doc.status) {
      doc.status = 'offline';
      changed = true;
    }

    // Ensure location object exists
    doc.location = doc.location || {};

    // If only address existed previously, keep it and ensure other fields exist
    const locKeys = ['street','houseNo','plotNo','area','landmark','pincode','state','gps'];
    for (const k of locKeys) {
      if (doc.location[k] === undefined) doc.location[k] = undefined;
    }

    // Ensure boolean flags exist
    if (doc.partnerContractAccepted === undefined) {
      doc.partnerContractAccepted = false; changed = true;
    }
    if (doc.isRegisteredBusiness === undefined) {
      doc.isRegisteredBusiness = false; changed = true;
    }

    // Services images ensure array
    if (Array.isArray(doc.services)) {
      for (const s of doc.services) {
        if (!Array.isArray(s.images)) s.images = [];
      }
    }

    if (changed) {
      await doc.save();
      updatedCount++;
      console.log(`Updated Business ${doc._id}`);
    }
  }

  console.log(`Migration complete. Documents updated: ${updatedCount}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
