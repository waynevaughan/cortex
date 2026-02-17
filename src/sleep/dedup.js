import { readdir, readFile, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mindPath, vaultPath } from '../cli/paths.js';
import { TAXONOMY } from '../daemon/taxonomy.js';
import { parseFrontmatter } from './decay.js';

const SIMILARITY_THRESHOLD = 0.70;
const WINDOW_SIZE = 200;

/**
 * Tokenize text: lowercase, collapse whitespace, split on whitespace.
 */
export function tokenize(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

/**
 * Jaccard similarity between two token arrays.
 */
export function jaccardSimilarity(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Run semantic dedup across all type directories in both mind and vault.
 * Returns { duplicates: [{ kept, archived, similarity, type }], log: string[] }
 */
export async function processDedup() {
  const duplicates = [];
  const log = [];

  for (const [type, category] of Object.entries(TAXONOMY)) {
    const partitions = [];
    if (category === 'concept') {
      partitions.push({ base: mindPath(), partition: 'mind' });
    } else {
      partitions.push({ base: vaultPath(), partition: 'vault' });
    }
    // Also check vault/decision/ for dual-write
    if (type === 'decision') {
      partitions.push({ base: vaultPath(), partition: 'vault' });
    }

    for (const { base, partition } of partitions) {
      const dir = resolve(base, type);
      let files;
      try {
        files = (await readdir(dir)).filter(f => f.endsWith('.md'));
      } catch {
        continue;
      }

      // Sort by filename (UUIDv7 = chronological)
      files.sort();

      // Load entries with body tokens
      const entries = [];
      for (const file of files) {
        const path = join(dir, file);
        const content = await readFile(path, 'utf-8');
        const { fields, body } = parseFrontmatter(content);
        const tokens = tokenize(body);
        entries.push({ file, path, fields, tokens, id: fields.id || file.replace('.md', '') });
      }

      // Compare each entry against the WINDOW_SIZE most recent before it
      for (let i = 1; i < entries.length; i++) {
        const current = entries[i]; // newer
        const windowStart = Math.max(0, i - WINDOW_SIZE);

        for (let j = windowStart; j < i; j++) {
          const older = entries[j];
          const sim = jaccardSimilarity(current.tokens, older.tokens);

          if (sim >= SIMILARITY_THRESHOLD) {
            // Archive the older one
            const archiveBase = partition === 'mind' ? mindPath() : vaultPath();
            const archiveDir = resolve(archiveBase, '.archived', type);
            await mkdir(archiveDir, { recursive: true });
            const dest = join(archiveDir, older.file);

            try {
              await rename(older.path, dest);
              duplicates.push({
                kept: current.id,
                archived: older.id,
                similarity: Math.round(sim * 1000) / 1000,
                type,
              });
              log.push(`[dedup] ${type}: archived ${older.id} (sim=${sim.toFixed(3)} with ${current.id})`);
            } catch (e) {
              log.push(`[dedup] Failed to archive ${older.id}: ${e.message}`);
            }
          }
        }
      }
    }
  }

  return { duplicates, log };
}
