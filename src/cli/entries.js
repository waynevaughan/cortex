import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { mindPath, vaultPath } from './paths.js';
import { TAXONOMY, getCategory } from '../daemon/taxonomy.js';

/**
 * Scan all entries across mind/ and vault/.
 * Returns array of { id, type, category, partition, path, content, firstLine }
 */
export async function scanEntries({ type, category } = {}) {
  const entries = [];

  // Determine which type dirs to scan
  let typesToScan = Object.keys(TAXONOMY);
  if (type) {
    typesToScan = typesToScan.filter(t => t === type);
  }
  if (category) {
    typesToScan = typesToScan.filter(t => TAXONOMY[t] === category);
  }

  for (const t of typesToScan) {
    const cat = TAXONOMY[t];
    const partition = cat === 'concept' ? 'mind' : 'vault';
    const base = partition === 'mind' ? mindPath() : vaultPath();
    const dir = resolve(base, t);

    let files;
    try {
      files = await readdir(dir);
    } catch {
      continue; // directory doesn't exist yet
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = file.replace('.md', '');
      const filePath = join(dir, file);
      entries.push({ id, type: t, category: cat, partition, path: filePath });
    }
  }

  // Also check vault/decision/ for dual-write entries (D31)
  if (!type || type === 'decision') {
    const vaultDecisionDir = resolve(vaultPath(), 'decision');
    try {
      const files = await readdir(vaultDecisionDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const id = file.replace('.md', '');
        const filePath = join(vaultDecisionDir, file);
        // Avoid duplicates if already scanned from mind/decision/
        if (!entries.some(e => e.id === id)) {
          entries.push({ id, type: 'decision', category: 'concept', partition: 'vault', path: filePath });
        }
      }
    } catch {
      // directory doesn't exist
    }
  }

  // UUIDv7 sorts chronologically by default
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

/**
 * Read an entry's full content.
 */
export async function readEntryContent(filePath) {
  return readFile(filePath, 'utf-8');
}

/**
 * Get the first meaningful line of body (after frontmatter).
 */
export function getFirstLine(content) {
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterCount = 0;
  for (const line of lines) {
    if (line.trim() === '---') {
      frontmatterCount++;
      if (frontmatterCount >= 2) {
        // Past frontmatter, get next non-empty line
        const rest = lines.slice(lines.indexOf(line) + 1);
        for (const r of rest) {
          const trimmed = r.trim();
          if (trimmed && trimmed !== '---') return trimmed;
        }
        return '(empty)';
      }
      continue;
    }
  }
  // No frontmatter found, return first non-empty line
  for (const line of lines) {
    if (line.trim()) return line.trim();
  }
  return '(empty)';
}

/**
 * Find an entry by ID across mind/ and vault/.
 */
export async function findEntryById(id) {
  const allEntries = await scanEntries();
  return allEntries.find(e => e.id === id) || null;
}
