const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Business = require('../models/Business');
const { generateVendorCode } = require('../utils/vendorCode');
const { THEMES, EVENT_TYPES, SERVICE_LOCATIONS } = require('../utils/vendorSpecializations');

function err(res, status, message, code, details) { return res.status(status).json({ error: true, message, code, ...(details?{details}:{}) }); }

// Normalize phone helper reusing messenger util
const { normalizePhone } = require('../utils/messenger');

// GET /api/vendor-mobile/check?phone=E164
// Returns whether phone exists, vendorCode and autofill profile fields from latest business
router.get('/check', async (req, res) => {
  try {
    const raw = (req.query.phone || '').trim();
    if (!raw) return err(res, 400, 'phone is required', 'VALIDATION_FAILED');
    const phone = normalizePhone(raw);
    const user = await User.findOne({ phone }).lean();
    if (!user) return res.json({ exists: false });

    let vendorCode = user.vendorCode;
    if (!vendorCode) {
      vendorCode = generateVendorCode(user._id ? String(user._id) : undefined);
      await User.findByIdAndUpdate(user._id, { $set: { vendorCode } });
    }

    // Autofill fields from the most recently created business of this user
    const latestBiz = await Business.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean();
    // Provide a richer autofill payload so mobile can pre-populate most fields
    const autofill = latestBiz ? {
      // identity and contact
      email: latestBiz.email || user.email || '',
      phone: latestBiz.phone || user.phone || '',
      whatsapp: latestBiz.whatsapp || '',
      ownerName: latestBiz.ownerName || '',
      businessName: latestBiz.businessName || '',

      // business registration IDs
      gstNumber: latestBiz.gstNumber || '',
      cinNumber: latestBiz.cinNumber || '',
      panNumber: latestBiz.panNumber || '',
      aadhaarNumber: latestBiz.aadhaarNumber || '',

      // ops details
      serviceType: latestBiz.serviceType || '',
      workingDays: Array.isArray(latestBiz.workingDays) ? latestBiz.workingDays : [],
      openingTime: latestBiz.openingTime || '',
      closingTime: latestBiz.closingTime || '',
      minBookingNoticeDays: typeof latestBiz.minBookingNoticeDays === 'number' ? latestBiz.minBookingNoticeDays : undefined,
      isRegisteredBusiness: !!latestBiz.isRegisteredBusiness,
      serviceDetail: latestBiz.serviceDetail || '',

      // banking
      bankAccount: latestBiz.bankAccount || '',
      ifscCode: latestBiz.ifscCode || '',

      // location
      location: latestBiz.location || {},

      // media urls (if present)
      logoUrl: latestBiz.logoUrl || '',
      govtIdUrl: latestBiz.govtIdUrl || '',
      registrationProofUrl: latestBiz.registrationProofUrl || '',
      cancelledChequeUrl: latestBiz.cancelledChequeUrl || '',
      ownerPhotoUrl: latestBiz.ownerPhotoUrl || '',
      previewPhotoUrl: latestBiz.previewPhotoUrl || '',
    } : {
      // fallback to user level basic info
      email: user.email || '',
      phone: user.phone || '',
    };

    res.json({ exists: true, vendorCode, autofill });
  } catch (e) {
    console.error('vendor-mobile check error', e);
    err(res, 500, 'Failed to check phone', 'SERVER_ERROR');
  }
});

// POST /api/vendor-mobile/onboard
// Body: { phone, serviceType, businessInfo, autofillFromExisting?: boolean }
// Creates a new Business linked to existing user (by phone) or errors if user not found (frontend can create user via normal signup)
router.post('/onboard', async (req, res) => {
  try {
    const { phone, serviceType, businessInfo = {}, autofillFromExisting } = req.body || {};
    if (!phone || !serviceType) return err(res, 400, 'phone and serviceType are required', 'VALIDATION_FAILED');
    const normalized = normalizePhone(phone);
    const user = await User.findOne({ phone: normalized });
    if (!user) return err(res, 404, 'User not found for given phone', 'NOT_FOUND');

    // Prefill fields if requested
  let info = { ...businessInfo };
    if (autofillFromExisting) {
      const latestBiz = await Business.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean();
      if (latestBiz) {
        info = {
          gstNumber: latestBiz.gstNumber,
          cinNumber: latestBiz.cinNumber,
          panNumber: latestBiz.panNumber,
          aadhaarNumber: latestBiz.aadhaarNumber,
          email: latestBiz.email || user.email,
          ...info,
        };
      } else {
        info = { email: user.email, ...info };
      }
    }

    // Build business payload with comprehensive mapping
    // Ensure required numeric fields present
    if (info.minBookingNoticeDays === undefined || info.minBookingNoticeDays === null) {
      return err(res, 400, 'minBookingNoticeDays is required', 'VALIDATION_FAILED');
    }

    const business = new Business({
      userId: user._id,
      serviceType,
      // contacts
      email: info.email,
      phone: normalized,
      whatsapp: info.whatsapp,
      ownerName: info.ownerName,
      businessName: info.businessName,

      // registration IDs
      gstNumber: info.gstNumber,
      cinNumber: info.cinNumber,
      panNumber: info.panNumber,
      aadhaarNumber: info.aadhaarNumber,

      // ops details
      workingDays: Array.isArray(info.workingDays) ? info.workingDays : [],
      openingTime: info.openingTime,
      closingTime: info.closingTime,
      minBookingNoticeDays: info.minBookingNoticeDays,
      isRegisteredBusiness: !!info.isRegisteredBusiness,
      serviceDetail: info.serviceDetail,

      // banking
      bankAccount: info.bankAccount,
      ifscCode: info.ifscCode,

      // location object
      location: {
        address: info?.location?.address,
        street: info?.location?.street,
        houseNo: info?.location?.houseNo,
        plotNo: info?.location?.plotNo,
        area: info?.location?.area,
        landmark: info?.location?.landmark,
        pincode: info?.location?.pincode,
        state: info?.location?.state,
        gps: info?.location?.gps,
      },

      // optional media urls (uploaded via uploads API)
      logoUrl: info.logoUrl,
      govtIdUrl: info.govtIdUrl,
      registrationProofUrl: info.registrationProofUrl,
      cancelledChequeUrl: info.cancelledChequeUrl,
      ownerPhotoUrl: info.ownerPhotoUrl,
      previewPhotoUrl: info.previewPhotoUrl,

      // default flags
      verificationStatus: 'verified',
      status: 'online'
    });

    const saved = await business.save();
    res.status(201).json({ message: 'Business created with existing vendor phone', business: saved });
  } catch (e) {
    console.error('vendor-mobile onboard error', e);
    err(res, 500, 'Failed to onboard with existing phone', 'SERVER_ERROR');
  }
});

// GET /api/vendor-mobile/:phone/businesses - list all businesses linked to a phone
router.get('/:phone/businesses', async (req, res) => {
  try {
    const normalized = normalizePhone(req.params.phone);
    const user = await User.findOne({ phone: normalized }).lean();
    if (!user) return err(res, 404, 'User not found', 'NOT_FOUND');
    const businesses = await Business.find({ userId: user._id }).lean();
    res.json({ businesses });
  } catch (e) {
    console.error('vendor-mobile businesses error', e);
    err(res, 500, 'Failed to list businesses', 'SERVER_ERROR');
  }
});

module.exports = router;

// --- Vendor Specializations: Themes & Event Types ---
// GET /api/vendor-mobile/specializations-options
// Returns fixed lists of themes and eventTypes
router.get('/specializations-options', (req, res) => {
  try {
    res.json({ themes: THEMES, eventTypes: EVENT_TYPES });
  } catch (e) {
    console.error('specializations-options error', e);
    err(res, 500, 'Failed to load options', 'SERVER_ERROR');
  }
});

// GET /api/vendor-mobile/service-locations-options
// Returns fixed list of service location options for vendors
router.get('/service-locations-options', (req, res) => {
  try {
    res.json({ serviceLocations: SERVICE_LOCATIONS });
  } catch (e) {
    console.error('service-locations-options error', e);
    err(res, 500, 'Failed to load service locations', 'SERVER_ERROR');
  }
});

// POST /api/vendor-mobile/:businessId/specializations
// Body: { themes: string[], eventTypes: string[] }
// Stores vendor selections on Business doc. Requires at least one in each.
router.post('/:businessId/specializations', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { themes = [], eventTypes = [] } = req.body || {};

    const t = Array.isArray(themes) ? themes.map(String) : [];
    const e = Array.isArray(eventTypes) ? eventTypes.map(String) : [];

    if (!t.length) return err(res, 400, 'Select at least one theme', 'VALIDATION_FAILED');
    if (!e.length) return err(res, 400, 'Select at least one event type', 'VALIDATION_FAILED');

    // Validate against fixed options
    const invalidThemes = t.filter(x => !THEMES.includes(x));
    const invalidEventTypes = e.filter(x => !EVENT_TYPES.includes(x));
    if (invalidThemes.length) return err(res, 400, 'Invalid theme(s) selected', 'VALIDATION_FAILED', { invalidThemes });
    if (invalidEventTypes.length) return err(res, 400, 'Invalid event type(s) selected', 'VALIDATION_FAILED', { invalidEventTypes });

    const updated = await Business.findByIdAndUpdate(
      businessId,
      { $set: { themes: t, eventTypes: e } },
      { new: true }
    ).lean();
    if (!updated) return err(res, 404, 'Business not found', 'NOT_FOUND');

    res.json({ message: 'Specializations saved', business: { _id: updated._id, themes: updated.themes, eventTypes: updated.eventTypes } });
  } catch (e) {
    console.error('save specializations error', e);
    err(res, 500, 'Failed to save specializations', 'SERVER_ERROR');
  }
});

// GET /api/vendor-mobile/:businessId/specializations
// Returns saved selections for the business
router.get('/:businessId/specializations', async (req, res) => {
  try {
    const { businessId } = req.params;
    const biz = await Business.findById(businessId).select('themes eventTypes').lean();
    if (!biz) return err(res, 404, 'Business not found', 'NOT_FOUND');
    res.json({ themes: biz.themes || [], eventTypes: biz.eventTypes || [] });
  } catch (e) {
    console.error('get specializations error', e);
    err(res, 500, 'Failed to load specializations', 'SERVER_ERROR');
  }
});
