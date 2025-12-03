const nodemailer = require('nodemailer');
const axios = require('axios');
const util = require('util');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);

function isEmail(identifier) {
  return /@/.test(String(identifier));
}

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  const cc = process.env.DEFAULT_COUNTRY_CODE || '91'; // default India
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+${cc}${digits.slice(1)}`;
  if (digits.startsWith(cc)) return `+${digits}`;
  if (digits.startsWith('1') && cc === '1') return `+${digits}`;
  if (digits.startsWith('+')) return digits;
  return `+${cc}${digits}`;
}

async function sendEmailOtp(toEmail, code, role) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM = 'no-reply@event-vendor.local',
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return { delivered: false, reason: 'smtp_not_configured' };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const subject = 'Your OTP Code';
  const text = `Your ${role || ''} login OTP is ${code}. It expires in 5 minutes.`.trim();

  await transporter.sendMail({ from: SMTP_FROM, to: toEmail, subject, text });
  return { delivered: true };
}

async function sendSmsOtp(toPhoneRaw, code) {
  const {
    MESSENGER_SMS_HTTP_URL,
    MESSENGER_SMS_HTTP_METHOD = 'POST',
    MESSENGER_SMS_HTTP_TOKEN,
    MESSENGER_SMS_HTTP_BASIC_USER,
    MESSENGER_SMS_HTTP_BASIC_PASS,
    MESSENGER_SMS_HTTP_TO_FIELD = 'to',
    MESSENGER_SMS_HTTP_MESSAGE_FIELD = 'message',
    MESSENGER_SMS_HTTP_FROM,
    MESSENGER_SMS_HTTP_EXTRA_JSON,
    MESSENGER_SMS_HTTP_HEADERS_JSON,
    MESSENGER_SMS_CMD_TEMPLATE,
  } = process.env;

  const to = normalizePhone(toPhoneRaw);
  const message = `Your login OTP is ${code}. It expires in 5 minutes.`;

  // 1) Local shell command (e.g., gammu-smsd-inject)
  if (MESSENGER_SMS_CMD_TEMPLATE) {
    const safe = (s) => String(s).replace(/(["`$\\])/g, '\\$1');
    const cmd = MESSENGER_SMS_CMD_TEMPLATE
      .replaceAll('{{to}}', `"${safe(to)}"`)
      .replaceAll('{{message}}', `"${safe(message)}"`);
    await execPromise(cmd);
    return { delivered: true };
  }

  // 2) HTTP gateway (PlaySMS, Jasmin, custom REST)
  if (!MESSENGER_SMS_HTTP_URL) {
    return { delivered: false, reason: 'sms_not_configured' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (MESSENGER_SMS_HTTP_TOKEN) headers['Authorization'] = `Bearer ${MESSENGER_SMS_HTTP_TOKEN}`;
  if (MESSENGER_SMS_HTTP_HEADERS_JSON) {
    try {
      Object.assign(headers, JSON.parse(MESSENGER_SMS_HTTP_HEADERS_JSON));
    } catch (e) {
      // ignore malformed headers json
    }
  }

  const payload = { [MESSENGER_SMS_HTTP_TO_FIELD]: to, [MESSENGER_SMS_HTTP_MESSAGE_FIELD]: message };
  if (MESSENGER_SMS_HTTP_FROM) payload.from = MESSENGER_SMS_HTTP_FROM;
  if (MESSENGER_SMS_HTTP_EXTRA_JSON) {
    try {
      Object.assign(payload, JSON.parse(MESSENGER_SMS_HTTP_EXTRA_JSON));
    } catch (e) {
      // ignore malformed extra json
    }
  }

  const method = String(MESSENGER_SMS_HTTP_METHOD).toUpperCase();
  const axiosConfig = {
    url: MESSENGER_SMS_HTTP_URL,
    method,
    headers,
    validateStatus: () => true,
  };
  if (MESSENGER_SMS_HTTP_BASIC_USER && MESSENGER_SMS_HTTP_BASIC_PASS) {
    axiosConfig.auth = { username: MESSENGER_SMS_HTTP_BASIC_USER, password: MESSENGER_SMS_HTTP_BASIC_PASS };
  }
  if (method === 'GET') axiosConfig.params = payload; else axiosConfig.data = payload;

  const res = await axios(axiosConfig);
  if (res.status >= 200 && res.status < 300) return { delivered: true };
  throw new Error(`HTTP SMS failed with status ${res.status}`);
}

async function sendOtp(identifier, code, role) {
  try {
    if (isEmail(identifier)) {
      return await sendEmailOtp(identifier, code, role);
    }
    return await sendSmsOtp(identifier, code);
  } catch (e) {
    return { delivered: false, reason: e.message };
  }
}

module.exports = {
  sendOtp,
  isEmail,
  normalizePhone,
};
