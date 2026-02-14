#!/usr/bin/env node
/**
 * UUIDv7 Generator per RFC 9562
 * 
 * Layout (128 bits):
 * - 48 bits: Unix timestamp in milliseconds
 * - 4 bits: version (0111 = 7)
 * - 12 bits: random data
 * - 2 bits: variant (10)
 * - 62 bits: random data
 */

import crypto from 'crypto';

export function generateUUIDv7() {
  // Get current timestamp in milliseconds
  const timestamp = Date.now();
  
  // Generate 16 random bytes
  const randomBytes = crypto.randomBytes(16);
  
  // Build the UUID
  const uuid = Buffer.alloc(16);
  
  // Bytes 0-5: 48-bit timestamp (big-endian)
  uuid.writeUIntBE(timestamp, 0, 6);
  
  // Bytes 6-7: version (4 bits) + random (12 bits)
  // Set version to 7 (0111)
  uuid[6] = (0x70 | (randomBytes[0] & 0x0f));
  uuid[7] = randomBytes[1];
  
  // Bytes 8-15: variant (2 bits) + random (62 bits)
  // Set variant to 10
  uuid[8] = (0x80 | (randomBytes[2] & 0x3f));
  uuid[9] = randomBytes[3];
  uuid[10] = randomBytes[4];
  uuid[11] = randomBytes[5];
  uuid[12] = randomBytes[6];
  uuid[13] = randomBytes[7];
  uuid[14] = randomBytes[8];
  uuid[15] = randomBytes[9];
  
  // Format as 8-4-4-4-12 hex string
  const hex = uuid.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(generateUUIDv7());
}
