/**
 * Entity canonicalization for the Cortex knowledge graph.
 *
 * Normalizes entity references to canonical IDs, manages aliases,
 * and merges known name variations into single nodes.
 */

/**
 * Known alias mappings. Keys are lowercase variations, values are canonical identifiers.
 * Add entries here as new aliases are confirmed.
 * @type {Record<string, string>}
 */
const KNOWN_ALIASES = {
  'owner': 'user-alpha',
  'user alpha': 'user-alpha',
  '@useralpha': 'user-alpha',
  'cole': 'cole',
  '@cole': 'cole',
};

/**
 * Normalize a raw string into a lowercase-hyphenated identifier.
 * @param {string} raw - Raw entity name or reference
 * @returns {string} Normalized identifier (e.g., "wayne-vaughan")
 */
export function normalizeId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build a typed node ID.
 * @param {string} type - Node type (person, project, tag, decision, document, observation)
 * @param {string} identifier - Normalized identifier
 * @returns {string} e.g., "person:wayne-vaughan"
 */
export function nodeId(type, identifier) {
  return `${type}:${identifier}`;
}

/**
 * Resolve a raw entity name to its canonical identifier using known aliases.
 * Returns the normalized form if no alias is found.
 * @param {string} raw - Raw entity name
 * @returns {string} Canonical normalized identifier
 */
export function resolveAlias(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const lower = raw.trim().toLowerCase();
  if (KNOWN_ALIASES[lower]) return KNOWN_ALIASES[lower];
  // Also try without @ prefix
  const noAt = lower.replace(/^@/, '');
  if (KNOWN_ALIASES[noAt]) return KNOWN_ALIASES[noAt];
  return normalizeId(raw);
}

/**
 * Get all known aliases for a canonical identifier.
 * @param {string} canonicalId - The canonical normalized ID
 * @returns {string[]} List of alias strings (not including the canonical form)
 */
export function getAliases(canonicalId) {
  const aliases = [];
  for (const [alias, canonical] of Object.entries(KNOWN_ALIASES)) {
    if (canonical === canonicalId && normalizeId(alias) !== canonicalId) {
      aliases.push(alias);
    }
  }
  return aliases;
}

/**
 * Create a display label from a normalized identifier.
 * @param {string} id - Normalized identifier (e.g., "wayne-vaughan")
 * @returns {string} Display label (e.g., "Wayne Vaughan")
 */
export function toLabel(id) {
  if (!id) return '';
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
