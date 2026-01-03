// routes/banquetHall.js
// Banquet Hall onboarding - uses Business model with serviceType: 'banquet hall'
const express = require("express");
const router = express.Router();
const Business = require("../models/Business");
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processImage } = require('../utils/imageProcessor');

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsRoot),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      cb(null, `banquet-${Date.now()}-${safe}`);
    }
  })
});

// Helper: error response
function err(res, status, message, code, details) {
  return res.status(status).json({ error: true, message, code, ...(details ? { details } : {}) });
}

// Helper: parse data URL
function parseDataUrl(data) {
  if (!data || typeof data !== 'string') return null;
  const match = data.match(/^data:(.+);base64,(.*)$/);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }
  try {
    return { mimeType: 'application/octet-stream', buffer: Buffer.from(data, 'base64') };
  } catch {
    return null;
  }
}

// Helper: get base URL
function getBaseUrl(req) {
  const envBase = process.env.PUBLIC_BASE_URL && String(process.env.PUBLIC_BASE_URL).trim();
  if (envBase) return envBase.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// Helper: save image buffer to uploads
async function saveBufferAsUpload(processed, prefix, req) {
  const ext = processed.ext || (processed.mimeType === 'image/png' ? 'png' : 'jpg');
  const safePrefix = (prefix || 'banquet').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safePrefix}.${ext}`;
  const fpath = path.join(uploadsRoot, fname);
  await fs.promises.writeFile(fpath, processed.buffer);
  const base = getBaseUrl(req);
  return `${base}/uploads/${fname}`;
}

// Helper: process and save image (from data URL or existing URL)
async function processAndSaveImage(imageData, prefix, req) {
  if (!imageData || typeof imageData !== 'string') return null;
  
  // If already a URL, return as-is
  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return imageData;
  }
  
  // If relative URL, make it absolute
  if (imageData.startsWith('/uploads/') || imageData.startsWith('uploads/')) {
    const base = getBaseUrl(req);
    const rel = imageData.startsWith('/') ? imageData : `/${imageData}`;
    return `${base}${rel}`;
  }
  
  // Process data URL
  if (imageData.startsWith('data:')) {
    const parsed = parseDataUrl(imageData);
    if (!parsed) return null;
    const processed = await processImage(parsed.buffer, 'doc');
    return await saveBufferAsUpload(processed, prefix, req);
  }
  
  return null;
}

// Helper: process array of images
async function processImageArray(images, prefix, req) {
  if (!Array.isArray(images)) return [];
  const processed = [];
  for (const img of images) {
    const url = await processAndSaveImage(img, prefix, req);
    if (url) processed.push(url);
  }
  return processed;
}

/**
 * POST /api/banquet-hall/onboard
 * 
 * Single consolidated endpoint for banquet hall onboarding.
 * Uses the Business model with serviceType: 'banquet hall'
 * 
 * Expected Payload:
 * {
 *   businessId?: string,           // If provided, update existing; else create new
 *   userId: string,                // Required: logged-in user ID
 *   
 *   // STEP 1: Basic Property Information
 *   businessName: string,          // Property name
 *   location: {
 *     address: string,
 *     landmark?: string,
 *     pincode: string,
 *     city: string,
 *     locality?: string,
 *     state?: string,
 *     gps?: string
 *   },
 *   propertyType: 'hotel' | 'guest house' | 'lodge' | 'homestay' | 'banquet hall' | 'resort' | 'convention center',
 *   numberOfFloors?: number,
 *   yearOfConstruction?: number,
 *   
 *   // STEP 2: Owner / Business Details
 *   ownerName: string,
 *   phone: string,
 *   email: string,
 *   panNumber?: string,
 *   gstNumber?: string,
 *   businessType?: string,
 *   
 *   // STEP 3: Property Infrastructure & Room Details
 *   totalRooms?: number,
 *   roomTypes?: [{ type: string, count: number, maxOccupancy: number, hasAttachedBathroom: boolean, roomSize: string }],
 *   totalHallCapacity?: number,
 *   hallArea?: string,
 *   diningCapacity?: number,
 *   
 *   // STEP 4: Amenities & Facilities (all booleans)
 *   amenities?: { wifi, ac, projector, elevator, parking, reception, cctv, inHouseCaterers, swimmingPool, djSound, generator, valetParking, decorServices, brideGroomRoom, outdoorArea, terrace },
 *   
 *   // STEP 5: Legal & Compliance Documents (URLs or base64/data URLs)
 *   tradeLicense?: string,
 *   fireSafetyNoc?: string,
 *   propertyOwnershipProof?: string,
 *   fssaiLicense?: string,
 *   
 *   // STEP 6: Photos & Branding Assets
 *   exteriorPhotos?: string[],
 *   receptionPhotos?: string[],
 *   roomPhotos?: string[],
 *   bathroomPhotos?: string[],
 *   lobbyPhotos?: string[],
 *   hallPhotos?: string[],
 *   diningAreaPhotos?: string[],
 *   outdoorAreaPhotos?: string[],
 *   parkingPhotos?: string[],
 *   logo?: string,
 *   
 *   // STEP 7: Cancellation & Refund Policy
 *   cancellationPolicyAgreed?: boolean,
 *   cancellationPolicy?: { fullRefundDays, partialRefundDays, partialRefundPercent, noRefundDays },
 *   
 *   // Additional fields
 *   pricing?: { basePrice, pricingType, vegPlatePrice, nonVegPlatePrice, roomRentPerNight },
 *   workingDays?: string[],
 *   openingTime?: string,
 *   closingTime?: string,
 *   minBookingNoticeDays?: number,
 *   bankAccount?: string,
 *   ifscCode?: string,
 *   agreementSigned?: boolean,
 *   agreementSignature?: string
 * }
 */
router.post('/onboard', async (req, res) => {
  try {
    const {
      businessId,
      userId,
      // Step 1: Basic Property Info
      businessName,
      location,
      propertyType,
      numberOfFloors,
      yearOfConstruction,
      // Step 2: Owner/Business Details
      ownerName,
      phone,
      email,
      whatsapp,
      panNumber,
      gstNumber,
      businessType,
      // Step 3: Infrastructure
      totalRooms,
      roomTypes,
      totalHallCapacity,
      hallArea,
      diningCapacity,
      maxOccupancyPerRoom,
      attachedBathrooms,
      roomSize,
      // Step 4: Amenities
      amenities,
      // Step 5: Legal Documents
      tradeLicense,
      fireSafetyNoc,
      propertyOwnershipProof,
      fssaiLicense,
      // Step 6: Photos
      exteriorPhotos,
      receptionPhotos,
      roomPhotos,
      bathroomPhotos,
      lobbyPhotos,
      hallPhotos,
      diningAreaPhotos,
      outdoorAreaPhotos,
      parkingPhotos,
      logo,
      // Step 7: Cancellation Policy
      cancellationPolicyAgreed,
      cancellationPolicy,
      // Additional
      pricing,
      workingDays,
      openingTime,
      closingTime,
      minBookingNoticeDays,
      bankAccount,
      ifscCode,
      agreementSigned,
      agreementSignature,
    } = req.body || {};

    // Validate required fields
    if (!userId) {
      return err(res, 400, 'userId is required', 'VALIDATION_FAILED');
    }

    let business = null;
    const isUpdate = !!businessId;

    if (isUpdate) {
      // Update existing business
      business = await Business.findById(businessId);
      if (!business) {
        return err(res, 404, 'Business not found', 'NOT_FOUND');
      }
      // Verify it's a banquet hall
      if (business.serviceType !== 'banquet hall') {
        return err(res, 400, 'This endpoint is only for banquet hall listings', 'VALIDATION_FAILED');
      }
      // Verify ownership
      if (String(business.userId) !== String(userId)) {
        return err(res, 403, 'You are not authorized to update this listing', 'FORBIDDEN');
      }
    } else {
      // Create new - validate required fields
      if (!businessName) {
        return err(res, 400, 'businessName (property name) is required', 'VALIDATION_FAILED');
      }
      if (!ownerName) {
        return err(res, 400, 'ownerName is required', 'VALIDATION_FAILED');
      }
      if (!phone) {
        return err(res, 400, 'phone is required', 'VALIDATION_FAILED');
      }
      if (minBookingNoticeDays === undefined || minBookingNoticeDays === null) {
        return err(res, 400, 'minBookingNoticeDays is required', 'VALIDATION_FAILED');
      }

      business = new Business({
        userId,
        serviceType: 'banquet hall',
        verificationStatus: 'verified',
        status: 'online',
      });
    }

    // ==================== STEP 1: Basic Property Information ====================
    if (businessName !== undefined) business.businessName = businessName;
    if (location) {
      business.location = {
        address: location.address ?? business.location?.address,
        landmark: location.landmark ?? business.location?.landmark,
        pincode: location.pincode ?? business.location?.pincode,
        city: location.city ?? business.location?.city,
        locality: location.locality ?? business.location?.locality,
        state: location.state ?? business.location?.state,
        gps: location.gps ?? business.location?.gps,
        street: location.street ?? business.location?.street,
        houseNo: location.houseNo ?? business.location?.houseNo,
        plotNo: location.plotNo ?? business.location?.plotNo,
        area: location.area ?? business.location?.area,
      };
    }
    if (propertyType !== undefined) business.propertyType = propertyType;
    if (numberOfFloors !== undefined) business.numberOfFloors = numberOfFloors;
    if (yearOfConstruction !== undefined) business.yearOfConstruction = yearOfConstruction;

    // ==================== STEP 2: Owner / Business Details ====================
    if (ownerName !== undefined) business.ownerName = ownerName;
    if (phone !== undefined) business.phone = phone;
    if (email !== undefined) business.email = email;
    if (whatsapp !== undefined) business.whatsapp = whatsapp;
    if (panNumber !== undefined) business.panNumber = panNumber;
    if (gstNumber !== undefined) business.gstNumber = gstNumber;
    if (businessType !== undefined) business.businessType = businessType;

    // ==================== STEP 3: Property Infrastructure ====================
    if (totalRooms !== undefined) business.totalRooms = totalRooms;
    if (roomTypes !== undefined) business.roomTypes = roomTypes;
    if (totalHallCapacity !== undefined) business.totalHallCapacity = totalHallCapacity;
    if (hallArea !== undefined) business.hallArea = hallArea;
    if (diningCapacity !== undefined) business.diningCapacity = diningCapacity;
    if (maxOccupancyPerRoom !== undefined) business.maxOccupancyPerRoom = maxOccupancyPerRoom;
    if (attachedBathrooms !== undefined) business.attachedBathrooms = attachedBathrooms;
    if (roomSize !== undefined) business.roomSize = roomSize;

    // ==================== STEP 4: Amenities & Facilities ====================
    if (amenities) {
      business.amenities = {
        wifi: amenities.wifi ?? business.amenities?.wifi ?? false,
        ac: amenities.ac ?? business.amenities?.ac ?? false,
        projector: amenities.projector ?? business.amenities?.projector ?? false,
        elevator: amenities.elevator ?? business.amenities?.elevator ?? false,
        parking: amenities.parking ?? business.amenities?.parking ?? false,
        reception: amenities.reception ?? business.amenities?.reception ?? false,
        cctv: amenities.cctv ?? business.amenities?.cctv ?? false,
        inHouseCaterers: amenities.inHouseCaterers ?? business.amenities?.inHouseCaterers ?? false,
        swimmingPool: amenities.swimmingPool ?? business.amenities?.swimmingPool ?? false,
        djSound: amenities.djSound ?? business.amenities?.djSound ?? false,
        generator: amenities.generator ?? business.amenities?.generator ?? false,
        valetParking: amenities.valetParking ?? business.amenities?.valetParking ?? false,
        decorServices: amenities.decorServices ?? business.amenities?.decorServices ?? false,
        brideGroomRoom: amenities.brideGroomRoom ?? business.amenities?.brideGroomRoom ?? false,
        outdoorArea: amenities.outdoorArea ?? business.amenities?.outdoorArea ?? false,
        terrace: amenities.terrace ?? business.amenities?.terrace ?? false,
      };
    }

    // ==================== STEP 5: Legal & Compliance Documents ====================
    if (tradeLicense) {
      const url = await processAndSaveImage(tradeLicense, 'tradeLicense', req);
      if (url) business.tradeLicenseUrl = url;
    }
    if (fireSafetyNoc) {
      const url = await processAndSaveImage(fireSafetyNoc, 'fireSafetyNoc', req);
      if (url) business.fireSafetyNocUrl = url;
    }
    if (propertyOwnershipProof) {
      const url = await processAndSaveImage(propertyOwnershipProof, 'propertyProof', req);
      if (url) business.propertyOwnershipProofUrl = url;
    }
    if (fssaiLicense) {
      const url = await processAndSaveImage(fssaiLicense, 'fssaiLicense', req);
      if (url) business.fssaiLicenseUrl = url;
    }

    // ==================== STEP 6: Photos & Branding Assets ====================
    if (exteriorPhotos) {
      business.exteriorPhotos = await processImageArray(exteriorPhotos, 'exterior', req);
    }
    if (receptionPhotos) {
      business.receptionPhotos = await processImageArray(receptionPhotos, 'reception', req);
    }
    if (roomPhotos) {
      business.roomPhotos = await processImageArray(roomPhotos, 'room', req);
    }
    if (bathroomPhotos) {
      business.bathroomPhotos = await processImageArray(bathroomPhotos, 'bathroom', req);
    }
    if (lobbyPhotos) {
      business.lobbyPhotos = await processImageArray(lobbyPhotos, 'lobby', req);
    }
    if (hallPhotos) {
      business.hallPhotos = await processImageArray(hallPhotos, 'hall', req);
    }
    if (diningAreaPhotos) {
      business.diningAreaPhotos = await processImageArray(diningAreaPhotos, 'dining', req);
    }
    if (outdoorAreaPhotos) {
      business.outdoorAreaPhotos = await processImageArray(outdoorAreaPhotos, 'outdoor', req);
    }
    if (parkingPhotos) {
      business.parkingPhotos = await processImageArray(parkingPhotos, 'parking', req);
    }
    if (logo) {
      const parsed = parseDataUrl(logo);
      if (parsed) {
        const processed = await processImage(parsed.buffer, 'logo');
        business.logo = {
          data: processed.buffer,
          contentType: processed.mimeType,
          sizeKb: processed.sizeKb,
          width: processed.width,
          height: processed.height,
        };
        business.logoUrl = await saveBufferAsUpload(processed, 'logo', req);
      } else if (logo.startsWith('http')) {
        business.logoUrl = logo;
      }
    }

    // ==================== STEP 7: Cancellation & Refund Policy ====================
    if (cancellationPolicyAgreed !== undefined) {
      business.cancellationPolicyAgreed = cancellationPolicyAgreed;
    }
    if (cancellationPolicy) {
      business.cancellationPolicy = {
        fullRefundDays: cancellationPolicy.fullRefundDays ?? business.cancellationPolicy?.fullRefundDays ?? 30,
        partialRefundDays: cancellationPolicy.partialRefundDays ?? business.cancellationPolicy?.partialRefundDays ?? 15,
        partialRefundPercent: cancellationPolicy.partialRefundPercent ?? business.cancellationPolicy?.partialRefundPercent ?? 50,
        noRefundDays: cancellationPolicy.noRefundDays ?? business.cancellationPolicy?.noRefundDays ?? 7,
      };
    }

    // ==================== Additional Fields ====================
    if (pricing) {
      business.pricing = {
        basePrice: pricing.basePrice ?? business.pricing?.basePrice,
        pricingType: pricing.pricingType ?? business.pricing?.pricingType,
        vegPlatePrice: pricing.vegPlatePrice ?? business.pricing?.vegPlatePrice,
        nonVegPlatePrice: pricing.nonVegPlatePrice ?? business.pricing?.nonVegPlatePrice,
        roomRentPerNight: pricing.roomRentPerNight ?? business.pricing?.roomRentPerNight,
      };
    }

    if (workingDays !== undefined) business.workingDays = workingDays;
    if (openingTime !== undefined) business.openingTime = openingTime;
    if (closingTime !== undefined) business.closingTime = closingTime;
    if (minBookingNoticeDays !== undefined) business.minBookingNoticeDays = minBookingNoticeDays;
    if (bankAccount !== undefined) business.bankAccount = bankAccount;
    if (ifscCode !== undefined) business.ifscCode = ifscCode;

    if (agreementSigned !== undefined) {
      business.agreementSigned = agreementSigned;
      if (agreementSigned) {
        business.agreementSignedAt = new Date();
      }
    }
    if (agreementSignature !== undefined) business.agreementSignature = agreementSignature;

    const saved = await business.save();

    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate ? 'Banquet hall updated successfully' : 'Banquet hall created successfully',
      business: saved,
    });

  } catch (error) {
    console.error('Banquet hall onboard error:', error);
    if (error.name === 'ValidationError') {
      return err(res, 400, error.message, 'VALIDATION_FAILED');
    }
    return err(res, 500, 'Failed to save banquet hall data', 'SERVER_ERROR', error.message);
  }
});

/**
 * GET /api/banquet-hall/user/:userId
 * Get all banquet hall listings for a specific user
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return err(res, 400, 'Invalid user ID', 'VALIDATION_FAILED');
    }
    
    const banquetHalls = await Business.find({ 
      userId, 
      serviceType: 'banquet hall' 
    })
      .sort({ createdAt: -1 })
      .lean();
    
    res.json({ success: true, banquetHalls, count: banquetHalls.length });
  } catch (error) {
    console.error('Get user banquet halls error:', error);
    return err(res, 500, 'Failed to fetch banquet halls', 'SERVER_ERROR');
  }
});

/**
 * GET /api/banquet-hall/list
 * List all banquet halls (with filtering for customer view)
 */
router.get('/list', async (req, res) => {
  try {
    const { city, locality, propertyType, minCapacity, maxPrice, page = 1, limit = 20 } = req.query;
    
    const filter = {
      serviceType: 'banquet hall',
      status: 'online',
      verificationStatus: 'verified',
    };
    
    if (city) filter['location.city'] = new RegExp(city, 'i');
    if (locality) filter['location.locality'] = new RegExp(locality, 'i');
    if (propertyType) filter.propertyType = propertyType;
    if (minCapacity) filter.totalHallCapacity = { $gte: Number(minCapacity) };
    if (maxPrice) filter['pricing.basePrice'] = { $lte: Number(maxPrice) };
    
    const skip = (Number(page) - 1) * Number(limit);
    
    const [banquetHalls, totalCount] = await Promise.all([
      Business.find(filter)
        .select('businessName location propertyType totalHallCapacity pricing exteriorPhotos ratingAvg ratingCount amenities logoUrl')
        .sort({ ratingAvg: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Business.countDocuments(filter),
    ]);
    
    res.json({
      success: true,
      banquetHalls,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error) {
    console.error('List banquet halls error:', error);
    return err(res, 500, 'Failed to list banquet halls', 'SERVER_ERROR');
  }
});

/**
 * GET /api/banquet-hall/:businessId
 * Get a single banquet hall by ID (same as /api/business/:businessId but validates serviceType)
 */
router.get('/:businessId', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return err(res, 400, 'Invalid business ID', 'VALIDATION_FAILED');
    }

    const projection = {
      logo: 0,
      govtId: 0,
      registrationProof: 0,
      cancelledCheque: 0,
      ownerPhoto: 0,
      previewPhoto: 0,
      tradeLicense: 0,
      fireSafetyNoc: 0,
      propertyOwnershipProof: 0,
      __v: 0,
    };
    
    const business = await Business.findById(businessId).select(projection).lean();
    
    if (!business) {
      return res.status(404).json({ message: 'Banquet hall not found' });
    }

    // Optionally validate it's a banquet hall
    if (business.serviceType !== 'banquet hall') {
      return res.status(400).json({ message: 'This is not a banquet hall listing. Use /api/business/:id instead.' });
    }
    
    // Return the full business object (same pattern as /api/business/:businessId)
    return res.json(business);
  } catch (error) {
    console.error('Get banquet hall error:', error);
    return next(error);
  }
});

/**
 * PATCH /api/banquet-hall/:businessId/status
 * Update banquet hall status (online/offline)
 */
router.patch('/:businessId/status', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status } = req.body;
    const userId = req.userId;
    
    if (!['online', 'offline'].includes(status)) {
      return err(res, 400, 'Status must be either online or offline', 'VALIDATION_FAILED');
    }
    
    const business = await Business.findById(businessId);
    
    if (!business) {
      return err(res, 404, 'Banquet hall not found', 'NOT_FOUND');
    }

    if (business.serviceType !== 'banquet hall') {
      return err(res, 400, 'This is not a banquet hall listing', 'VALIDATION_FAILED');
    }
    
    if (String(business.userId) !== String(userId)) {
      return err(res, 403, 'You are not authorized to update this listing', 'FORBIDDEN');
    }
    
    business.status = status;
    await business.save();
    
    res.json({ success: true, message: `Banquet hall is now ${status}`, status });
  } catch (error) {
    console.error('Update status error:', error);
    return err(res, 500, 'Failed to update status', 'SERVER_ERROR');
  }
});

module.exports = router;
