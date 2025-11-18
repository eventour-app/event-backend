const express = require('express');
const router = express.Router();
const Listing = require('../models/Listing');
const Business = require('../models/Business');

// Helper response format
function ok(data) { return data; }
function err(res, status, message, code, details) { return res.status(status).json({ error: true, message, code, ...(details?{details}:{}) }); }

// POST /api/listings/publish { businessId }
router.post('/publish', async (req, res) => {
  try {
    const { businessId } = req.body || {};
    if (!businessId) return err(res, 400, 'businessId is required', 'VALIDATION_FAILED');

    const biz = await Business.findById(businessId).select('_id status verificationStatus');
    if (!biz) return err(res, 404, 'Business not found', 'NOT_FOUND');

    // Single listing per business: upsert published listing
    let listing = await Listing.findOne({ businessId });
    if (!listing) {
      listing = await Listing.create({ businessId, status: 'published', visibility: 'public', publishedAt: new Date() });
    } else {
      if (listing.status !== 'published') {
        listing.status = 'published';
        listing.publishedAt = new Date();
        listing.unpublishedAt = null;
        await listing.save();
      }
    }
    return res.status(201).json(ok({ listing }));
  } catch (e) {
    console.error('publish listing error', e);
    return err(res, 500, 'Failed to publish listing', 'SERVER_ERROR');
  }
});

// GET /api/listings/by-business/:businessId
router.get('/by-business/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const listing = await Listing.findOne({ businessId }).lean();
    if (!listing) return err(res, 404, 'Listing not found', 'NOT_FOUND');
    return res.json(ok(listing));
  } catch (e) {
    console.error('get listing by business error', e);
    return err(res, 500, 'Failed to fetch listing', 'SERVER_ERROR');
  }
});

// GET /api/listings/:listingId
router.get('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const listing = await Listing.findById(listingId).lean();
    if (!listing) return err(res, 404, 'Listing not found', 'NOT_FOUND');
    return res.json(ok(listing));
  } catch (e) {
    console.error('get listing error', e);
    return err(res, 500, 'Failed to fetch listing', 'SERVER_ERROR');
  }
});

module.exports = router;
