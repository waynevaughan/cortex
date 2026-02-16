/**
 * Cortex Observer Daemon
 *
 * Watches session transcripts via fs.watch + 30s polling fallback,
 * extracts observations through the full pipeline, and memorizes to vault.
 *
 * Usage: node src/observer/daemon.js --transcripts <dir> --vault <dir> [--config .cortexrc] [--once]
 */

import { watch } from 'node:fs';
import { readFile, writeFile, readdir, stat, mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { preprocess } from './preprocessor.js';
import { extract, loadVaultContext, loadCalibration } from './extractor.js';
import { parse } from './parser.js';
import { score } from './scorer.js';
import { validate } from './security.js';
import { dedup } from './dedup.js';
import { stageAll, findOrphans } from './staging.js';
import { memorizeAll } from './promoter.js';

const POLL_INTERVAL = 30000; // 30 seconds
const PID_FILENAME = 'observer.pid';
const STATE_FILENAME = 'state.json';

/**
 * Parse CLI arguments.
 * @param {string[]} argv
 * @returns {Object}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const get = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  return {
    transcriptsDir: get('transcripts'),
    vaultDir: get('vault'),
    configPath: get('config'),
    once: args.includes('--once'),
  };
}

/**
 * Load config from .cortexrc if it exists.
 * @param {string} [configPath]
 * @returns {Promise<Object>}
 */
async function loadConfig(configPath) {
  if (!configPath) return {};
  try {
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Acquire PID lock.
 * @param {string} lockPath
 * @returns {Promise<boolean>}
 */
async function acquireLock(lockPath) {
  try {
    const existing = await readFile(lockPath, 'utf8').catch(() => null);
    if (existing) {
      // Check if process is still running
      try {
        process.kill(parseInt(existing, 10), 0);
        return false; // Process still running
      } catch {
        // Stale lock, remove it
      }
    }
    await writeFile(lockPath, String(process.pid), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Release PID lock.
 * @param {string} lockPath
 */
async function releaseLock(lockPath) {
  try { await unlink(lockPath); } catch { /* ignore */ }
}

/**
 * Load processing state (byte offsets per file).
 * @param {string} statePath
 * @returns {Promise<{offsets: Object, lastRun: string}>}
 */
async function loadState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { offsets: {}, lastRun: null };
  }
}

/**
 * Save processing state.
 * @param {string} statePath
 * @param {Object} state
 */
async function saveState(statePath, state) {
  state.lastRun = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Process a single transcript file from the stored offset.
 * @param {string} filepath - Path to JSONL file
 * @param {number} offset - Byte offset to start from
 * @param {Object} ctx - Processing context
 * @returns {Promise<{ newOffset: number, count: number }>}
 */
async function processFile(filepath, offset, ctx) {
  const content = await readFile(filepath, 'utf8');
  const newContent = content.slice(offset);
  if (!newContent.trim()) return { newOffset: offset, count: 0 };

  console.log(`[daemon] Processing ${filepath} from offset ${offset} (${newContent.length} new bytes)`);

  // Stage 1: Preprocess
  const chunks = preprocess(newContent);
  let totalCount = 0;

  for (const chunk of chunks) {
    try {
      // Stage 2: Extract
      const raw = await extract(chunk, {
        apiKey: ctx.apiKey,
        model: ctx.model,
        existingObservations: ctx.existingObservations,
        calibration: ctx.calibration,
      });

      // Stage 3: Parse
      let { observations, errors } = parse(raw);
      if (errors.length) {
        // Retry once on parse failure
        if (observations.length === 0) {
          console.warn('[daemon] Parse failed, retrying...');
          const raw2 = await extract(chunk, {
            apiKey: ctx.apiKey,
            model: ctx.model,
            existingObservations: ctx.existingObservations,
            calibration: ctx.calibration,
          });
          const result2 = parse(raw2);
          observations = result2.observations;
          errors = result2.errors;
        }
        for (const err of errors) console.warn(`[parser] ${err}`);
      }

      if (observations.length === 0) continue;

      // Stage 4: Score
      const { memorized } = await score(observations, {
        baseDir: ctx.baseDir,
        apiKey: ctx.apiKey,
      });

      if (memorized.length === 0) continue;

      // Stage 4b: Security validation
      const { passed, rejected } = validate(memorized);
      for (const r of rejected) {
        console.warn(`[security] Rejected "${r.obs.title}": ${r.reason}`);
      }

      if (passed.length === 0) continue;

      // Stage 5: Dedup
      const { toStage, toReplace, contradictions, skipped } = await dedup(passed, ctx.vaultDir);
      for (const s of skipped) {
        console.log(`[dedup] Skipped "${s.obs.title}": ${s.reason}`);
      }
      for (const c of contradictions) {
        console.warn(`[dedup] Contradiction: "${c.obs.title}" vs ${c.file}`);
      }

      // Combine new and replacement observations
      const allToStage = [...toStage, ...toReplace.map(r => r.obs)];
      if (allToStage.length === 0) continue;

      // Stage 6: Stage
      await stageAll(allToStage, ctx.stagingDir);
      totalCount += allToStage.length;

    } catch (err) {
      console.error(`[daemon] Error processing chunk: ${err.message}`);
    }
  }

  // Stage 7: Memorize all staged
  if (totalCount > 0) {
    const { memorized: memorizedFiles, failed } = await memorizeAll(ctx.stagingDir, ctx.vaultDir);
    if (memorizedFiles.length > 0) {
      console.log(`[daemon] Memorized ${memorizedFiles.length} observations`);
      // Stage 8: Trigger graph rebuild
      await triggerGraphRebuild(ctx.vaultDir);
    }
    if (failed.length > 0) {
      console.warn(`[daemon] ${failed.length} memorizations failed, will retry`);
    }
  }

  return { newOffset: Buffer.byteLength(content, 'utf8'), count: totalCount };
}

/**
 * Trigger incremental graph rebuild after memorization.
 * @param {string} vaultDir
 */
async function triggerGraphRebuild(vaultDir) {
  try {
    const { buildIncremental } = await import('../graph/builder.js');
    await buildIncremental([vaultDir]);
    console.log('[daemon] Graph rebuild triggered');
  } catch (err) {
    console.warn(`[daemon] Graph rebuild failed: ${err.message}`);
  }
}

/**
 * Main daemon loop.
 */
async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.transcriptsDir || !opts.vaultDir) {
    console.error('Usage: node daemon.js --transcripts <dir> --vault <dir> [--config .cortexrc] [--once]');
    process.exit(1);
  }

  const transcriptsDir = resolve(opts.transcriptsDir);
  const vaultDir = resolve(opts.vaultDir);
  const config = await loadConfig(opts.configPath);
  const baseDir = resolve('.');
  const stagingDir = join(baseDir, 'observer', 'staging');
  const lockPath = join(baseDir, 'observer', PID_FILENAME);
  const statePath = join(baseDir, 'observer', STATE_FILENAME);

  await mkdir(join(baseDir, 'observer'), { recursive: true });
  await mkdir(stagingDir, { recursive: true });

  // Acquire PID lock
  if (!await acquireLock(lockPath)) {
    console.error('[daemon] Another observer instance is running. Exiting.');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[daemon] ANTHROPIC_API_KEY not set');
    await releaseLock(lockPath);
    process.exit(1);
  }

  console.log(`[daemon] Starting observer daemon`);
  console.log(`[daemon] Transcripts: ${transcriptsDir}`);
  console.log(`[daemon] Vault: ${vaultDir}`);

  // Pre-load shared context
  const existingObservations = await loadVaultContext(vaultDir);
  const calibration = await loadCalibration(baseDir);

  const ctx = {
    apiKey,
    model: config.model || 'claude-opus-4-6',
    vaultDir,
    baseDir,
    stagingDir,
    existingObservations,
    calibration,
  };

  /** Process all transcript files */
  async function processAll() {
    const state = await loadState(statePath);

    let files;
    try {
      files = (await readdir(transcriptsDir)).filter(f => f.endsWith('.jsonl'));
    } catch (err) {
      console.error(`[daemon] Cannot read transcripts dir: ${err.message}`);
      return;
    }

    for (const file of files) {
      const filepath = join(transcriptsDir, file);
      let fileStat;
      try {
        fileStat = await stat(filepath);
      } catch {
        // File deleted mid-read
        delete state.offsets[file];
        continue;
      }

      const currentOffset = state.offsets[file] || 0;
      if (fileStat.size <= currentOffset) continue;

      try {
        const { newOffset, count } = await processFile(filepath, currentOffset, ctx);
        state.offsets[file] = newOffset;
        if (count > 0) {
          console.log(`[daemon] Extracted ${count} observations from ${file}`);
        }
      } catch (err) {
        console.error(`[daemon] Error processing ${file}: ${err.message}`);
      }
    }

    // Check for orphaned staging files
    const orphans = await findOrphans(stagingDir);
    if (orphans.length > 0) {
      console.warn(`[daemon] ${orphans.length} orphaned staging files older than 7 days`);
    }

    await saveState(statePath, state);
  }

  // One-shot mode (for hooks)
  if (opts.once) {
    await processAll();
    await releaseLock(lockPath);
    process.exit(0);
  }

  // Graceful shutdown
  let running = true;
  const shutdown = async () => {
    console.log('[daemon] Shutting down...');
    running = false;
    await releaseLock(lockPath);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Initial processing
  await processAll();

  // File watcher
  try {
    const watcher = watch(transcriptsDir, { persistent: true }, (eventType, filename) => {
      if (filename?.endsWith('.jsonl')) {
        console.log(`[daemon] File change detected: ${filename}`);
        // Debounce: wait a moment for writes to settle
        setTimeout(() => processAll().catch(err => console.error(`[daemon] ${err.message}`)), 1000);
      }
    });
    watcher.on('error', (err) => {
      console.warn(`[daemon] Watcher error: ${err.message}, relying on polling`);
    });
    console.log('[daemon] File watcher active');
  } catch (err) {
    console.warn(`[daemon] Could not start file watcher: ${err.message}`);
  }

  // Polling fallback
  const poll = async () => {
    while (running) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      if (!running) break;
      await processAll().catch(err => console.error(`[daemon] Poll error: ${err.message}`));
    }
  };
  poll();
}

main().catch(err => {
  console.error(`[daemon] Fatal: ${err.message}`);
  process.exit(1);
});
