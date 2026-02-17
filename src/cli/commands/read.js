import { findEntryById, readEntryContent } from '../entries.js';

export async function readCommand(args) {
  const id = args._positional[0];
  if (!id) {
    console.error('Usage: cortex read <id>');
    process.exit(1);
  }

  const entry = await findEntryById(id);
  if (!entry) {
    console.error(`Entry not found: ${id}`);
    process.exit(1);
  }

  const content = await readEntryContent(entry.path);
  console.log(`[${entry.partition}/${entry.type}] ${entry.path}`);
  console.log('');
  console.log(content);

  if (entry.partition === 'mind') {
    console.log('(Note: reinforcement tracking deferred to daemon — D28)');
  }
}
