'use strict';

/**
 * Formats a buffer as hex pairs separated by spaces.
 * @param {Buffer} buffer
 */
function bufferToSpacedHex(buffer) {
  const hex = buffer.toString('hex');
  if (hex.length <= 2) return hex;
  return hex.match(/.{1,2}/g).join(' ');
}

/**
 * Parses a string containing hex bytes (with or without spaces).
 * @param {string} str
 * @returns {Buffer}
 */
function parseHexString(str) {
  let clean = String(str).trim().toLowerCase();
  clean = clean.replace(/0x/g, '');
  clean = clean.replace(/[^0-9a-f]/g, '');
  if (clean.length % 2 !== 0) {
    clean = '0' + clean;
  }
  return Buffer.from(clean, 'hex');
}

/**
 * @param {string} format
 * @returns {{type: 'string'|'number'|'boolean', role: string}}
 */
function inferIoBrokerType(format) {
  const f = String(format || '').toLowerCase().trim();
  if (f === 'bool' || f === 'boolean') {
    return { type: 'boolean', role: 'switch' };
  }
  if (
    [
      'uint8', 'int8',
      'uint16le', 'int16le', 'uint16be', 'int16be',
      'uint32le', 'int32le', 'uint32be', 'int32be',
      'floatle', 'floatbe', 'doublele', 'doublebe'
    ].includes(f)
  ) {
    return { type: 'number', role: 'value' };
  }
  // default
  return { type: 'string', role: 'text' };
}

/**
 * @param {string} format
 * @param {Buffer|number[]|Uint8Array} value
 * @returns {any}
 */
function decodeValue(format, value) {
  const f = String(format || 'hex').toLowerCase().trim();
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  switch (f) {
    case 'utf8':
    case 'string':
      return buf.toString('utf8');
    case 'base64':
      return buf.toString('base64');
    case 'hex':
    case 'spacedhex':
      return bufferToSpacedHex(buf);
    case 'bool':
    case 'boolean':
      return (buf[0] || 0) !== 0;

    case 'uint8':
      return dv.getUint8(0);
    case 'int8':
      return dv.getInt8(0);

    case 'uint16le':
      return dv.getUint16(0, true);
    case 'int16le':
      return dv.getInt16(0, true);
    case 'uint16be':
      return dv.getUint16(0, false);
    case 'int16be':
      return dv.getInt16(0, false);

    case 'uint32le':
      return dv.getUint32(0, true);
    case 'int32le':
      return dv.getInt32(0, true);
    case 'uint32be':
      return dv.getUint32(0, false);
    case 'int32be':
      return dv.getInt32(0, false);

    case 'floatle':
      return dv.getFloat32(0, true);
    case 'floatbe':
      return dv.getFloat32(0, false);

    case 'doublele':
      return dv.getFloat64(0, true);
    case 'doublebe':
      return dv.getFloat64(0, false);

    default:
      return bufferToSpacedHex(buf);
  }
}

/**
 * @param {string} format
 * @param {any} val
 * @returns {Buffer}
 */
function encodeValue(format, val) {
  const f = String(format || 'hex').toLowerCase().trim();

  switch (f) {
    case 'utf8':
    case 'string':
      return Buffer.from(String(val), 'utf8');
    case 'base64':
      return Buffer.from(String(val), 'base64');
    case 'hex':
    case 'spacedhex':
      return parseHexString(String(val));
    case 'bool':
    case 'boolean':
      return Buffer.from([val ? 1 : 0]);

    case 'uint8': {
      const b = Buffer.alloc(1);
      b.writeUInt8(Number(val) & 0xff, 0);
      return b;
    }
    case 'int8': {
      const b = Buffer.alloc(1);
      b.writeInt8(Number(val), 0);
      return b;
    }

    case 'uint16le': {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(Number(val) & 0xffff, 0);
      return b;
    }
    case 'int16le': {
      const b = Buffer.alloc(2);
      b.writeInt16LE(Number(val), 0);
      return b;
    }
    case 'uint16be': {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(Number(val) & 0xffff, 0);
      return b;
    }
    case 'int16be': {
      const b = Buffer.alloc(2);
      b.writeInt16BE(Number(val), 0);
      return b;
    }

    case 'uint32le': {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(Number(val) >>> 0, 0);
      return b;
    }
    case 'int32le': {
      const b = Buffer.alloc(4);
      b.writeInt32LE(Number(val) | 0, 0);
      return b;
    }
    case 'uint32be': {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(Number(val) >>> 0, 0);
      return b;
    }
    case 'int32be': {
      const b = Buffer.alloc(4);
      b.writeInt32BE(Number(val) | 0, 0);
      return b;
    }

    case 'floatle': {
      const b = Buffer.alloc(4);
      b.writeFloatLE(Number(val), 0);
      return b;
    }
    case 'floatbe': {
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number(val), 0);
      return b;
    }

    case 'doublele': {
      const b = Buffer.alloc(8);
      b.writeDoubleLE(Number(val), 0);
      return b;
    }
    case 'doublebe': {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(Number(val), 0);
      return b;
    }

    default:
      // Fallback: try hex
      return parseHexString(String(val));
  }
}

module.exports = {
  decodeValue,
  encodeValue,
  inferIoBrokerType,
  bufferToSpacedHex,
  parseHexString,
};
