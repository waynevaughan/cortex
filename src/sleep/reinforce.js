import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cortexRoot } from '../cli/paths.js';
import { findEntryById } from '../cli/entries.js';
import { updateFrontmatterField } from './decay.js';

/**
 * Process reinforcements from queue/state.json.
 * Updates last_reinforced in entry frontmatter, clears processed reinforcements.
 * Returns { processed: [{ id, timestamp }], log: string[] }
 */
export async function processReinforcements() {
  const stateFile = resolve(cortexRoot(), 'queue', 'state.json');
  const processed = [];
  const log = [];

  let state;
  try {
    state = JSON.parse(await readFile(stateFile, 'utf-8'));
  } catch {
    log.push('[reinforce] No state.json found or unreadable');
    return { processed, log };
  }

  const reinforcements = state.reinforcements || {};
  const ids = Object.keys(reinforcements);

  if (ids.length === 0) {
    log.push('[reinforce] No pending reinforcements');
    return { processed, log };
  }

  for (const id of ids) {
    const timestamp = reinforcements[id];
    const entry = await findEntryById(id);

    if (!entry) {
      log.push(`[reinforce] Entry ${id} not found, skipping`);
      delete reinforcements[id];
      continue;
    }

    const content = await readFile(entry.path, 'utf-8');
    const updated = updateFrontmatterField(content, 'last_reinforced', timestamp);
    await writeFile(entry.path, updated, 'utf-8');

    delete reinforcements[id];
    processed.push({ id, timestamp });
    log.push(`[reinforce] Updated ${id} last_reinforced=${timestamp}`);
  }

  // Save updated state
  state.reinforcements = reinforcements;
  await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf-8');

  return { processed, log };
}
