function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const cc = process.env.DEFAULT_COUNTRY_CODE || '91';
  if (!digits) return '';
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+${cc}${digits.slice(1)}`;
  if (digits.startsWith(cc)) return `+${digits}`;
  if (digits.startsWith('+')) return digits;
  return `+${cc}${digits}`;
}

module.exports = { normalizePhone };
