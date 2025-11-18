// Unified response helpers
// Usage: const { success, error } = require('../utils/respond');
// success(res, 200, { data });
// error(res, 400, 'Validation failed', 'VALIDATION_FAILED', { field: 'message' });

function success(res, status = 200, payload = {}) {
  return res.status(status).json({ error: false, ...payload });
}

function error(res, status, message, code, details) {
  const body = { error: true, message };
  if (code) body.code = code;
  if (details) body.details = details;
  return res.status(status).json(body);
}

module.exports = { success, error };
