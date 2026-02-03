'use strict';

const { normalizeUuid } = require('./utils/uuid');

/**
 * @typedef {Object} GattMapping
 * @property {string} state        State id relative to devices.<deviceId> (e.g. "temperature" or "controls.led")
 * @property {string} service      Service UUID (16/32/128-bit)
 * @property {string} characteristic Characteristic UUID (16/32/128-bit)
 * @property {'ro'|'rw'} [mode]    Read-only or read-write
 * @property {string} [format]     One of: utf8, hex, base64, bool, uint8, int8, uint16le, int16le, uint32le, int32le, floatle, doublele, ...
 * @property {number} [poll]       Poll interval in seconds (0 = disabled)
 * @property {boolean} [notify]    Start notifications (if supported)
 */

/**
 * @typedef {Object} DeviceConfig
 * @property {string} id
 * @property {string} name
 * @property {string} address
 * @property {boolean} [connect]
 * @property {GattMapping[]} [gatt]
 */

/**
 * @param {string} address
 */
function normalizeAddress(address) {
  const a = String(address || '').trim().toUpperCase();
  // Keep as-is if it looks like a MAC
  if (/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(a)) return a;
  return a;
}

/**
 * @param {any} raw
 * @returns {GattMapping[]}
 */
function normalizeGattArray(raw) {
  const gatt = Array.isArray(raw) ? raw : [];
  return gatt
    .filter(x => x && typeof x === 'object')
    .map((m) => {
      const state = String(m.state || '').trim();
      const service = normalizeUuid(m.service || m.serviceUuid || m.serviceUUID);
      const characteristic = normalizeUuid(m.characteristic || m.char || m.characteristicUuid || m.characteristicUUID);

      return {
        state,
        service,
        characteristic,
        mode: (String(m.mode || 'ro').toLowerCase() === 'rw') ? 'rw' : 'ro',
        format: String(m.format || 'hex').toLowerCase(),
        poll: typeof m.poll === 'number' ? m.poll : (typeof m.pollInterval === 'number' ? m.pollInterval : 0),
        notify: Boolean(m.notify),
      };
    })
    .filter(m => m.state && m.service && m.characteristic);
}

/**
 * Parses and normalizes the adapter setting "devicesJson".
 *
 * @param {string} jsonText
 * @param {{warn: Function, info: Function, error: Function}} log
 * @returns {DeviceConfig[]}
 */
function parseDevicesConfig(jsonText, log) {
  const text = String(jsonText || '').trim();
  if (!text) return [];

  let arr;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    log.error(`devicesJson is not valid JSON: ${e.message}`);
    return [];
  }

  if (!Array.isArray(arr)) {
    log.error('devicesJson must be a JSON array');
    return [];
  }

  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;

    const address = normalizeAddress(raw.address || raw.mac || raw.macAddress);
    if (!address) {
      log.warn('Skipping device without address');
      continue;
    }

    const id = String(raw.id || address.replace(/:/g, '_')).trim();
    const name = String(raw.name || id).trim();

    out.push({
      id,
      name,
      address,
      connect: raw.connect !== undefined ? Boolean(raw.connect) : false,
      gatt: normalizeGattArray(raw.gatt)
    });
  }

  return out;
}

module.exports = {
  parseDevicesConfig,
};
