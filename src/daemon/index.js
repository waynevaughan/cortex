/**
 * Cortex Daemon
 *
 * Zero-LLM background process. Watches the queue (observations.jsonl),
 * validates, deduplicates, routes, and commits entries to Mind or Vault.
 *
 * Also watches the Vault filesystem for external changes (Obsidian, etc.)
 * and reconciles them (recompute hash, fill missing fields, index, commit).
 *
 * Usage: node src/daemon/index.js --cortex <dir> [--once]
 *
 * Architecture: D22 (all writes through queue), D29 (partition-specific ops)
 */

import { watch } from 'node:fs';
import { readFile, writeFile, readdir, stat, mkdir, unlink } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

// --- Constants ---

const POLL_INTERVAL = 30000; // 30s polling fallback
const PID_FILENAME = 'daemon.pid';
const STATE_FILENAME = 'daemon-state.json';
const QUEUE_FILENAME = 'queue/observations.jsonl';
const QUEUE_MAX_BYTES = 2 * 1024 * 1024; // 2MB rotation threshold
const QUEUE_KEEP_ROTATED = 3;

// --- Taxonomy (D12, D30) ---

const TAXONOMY = {
  // Concept → Mind (11 types)
  idea:        'concept',
  opinion:     'concept',
  belief:      'concept',
  preference:  'concept',
  lesson:      'concept',
  decision:    'concept',
  commitment:  'concept',
  goal_short:  'concept',
  goal_long:   'concept',
  aspiration:  'concept',
  constraint:  'concept',

  // Entity → Vault (7 types)
  fact:        'entity',
  document:    'entity',
  event:       'entity',
  milestone:   'entity',
  person:      'entity',
  resource:    'entity',
  task:        'entity',

  // Relation → Vault (2 types)
  dependency:  'relation',
  project:     'relation',
};

const CATEGORY_PARTITION = {
  concept:  'mind',
  entity:   'vault',
  relation: 'vault',
};

// --- UUIDv7 Generation ---

/**
 * Generate a UUIDv7 (RFC 9562).
 * First 48 bits = Unix timestamp in ms, remaining = random.
 * @returns {string} Standard UUID format
 */
function uuidv7() {
  const now = Date.now();
  const bytes = new Uint8Array(16);

  // Timestamp (48 bits = 6 bytes)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Random fill
  const rand = new Uint8Array(10);
  globalThis.crypto?.getRandomValues?.(rand) ?? rand.forEach((_, i) => { rand[i] = Math.floor(Math.random() * 256); });
  bytes.set(rand, 6);

  // Version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Hashing ---

/**
 * SHA-256 hash of content.
 * @param {string} content
 * @returns {string} 64 hex chars
 */
function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// --- Frontmatter Parsing ---

/**
 * Parse YAML-ish frontmatter from markdown.
 * Simple parser — handles the fields we care about.
 * @param {string} content
 * @returns {{ meta: Object, body: string, raw: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content, raw: '' };

  const raw = match[1];
  const body = match[2];
  const meta = {};

  let currentKey = null;
  let inList = false;

  for (const line of raw.split('\n')) {
    const listMatch = line.match(/^\s+-\s+(.+)/);
    if (listMatch && currentKey && inList) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(listMatch[1].trim());
      continue;
    }

    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '' || val === '[]') {
        meta[currentKey] = [];
        inList = true;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        meta[currentKey] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        inList = false;
      } else {
        meta[currentKey] = isNaN(val) ? val : Number(val);
        inList = false;
      }
    }
  }

  return { meta, body, raw };
}

/**
 * Serialize frontmatter back to YAML-ish string.
 * @param {Object} meta
 * @param {Object} [appMeta] - Application fields (below separator)
 * @returns {string}
 */
function serializeFrontmatter(meta, appMeta = null) {
  const lines = ['---'];

  const cortexFields = ['id', 'type', 'category', 'created', 'source_hash', 'importance', 'last_reinforced', 'relates_to'];

  for (const key of cortexFields) {
    if (meta[key] === undefined) continue;
    const val = meta[key];
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of val) lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${val}`);
    }
  }

  if (appMeta && Object.keys(appMeta).length > 0) {
    lines.push('# ---');
    for (const [key, val] of Object.entries(appMeta)) {
      if (Array.isArray(val)) {
        lines.push(`${key}: [${val.join(', ')}]`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    }
  }

  lines.push('---');
  return lines.join('\n');
}

// --- Custom Taxonomy ---

/**
 * Load custom types from taxonomy.yml if it exists.
 * @param {string} cortexDir
 * @returns {Promise<Object>} Merged taxonomy
 */
async function loadTaxonomy(cortexDir) {
  const taxonomy = { ...TAXONOMY };
  const taxonomyPath = join(cortexDir, 'taxonomy.yml');
  try {
    const content = await readFile(taxonomyPath, 'utf8');
    // Simple YAML parsing for custom_types
    const typeMatches = content.matchAll(/- name:\s*(\w+)\s*\n\s*category:\s*(\w+)/g);
    for (const m of typeMatches) {
      const [, name, category] = m;
      if (['concept', 'entity', 'relation'].includes(category)) {
        taxonomy[name] = category;
      }
    }
  } catch {
    // No custom taxonomy — that's fine
  }
  return taxonomy;
}

// --- Validation (D19, D25) ---

/**
 * Validate entry frontmatter.
 * @param {Object} meta
 * @param {string} body
 * @param {Object} taxonomy
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEntry(meta, body, taxonomy) {
  const errors = [];

  if (!meta.id) errors.push('missing id');
  if (!meta.type) errors.push('missing type');
  if (meta.type && !taxonomy[meta.type]) errors.push(`unknown type: ${meta.type}`);
  if (!meta.category) errors.push('missing category');
  if (meta.type && taxonomy[meta.type] && meta.category !== taxonomy[meta.type]) {
    errors.push(`category mismatch: ${meta.category} should be ${taxonomy[meta.type]}`);
  }
  if (!meta.created) errors.push('missing created');
  if (!meta.source_hash) errors.push('missing source_hash');

  // Verify hash matches body
  if (meta.source_hash && body) {
    const expected = sha256(body);
    if (meta.source_hash !== expected) {
      errors.push(`source_hash mismatch: stored=${meta.source_hash.slice(0, 12)}... computed=${expected.slice(0, 12)}...`);
    }
  }

  // Mind-specific fields
  if (meta.category === 'concept') {
    if (meta.importance === undefined) errors.push('mind entry missing importance');
    if (!meta.last_reinforced) errors.push('mind entry missing last_reinforced');
  }

  // relates_to must be present (D29)
  if (!meta.relates_to) errors.push('missing relates_to');

  return { valid: errors.length === 0, errors };
}

// --- Queue Processing ---

/**
 * Parse JSONL observations from queue content.
 * @param {string} content
 * @returns {Object[]}
 */
function parseQueue(content) {
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (err) {
      console.warn(`[daemon] Invalid JSONL line: ${err.message}`);
    }
  }
  return entries;
}

/**
 * Build a complete entry from a queue observation.
 * @param {Object} obs - Queue observation
 * @param {Object} taxonomy
 * @returns {{ meta: Object, body: string, appMeta: Object } | null}
 */
function buildEntry(obs, taxonomy) {
  const type = obs.type;
  if (!type || !taxonomy[type]) {
    console.warn(`[daemon] Unknown type: ${type}`);
    return null;
  }

  const category = taxonomy[type];
  const partition = CATEGORY_PARTITION[category];
  const body = obs.body || obs.content || '';
  const hash = sha256(body);
  const now = new Date().toISOString();

  const meta = {
    id: obs.id || uuidv7(),
    type,
    category,
    created: obs.created || now,
    source_hash: hash,
    relates_to: obs.relates_to || [],
  };

  // Mind-specific fields
  if (partition === 'mind') {
    meta.importance = obs.importance ?? 0.5;
    meta.last_reinforced = now;
  }

  // Application fields (everything not in cortex schema)
  const cortexKeys = new Set(['id', 'type', 'category', 'created', 'source_hash', 'relates_to', 'importance', 'last_reinforced', 'body', 'content', 'title']);
  const appMeta = {};
  for (const [k, v] of Object.entries(obs)) {
    if (!cortexKeys.has(k)) appMeta[k] = v;
  }

  return { meta, body, appMeta, partition };
}

// --- Deduplication ---

/**
 * Check if an entry with this hash already exists.
 * @param {string} hash
 * @param {string} partition - 'mind' or 'vault'
 * @param {Map} hashIndex - hash → { id, path, partition }
 * @returns {{ exists: boolean, entry?: Object }}
 */
function checkDedup(hash, partition, hashIndex) {
  const existing = hashIndex.get(hash);
  if (!existing) return { exists: false };
  return { exists: true, entry: existing };
}

// --- File Writing ---

/**
 * Write an entry to disk.
 * @param {Object} meta
 * @param {string} body
 * @param {Object} appMeta
 * @param {string} dir - Target directory
 * @returns {Promise<string>} Path to written file
 */
async function writeEntry(meta, body, appMeta, dir) {
  await mkdir(dir, { recursive: true });

  const frontmatter = serializeFrontmatter(meta, appMeta);
  const title = body.split('\n').find(l => l.startsWith('# '))?.replace(/^#\s+/, '') || meta.type;
  const content = `${frontmatter}\n\n${body}`;
  const filename = `${meta.id}.md`;
  const filepath = join(dir, filename);

  await writeFile(filepath, content, 'utf8');
  return filepath;
}

// --- Git Operations ---

/**
 * Git add + commit (local only).
 * @param {string} cortexDir
 * @param {string} message
 */
function gitCommit(cortexDir, message) {
  try {
    execSync('git add -A', { cwd: cortexDir, stdio: 'pipe' });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}" --allow-empty-message`, {
      cwd: cortexDir,
      stdio: 'pipe',
    });
  } catch (err) {
    // Nothing to commit is fine
    if (!err.stderr?.toString().includes('nothing to commit')) {
      console.warn(`[daemon] Git commit failed: ${err.message}`);
    }
  }
}

// --- Hash Index ---

/**
 * Build hash index from all entries in Mind and Vault.
 * @param {string} cortexDir
 * @returns {Promise<Map>} hash → { id, path, partition }
 */
async function buildHashIndex(cortexDir) {
  const index = new Map();

  for (const partition of ['mind', 'vault']) {
    const dir = join(cortexDir, partition);
    let files;
    try {
      files = (await readdir(dir, { recursive: true })).filter(f => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const content = await readFile(join(dir, file), 'utf8');
        const { meta } = parseFrontmatter(content);
        if (meta.source_hash) {
          index.set(meta.source_hash, {
            id: meta.id,
            path: join(dir, file),
            partition,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return index;
}

// --- Queue Rotation (D18) ---

/**
 * Rotate queue file if over size limit.
 * @param {string} queuePath
 */
async function rotateQueue(queuePath) {
  try {
    const s = await stat(queuePath);
    if (s.size < QUEUE_MAX_BYTES) return;

    console.log(`[daemon] Rotating queue (${(s.size / 1024).toFixed(0)}KB > ${QUEUE_MAX_BYTES / 1024}KB)`);

    // Shift existing rotated files
    for (let i = QUEUE_KEEP_ROTATED; i >= 1; i--) {
      const from = i === 1 ? queuePath : `${queuePath}.${i - 1}`;
      const to = `${queuePath}.${i}`;
      try {
        await readFile(from); // Check exists
        const { rename } = await import('node:fs/promises');
        await rename(from, to);
      } catch { /* ignore */ }
    }

    // Create fresh queue file
    await writeFile(queuePath, '', 'utf8');
  } catch {
    // Queue doesn't exist yet — that's fine
  }
}

// --- PID Lock ---

async function acquireLock(lockPath) {
  try {
    const existing = await readFile(lockPath, 'utf8').catch(() => null);
    if (existing) {
      try {
        process.kill(parseInt(existing, 10), 0);
        return false; // Still running
      } catch { /* Stale lock */ }
    }
    await writeFile(lockPath, String(process.pid), 'utf8');
    return true;
  } catch { return false; }
}

async function releaseLock(lockPath) {
  try { await unlink(lockPath); } catch { /* ignore */ }
}

// --- State Management ---

async function loadState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { offset: 0, lastRun: null, stats: { processed: 0, memorized: 0, reinforced: 0, skipped: 0 } };
  }
}

async function saveState(statePath, state) {
  state.lastRun = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

// --- Main Processing ---

/**
 * Process new queue entries.
 * @param {string} cortexDir
 * @param {Object} state
 * @param {Object} taxonomy
 * @param {Map} hashIndex
 * @returns {Promise<Object>} Updated state
 */
async function processQueue(cortexDir, state, taxonomy, hashIndex) {
  const queuePath = join(cortexDir, QUEUE_FILENAME);

  let content;
  try {
    content = await readFile(queuePath, 'utf8');
  } catch {
    return state; // No queue file yet
  }

  const newContent = content.slice(state.offset);
  if (!newContent.trim()) return state;

  const observations = parseQueue(newContent);
  if (observations.length === 0) {
    state.offset = Buffer.byteLength(content, 'utf8');
    return state;
  }

  console.log(`[daemon] Processing ${observations.length} observations`);

  let memorized = 0;
  let reinforced = 0;
  let skipped = 0;

  for (const obs of observations) {
    const entry = buildEntry(obs, taxonomy);
    if (!entry) { skipped++; continue; }

    const { meta, body, appMeta, partition } = entry;

    // Dedup check
    const dup = checkDedup(meta.source_hash, partition, hashIndex);
    if (dup.exists) {
      if (partition === 'mind') {
        // Reinforce — update last_reinforced
        try {
          const existingContent = await readFile(dup.entry.path, 'utf8');
          const updated = existingContent.replace(
            /last_reinforced:\s*.+/,
            `last_reinforced: ${new Date().toISOString()}`
          );
          await writeFile(dup.entry.path, updated, 'utf8');
          gitCommit(cortexDir, `cortex: reinforce ${meta.type} (${dup.entry.id.slice(0, 13)})`);
          reinforced++;
          console.log(`[daemon] Reinforced ${meta.type} (${dup.entry.id.slice(0, 13)})`);
        } catch (err) {
          console.warn(`[daemon] Reinforce failed: ${err.message}`);
        }
      } else {
        // Vault — warn but allow? For now, skip exact dupes.
        console.log(`[daemon] Duplicate vault entry detected (${meta.source_hash.slice(0, 12)}...) — skipping`);
        skipped++;
      }
      continue;
    }

    // Validate
    const { valid, errors } = validateEntry(meta, body, taxonomy);
    if (!valid) {
      console.warn(`[daemon] Validation failed for ${meta.type}: ${errors.join(', ')}`);
      skipped++;
      continue;
    }

    // Write entry
    const dir = join(cortexDir, partition);
    try {
      const filepath = await writeEntry(meta, body, appMeta, dir);
      hashIndex.set(meta.source_hash, { id: meta.id, path: filepath, partition });

      const title = body.split('\n').find(l => l.startsWith('# '))?.replace(/^#\s+/, '') || meta.type;
      gitCommit(cortexDir, `cortex: memorize ${meta.type} "${title}" (${meta.id.slice(0, 13)})`);
      memorized++;
      console.log(`[daemon] Memorized ${meta.type} → ${partition} (${meta.id.slice(0, 13)})`);
    } catch (err) {
      console.warn(`[daemon] Write failed: ${err.message}`);
      skipped++;
    }
  }

  state.offset = Buffer.byteLength(content, 'utf8');
  state.stats.processed += observations.length;
  state.stats.memorized += memorized;
  state.stats.reinforced += reinforced;
  state.stats.skipped += skipped;

  console.log(`[daemon] Batch complete: ${memorized} memorized, ${reinforced} reinforced, ${skipped} skipped`);

  // Rotate if needed
  await rotateQueue(queuePath);

  return state;
}

// --- Vault Filesystem Reconciliation (D29) ---

/**
 * Track known vault file mtimes for change detection.
 * @type {Map<string, number>}
 */
const vaultMtimes = new Map();

/**
 * Scan vault for new or changed files and reconcile them.
 * - New files without id: generate id, fill fields, rewrite, commit
 * - Changed files: recompute source_hash, update frontmatter, commit
 * @param {string} cortexDir
 * @param {Object} taxonomy
 * @param {Map} hashIndex
 */
async function reconcileVault(cortexDir, taxonomy, hashIndex) {
  const vaultDir = join(cortexDir, 'vault');
  let files;
  try {
    files = (await readdir(vaultDir, { recursive: true })).filter(f => f.endsWith('.md'));
  } catch { return; }

  let reconciled = 0;

  for (const file of files) {
    const filepath = join(vaultDir, file);
    let fileStat;
    try {
      fileStat = await stat(filepath);
    } catch { continue; }

    const mtime = fileStat.mtimeMs;
    const knownMtime = vaultMtimes.get(filepath);

    // Skip if unchanged
    if (knownMtime && Math.abs(mtime - knownMtime) < 100) continue;
    vaultMtimes.set(filepath, mtime);

    // Skip non-entry files (README, CONVENTIONS, etc.)
    const content = await readFile(filepath, 'utf8');
    if (!content.startsWith('---')) {
      // Not a frontmatter file — skip on first scan, but if it's new and looks like markdown...
      // Only reconcile files that have frontmatter or are clearly entries
      continue;
    }

    const { meta, body, raw } = parseFrontmatter(content);

    // Skip if already in hash index and hash matches (no change to body)
    const currentHash = sha256(body);
    if (meta.source_hash === currentHash && meta.id) {
      // No change — just update our mtime tracking
      continue;
    }

    let changed = false;
    const now = new Date().toISOString();

    // Fill missing id
    if (!meta.id) {
      meta.id = uuidv7();
      changed = true;
      console.log(`[daemon] Vault reconcile: generated id for ${file}`);
    }

    // Fill missing type — default to 'document' for vault
    if (!meta.type) {
      meta.type = 'document';
      changed = true;
    }

    // Fill missing category
    if (!meta.category && meta.type && taxonomy[meta.type]) {
      meta.category = taxonomy[meta.type];
      changed = true;
    }

    // Fill missing created
    if (!meta.created) {
      meta.created = now;
      changed = true;
    }

    // Fill missing relates_to
    if (!meta.relates_to) {
      meta.relates_to = [];
      changed = true;
    }

    // Recompute source_hash if body changed
    if (meta.source_hash !== currentHash) {
      meta.source_hash = currentHash;
      changed = true;
    }

    if (!changed) continue;

    // Rewrite the file with updated frontmatter
    // Preserve application fields (everything below # --- separator)
    const separatorIdx = raw.indexOf('# ---');
    let appMeta = {};
    if (separatorIdx >= 0) {
      const appSection = raw.slice(separatorIdx + 5).trim();
      for (const line of appSection.split('\n')) {
        const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
        if (kvMatch) {
          const val = kvMatch[2].trim();
          if (val.startsWith('[') && val.endsWith(']')) {
            appMeta[kvMatch[1]] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          } else {
            appMeta[kvMatch[1]] = val;
          }
        }
      }
    }

    const newFrontmatter = serializeFrontmatter(meta, Object.keys(appMeta).length > 0 ? appMeta : null);
    const newContent = `${newFrontmatter}\n\n${body}`;
    await writeFile(filepath, newContent, 'utf8');

    // Update hash index
    hashIndex.set(currentHash, { id: meta.id, path: filepath, partition: 'vault' });

    gitCommit(cortexDir, `cortex: reconcile ${meta.type} "${basename(file, '.md')}" (${meta.id.slice(0, 13)})`);
    reconciled++;
    console.log(`[daemon] Reconciled vault entry: ${file} (${meta.id.slice(0, 13)})`);
  }

  if (reconciled > 0) {
    console.log(`[daemon] Vault reconciliation: ${reconciled} entries updated`);
  }
}

// --- CLI ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  return {
    cortexDir: get('cortex'),
    once: args.includes('--once'),
  };
}

// --- Main ---

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.cortexDir) {
    console.error('Usage: node src/daemon/index.js --cortex <dir> [--once]');
    process.exit(1);
  }

  const cortexDir = resolve(opts.cortexDir);
  const lockPath = join(cortexDir, PID_FILENAME);
  const statePath = join(cortexDir, STATE_FILENAME);
  const queueDir = join(cortexDir, 'queue');

  // Ensure directories exist
  await mkdir(join(cortexDir, 'mind'), { recursive: true });
  await mkdir(join(cortexDir, 'vault'), { recursive: true });
  await mkdir(queueDir, { recursive: true });

  // Acquire lock
  if (!await acquireLock(lockPath)) {
    console.error('[daemon] Another instance is running. Exiting.');
    process.exit(1);
  }

  console.log(`[daemon] Starting Cortex daemon`);
  console.log(`[daemon] Cortex dir: ${cortexDir}`);

  // Load taxonomy and hash index
  const taxonomy = await loadTaxonomy(cortexDir);
  console.log(`[daemon] Taxonomy: ${Object.keys(taxonomy).length} types`);

  const hashIndex = await buildHashIndex(cortexDir);
  console.log(`[daemon] Hash index: ${hashIndex.size} entries`);

  let state = await loadState(statePath);

  // One-shot mode
  if (opts.once) {
    state = await processQueue(cortexDir, state, taxonomy, hashIndex);
    await saveState(statePath, state);
    await releaseLock(lockPath);
    console.log('[daemon] One-shot complete.');
    process.exit(0);
  }

  // Initial processing
  state = await processQueue(cortexDir, state, taxonomy, hashIndex);
  await saveState(statePath, state);

  // File watcher on queue
  const queuePath = join(cortexDir, QUEUE_FILENAME);
  try {
    watch(queueDir, { persistent: true }, async (eventType, filename) => {
      if (filename === 'observations.jsonl') {
        // Debounce
        setTimeout(async () => {
          try {
            state = await processQueue(cortexDir, state, taxonomy, hashIndex);
            await saveState(statePath, state);
          } catch (err) {
            console.error(`[daemon] Process error: ${err.message}`);
          }
        }, 500);
      }
    });
    console.log('[daemon] Watching queue');
  } catch (err) {
    console.warn(`[daemon] Queue watch failed: ${err.message}`);
  }

  // Vault filesystem watcher
  const vaultDir = join(cortexDir, 'vault');
  try {
    watch(vaultDir, { persistent: true, recursive: true }, (eventType, filename) => {
      if (!filename?.endsWith('.md')) return;
      // Debounce — wait for writes to settle
      setTimeout(async () => {
        try {
          await reconcileVault(cortexDir, taxonomy, hashIndex);
        } catch (err) {
          console.error(`[daemon] Vault reconcile error: ${err.message}`);
        }
      }, 1000);
    });
    console.log('[daemon] Watching vault');
  } catch (err) {
    console.warn(`[daemon] Vault watch failed: ${err.message}`);
  }

  // Initial vault scan
  await reconcileVault(cortexDir, taxonomy, hashIndex);

  // Polling fallback (processes both queue and vault)
  const poll = async () => {
    while (true) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      try {
        state = await processQueue(cortexDir, state, taxonomy, hashIndex);
        await reconcileVault(cortexDir, taxonomy, hashIndex);
        await saveState(statePath, state);
      } catch (err) {
        console.error(`[daemon] Poll error: ${err.message}`);
      }
    }
  };

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[daemon] Shutting down...');
    await saveState(statePath, state);
    await releaseLock(lockPath);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('[daemon] Running. Press Ctrl+C to stop.');
  poll();
}

main().catch(err => {
  console.error(`[daemon] Fatal: ${err.message}`);
  process.exit(1);
});
