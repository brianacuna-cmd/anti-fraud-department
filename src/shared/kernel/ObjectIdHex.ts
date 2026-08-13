import { randomBytes } from 'node:crypto';

/**
 * 24-char hex, the only shape MongoDB's `ObjectId` constructor accepts from a
 * string in this codebase. Lives in the kernel so domain ID value objects can
 * stay compatible with BSON `ObjectId` without importing `mongodb`.
 */
const OBJECT_ID_HEX_PATTERN = /^[a-fA-F0-9]{24}$/;

let counter = randomBytes(3).readUIntBE(0, 3);

export function isObjectIdHex(value: string): boolean {
  return OBJECT_ID_HEX_PATTERN.test(value);
}

/**
 * Mints a 12-byte id with the same layout as MongoDB `ObjectId`
 * (4-byte unix time, 5-byte random, 3-byte counter) encoded as 24 hex chars.
 */
export function generateObjectIdHex(): string {
  const bytes = Buffer.allocUnsafe(12);
  bytes.writeUInt32BE(Math.floor(Date.now() / 1000) >>> 0, 0);
  randomBytes(5).copy(bytes, 4);
  counter = (counter + 1) & 0xffffff;
  bytes[9] = (counter >> 16) & 0xff;
  bytes[10] = (counter >> 8) & 0xff;
  bytes[11] = counter & 0xff;
  return bytes.toString('hex');
}
