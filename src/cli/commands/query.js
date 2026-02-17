import { scanEntries, readEntryContent, getFirstLine } from '../entries.js';
import { VALID_TYPES, CONCEPT_TYPES, ENTITY_TYPES, RELATION_TYPES } from '../../daemon/taxonomy.js';

export async function queryCommand(args) {
  const searchTerm = args._positional[0];
  if (!searchTerm) {
    console.error('Usage: cortex query <search-term> [--type <type>] [--category <category>]');
    process.exit(1);
  }

  if (args.type && !VALID_TYPES.has(args.type)) {
    console.error(`Invalid type: ${args.type}`);
    process.exit(1);
  }
  if (args.category && !['concept', 'entity', 'relation'].includes(args.category)) {
    console.error('Invalid category. Must be: concept, entity, or relation');
    process.exit(1);
  }

  const entries = await scanEntries({ type: args.type, category: args.category });
  const needle = searchTerm.toLowerCase();
  const matches = [];

  for (const entry of entries) {
    try {
      const content = await readEntryContent(entry.path);
      if (content.toLowerCase().includes(needle)) {
        matches.push({ ...entry, firstLine: getFirstLine(content) });
      }
    } catch {
      continue;
    }
  }

  if (matches.length === 0) {
    console.log(`No entries matching "${searchTerm}"`);
    return;
  }

  console.log(`Found ${matches.length} match${matches.length === 1 ? '' : 'es'}:\n`);
  for (const m of matches) {
    console.log(`  ${m.id}  [${m.type}]  ${m.firstLine}`);
    console.log(`    ${m.path}`);
  }
}
