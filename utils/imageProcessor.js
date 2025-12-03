const sharp = require('sharp');

// Constants for targets
const TARGETS = {
  logo: { maxKB: 50, maxWidth: 512, maxHeight: 512 },
  service: { desiredKB: 150, maxKB: 200, maxWidth: 1920, maxHeight: 1920 },
  doc: { maxKB: 400, maxWidth: 1920, maxHeight: 1920 },
};

/**
 * Decide output format based on kind and source metadata
 */
async function chooseFormat(kind, metadata, formatOverride) {
  if (formatOverride) return formatOverride;
  if (kind === 'logo') {
    // Prefer PNG for logos if alpha channel exists; else JPEG
    return metadata.hasAlpha ? 'png' : 'jpeg';
  }
  // Service and docs default to JPEG for good compression
  return 'jpeg';
}


async function encode(sharpInstance, format, opts = {}) {
  let pipeline = sharpInstance.clone();
  if (format === 'jpeg' || format === 'jpg') {
    const { quality = 80, mozjpeg = true } = opts;
    pipeline = pipeline.jpeg({ quality, mozjpeg, chromaSubsampling: '4:2:0' });
  } else if (format === 'png') {
    const { compressionLevel = 9, palette = true } = opts;
    pipeline = pipeline.png({ compressionLevel, palette });
  } else if (format === 'webp') {
    const { quality = 80 } = opts;
    pipeline = pipeline.webp({ quality });
  } else {
    // fallback to original
  }
  const buffer = await pipeline.toBuffer();
  const size = buffer.length;
  return { buffer, size };
}


async function compressToTarget(factory, format, maxKB, desiredKB) {
  let lo = 35; // lower quality bound
  let hi = 90; // upper quality bound
  let best = null;
  const maxBytes = maxKB * 1024;
  const desiredBytes = desiredKB ? desiredKB * 1024 : null;

  for (let i = 0; i < 7; i++) {
    const mid = Math.round((lo + hi) / 2);
    const { buffer, size } = await encode(factory(), format, { quality: mid });
    if (size <= maxBytes) {
      best = { buffer, size, quality: mid };
      lo = mid + 1; // try higher quality while under cap
    } else {
      hi = mid - 1; // decrease quality
    }
  }

  if (!best) {
    // couldn't get under cap; return the smallest we found at lowest quality
    const { buffer, size } = await encode(factory(), format, { quality: lo });
    return { buffer, size };
  }

  if (desiredBytes && best.size < desiredBytes) {
    // Try nudging quality upward a few steps to reach desiredBytes while staying under maxBytes
    let qualityCursor = typeof best.quality === 'number' ? best.quality : 80;
    for (let i = 0; i < 3; i++) {
      const nextQ = Math.min(qualityCursor + 5, 95);
      const { buffer, size } = await encode(factory(), format, { quality: nextQ });
      if (size <= maxBytes) {
        best = { buffer, size, quality: nextQ };
        qualityCursor = nextQ;
      } else {
        break;
      }
    }
  }

  return { buffer: best.buffer, size: best.size };
}


async function processImage(inputBuffer, kind = 'service', options = {}) {
  if (!inputBuffer || !Buffer.isBuffer(inputBuffer)) {
    throw new Error('processImage requires a Buffer input');
  }

  const base = sharp(inputBuffer, { failOn: 'none' });
  const metadata = await base.metadata();

  const t = TARGETS[kind] || TARGETS.service;
  const maxW = t.maxWidth;
  const maxH = t.maxHeight;

  const resizeNeeded = (metadata.width && metadata.width > maxW) || (metadata.height && metadata.height > maxH);
  const resized = resizeNeeded ? base.resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true }) : base;

  let format = await chooseFormat(kind, metadata, options.format);

  if (format === 'png') {
    const { buffer, size } = await encode(resized, 'png', { compressionLevel: 9, palette: true });
    if (kind === 'logo' && size > TARGETS.logo.maxKB * 1024 && !metadata.hasAlpha) {
      format = 'jpeg';
    } else {
      const info = await sharp(buffer).metadata();
      return {
        buffer,
        size,
        sizeKb: +(size / 1024).toFixed(1),
        mimeType: 'image/png',
        ext: 'png',
        width: info.width,
        height: info.height,
      };
    }
  }

  const factory = () => resized.clone();
  let maxKB = (t.maxKB || 200);
  let desiredKB = t.desiredKB;
  if (kind === 'service') {
    
    maxKB = TARGETS.service.maxKB;
    desiredKB = TARGETS.service.desiredKB;
  } else if (kind === 'logo') {
    maxKB = TARGETS.logo.maxKB;
  } else if (kind === 'doc') {
    maxKB = TARGETS.doc.maxKB;
  }

  if (format !== 'jpeg' && format !== 'webp') {
    format = 'jpeg';
  }

  const { buffer: out, size } = await compressToTarget(factory, format, maxKB, desiredKB);
  const info = await sharp(out).metadata();
  const ext = format === 'jpg' ? 'jpeg' : format;
  const mimeType = `image/${ext}`;
  return {
    buffer: out,
    size,
    sizeKb: +(size / 1024).toFixed(1),
    mimeType,
    ext,
    width: info.width,
    height: info.height,
  };
}

function toDataUrl(processed) {
  const base64 = processed.buffer.toString('base64');
  return `data:${processed.mimeType};base64,${base64}`;
}

module.exports = {
  processImage,
  toDataUrl,
};
