'use strict';

const BASE_UUID = '-0000-1000-8000-00805f9b34fb';

/**
 * Normalizes UUID strings.
 * Accepts:
 *  - 16-bit UUID: "2a37"
 *  - 32-bit UUID: "00002a37"
 *  - 128-bit UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 * Also accepts leading "0x".
 *
 * @param {string} uuid
 * @returns {string}
 */
function normalizeUuid(uuid) {
  if (!uuid) return '';
  let u = String(uuid).trim().toLowerCase();
  if (u.startsWith('0x')) u = u.slice(2);

  // Remove braces
  u = u.replace(/[{}]/g, '');

  // 16-bit
  if (/^[0-9a-f]{4}$/.test(u)) {
    return `0000${u}${BASE_UUID}`;
  }

  // 32-bit
  if (/^[0-9a-f]{8}$/.test(u)) {
    return `${u}${BASE_UUID}`;
  }

  // 128-bit (keep as-is but normalize to lower)
  return u;
}

module.exports = {
  normalizeUuid,
  BASE_UUID,
};
