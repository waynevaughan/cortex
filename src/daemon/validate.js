import { VALID_TYPES } from './taxonomy.js';

const REQUIRED_FIELDS = ['timestamp', 'bucket', 'type', 'body', 'attribution', 'session_id'];
const VALID_BUCKETS = new Set(['ambient', 'explicit']);

// Injection patterns
const INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /disregard/i,
  /you\s+are\s+now/i,
  /\bexecute\b/i,
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /```[\s\S]*```/,
];

// Credential patterns
const CREDENTIAL_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{20,}/,
  /\bghp_[a-zA-Z0-9]{36,}/,
  /\bxoxb-[a-zA-Z0-9-]+/,
  /\bbearer\s+[a-zA-Z0-9._\-]{20,}/i,
  /[a-zA-Z0-9+/]{40,}={0,2}/, // base64 secrets >40 chars
  /mongodb(\+srv)?:\/\/[^\s]+/i,
  /postgres(ql)?:\/\/[^\s]+/i,
];

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate an observation entry.
 * Returns { valid: true } or { valid: false, reason: string, detail: string }
 */
export function validate(entry) {
  // Schema validation
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
      return fail('validation_failed', `Missing required field: ${field}`);
    }
  }

  if (!VALID_BUCKETS.has(entry.bucket)) {
    return fail('validation_failed', `Invalid bucket: "${entry.bucket}". Must be "ambient" or "explicit".`);
  }

  if (entry.type === 'observation') {
    return fail('validation_failed', 'Type "observation" is a staging state, not a valid final type.');
  }

  if (!VALID_TYPES.has(entry.type)) {
    return fail('validation_failed', `Invalid type: "${entry.type}". Not in taxonomy.`);
  }

  if (typeof entry.body !== 'string' || entry.body.length < 1 || entry.body.length > 500) {
    return fail('validation_failed', `Body length ${typeof entry.body === 'string' ? entry.body.length : 'N/A'} out of range 1-500.`);
  }

  if (entry.context !== undefined && typeof entry.context === 'string' && entry.context.length > 1000) {
    return fail('validation_failed', `Context length ${entry.context.length} exceeds 1000.`);
  }

  if (entry.source_quote !== undefined && typeof entry.source_quote === 'string' && entry.source_quote.length > 500) {
    return fail('validation_failed', `Source quote length ${entry.source_quote.length} exceeds 500.`);
  }

  if (!ISO_8601_RE.test(entry.timestamp)) {
    return fail('validation_failed', `Invalid ISO-8601 timestamp: "${entry.timestamp}".`);
  }

  if (!UUID_RE.test(entry.session_id) && entry.session_id !== 'cli') {
    return fail('validation_failed', `Invalid session_id: "${entry.session_id}". Must be a valid UUID.`);
  }

  if (entry.confidence !== undefined) {
    const c = Number(entry.confidence);
    if (isNaN(c) || c < 0 || c > 1) {
      return fail('validation_failed', `Confidence ${entry.confidence} out of range 0.0-1.0.`);
    }
  }

  if (entry.importance !== undefined) {
    const i = Number(entry.importance);
    if (isNaN(i) || i < 0 || i > 1) {
      return fail('validation_failed', `Importance ${entry.importance} out of range 0.0-1.0.`);
    }
  }

  // Security validation
  const textFields = [entry.body, entry.context, entry.source_quote].filter(Boolean).join(' ');

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(textFields)) {
      return fail('injection_detected', `Injection pattern matched: ${pattern.source}`);
    }
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(textFields)) {
      return fail('credential_detected', `Credential pattern matched in content.`);
    }
  }

  return { valid: true };
}

function fail(reason, detail) {
  return { valid: false, reason, detail };
}
