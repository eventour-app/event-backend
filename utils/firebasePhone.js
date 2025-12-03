const axios = require('axios');
const { normalizePhone } = require('./phone');

function isConfigured() {
  return !!process.env.FIREBASE_API_KEY;
}

async function startPhoneVerification(phone) {
  const API_KEY = process.env.FIREBASE_API_KEY;
  if (!API_KEY) throw new Error('FIREBASE_API_KEY not set');
  const to = normalizePhone(phone);
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${API_KEY}`;
  const payload = { phoneNumber: to };
  const res = await axios.post(url, payload, { validateStatus: () => true });
  if (res.status !== 200) {
    throw new Error(`Firebase sendVerificationCode failed (${res.status}): ${res.data && res.data.error && res.data.error.message}`);
  }
  return { sessionInfo: res.data.sessionInfo, phone: to };
}


async function verifyPhoneCode(sessionInfo, code) {
  const API_KEY = process.env.FIREBASE_API_KEY;
  if (!API_KEY) throw new Error('FIREBASE_API_KEY not set');
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${API_KEY}`;
  const payload = { sessionInfo, code: String(code) };
  const res = await axios.post(url, payload, { validateStatus: () => true });
  if (res.status !== 200) {
    throw new Error(`Firebase signInWithPhoneNumber failed (${res.status}): ${res.data && res.data.error && res.data.error.message}`);
  }
  return res.data;
}

module.exports = {
  isConfigured,
  startPhoneVerification,
  verifyPhoneCode,
};
