/**
 * Stage 4b: Security Validation
 *
 * Schema enforcement, content length cap, instruction injection scan,
 * credential re-check, source attribution trust scoring.
 */

import { scrubCredentials } from './preprocessor.js';

const VALID_TYPES = ['decision', 'preference', 'fact', 'commitment', 'milestone', 'lesson', 'relationship', 'project'];
const MAX_BODY_LENGTH = 500;
const NON_PRIMARY_IMPORTANCE_CAP = 0.7;

/** Instruction injection patterns */
const INJECTION_PATTERNS = [
  /ignore\s+(previous|prior|all)\s+instructions/i,
  /disregard\s+(your|the|all)\s+rules/i,
  /you\s+are\s+now/i,
  /your\s+new\s+instructions\s+are/i,
  /override\s+the\s+following/i,
  /run\s+this\s+command/i,
  /execute\s+the\s+following/i,
  /call\s+the\s+api/i,
  /```[\s\S]*```/,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /system\s*prompt/i,
  /\bsudo\b/i,
];

/**
 * Validate observation schema.
 * @param {Object} obs
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateSchema(obs) {
  if (!VALID_TYPES.includes(obs.type)) {
    return { valid: false, reason: `invalid type: ${obs.type}` };
  }
  if (typeof obs.confidence !== 'number' || obs.confidence < 0 || obs.confidence > 1) {
    return { valid: false, reason: `invalid confidence: ${obs.confidence}` };
  }
  if (typeof obs.importance !== 'number' || obs.importance < 0 || obs.importance > 1) {
    return { valid: false, reason: `invalid importance: ${obs.importance}` };
  }
  if (!obs.title || typeof obs.title !== 'string') {
    return { valid: false, reason: 'missing or invalid title' };
  }
  if (!obs.body || typeof obs.body !== 'string') {
    return { valid: false, reason: 'missing or invalid body' };
  }
  return { valid: true };
}

/**
 * Enforce body length cap.
 * @param {Object} obs
 * @returns {{ obs: Object, truncated: boolean }}
 */
export function enforceBodyLength(obs) {
  if (obs.body.length <= MAX_BODY_LENGTH) return { obs, truncated: false };
  return {
    obs: { ...obs, body: obs.body.slice(0, MAX_BODY_LENGTH) + '…' },
    truncated: true,
  };
}

/**
 * Scan for instruction injection patterns.
 * @param {Object} obs
 * @returns {{ safe: boolean, pattern?: string }}
 */
export function scanInjection(obs) {
  const text = `${obs.title} ${obs.body} ${obs.context || ''}`;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, pattern: pattern.source };
    }
  }
  return { safe: true };
}

/**
 * Re-check observation body for leaked credentials.
 * @param {Object} obs
 * @returns {Object} Observation with credentials scrubbed
 */
export function recheckCredentials(obs) {
  return {
    ...obs,
    body: scrubCredentials(obs.body),
    title: scrubCredentials(obs.title),
    context: obs.context ? scrubCredentials(obs.context) : obs.context,
  };
}

/**
 * Apply source attribution trust scoring.
 * @param {Object} obs
 * @param {string} [primaryAgent] - Primary agent identifier
 * @returns {Object}
 */
export function applyTrustScoring(obs, primaryAgent = 'main') {
  const author = obs.author || primaryAgent;
  if (author !== primaryAgent) {
    return {
      ...obs,
      importance: Math.min(obs.importance, NON_PRIMARY_IMPORTANCE_CAP),
    };
  }
  return obs;
}

/**
 * Full security validation pipeline.
 * @param {Array<Object>} observations
 * @param {Object} [options]
 * @param {string} [options.primaryAgent] - Primary agent identifier
 * @returns {{ passed: Array<Object>, rejected: Array<{obs: Object, reason: string}> }}
 */
export function validate(observations, options = {}) {
  const passed = [];
  const rejected = [];

  for (const obs of observations) {
    // Layer 1: Schema enforcement
    const schema = validateSchema(obs);
    if (!schema.valid) {
      rejected.push({ obs, reason: `schema: ${schema.reason}` });
      continue;
    }

    // Layer 3: Injection scan (before truncation so we check full content)
    const injection = scanInjection(obs);
    if (!injection.safe) {
      rejected.push({ obs, reason: `injection: matched pattern ${injection.pattern}` });
      console.warn(`[security] Rejected observation "${obs.title}" — injection pattern: ${injection.pattern}`);
      continue;
    }

    // Layer 2: Body length cap
    let current = obs;
    const { obs: truncated, truncated: wasTruncated } = enforceBodyLength(current);
    current = truncated;
    if (wasTruncated) {
      console.warn(`[security] Truncated observation "${current.title}" body to ${MAX_BODY_LENGTH} chars`);
    }

    // Layer 5: Credential re-check
    current = recheckCredentials(current);

    // Layer 4: Trust scoring
    current = applyTrustScoring(current, options.primaryAgent);

    passed.push(current);
  }

  return { passed, rejected };
}
