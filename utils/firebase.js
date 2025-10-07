const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let initialized = false;

function loadServiceAccountFromFile() {
  try {
    const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const root = path.join(__dirname, '..');
    const knownNames = [
      'service-account.json',
      'firebase-service-account.json',
      'planora-c2574-firebase-adminsdk-fbsvc-a8ebb30ad7.json',
    ];

    let candidate = null;
    if (explicitPath && fs.existsSync(explicitPath)) candidate = explicitPath;
    if (!candidate) {
      for (const name of knownNames) {
        const p = path.join(root, name);
        if (fs.existsSync(p)) { candidate = p; break; }
      }
    }
    if (!candidate) {
      // try to auto-detect any *firebase-adminsdk*.json in root
      const files = fs.readdirSync(root);
      const match = files.find(f => /firebase-adminsdk.*\.json$/i.test(f) || /service.*account.*\.json$/i.test(f));
      if (match) candidate = path.join(root, match);
    }
    if (!candidate) return null;
    const raw = fs.readFileSync(candidate, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[firebase] Failed to read service account file:', e.message);
    return null;
  }
}

function initFirebase() {
  if (initialized) return admin;
  try {
    let creds = null;
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (sa) {
      creds = JSON.parse(sa);
    } else {
      creds = loadServiceAccountFromFile();
    }
    if (!creds) {
      console.warn('[firebase] No service account found. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH, or place the JSON in project root.');
      return admin;
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(creds),
      });
    }
    initialized = true;
  } catch (e) {
    console.error('[firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
  }
  return admin;
}

module.exports = { initFirebase };
