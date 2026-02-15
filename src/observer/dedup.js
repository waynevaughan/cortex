/**
 * Stage 5: Deduplication
 *
 * Content hash check + semantic similarity (placeholder for QMD integration).
 * Handles exact dupes, more-specific replacements, and contradictions.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Compute SHA-256 content hash of normalized observation body.
 * @param {string} body
 * @returns {string}
 */
export function contentHash(body) {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Normalize text for comparison.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}

/**
 * Simple semantic similarity based on normalized text comparison.
 * This is a placeholder for QMD vector similarity integration.
 * Returns a score 0-1 based on word overlap (Jaccard similarity).
 *
 * TODO: Replace with QMD hybrid BM25 + vector similarity when available as a library.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Similarity score 0-1
 */
export function textSimilarity(a, b) {
  const wordsA = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const wordsB = new Set(normalize(b).split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Load existing vault observation hashes and content.
 * @param {string} vaultDir
 * @param {number} [limit=50]
 * @returns {Promise<Array<{hash: string, title: string, body: string, file: string}>>}
 */
export async function loadExistingObservations(vaultDir, limit = 50) {
  try {
    const obsDir = join(vaultDir, 'observations');
    const files = await readdir(obsDir).catch(() => []);
    const sorted = files.filter(f => f.endsWith('.md')).sort().reverse().slice(0, limit);
    const existing = [];

    for (const file of sorted) {
      const content = await readFile(join(obsDir, file), 'utf8');
      const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const bodyMatch = content.match(/^body:\s*["']?(.+?)["']?\s*$/m);
      const body = bodyMatch?.[1] || '';
      existing.push({
        hash: contentHash(body),
        title: titleMatch?.[1] || '',
        body,
        file,
      });
    }

    return existing;
  } catch {
    return [];
  }
}

/**
 * @typedef {Object} DedupResult
 * @property {'new'|'skip'|'replace'|'contradiction'} action
 * @property {Object} observation
 * @property {string} [matchFile] - File of the matched existing observation
 * @property {string} [reason]
 */

/**
 * Deduplicate a single observation against existing vault observations.
 * @param {Object} obs
 * @param {Array<{hash: string, title: string, body: string, file: string}>} existing
 * @returns {DedupResult}
 */
export function dedupOne(obs, existing) {
  const hash = contentHash(obs.body);

  // Exact content hash match → skip
  for (const ex of existing) {
    if (ex.hash === hash) {
      return { action: 'skip', observation: obs, matchFile: ex.file, reason: 'exact content hash match' };
    }
  }

  // Semantic similarity check
  for (const ex of existing) {
    // Exact title match
    if (normalize(obs.title) === normalize(ex.title)) {
      const bodySim = textSimilarity(obs.body, ex.body);
      if (bodySim > 0.85) {
        // More specific? (longer body with similar content)
        if (obs.body.length > ex.body.length * 1.2) {
          return { action: 'replace', observation: obs, matchFile: ex.file, reason: 'more specific version' };
        }
        return { action: 'skip', observation: obs, matchFile: ex.file, reason: `semantic duplicate (sim=${bodySim.toFixed(2)})` };
      }
      // Same title but different body — potential contradiction
      if (bodySim < 0.3) {
        return { action: 'contradiction', observation: obs, matchFile: ex.file, reason: 'same title, divergent body' };
      }
    }

    // Body-only similarity (no title match required)
    const bodySim = textSimilarity(obs.body, ex.body);
    if (bodySim > 0.85) {
      if (obs.body.length > ex.body.length * 1.2) {
        return { action: 'replace', observation: obs, matchFile: ex.file, reason: 'more specific version' };
      }
      return { action: 'skip', observation: obs, matchFile: ex.file, reason: `body duplicate (sim=${bodySim.toFixed(2)})` };
    }
  }

  return { action: 'new', observation: obs };
}

/**
 * Deduplicate a batch of observations against vault.
 * @param {Array<Object>} observations
 * @param {string} vaultDir
 * @returns {Promise<{ toStage: Array<Object>, toReplace: Array<{obs: Object, file: string}>, contradictions: Array<{obs: Object, file: string}>, skipped: Array<{obs: Object, reason: string}> }>}
 */
export async function dedup(observations, vaultDir) {
  const existing = await loadExistingObservations(vaultDir);
  const toStage = [];
  const toReplace = [];
  const contradictions = [];
  const skipped = [];

  for (const obs of observations) {
    const result = dedupOne(obs, existing);
    switch (result.action) {
      case 'new':
        toStage.push(obs);
        break;
      case 'replace':
        toReplace.push({ obs, file: result.matchFile });
        break;
      case 'contradiction':
        contradictions.push({ obs, file: result.matchFile });
        toStage.push(obs); // Write both, flag old
        break;
      case 'skip':
        skipped.push({ obs, reason: result.reason });
        break;
    }
  }

  return { toStage, toReplace, contradictions, skipped };
}
