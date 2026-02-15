/**
 * Stage 4: Scoring
 *
 * Validates and clamps scores, optional calibration pass,
 * applies promotion threshold.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const PROMOTION_THRESHOLD = 0.5;

/**
 * Clamp a value to [0.0, 1.0].
 * @param {number} val
 * @returns {number}
 */
export function clamp(val) {
  const n = Number(val);
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * Validate and clamp scores on observations.
 * @param {Array<Object>} observations
 * @returns {Array<Object>} Observations with clamped scores
 */
export function validateScores(observations) {
  return observations.map(obs => ({
    ...obs,
    confidence: clamp(obs.confidence),
    importance: clamp(obs.importance),
  }));
}

/**
 * Apply promotion threshold — discard observations below importance 0.5.
 * @param {Array<Object>} observations
 * @returns {{ promoted: Array<Object>, discarded: Array<Object> }}
 */
export function applyThreshold(observations) {
  const promoted = [];
  const discarded = [];
  for (const obs of observations) {
    if (obs.importance < PROMOTION_THRESHOLD) {
      discarded.push(obs);
    } else {
      promoted.push(obs);
    }
  }
  return { promoted, discarded };
}

/**
 * Load and validate calibration file, returning content and hash.
 * @param {string} baseDir
 * @returns {Promise<{ content: string, hash: string } | null>}
 */
export async function loadCalibrationFile(baseDir) {
  try {
    const path = join(baseDir, 'observer', 'calibration.yml');
    const content = await readFile(path, 'utf8');
    if (content.length > 4096) {
      console.warn('[scorer] calibration.yml exceeds 4KB, ignoring');
      return null;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    return { content, hash };
  } catch {
    return null;
  }
}

/**
 * Optional calibration pass via lightweight LLM call.
 * @param {Array<Object>} observations
 * @param {string} calibrationContent
 * @param {Object} options - { apiKey, model }
 * @returns {Promise<Array<Object>>} Re-scored observations
 */
export async function calibrate(observations, calibrationContent, options = {}) {
  if (!calibrationContent || observations.length === 0) return observations;

  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return observations;

  const model = options.model || 'claude-sonnet-4-20250514';

  const prompt = `Given these calibration rules:\n${calibrationContent}\n\nRe-score these observations. Return a JSON array of objects with "index" (0-based) and adjusted "confidence" and "importance" floats. Only include entries that need adjustment.\n\nObservations:\n${JSON.stringify(observations.map((o, i) => ({ index: i, type: o.type, title: o.title, body: o.body, confidence: o.confidence, importance: o.importance })))}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return observations;

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    const adjustments = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');

    const result = [...observations];
    for (const adj of adjustments) {
      if (typeof adj.index === 'number' && result[adj.index]) {
        if (adj.confidence != null) result[adj.index].confidence = clamp(adj.confidence);
        if (adj.importance != null) result[adj.index].importance = clamp(adj.importance);
      }
    }
    return result;
  } catch (err) {
    console.warn('[scorer] calibration pass failed:', err.message);
    return observations;
  }
}

/**
 * Full scoring pipeline: validate → calibrate (optional) → threshold.
 * @param {Array<Object>} observations
 * @param {Object} [options]
 * @param {string} [options.baseDir] - For calibration file
 * @param {string} [options.apiKey]
 * @param {string} [options.model]
 * @param {string} [options.lastCalibrationHash] - Previous hash for change detection
 * @returns {Promise<{ promoted: Array<Object>, discarded: Array<Object>, calibrationHash: string|null }>}
 */
export async function score(observations, options = {}) {
  let scored = validateScores(observations);
  let calibrationHash = null;

  if (options.baseDir) {
    const cal = await loadCalibrationFile(options.baseDir);
    if (cal) {
      calibrationHash = cal.hash;
      if (options.lastCalibrationHash && cal.hash !== options.lastCalibrationHash) {
        console.warn('[scorer] calibration.yml hash changed unexpectedly, falling back to base scoring');
      } else {
        scored = await calibrate(scored, cal.content, options);
      }
    }
  }

  const { promoted, discarded } = applyThreshold(scored);
  return { promoted, discarded, calibrationHash };
}
