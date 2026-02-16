/**
 * Stage 6: Staging
 *
 * Writes observation files to observer/staging/ with YAML frontmatter.
 * Handles cleanup after memorization and orphan detection.
 */

import { writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveAlias, normalizeId } from '../graph/entities.js';

/**
 * Generate staging filename.
 * @param {Object} obs - Observation object
 * @returns {string} Filename like YYYY-MM-DD-abcd1234.md
 */
export function stagingFilename(obs) {
  const date = new Date().toISOString().slice(0, 10);
  const hash = createHash('sha256')
    .update(`${obs.title}${obs.body}${Date.now()}`)
    .digest('hex')
    .slice(0, 8);
  return `${date}-${hash}.md`;
}

/**
 * Format an observation as vault markdown with YAML frontmatter.
 * @param {Object} obs
 * @param {string} [sourceSession] - Source session identifier
 * @returns {string}
 */
export function formatObservation(obs, sourceSession) {
  const now = new Date().toISOString();
  const entities = (obs.entities || [])
    .map(e => {
      const canonName = resolveAlias(e.name);
      return `  - name: "${canonName}"\n    type: ${e.type || 'person'}`;
    })
    .join('\n');

  let fm = `---
type: ${obs.type}
confidence: ${obs.confidence.toFixed(2)}
importance: ${obs.importance.toFixed(2)}
title: "${obs.title.replace(/"/g, '\\"')}"
created: ${now}
source_session: ${sourceSession || 'unknown'}`;

  if (obs.author) fm += `\nauthor: ${obs.author}`;
  if (entities) fm += `\nentities:\n${entities}`;
  fm += '\n---\n';

  let body = obs.body;
  if (obs.context) body += `\n\n**Context:** ${obs.context}`;
  if (obs.source_quote) body += `\n\n> ${obs.source_quote}`;

  return fm + '\n' + body + '\n';
}

/**
 * Write an observation to the staging directory.
 * @param {Object} obs - Observation object
 * @param {string} stagingDir - Path to staging directory
 * @param {string} [sourceSession] - Source session identifier
 * @returns {Promise<string>} Path to written file
 */
export async function writeToStaging(obs, stagingDir, sourceSession) {
  await mkdir(stagingDir, { recursive: true });
  const filename = stagingFilename(obs);
  const filepath = join(stagingDir, filename);
  const content = formatObservation(obs, sourceSession);
  await writeFile(filepath, content, 'utf8');
  return filepath;
}

/**
 * Stage a batch of observations.
 * @param {Array<Object>} observations
 * @param {string} stagingDir
 * @param {string} [sourceSession]
 * @returns {Promise<string[]>} Array of written file paths
 */
export async function stageAll(observations, stagingDir, sourceSession) {
  const paths = [];
  for (const obs of observations) {
    const path = await writeToStaging(obs, stagingDir, sourceSession);
    paths.push(path);
    console.log(`[staging] Wrote ${path}`);
  }
  return paths;
}

/**
 * Remove a staging file after successful memorization.
 * @param {string} filepath
 */
export async function cleanupStaged(filepath) {
  try {
    await unlink(filepath);
  } catch (err) {
    console.warn(`[staging] Failed to clean up ${filepath}: ${err.message}`);
  }
}

/**
 * Find orphaned staging files older than maxAgeDays.
 * @param {string} stagingDir
 * @param {number} [maxAgeDays=7]
 * @returns {Promise<string[]>} Orphaned file paths
 */
export async function findOrphans(stagingDir, maxAgeDays = 7) {
  try {
    const files = await readdir(stagingDir);
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const orphans = [];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filepath = join(stagingDir, file);
      const s = await stat(filepath);
      if (now - s.mtimeMs > maxAge) {
        orphans.push(filepath);
      }
    }

    return orphans;
  } catch {
    return [];
  }
}
