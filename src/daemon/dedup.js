import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compute content hash: SHA-256 of lowercased, whitespace-collapsed body.
 */
export function contentHash(body) {
  const normalized = body.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Check for duplicate by scanning mind/ and vault/ for matching source_hash.
 * Returns { duplicate: false } or { duplicate: true, existingId: string }
 */
export function checkDuplicate(hash, rootDir) {
  for (const partition of ['mind', 'vault']) {
    const partDir = join(rootDir, partition);
    const match = scanForHash(partDir, hash);
    if (match) return { duplicate: true, existingId: match };
  }
  return { duplicate: false };
}

function scanForHash(dir, hash) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const ent of entries) {
    const fullPath = join(dir, ent.name);
    if (ent.isDirectory()) {
      const found = scanForHash(fullPath, hash);
      if (found) return found;
    } else if (ent.name.endsWith('.md')) {
      try {
        const content = readFileSync(fullPath, 'utf8');
        // Check frontmatter for source_hash
        if (content.includes(`source_hash: ${hash}`)) {
          // Extract id from frontmatter
          const idMatch = content.match(/^id:\s*"?([^"\n]+)"?/m);
          return idMatch ? idMatch[1] : 'unknown';
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
  return null;
}
