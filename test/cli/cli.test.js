import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../../src/cli/index.js', import.meta.url));

let tmpDir;

async function runCLI(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI, ...args], {
      env: { ...process.env, CORTEX_ROOT: tmpDir, ...env },
      timeout: 10000,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.code || 1 };
  }
}

describe('cortex write', () => {
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'cortex-test-')); });
  after(async () => { await rm(tmpDir, { recursive: true }); });

  it('writes a valid entry to queue', async () => {
    const { stdout, code } = await runCLI(['write', '--type', 'fact', '--body', 'SQLite is used for storage']);
    assert.equal(code, 0);
    assert.match(stdout, /Queued fact entry/);

    const queueContent = await readFile(join(tmpDir, 'queue', 'observations.jsonl'), 'utf-8');
    const lines = queueContent.trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.equal(entry.type, 'fact');
    assert.equal(entry.body, 'SQLite is used for storage');
    assert.equal(entry.bucket, 'explicit');
    assert.equal(entry.session_id, 'cli');
    assert.ok(entry.timestamp);
  });

  it('rejects invalid type', async () => {
    const { stderr, code } = await runCLI(['write', '--type', 'bogus', '--body', 'test']);
    assert.notEqual(code, 0);
    assert.match(stderr, /Invalid type/);
  });

  it('requires --type', async () => {
    const { stderr, code } = await runCLI(['write', '--body', 'test']);
    assert.notEqual(code, 0);
    assert.match(stderr, /--type is required/);
  });

  it('requires --body', async () => {
    const { stderr, code } = await runCLI(['write', '--type', 'fact']);
    assert.notEqual(code, 0);
    assert.match(stderr, /--body is required/);
  });

  it('writes valid JSONL (parseable JSON per line)', async () => {
    await runCLI(['write', '--type', 'decision', '--body', 'Use Postgres']);
    await runCLI(['write', '--type', 'preference', '--body', 'Prefer simplicity']);
    const content = await readFile(join(tmpDir, 'queue', 'observations.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    assert.ok(lines.length >= 2);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });

  it('accepts optional flags', async () => {
    const { code } = await runCLI([
      'write', '--type', 'belief', '--body', 'Data is the moat',
      '--attribution', 'Wayne', '--bucket', 'ambient',
      '--confidence', '0.9', '--importance', '0.8',
      '--context', 'strategy discussion',
    ]);
    assert.equal(code, 0);
    const content = await readFile(join(tmpDir, 'queue', 'observations.jsonl'), 'utf-8');
    const last = JSON.parse(content.trim().split('\n').pop());
    assert.equal(last.attribution, 'Wayne');
    assert.equal(last.bucket, 'ambient');
    assert.equal(last.confidence, 0.9);
    assert.equal(last.importance, 0.8);
    assert.equal(last.context, 'strategy discussion');
  });
});

describe('cortex read', () => {
  let readDir;
  const testId = '019502a0-0000-7000-8000-000000000001';

  before(async () => {
    readDir = await mkdtemp(join(tmpdir(), 'cortex-read-'));
    // Create a mind/decision entry
    await mkdir(join(readDir, 'mind', 'decision'), { recursive: true });
    await writeFile(join(readDir, 'mind', 'decision', `${testId}.md`), `---
id: "${testId}"
type: decision
category: concept
created: 2026-02-17T00:00:00.000Z
source_hash: abc123
---

Use SQLite for storage.
`);
  });
  after(async () => { await rm(readDir, { recursive: true }); });

  it('reads an existing entry', async () => {
    const { stdout, code } = await runCLI(['read', testId], { CORTEX_ROOT: readDir });
    assert.equal(code, 0);
    assert.match(stdout, /Use SQLite for storage/);
    assert.match(stdout, /mind\/decision/);
  });

  it('errors on non-existent ID', async () => {
    const { stderr, code } = await runCLI(['read', '019502a0-0000-7000-8000-999999999999'], { CORTEX_ROOT: readDir });
    assert.notEqual(code, 0);
    assert.match(stderr, /not found/);
  });
});

describe('cortex query', () => {
  let queryDir;

  before(async () => {
    queryDir = await mkdtemp(join(tmpdir(), 'cortex-query-'));
    await mkdir(join(queryDir, 'vault', 'fact'), { recursive: true });
    await mkdir(join(queryDir, 'mind', 'preference'), { recursive: true });

    await writeFile(join(queryDir, 'vault', 'fact', '019502a0-0001-7000-8000-000000000001.md'), `---
id: "019502a0-0001-7000-8000-000000000001"
type: fact
---

SQLite is the database engine.
`);
    await writeFile(join(queryDir, 'mind', 'preference', '019502a0-0002-7000-8000-000000000002.md'), `---
id: "019502a0-0002-7000-8000-000000000002"
type: preference
---

Prefer PostgreSQL over MySQL.
`);
  });
  after(async () => { await rm(queryDir, { recursive: true }); });

  it('finds matching entries', async () => {
    const { stdout, code } = await runCLI(['query', 'SQLite'], { CORTEX_ROOT: queryDir });
    assert.equal(code, 0);
    assert.match(stdout, /1 match/);
    assert.match(stdout, /fact/);
  });

  it('case-insensitive search', async () => {
    const { stdout, code } = await runCLI(['query', 'sqlite'], { CORTEX_ROOT: queryDir });
    assert.equal(code, 0);
    assert.match(stdout, /1 match/);
  });

  it('filters by type', async () => {
    const { stdout, code } = await runCLI(['query', 'SQL', '--type', 'preference'], { CORTEX_ROOT: queryDir });
    assert.equal(code, 0);
    // Should only find PostgreSQL preference, not SQLite fact
    assert.match(stdout, /1 match/);
    assert.match(stdout, /preference/);
  });

  it('reports no results', async () => {
    const { stdout, code } = await runCLI(['query', 'nonexistent'], { CORTEX_ROOT: queryDir });
    assert.equal(code, 0);
    assert.match(stdout, /No entries matching/);
  });
});

describe('cortex list', () => {
  let listDir;

  before(async () => {
    listDir = await mkdtemp(join(tmpdir(), 'cortex-list-'));
    await mkdir(join(listDir, 'vault', 'fact'), { recursive: true });
    await mkdir(join(listDir, 'mind', 'decision'), { recursive: true });

    for (let i = 1; i <= 5; i++) {
      const id = `019502a0-000${i}-7000-8000-000000000001`;
      await writeFile(join(listDir, 'vault', 'fact', `${id}.md`), `---\nid: "${id}"\ntype: fact\n---\n\nFact number ${i}.\n`);
    }
    await writeFile(join(listDir, 'mind', 'decision', '019502a0-0006-7000-8000-000000000001.md'),
      `---\nid: "019502a0-0006-7000-8000-000000000001"\ntype: decision\n---\n\nDecided something.\n`);
  });
  after(async () => { await rm(listDir, { recursive: true }); });

  it('lists entries (default)', async () => {
    const { stdout, code } = await runCLI(['list'], { CORTEX_ROOT: listDir });
    assert.equal(code, 0);
    assert.match(stdout, /6 of 6/);
  });

  it('filters by type', async () => {
    const { stdout, code } = await runCLI(['list', '--type', 'fact'], { CORTEX_ROOT: listDir });
    assert.equal(code, 0);
    assert.match(stdout, /5 of 5/);
  });

  it('respects --limit', async () => {
    const { stdout, code } = await runCLI(['list', '--limit', '2'], { CORTEX_ROOT: listDir });
    assert.equal(code, 0);
    assert.match(stdout, /2 of 6/);
  });
});

describe('cortex status', () => {
  let statusDir;

  before(async () => {
    statusDir = await mkdtemp(join(tmpdir(), 'cortex-status-'));
    await mkdir(join(statusDir, 'vault', 'fact'), { recursive: true });
    await mkdir(join(statusDir, 'mind', 'preference'), { recursive: true });
    await writeFile(join(statusDir, 'vault', 'fact', '019502a0-0001-7000-8000-000000000001.md'), '---\ntype: fact\n---\nHello\n');
    await writeFile(join(statusDir, 'mind', 'preference', '019502a0-0002-7000-8000-000000000002.md'), '---\ntype: preference\n---\nWorld\n');
  });
  after(async () => { await rm(statusDir, { recursive: true }); });

  it('shows status output', async () => {
    const { stdout, code } = await runCLI(['status'], { CORTEX_ROOT: statusDir });
    assert.equal(code, 0);
    assert.match(stdout, /Cortex Status/);
    assert.match(stdout, /Entries: 2 total/);
    assert.match(stdout, /Mind:\s+1/);
    assert.match(stdout, /Vault:\s+1/);
    assert.match(stdout, /fact: 1/);
    assert.match(stdout, /preference: 1/);
  });
});
