import { mkdir, appendFile } from 'node:fs/promises';
import { VALID_TYPES, getCategory } from '../../daemon/taxonomy.js';
import { queuePath, queueFile } from '../paths.js';

const WRITE_USAGE = `Usage: cortex write --type <type> --body <text> [options]

Required:
  --type <type>           Entry type (from taxonomy)
  --body <text>           Entry body text

Optional:
  --attribution <name>    Attribution (default: "system")
  --bucket <bucket>       ambient or explicit (default: explicit)
  --confidence <0-1>      Confidence score
  --importance <0-1>      Importance score
  --entities <json>       Entity references as JSON array
  --context <text>        Context text
  --source-quote <text>   Source quote`;

export async function writeCommand(args) {
  if (args.help) {
    console.log(WRITE_USAGE);
    return;
  }

  const type = args.type;
  const body = args.body;

  if (!type) {
    console.error('Error: --type is required');
    console.error(WRITE_USAGE);
    process.exit(1);
  }
  if (!body) {
    console.error('Error: --body is required');
    console.error(WRITE_USAGE);
    process.exit(1);
  }
  if (!VALID_TYPES.has(type)) {
    console.error(`Error: Invalid type "${type}". Valid types: ${[...VALID_TYPES].join(', ')}`);
    process.exit(1);
  }

  const bucket = args.bucket || 'explicit';
  if (bucket !== 'ambient' && bucket !== 'explicit') {
    console.error('Error: --bucket must be "ambient" or "explicit"');
    process.exit(1);
  }

  const entry = {
    timestamp: new Date().toISOString(),
    type,
    body,
    bucket,
    attribution: args.attribution || 'system',
    session_id: 'cli',
  };

  if (args.confidence !== undefined) {
    const c = parseFloat(args.confidence);
    if (isNaN(c) || c < 0 || c > 1) {
      console.error('Error: --confidence must be a number between 0 and 1');
      process.exit(1);
    }
    entry.confidence = c;
  }

  if (args.importance !== undefined) {
    const imp = parseFloat(args.importance);
    if (isNaN(imp) || imp < 0 || imp > 1) {
      console.error('Error: --importance must be a number between 0 and 1');
      process.exit(1);
    }
    entry.importance = imp;
  }

  if (args.entities) {
    try {
      entry.entities = JSON.parse(args.entities);
    } catch {
      console.error('Error: --entities must be valid JSON');
      process.exit(1);
    }
  }

  if (args.context) entry.context = args.context;
  if (args['source-quote']) entry.source_quote = args['source-quote'];

  // Create queue directory if needed
  await mkdir(queuePath(), { recursive: true });

  // Append as JSONL
  const line = JSON.stringify(entry) + '\n';
  await appendFile(queueFile(), line, 'utf-8');

  console.log(`✓ Queued ${type} entry`);
  console.log(`  Type:     ${type} (${getCategory(type)})`);
  console.log(`  Bucket:   ${bucket}`);
  console.log(`  Body:     ${body.length > 60 ? body.slice(0, 60) + '…' : body}`);
  console.log(`  Queue:    ${queueFile()}`);
}
