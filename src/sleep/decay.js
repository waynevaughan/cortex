import { readdir, readFile, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mindPath } from '../cli/paths.js';
import { TAXONOMY } from '../daemon/taxonomy.js';

// Per-type decay rates. 0 = no decay.
const DECAY_RATES = {
  idea: 0.02,
  opinion: 0.01,
  belief: 0.005,
  preference: 0,       // preferences don't decay per spec
  lesson: 0.005,
  decision: 0.005,
  commitment: 0.015,
  goal_short: 0.02,
  goal_long: 0.005,
  aspiration: 0,        // aspirations are persistent per spec
  constraint: 0.005,
};

const DEFAULT_DECAY_RATE = 0.01;
const ARCHIVE_THRESHOLD = 0.3;

/**
 * Parse simple frontmatter from markdown content.
 * Returns { fields: {}, body: string }
 */
export function parseFrontmatter(content) {
  const fields = {};
  if (!content.startsWith('---')) return { fields, body: content };

  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return { fields, body: content };

  const fmBlock = content.slice(4, endIdx);
  const body = content.slice(endIdx + 4).trim();

  for (const line of fmBlock.split('\n')) {
    const match = line.match(/^([a-z_]+):\s*"?(.+?)"?\s*$/);
    if (match) {
      fields[match[1]] = match[2];
    }
  }

  return { fields, body };
}

/**
 * Update a frontmatter field in raw content string.
 */
export function updateFrontmatterField(content, field, value) {
  const regex = new RegExp(`^(${field}:\\s*).*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `$1${value}`);
  }
  // Insert before closing ---
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return content;
  return content.slice(0, endIdx) + `\n${field}: ${value}` + content.slice(endIdx);
}

/**
 * Calculate effective importance after decay.
 */
export function effectiveImportance(importance, daysSince, decayRate) {
  return importance * Math.exp(-decayRate * daysSince);
}

/**
 * Process decay for all mind entries.
 * Returns { archived: [{ id, type, from, to, effective, original }], log: string[] }
 */
export async function processDecay(now = new Date()) {
  const mind = mindPath();
  const archived = [];
  const log = [];

  const conceptTypes = Object.keys(TAXONOMY).filter(t => TAXONOMY[t] === 'concept');

  for (const type of conceptTypes) {
    const decayRate = DECAY_RATES[type] ?? DEFAULT_DECAY_RATE;
    if (decayRate === 0) {
      log.push(`[decay] ${type}: skip (no decay)`);
      continue;
    }

    const dir = resolve(mind, type);
    let files;
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(dir, file);
      const content = await readFile(filePath, 'utf-8');
      const { fields } = parseFrontmatter(content);

      const importance = parseFloat(fields.importance);
      if (isNaN(importance)) continue;

      const refDate = fields.last_reinforced || fields.created;
      if (!refDate) continue;

      const daysSince = (now - new Date(refDate)) / (1000 * 60 * 60 * 24);
      const effective = effectiveImportance(importance, daysSince, decayRate);

      if (effective < ARCHIVE_THRESHOLD) {
        const archiveDir = resolve(mind, '.archived', type);
        await mkdir(archiveDir, { recursive: true });
        const dest = join(archiveDir, file);
        await rename(filePath, dest);
        archived.push({
          id: fields.id || file.replace('.md', ''),
          type,
          from: filePath,
          to: dest,
          effective: Math.round(effective * 1000) / 1000,
          original: importance,
        });
        log.push(`[decay] archived ${file} (${type}): effective=${effective.toFixed(3)} < ${ARCHIVE_THRESHOLD}`);
      }
    }
  }

  return { archived, log };
}
