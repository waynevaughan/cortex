#!/usr/bin/env node
/**
 * Cortex CLI
 *
 * Command-line interface for Cortex. Writes to the queue, reads entries,
 * and shows status. Does NOT process entries — the daemon handles that.
 *
 * Commands:
 *   write   - Add an observation to the queue
 *   read    - Read an entry by ID
 *   status  - Show Cortex stats
 *   list    - List entries with filters
 *
 * Usage:
 *   node src/cli/index.js <command> [options]
 *   --cortex <dir>  Override cortex directory (default: cwd)
 */

import { readFile, writeFile, readdir, stat, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// --- Constants ---

const TAXONOMY = {
  // Concept → Mind (11 types)
  idea: 'concept',
  opinion: 'concept',
  belief: 'concept',
  preference: 'concept',
  lesson: 'concept',
  decision: 'concept',
  commitment: 'concept',
  goal_short: 'concept',
  goal_long: 'concept',
  aspiration: 'concept',
  constraint: 'concept',

  // Entity → Vault (7 types)
  fact: 'entity',
  document: 'entity',
  event: 'entity',
  milestone: 'entity',
  person: 'entity',
  resource: 'entity',
  task: 'entity',

  // Relation → Vault (2 types)
  dependency: 'relation',
  project: 'relation',
};

const VALID_TYPES = Object.keys(TAXONOMY);

// --- UUIDv7 Generation (RFC 9562) ---

/**
 * Generate a UUIDv7.
 * First 48 bits = Unix timestamp in ms, remaining = random.
 * @returns {string} Standard UUID format
 */
function uuidv7() {
  const now = Date.now();
  const bytes = new Uint8Array(16);

  // Timestamp (48 bits = 6 bytes)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Random fill
  const rand = new Uint8Array(10);
  globalThis.crypto?.getRandomValues?.(rand) ?? rand.forEach((_, i) => { rand[i] = Math.floor(Math.random() * 256); });
  bytes.set(rand, 6);

  // Version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Argument Parser ---

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        // Handle multiple values for same flag
        if (args.flags[key]) {
          args.flags[key] = Array.isArray(args.flags[key]) ? args.flags[key] : [args.flags[key]];
          args.flags[key].push(next);
        } else {
          args.flags[key] = next;
        }
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

// --- Commands ---

async function cmdWrite(cortexDir, args) {
  const type = args.flags.type;
  const body = args.flags.body;
  const importance = args.flags.importance ? parseFloat(args.flags.importance) : 0.5;
  const relatesTo = args.flags['relates-to'] ? args.flags['relates-to'].split(',') : [];

  // Validate
  if (!type) {
    console.error('Error: --type is required');
    process.exit(1);
  }
  if (!VALID_TYPES.includes(type)) {
    console.error(`Error: Invalid type "${type}". Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }
  if (!body) {
    console.error('Error: --body is required');
    process.exit(1);
  }
  if (importance < 0 || importance > 1) {
    console.error('Error: --importance must be between 0 and 1');
    process.exit(1);
  }

  // Build entry
  const entry = {
    id: uuidv7(),
    type,
    body,
    importance,
    relates_to: relatesTo,
  };

  // Add application fields (--field key=value)
  const fields = args.flags.field;
  if (fields) {
    const fieldList = Array.isArray(fields) ? fields : [fields];
    for (const field of fieldList) {
      const [key, value] = field.split('=');
      if (key && value !== undefined) {
        entry.application = entry.application || {};
        entry.application[key] = value;
      }
    }
  }

  // Write to queue
  const queuePath = join(cortexDir, 'queue', 'observations.jsonl');
  const line = JSON.stringify(entry) + '\n';

  try {
    await appendFile(queuePath, line, 'utf8');
    console.log(`✓ Queued: ${entry.id}`);
    console.log(`  Type: ${type}`);
    console.log(`  Importance: ${importance}`);
  } catch (err) {
    console.error(`Error writing to queue: ${err.message}`);
    process.exit(1);
  }
}

async function cmdRead(cortexDir, args) {
  const id = args.positional[1];
  if (!id) {
    console.error('Error: Entry ID required');
    console.error('Usage: cortex read <id>');
    process.exit(1);
  }

  // Search in mind/ and vault/
  const partitions = ['mind', 'vault'];
  let found = false;

  for (const partition of partitions) {
    const partitionPath = join(cortexDir, partition);
    if (!existsSync(partitionPath)) continue;

    const files = await readdir(partitionPath);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = join(partitionPath, file);
      const content = await readFile(filePath, 'utf8');

      // Check if ID matches
      const idMatch = content.match(/^id:\s*(.+)$/m);
      if (idMatch && idMatch[1].trim() === id) {
        console.log(`\n=== ${partition}/${file} ===\n`);
        console.log(content);
        found = true;

        // If Mind entry, note that this is a reinforcement read
        if (partition === 'mind') {
          console.log('\n[Mind entry — daemon will record reinforcement]');
        }
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    console.error(`Error: Entry ${id} not found`);
    process.exit(1);
  }
}

async function cmdStatus(cortexDir) {
  // Count Mind entries
  let mindCount = 0;
  const mindPath = join(cortexDir, 'mind');
  if (existsSync(mindPath)) {
    const files = await readdir(mindPath);
    mindCount = files.filter(f => f.endsWith('.md')).length;
  }

  // Count Vault entries
  let vaultCount = 0;
  const vaultPath = join(cortexDir, 'vault');
  if (existsSync(vaultPath)) {
    const files = await readdir(vaultPath);
    vaultCount = files.filter(f => f.endsWith('.md')).length;
  }

  // Queue size
  let queueSize = 0;
  const queuePath = join(cortexDir, 'queue', 'observations.jsonl');
  if (existsSync(queuePath)) {
    const content = await readFile(queuePath, 'utf8');
    queueSize = content.trim().split('\n').filter(l => l.trim()).length;
  }

  // Daemon state
  const statePath = join(cortexDir, 'daemon-state.json');
  let lastRun = 'never';
  let processedCount = 0;
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      lastRun = state.last_run || 'never';
      processedCount = state.entries_processed || 0;
    } catch (err) {
      // Ignore parse errors
    }
  }

  // Output
  console.log('Cortex Status');
  console.log('=============');
  console.log(`Mind entries:       ${mindCount}`);
  console.log(`Vault entries:      ${vaultCount}`);
  console.log(`Queue size:         ${queueSize}`);
  console.log(`Entries processed:  ${processedCount}`);
  console.log(`Last daemon run:    ${lastRun}`);
}

async function cmdList(cortexDir, args) {
  const partitionFilter = args.flags.partition; // 'mind' or 'vault'
  const typeFilter = args.flags.type;
  const limit = args.flags.limit ? parseInt(args.flags.limit, 10) : Infinity;

  const partitions = partitionFilter ? [partitionFilter] : ['mind', 'vault'];
  let count = 0;

  for (const partition of partitions) {
    const partitionPath = join(cortexDir, partition);
    if (!existsSync(partitionPath)) continue;

    const files = await readdir(partitionPath);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      if (count >= limit) break;

      const filePath = join(partitionPath, file);
      const content = await readFile(filePath, 'utf8');

      // Extract frontmatter
      const idMatch = content.match(/^id:\s*(.+)$/m);
      const typeMatch = content.match(/^type:\s*(.+)$/m);
      const titleMatch = content.match(/^title:\s*(.+)$/m);

      const id = idMatch ? idMatch[1].trim() : '(no id)';
      const type = typeMatch ? typeMatch[1].trim() : '(no type)';
      const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');

      // Apply type filter
      if (typeFilter && type !== typeFilter) continue;

      console.log(`[${partition}] ${id.slice(0, 8)}… ${type.padEnd(12)} ${title}`);
      count++;
    }
    if (count >= limit) break;
  }

  if (count === 0) {
    console.log('No entries found');
  }
}

// --- Query Command ---

/**
 * Search entries by keyword matching against body, title, type, and metadata.
 * Uses the index for fast lookup, falls back to scanning files.
 */
async function cmdQuery(cortexDir, args) {
  const searchTerms = args.positional.slice(1).join(' ').toLowerCase();
  if (!searchTerms) {
    console.error('Usage: cortex query <search terms> [--type <type>] [--partition mind|vault] [--limit <n>]');
    process.exit(1);
  }

  const typeFilter = args.flags.type;
  const partitionFilter = args.flags.partition;
  const limit = parseInt(args.flags.limit || '10', 10);

  // Try index first
  const indexPath = join(cortexDir, 'index', 'entries.json');
  let entries = [];

  try {
    entries = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    // No index — scan files directly
    console.log('(no index found — scanning files, run sleep cycle to build index)');
    for (const partition of ['mind', 'vault']) {
      const dir = join(cortexDir, partition);
      let files;
      try {
        files = (await readdir(dir, { recursive: true })).filter(f => f.endsWith('.md'));
      } catch { continue; }
      for (const file of files) {
        try {
          const content = await readFile(join(dir, file), 'utf8');
          const { meta, body } = parseFrontmatter(content);
          entries.push({ ...meta, partition, filepath: join(partition, file), _body: body });
        } catch { /* skip */ }
      }
    }
  }

  // Apply filters
  if (typeFilter) entries = entries.filter(e => e.type === typeFilter);
  if (partitionFilter) entries = entries.filter(e => e.partition === partitionFilter);

  // Score entries by keyword relevance
  const scored = [];
  for (const entry of entries) {
    let body = entry._body;
    if (!body) {
      // Load body from file if not already loaded (index entries don't have body)
      try {
        const content = await readFile(join(cortexDir, entry.filepath), 'utf8');
        const parsed = parseFrontmatter(content);
        body = parsed.body;
      } catch { continue; }
    }

    const searchable = `${body} ${entry.type} ${entry.category || ''} ${entry.id}`.toLowerCase();
    const terms = searchTerms.split(/\s+/);
    let score = 0;

    for (const term of terms) {
      // Title match (first # heading) gets highest weight
      const titleMatch = body.match(/^#\s+(.+)/m);
      if (titleMatch && titleMatch[1].toLowerCase().includes(term)) {
        score += 10;
      }
      // Body match
      const bodyMatches = (searchable.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      score += bodyMatches;
    }

    if (score > 0) {
      scored.push({ entry, body, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit);

  if (results.length === 0) {
    console.log(`No results for "${searchTerms}"`);
    return;
  }

  console.log(`\n${results.length} result${results.length > 1 ? 's' : ''} for "${searchTerms}":\n`);

  for (const { entry, body, score } of results) {
    const title = body.match(/^#\s+(.+)/m)?.[1] || '(untitled)';
    const partition = entry.partition || (entry.category === 'concept' ? 'mind' : 'vault');
    const snippet = body.replace(/^#\s+.+\n+/, '').trim().slice(0, 120).replace(/\n/g, ' ');

    console.log(`  [${partition}] ${entry.type.padEnd(12)} ${title}`);
    console.log(`  ${snippet}${snippet.length >= 120 ? '...' : ''}`);
    console.log(`  id: ${entry.id}  score: ${score}`);
    console.log('');
  }
}

// --- Frontmatter parser for query (minimal) ---

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const raw = match[1];
  const body = match[2];
  const meta = {};
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body };
}

// --- Main ---

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const command = args.positional[0];
  const cortexDir = resolve(args.flags.cortex || process.cwd());

  if (!command || command === 'help' || command === '--help') {
    console.log(`
Cortex CLI

Commands:
  write   Write an observation to the queue
  read    Read an entry by ID
  status  Show Cortex stats
  list    List entries with filters

Usage:
  cortex write --type <type> --body <text> [--importance <0-1>] [--relates-to <id,...>] [--field key=value]
  cortex read <id>
  cortex status
  cortex list [--partition mind|vault] [--type <type>] [--limit <n>]

Options:
  --cortex <dir>   Cortex directory (default: current working directory)

Valid types (20):
  Concept: ${Object.keys(TAXONOMY).filter(k => TAXONOMY[k] === 'concept').join(', ')}
  Entity:  ${Object.keys(TAXONOMY).filter(k => TAXONOMY[k] === 'entity').join(', ')}
  Relation: ${Object.keys(TAXONOMY).filter(k => TAXONOMY[k] === 'relation').join(', ')}
`);
    process.exit(0);
  }

  // Dispatch
  try {
    switch (command) {
      case 'write':
        await cmdWrite(cortexDir, args);
        break;
      case 'read':
        await cmdRead(cortexDir, args);
        break;
      case 'status':
        await cmdStatus(cortexDir);
        break;
      case 'list':
        await cmdList(cortexDir, args);
        break;
      case 'query':
      case 'search':
        await cmdQuery(cortexDir, args);
        break;
      default:
        console.error(`Error: Unknown command "${command}"`);
        console.error('Run "cortex help" for usage');
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
