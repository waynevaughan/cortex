#!/usr/bin/env node

import { writeCommand } from './commands/write.js';
import { readCommand } from './commands/read.js';
import { queryCommand } from './commands/query.js';
import { listCommand } from './commands/list.js';
import { statusCommand } from './commands/status.js';

const USAGE = `Usage: cortex <command> [options]

Commands:
  write    Write an entry to the observation queue
  read     Read an entry by ID
  query    Search entries by keyword
  list     List entries
  status   Show Cortex status

Run 'cortex <command> --help' for command-specific help.`;

function parseArgs(argv) {
  const args = { _positional: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      args._positional.push(arg);
      i += 1;
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'write':
        await writeCommand(args);
        break;
      case 'read':
        await readCommand(args);
        break;
      case 'query':
        await queryCommand(args);
        break;
      case 'list':
        await listCommand(args);
        break;
      case 'status':
        await statusCommand(args);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export { parseArgs };
main();
