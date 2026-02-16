/**
 * Stage 3: Output Parser
 *
 * Parses the JSON array from LLM response, validates required fields,
 * caps at 20 observations.
 */

const REQUIRED_FIELDS = ['type', 'confidence', 'importance', 'title', 'body'];
const MAX_OBSERVATIONS = 20;

/**
 * Parse LLM response into an array of observations.
 * @param {string} raw - Raw LLM response text
 * @returns {{ observations: Array<Object>, errors: string[] }}
 */
export function parse(raw) {
  const errors = [];

  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Try to extract JSON array from response
  let parsed;
  try {
    parsed = JSON.parse(cleaned.trim());
  } catch {
    // Try to find JSON array in the response (greedy)
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        errors.push('Failed to parse JSON array from LLM response');
        return { observations: [], errors };
      }
    } else {
      // Empty array is valid — model may have found nothing worth extracting
      if (cleaned.includes('[]') || cleaned.trim() === '') {
        return { observations: [], errors };
      }
      errors.push('No JSON array found in LLM response');
      return { observations: [], errors };
    }
  }

  if (!Array.isArray(parsed)) {
    errors.push('LLM response is not an array');
    return { observations: [], errors };
  }

  // Validate individual observations
  const valid = [];
  for (let i = 0; i < parsed.length; i++) {
    const obs = parsed[i];
    const missing = REQUIRED_FIELDS.filter(f => obs[f] == null || obs[f] === '');
    if (missing.length > 0) {
      errors.push(`Observation ${i}: missing fields: ${missing.join(', ')}`);
      continue;
    }
    valid.push(obs);
  }

  // Cap at MAX_OBSERVATIONS, sorted by importance descending
  if (valid.length > MAX_OBSERVATIONS) {
    errors.push(`Too many observations (${valid.length}), taking top ${MAX_OBSERVATIONS} by importance`);
    valid.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    return { observations: valid.slice(0, MAX_OBSERVATIONS), errors };
  }

  return { observations: valid, errors };
}
