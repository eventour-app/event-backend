// utils/vendorCode.js
// Generates a readable vendor code. Not cryptographically secure.
module.exports.generateVendorCode = function(seed) {
  const base = (seed || Math.random().toString(36).slice(2,10)).toUpperCase();
  return `VND-${base.slice(0,6)}`;
};
