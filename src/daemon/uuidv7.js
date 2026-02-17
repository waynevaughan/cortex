import { randomBytes } from 'node:crypto';

/**
 * Generate a UUIDv7 (RFC 9562) — timestamp-based, sortable UUID.
 * Format: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
 * where t = unix ms timestamp (48 bits), 7 = version, y = variant (8/9/a/b)
 */
export function uuidv7(timestamp = Date.now()) {
  const ts = BigInt(timestamp);
  const rand = randomBytes(10);

  // 48-bit timestamp in first 6 bytes
  const bytes = Buffer.alloc(16);
  bytes[0] = Number((ts >> 40n) & 0xFFn);
  bytes[1] = Number((ts >> 32n) & 0xFFn);
  bytes[2] = Number((ts >> 24n) & 0xFFn);
  bytes[3] = Number((ts >> 16n) & 0xFFn);
  bytes[4] = Number((ts >> 8n) & 0xFFn);
  bytes[5] = Number(ts & 0xFFn);

  // version 7 + 12 random bits
  bytes[6] = (0x70) | (rand[0] & 0x0F);
  bytes[7] = rand[1];

  // variant 10 + 62 random bits
  bytes[8] = (0x80) | (rand[2] & 0x3F);
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
