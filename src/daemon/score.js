import { readFileSync } from 'node:fs';

const BUCKET_DEFAULTS = {
  explicit: { confidence: 0.9, importance: 0.6 },
  ambient:  { confidence: 0.7, importance: 0.6 },
};

const MEMORIZATION_THRESHOLD = 0.6;

/**
 * Score an observation entry. Mutates entry in place with final confidence/importance.
 * Returns { memorize: boolean, reason?: string }
 */
export function score(entry, calibrationPath = null) {
  const defaults = BUCKET_DEFAULTS[entry.bucket] || BUCKET_DEFAULTS.explicit;

  // Agent-provided scores override defaults, clamped to [0,1]
  let confidence = entry.confidence !== undefined ? clamp(Number(entry.confidence)) : defaults.confidence;
  let importance = entry.importance !== undefined ? clamp(Number(entry.importance)) : defaults.importance;

  // Apply calibration if available
  const calibration = loadCalibration(calibrationPath);
  if (calibration && calibration.rules) {
    for (const rule of calibration.rules) {
      if (matchesRule(entry, rule.match)) {
        if (rule.adjust) {
          if (rule.adjust.confidence !== undefined) {
            confidence = clamp(confidence + Number(rule.adjust.confidence));
          }
          if (rule.adjust.importance !== undefined) {
            importance = clamp(importance + Number(rule.adjust.importance));
          }
        }
      }
    }
  }

  entry.confidence = confidence;
  entry.importance = importance;

  if (importance < MEMORIZATION_THRESHOLD) {
    return { memorize: false, reason: `Importance ${importance} below threshold ${MEMORIZATION_THRESHOLD}` };
  }

  return { memorize: true };
}

function clamp(v) {
  return Math.max(0, Math.min(1, v));
}

function matchesRule(entry, match) {
  if (!match) return false;
  for (const [key, val] of Object.entries(match)) {
    if (key === 'source') {
      if (entry.attribution?.toLowerCase() !== val.toLowerCase()) return false;
    } else if (entry[key] !== val) {
      return false;
    }
  }
  return true;
}

let _calibrationCache = null;
let _calibrationPath = null;

function loadCalibration(path) {
  if (!path) return null;
  // Simple cache - reload if path changed
  if (_calibrationPath === path && _calibrationCache !== undefined) return _calibrationCache;
  _calibrationPath = path;
  try {
    const content = readFileSync(path, 'utf8');
    if (content.length > 4096) {
      console.warn('[cortex-daemon] Calibration file >4KB, ignoring.');
      _calibrationCache = null;
      return null;
    }
    // Simple YAML parser for our limited format
    _calibrationCache = parseSimpleYaml(content);
    return _calibrationCache;
  } catch {
    _calibrationCache = null;
    return null;
  }
}

/**
 * Minimal YAML parser for calibration files. Supports:
 * rules:
 *   - match: { type: "decision" }
 *     adjust: { importance: +0.1 }
 */
function parseSimpleYaml(content) {
  const rules = [];
  const lines = content.split('\n');
  let currentRule = null;
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed === 'rules:') continue;

    if (trimmed.startsWith('- match:')) {
      if (currentRule) rules.push(currentRule);
      currentRule = { match: {}, adjust: {} };
      currentSection = 'match';
      const inline = trimmed.replace('- match:', '').trim();
      if (inline) Object.assign(currentRule.match, parseInlineObj(inline));
    } else if (trimmed.startsWith('adjust:')) {
      currentSection = 'adjust';
      const inline = trimmed.replace('adjust:', '').trim();
      if (inline) Object.assign(currentRule.adjust, parseInlineObj(inline));
    } else if (currentRule && currentSection) {
      // Nested key: value
      const kv = trimmed.match(/^(\w+):\s*(.+)$/);
      if (kv) {
        const val = kv[2].replace(/^["']|["']$/g, '');
        currentRule[currentSection][kv[1]] = isNaN(Number(val)) ? val : Number(val);
      }
    }
  }
  if (currentRule) rules.push(currentRule);

  return { rules };
}

function parseInlineObj(str) {
  const obj = {};
  // Parse { key: "value", key2: +0.1 }
  const inner = str.replace(/^\{|\}$/g, '').trim();
  if (!inner) return obj;
  const pairs = inner.split(',');
  for (const pair of pairs) {
    const [k, ...vParts] = pair.split(':');
    if (!k) continue;
    const v = vParts.join(':').trim().replace(/^["']|["']$/g, '');
    obj[k.trim()] = isNaN(Number(v)) ? v : Number(v);
  }
  return obj;
}

// Export for testing
export { BUCKET_DEFAULTS, MEMORIZATION_THRESHOLD, loadCalibration, clamp };

// Reset calibration cache (for testing)
export function resetCalibrationCache() {
  _calibrationCache = null;
  _calibrationPath = null;
}
