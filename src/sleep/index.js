#!/usr/bin/env node

/**
 * Cortex Sleep Cycle — Nightly maintenance batch job.
 *
 * Runs: decay → reinforcement → dedup → index rebuild → stats → git commit
 * Zero LLM calls. Fully mechanical. Idempotent.
 *
 * Usage: node src/sleep/index.js
 *        CORTEX_ROOT=/path/to/cortex node src/sleep/index.js
 */

import { execSync } from 'node:child_process';
import { cortexRoot } from '../cli/paths.js';
import { processDecay } from './decay.js';
import { processReinforcements } from './reinforce.js';
import { processDedup } from './dedup.js';
import { rebuildIndex } from './indexer.js';
import { writeStats } from './stats.js';

async function sleep() {
  const allLogs = [];
  const log = (lines) => { allLogs.push(...lines); lines.forEach(l => console.log(l)); };

  const date = new Date().toISOString().slice(0, 10);
  console.log(`[sleep] Starting nightly maintenance ${date}`);

  // 1. Reinforcement (before decay so reinforced entries don't get archived)
  const reinforce = await processReinforcements();
  log(reinforce.log);

  // 2. Decay
  const decay = await processDecay();
  log(decay.log);

  // 3. Semantic dedup
  const dedup = await processDedup();
  log(dedup.log);

  // 4. Index rebuild
  const index = await rebuildIndex();
  log(index.log);

  // 5. Stats
  const stats = await writeStats({
    archivedCount: decay.archived.length + dedup.duplicates.length,
    dupCount: dedup.duplicates.length,
  });
  log(stats.log);

  // 6. Git commit
  try {
    const root = cortexRoot();
    execSync('git add -A', { cwd: root, stdio: 'pipe' });
    // Check if there are changes to commit
    try {
      execSync('git diff --cached --quiet', { cwd: root, stdio: 'pipe' });
      console.log('[sleep] No changes to commit');
    } catch {
      // diff --cached --quiet exits non-zero when there are staged changes
      execSync(`git commit -m "sleep: nightly maintenance ${date}"`, { cwd: root, stdio: 'pipe' });
      console.log(`[sleep] Committed: sleep: nightly maintenance ${date}`);
    }
  } catch (e) {
    console.error(`[sleep] Git commit failed: ${e.message}`);
  }

  console.log(`[sleep] Complete. Archived=${decay.archived.length} Reinforced=${reinforce.processed.length} Dupes=${dedup.duplicates.length} Indexed=${index.entryCount}`);
}

sleep().catch(e => {
  console.error('[sleep] Fatal error:', e);
  process.exit(1);
});
