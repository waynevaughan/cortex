/**
 * Cortex Sleep Cycle
 *
 * Nightly maintenance process: decay, index rebuild, hooks, stats.
 * Runs as a one-shot command via cron/launchd.
 *
 * Usage: node src/sleep/index.js --cortex <dir>
 */

import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// --- CLI Args ---

const args = process.argv.slice(2);
const cortexDirIndex = args.indexOf('--cortex');
if (cortexDirIndex === -1 || !args[cortexDirIndex + 1]) {
  console.error('Usage: node src/sleep/index.js --cortex <dir>');
  process.exit(1);
}

const CORTEX_DIR = args[cortexDirIndex + 1];

// --- Config ---

/**
 * Load .cortexrc config
 * @returns {Promise<Object>}
 */
async function loadConfig() {
  const configPath = join(CORTEX_DIR, '.cortexrc');
  try {
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// --- Frontmatter Parsing ---

/**
 * Parse entry frontmatter and body
 * @param {string} content
 * @returns {{ meta: Object, body: string } | null}
 */
function parseEntry(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const meta = {};

  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;

    // Parse arrays
    if (value === '[]') {
      meta[key] = [];
    } else if (value.startsWith('[')) {
      try {
        meta[key] = JSON.parse(value);
      } catch {
        meta[key] = value;
      }
    } else {
      // Parse numbers/booleans
      if (value === 'true') meta[key] = true;
      else if (value === 'false') meta[key] = false;
      else if (/^\d+(\.\d+)?$/.test(value)) meta[key] = parseFloat(value);
      else meta[key] = value;
    }
  }

  return { meta, body: body.trim() };
}

// --- Git Helpers ---

/**
 * Git commit with message
 * @param {string} message
 */
function gitCommit(message) {
  try {
    execSync('git add -A', { cwd: CORTEX_DIR, stdio: 'pipe' });
    execSync(`git commit -m "${message}"`, { cwd: CORTEX_DIR, stdio: 'pipe' });
  } catch (err) {
    // No changes to commit is fine
    if (!err.message.includes('nothing to commit')) {
      console.warn(`[sleep] Git commit warning: ${err.message}`);
    }
  }
}

// --- 1. Decay Processing ---

/**
 * Process decay for Mind entries
 * @param {Object} config
 * @returns {Promise<Object>}
 */
async function processDecay(config) {
  const decayRate = config.decay_rate ?? 0.03;
  const archiveThreshold = config.archive_threshold ?? 0.05;

  const mindDir = join(CORTEX_DIR, 'mind');
  if (!existsSync(mindDir)) {
    console.log('[sleep] No mind/ directory, skipping decay');
    return { evaluated: 0, archived: 0, distribution: [] };
  }

  const files = await readdir(mindDir);
  const entries = [];

  // Read all entries
  for (const filename of files) {
    if (!filename.endsWith('.md')) continue;
    const filepath = join(mindDir, filename);
    try {
      const content = await readFile(filepath, 'utf8');
      const parsed = parseEntry(content);
      if (!parsed) continue;

      entries.push({
        filepath,
        filename,
        meta: parsed.meta,
      });
    } catch (err) {
      console.warn(`[sleep] Failed to read ${filename}: ${err.message}`);
    }
  }

  const now = Date.now();
  const results = [];
  let archivedCount = 0;

  // Compute effective importance and archive if needed
  for (const entry of entries) {
    const { meta, filepath, filename } = entry;
    const importance = meta.importance ?? 0;
    const lastReinforced = new Date(meta.last_reinforced).getTime();
    const daysSince = (now - lastReinforced) / 86400000;

    const effectiveImportance = importance * Math.exp(-decayRate * daysSince);
    results.push(effectiveImportance);

    if (effectiveImportance < archiveThreshold) {
      // Archive (delete file, stays in git history)
      await unlink(filepath);
      const idPrefix = meta.id?.slice(0, 8) ?? 'unknown';
      gitCommit(`cortex: archive ${meta.type} (${idPrefix}) — decayed`);
      archivedCount++;
      console.log(`[sleep] Archived ${filename} (effective=${effectiveImportance.toFixed(4)})`);
    }
  }

  // Distribution buckets
  const distribution = {
    '0.0-0.1': results.filter(v => v < 0.1).length,
    '0.1-0.3': results.filter(v => v >= 0.1 && v < 0.3).length,
    '0.3-0.5': results.filter(v => v >= 0.3 && v < 0.5).length,
    '0.5-0.7': results.filter(v => v >= 0.5 && v < 0.7).length,
    '0.7+': results.filter(v => v >= 0.7).length,
  };

  console.log(`[sleep] Decay: evaluated ${entries.length}, archived ${archivedCount}`);
  console.log(`[sleep] Distribution:`, distribution);

  return {
    evaluated: entries.length,
    archived: archivedCount,
    distribution,
  };
}

// --- 2. Index Rebuild ---

/**
 * Rebuild index files
 * @returns {Promise<Object>}
 */
async function rebuildIndex() {
  const indexDir = join(CORTEX_DIR, 'index');
  if (!existsSync(indexDir)) {
    await mkdir(indexDir, { recursive: true });
  }

  const entries = [];
  const edges = [];

  // Scan mind/ and vault/
  for (const partition of ['mind', 'vault']) {
    const partitionDir = join(CORTEX_DIR, partition);
    if (!existsSync(partitionDir)) continue;

    const files = await readdir(partitionDir);
    for (const filename of files) {
      if (!filename.endsWith('.md')) continue;
      const filepath = join(partitionDir, filename);

      try {
        const content = await readFile(filepath, 'utf8');
        const parsed = parseEntry(content);
        if (!parsed) continue;

        const { meta } = parsed;
        entries.push({
          id: meta.id,
          type: meta.type,
          category: meta.category,
          created: meta.created,
          source_hash: meta.source_hash,
          relates_to: meta.relates_to ?? [],
          partition,
          filepath: `${partition}/${filename}`,
        });

        // Build graph edges (bidirectional)
        if (meta.relates_to && Array.isArray(meta.relates_to)) {
          for (const targetId of meta.relates_to) {
            edges.push({ from: meta.id, to: targetId });
            edges.push({ from: targetId, to: meta.id });
          }
        }
      } catch (err) {
        console.warn(`[sleep] Failed to index ${partition}/${filename}: ${err.message}`);
      }
    }
  }

  // Write index files
  await writeFile(
    join(indexDir, 'entries.json'),
    JSON.stringify(entries, null, 2),
    'utf8'
  );

  await writeFile(
    join(indexDir, 'graph.json'),
    JSON.stringify(edges, null, 2),
    'utf8'
  );

  gitCommit(`cortex: rebuild index (${entries.length} entries, ${edges.length} edges)`);

  console.log(`[sleep] Index rebuilt: ${entries.length} entries, ${edges.length} edges`);

  return { entries: entries.length, edges: edges.length };
}

// --- 3. Application Hooks ---

/**
 * Run application hooks
 * @returns {Promise<void>}
 */
async function runHooks() {
  const hooksDir = join(CORTEX_DIR, 'hooks', 'sleep');
  if (!existsSync(hooksDir)) {
    console.log('[sleep] No hooks/sleep/ directory, skipping hooks');
    return;
  }

  const files = await readdir(hooksDir);
  const executables = [];

  // Find executables
  for (const filename of files) {
    const filepath = join(hooksDir, filename);
    const stats = await stat(filepath);
    if (stats.isFile() && (stats.mode & 0o111)) {
      executables.push(filepath);
    }
  }

  // Sort alphabetically
  executables.sort();

  console.log(`[sleep] Running ${executables.length} hooks`);

  for (const hookPath of executables) {
    const hookName = basename(hookPath);
    console.log(`[sleep] Running hook: ${hookName}`);

    try {
      const output = execSync(`"${hookPath}" "${CORTEX_DIR}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 60000, // 1 minute timeout
      });
      if (output.trim()) {
        console.log(`[sleep] ${hookName} output:\n${output}`);
      }
    } catch (err) {
      console.error(`[sleep] Hook ${hookName} failed (exit ${err.status}):`);
      if (err.stdout) console.error(err.stdout);
      if (err.stderr) console.error(err.stderr);
      // Continue with other hooks
    }
  }
}

// --- 4. Stats Update ---

/**
 * Update stats file
 * @param {Object} decayResult
 * @param {Object} indexResult
 * @returns {Promise<void>}
 */
async function updateStats(decayResult, indexResult) {
  const observerDir = join(CORTEX_DIR, 'observer');
  if (!existsSync(observerDir)) {
    await mkdir(observerDir, { recursive: true });
  }

  const stats = {
    mind_entries: 0,
    vault_entries: 0,
    archived_today: decayResult.archived,
    index_size: indexResult.entries,
    last_sleep: new Date().toISOString(),
  };

  // Count entries
  for (const partition of ['mind', 'vault']) {
    const partitionDir = join(CORTEX_DIR, partition);
    if (existsSync(partitionDir)) {
      const files = await readdir(partitionDir);
      const count = files.filter(f => f.endsWith('.md')).length;
      if (partition === 'mind') stats.mind_entries = count;
      else stats.vault_entries = count;
    }
  }

  await writeFile(
    join(observerDir, 'stats.json'),
    JSON.stringify(stats, null, 2),
    'utf8'
  );

  console.log(`[sleep] Stats updated:`, stats);
}

// --- Main ---

async function main() {
  console.log(`[sleep] Starting sleep cycle for ${CORTEX_DIR}`);
  const startTime = Date.now();

  // Load config
  const config = await loadConfig();
  console.log('[sleep] Config:', { decay_rate: config.decay_rate ?? 0.03, archive_threshold: config.archive_threshold ?? 0.05 });

  // 1. Decay processing
  const decayResult = await processDecay(config);

  // 2. Index rebuild
  const indexResult = await rebuildIndex();

  // 3. Application hooks
  await runHooks();

  // 4. Stats update
  await updateStats(decayResult, indexResult);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[sleep] Sleep cycle complete (${elapsed}s)`);
}

main().catch(err => {
  console.error('[sleep] Fatal error:', err);
  process.exit(1);
});
