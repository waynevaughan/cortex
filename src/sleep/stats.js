import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cortexRoot } from '../cli/paths.js';
import { scanEntries } from '../cli/entries.js';

/**
 * Write queue/stats.json with current counts.
 */
export async function writeStats({ archivedCount = 0, dupCount = 0 } = {}) {
  const log = [];
  const entries = await scanEntries();

  const perPartition = { mind: 0, vault: 0 };
  const perType = {};

  for (const e of entries) {
    perPartition[e.partition] = (perPartition[e.partition] || 0) + 1;
    perType[e.type] = (perType[e.type] || 0) + 1;
  }

  const stats = {
    total: entries.length,
    perPartition,
    perType,
    archivedThisRun: archivedCount,
    duplicatesThisRun: dupCount,
    timestamp: new Date().toISOString(),
  };

  const queueDir = resolve(cortexRoot(), 'queue');
  await mkdir(queueDir, { recursive: true });
  await writeFile(resolve(queueDir, 'stats.json'), JSON.stringify(stats, null, 2) + '\n', 'utf-8');

  log.push(`[stats] Total=${stats.total} mind=${perPartition.mind} vault=${perPartition.vault} archived=${archivedCount} dupes=${dupCount}`);
  return { stats, log };
}
