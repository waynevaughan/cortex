import { scanEntries, readEntryContent, getFirstLine } from '../entries.js';
import { VALID_TYPES } from '../../daemon/taxonomy.js';

export async function listCommand(args) {
  if (args.type && !VALID_TYPES.has(args.type)) {
    console.error(`Invalid type: ${args.type}`);
    process.exit(1);
  }
  if (args.category && !['concept', 'entity', 'relation'].includes(args.category)) {
    console.error('Invalid category. Must be: concept, entity, or relation');
    process.exit(1);
  }

  const limit = parseInt(args.limit, 10) || 20;
  const entries = await scanEntries({ type: args.type, category: args.category });
  const sliced = entries.slice(-limit); // most recent N (UUIDv7 sorted chronologically)

  if (sliced.length === 0) {
    console.log('No entries found.');
    return;
  }

  console.log(`Showing ${sliced.length} of ${entries.length} entries:\n`);
  for (const entry of sliced) {
    let firstLine;
    try {
      const content = await readEntryContent(entry.path);
      firstLine = getFirstLine(content);
    } catch {
      firstLine = '(unreadable)';
    }
    console.log(`  ${entry.id}  [${entry.type}]  ${firstLine}`);
    console.log(`    ${entry.path}`);
  }
}
