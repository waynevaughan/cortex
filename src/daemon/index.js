#!/usr/bin/env node

import { watch, readFileSync, writeFileSync, appendFileSync, statSync, renameSync, unlinkSync, mkdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { validate } from './validate.js';
import { score, resetCalibrationCache } from './score.js';
import { contentHash, checkDuplicate } from './dedup.js';
import { getCategory, getDestination } from './taxonomy.js';
import { buildEntry } from './frontmatter.js';

// ── Configuration ──────────────────────────────────────────────────────────────

const ROOT_DIR = process.env.CORTEX_ROOT || process.cwd();
const QUEUE_DIR = join(ROOT_DIR, 'queue');
const QUEUE_FILE = join(QUEUE_DIR, 'observations.jsonl');
const QUARANTINE_FILE = join(QUEUE_DIR, 'quarantine.jsonl');
const STATE_FILE = join(QUEUE_DIR, 'state.json');
const PID_FILE = join(QUEUE_DIR, 'daemon.pid');
const CALIBRATION_FILE = join(ROOT_DIR, 'calibration.yml');

const POLL_INTERVAL_MS = 30_000;
const ROTATION_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_ROTATED_FILES = 3;

// ── State ──────────────────────────────────────────────────────────────────────

let state = {
  observationFileOffset: 0,
  lastRun: null,
  reinforcements: {},
};

// ── PID Lock ───────────────────────────────────────────────────────────────────

function acquireLock() {
  mkdirSync(QUEUE_DIR, { recursive: true });
  if (existsSync(PID_FILE)) {
    const existingPid = readFileSync(PID_FILE, 'utf8').trim();
    // Check if process is still running
    try {
      process.kill(Number(existingPid), 0);
      console.error(`[cortex-daemon] Another instance running (PID ${existingPid}). Exiting.`);
      process.exit(1);
    } catch {
      // Process not running, stale PID file
      console.warn(`[cortex-daemon] Removing stale PID file (PID ${existingPid}).`);
    }
  }
  writeFileSync(PID_FILE, String(process.pid));
}

function releaseLock() {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// ── State Management ───────────────────────────────────────────────────────────

function loadState() {
  try {
    const data = readFileSync(STATE_FILE, 'utf8');
    state = JSON.parse(data);
    if (!state.reinforcements) state.reinforcements = {};
  } catch {
    state = { observationFileOffset: 0, lastRun: null, reinforcements: {} };
  }
}

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Queue Rotation ─────────────────────────────────────────────────────────────

function rotateIfNeeded() {
  try {
    const stats = statSync(QUEUE_FILE);
    if (stats.size < ROTATION_SIZE) return false;
  } catch {
    return false;
  }

  console.log('[cortex-daemon] Rotating queue file (>2MB).');

  // Remove oldest rotated file if at max
  const oldest = `${QUEUE_FILE}.${MAX_ROTATED_FILES}`;
  if (existsSync(oldest)) {
    try { unlinkSync(oldest); } catch { /* ignore */ }
  }

  // Shift existing rotated files
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const src = `${QUEUE_FILE}.${i}`;
    const dst = `${QUEUE_FILE}.${i + 1}`;
    if (existsSync(src)) {
      try { renameSync(src, dst); } catch { /* ignore */ }
    }
  }

  // Rotate current file
  try {
    renameSync(QUEUE_FILE, `${QUEUE_FILE}.1`);
  } catch { /* ignore */ }

  // Reset offset
  state.observationFileOffset = 0;
  saveState();
  return true;
}

// ── Quarantine ─────────────────────────────────────────────────────────────────

function quarantine(entry, reason, detail) {
  const record = {
    ...entry,
    rejected_at: new Date().toISOString(),
    reason,
    detail,
  };
  appendFileSync(QUARANTINE_FILE, JSON.stringify(record) + '\n');
  console.warn(`[cortex-daemon] Quarantined: ${reason} — ${detail}`);
}

// ── Git Operations ─────────────────────────────────────────────────────────────

function gitCommit(filePath, summary, attribution) {
  try {
    execSync(`git add "${filePath}"`, { cwd: ROOT_DIR, stdio: 'pipe' });
    const msg = `observe: ${summary} (${attribution})`;
    execSync(`git commit -m ${JSON.stringify(msg)} --author="cortex-daemon <daemon@cortex.local>"`, {
      cwd: ROOT_DIR,
      stdio: 'pipe',
    });
    return true;
  } catch (err) {
    console.error(`[cortex-daemon] Git commit failed: ${err.message}`);
    return false;
  }
}

// ── Process Single Entry ───────────────────────────────────────────────────────

function processEntry(entry) {
  // 1. Validate
  const validation = validate(entry);
  if (!validation.valid) {
    quarantine(entry, validation.reason, validation.detail);
    return;
  }

  // 2. Block milestones (log and skip, do NOT quarantine)
  if (entry.type === 'milestone') {
    console.log(`[cortex-daemon] Milestone entry blocked (requires explicit promotion): "${entry.body?.slice(0, 60)}"`);
    return;
  }

  // 3. Score
  const calibPath = existsSync(CALIBRATION_FILE) ? CALIBRATION_FILE : null;
  const scoreResult = score(entry, calibPath);
  if (!scoreResult.memorize) {
    console.log(`[cortex-daemon] Below threshold: ${scoreResult.reason}`);
    return;
  }

  // 4. Deduplicate
  const hash = contentHash(entry.body);
  const dupCheck = checkDuplicate(hash, ROOT_DIR);
  if (dupCheck.duplicate) {
    console.log(`[cortex-daemon] Duplicate detected, reinforcing: ${dupCheck.existingId}`);
    state.reinforcements[dupCheck.existingId] = new Date().toISOString();
    return;
  }

  // 5. Route
  const destination = getDestination(entry.type);
  if (!destination) {
    quarantine(entry, 'routing_failed', `Could not route type: ${entry.type}`);
    return;
  }

  // 6. Build entry
  const { content, id, filename } = buildEntry(entry);
  const typeDir = join(ROOT_DIR, destination, entry.type);
  mkdirSync(typeDir, { recursive: true });
  const filePath = join(typeDir, filename);

  // 7. Write file
  writeFileSync(filePath, content);
  console.log(`[cortex-daemon] Wrote: ${destination}/${entry.type}/${filename}`);

  // 8. Git commit
  const summary = entry.body.slice(0, 60);
  gitCommit(filePath, summary, entry.attribution);
}

// ── Process Queue ──────────────────────────────────────────────────────────────

function processQueue() {
  // Check for rotation first
  rotateIfNeeded();

  // Check if queue file exists
  if (!existsSync(QUEUE_FILE)) return;

  let fileSize;
  try {
    fileSize = statSync(QUEUE_FILE).size;
  } catch {
    return;
  }

  if (fileSize <= state.observationFileOffset) return;

  // Read from offset to EOF
  const bytesToRead = fileSize - state.observationFileOffset;
  const buffer = Buffer.alloc(bytesToRead);
  const fd = openSync(QUEUE_FILE, 'r');
  try {
    readSync(fd, buffer, 0, bytesToRead, state.observationFileOffset);
  } finally {
    closeSync(fd);
  }

  const content = buffer.toString('utf8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (err) {
      console.error(`[cortex-daemon] Malformed JSON, skipping: ${err.message}`);
      quarantine({ raw: trimmed }, 'malformed_json', err.message);
      continue;
    }

    try {
      processEntry(entry);
    } catch (err) {
      console.error(`[cortex-daemon] Error processing entry: ${err.message}`);
      quarantine(entry, 'processing_error', err.message);
    }
  }

  // Advance offset
  state.observationFileOffset = fileSize;
  state.lastRun = new Date().toISOString();
  saveState();
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  console.log(`[cortex-daemon] Starting. Root: ${ROOT_DIR}`);
  acquireLock();

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', releaseLock);

  loadState();
  mkdirSync(QUEUE_DIR, { recursive: true });

  // Initial processing
  processQueue();

  // Watch for changes
  let watcher;
  try {
    watcher = watch(QUEUE_FILE, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        processQueue();
      }
    });
    // Handle watcher errors (file doesn't exist yet, etc.)
    watcher.on('error', () => {
      console.warn('[cortex-daemon] Watcher error, relying on polling.');
    });
  } catch {
    console.warn('[cortex-daemon] Could not start watcher, relying on polling.');
  }

  // Polling fallback (30s)
  const pollTimer = setInterval(() => {
    processQueue();
  }, POLL_INTERVAL_MS);

  console.log('[cortex-daemon] Running. Watching queue for observations.');

  function shutdown() {
    console.log('\n[cortex-daemon] Shutting down.');
    if (watcher) watcher.close();
    clearInterval(pollTimer);
    saveState();
    releaseLock();
    process.exit(0);
  }
}

// Only run main when executed directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))) {
  main();
}

// Export for testing
export { processEntry, processQueue, loadState, saveState, state, rotateIfNeeded, quarantine, acquireLock, releaseLock, main, ROOT_DIR };
