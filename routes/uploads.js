const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`);
  }
});
const upload = multer({ storage });

function err(res, status, message, code, details) { return res.status(status).json({ error: true, message, code, ...(details?{details}:{}) }); }

// POST /api/uploads (multipart form-data: file)
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return err(res, 400, 'file field is required', 'VALIDATION_FAILED');
    const filePath = req.file.path;
    let meta = {};
    try { meta = await sharp(filePath).metadata(); } catch {}
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/uploads/${path.basename(filePath)}`;
    res.status(201).json({ id: path.basename(filePath), url, width: meta.width || null, height: meta.height || null, mimeType: req.file.mimetype });
  } catch (e) {
    console.error('generic upload error', e);
    err(res, 500, 'Failed to upload file', 'SERVER_ERROR');
  }
});

module.exports = router;
