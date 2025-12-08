const twilio = require('twilio');
const { normalizePhone } = require('./phone');

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}

function getClient() {
  if (!isConfigured()) throw new Error('Twilio not configured');
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendVerification(toRaw, channel = 'sms') {
  const client = getClient();
  const to = normalizePhone(toRaw);
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const resp = await client.verify.v2.services(serviceSid).verifications.create({ to, channel });
  return resp; // contains sid, to, channel, status: 'pending'
}

async function checkVerification(toRaw, code) {
  const client = getClient();
  const to = normalizePhone(toRaw);
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const resp = await client.verify.v2.services(serviceSid).verificationChecks.create({ to, code: String(code) });
  // resp.status === 'approved' for success
  return resp;
}

module.exports = { isConfigured, sendVerification, checkVerification };
