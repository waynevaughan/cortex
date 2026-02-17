import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Set CORTEX_ROOT before imports that use it
const testRoot = join(tmpdir(), `cortex-sleep-test-${Date.now()}`);
process.env.CORTEX_ROOT = testRoot;

// Now import modules
import { effectiveImportance, parseFrontmatter, updateFrontmatterField, processDecay } from '../../src/sleep/decay.js';
import { processReinforcements } from '../../src/sleep/reinforce.js';
import { tokenize, jaccardSimilarity, processDedup } from '../../src/sleep/dedup.js';
import { rebuildIndex } from '../../src/sleep/indexer.js';
import { writeStats } from '../../src/sleep/stats.js';

function makeEntry({ id = '019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b', type = 'idea', importance = 0.8, created = '2026-01-01T00:00:00Z', lastReinforced = null, body = 'Test entry body content here.', relatesTo = null } = {}) {
  let fm = `---\nid: "${id}"\ntype: ${type}\ncategory: concept\ncreated: ${created}\nsource_hash: abc123\n\n# ---\n\ntitle: "Test"\nimportance: ${importance}\n`;
  if (lastReinforced) fm += `last_reinforced: ${lastReinforced}\n`;
  if (relatesTo) fm += `relates_to: ${relatesTo}\n`;
  fm += `---\n\n${body}\n`;
  return fm;
}

function setup() {
  rmSync(testRoot, { recursive: true, force: true });
  mkdirSync(join(testRoot, 'mind', 'idea'), { recursive: true });
  mkdirSync(join(testRoot, 'mind', 'preference'), { recursive: true });
  mkdirSync(join(testRoot, 'mind', 'decision'), { recursive: true });
  mkdirSync(join(testRoot, 'vault', 'fact'), { recursive: true });
  mkdirSync(join(testRoot, 'queue'), { recursive: true });
  mkdirSync(join(testRoot, 'index'), { recursive: true });
}

function teardown() {
  rmSync(testRoot, { recursive: true, force: true });
}

// --- Unit Tests ---

describe('effectiveImportance', () => {
  it('returns original importance at day 0', () => {
    assert.equal(effectiveImportance(0.8, 0, 0.01), 0.8);
  });

  it('decays over time', () => {
    const result = effectiveImportance(0.8, 100, 0.01);
    assert.ok(result < 0.8);
    assert.ok(result > 0);
    // 0.8 * exp(-1) ≈ 0.294
    assert.ok(Math.abs(result - 0.8 * Math.exp(-1)) < 0.001);
  });

  it('no decay with rate 0', () => {
    assert.equal(effectiveImportance(0.8, 1000, 0), 0.8);
  });
});

describe('parseFrontmatter', () => {
  it('parses fields and body', () => {
    const content = makeEntry({ importance: 0.7, body: 'Hello world' });
    const { fields, body } = parseFrontmatter(content);
    assert.equal(fields.type, 'idea');
    assert.equal(parseFloat(fields.importance), 0.7);
    assert.ok(body.includes('Hello world'));
  });
});

describe('updateFrontmatterField', () => {
  it('updates existing field', () => {
    const content = makeEntry({ importance: 0.5 });
    const updated = updateFrontmatterField(content, 'importance', '0.9');
    assert.ok(updated.includes('importance: 0.9'));
  });

  it('inserts new field', () => {
    const content = makeEntry();
    const updated = updateFrontmatterField(content, 'last_reinforced', '2026-02-17T00:00:00Z');
    assert.ok(updated.includes('last_reinforced: 2026-02-17T00:00:00Z'));
  });
});

describe('tokenize', () => {
  it('normalizes and splits', () => {
    assert.deepEqual(tokenize('Hello  World  Test'), ['hello', 'world', 'test']);
  });
});

describe('jaccardSimilarity', () => {
  it('identical sets = 1.0', () => {
    assert.equal(jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1.0);
  });

  it('disjoint sets = 0.0', () => {
    assert.equal(jaccardSimilarity(['a', 'b'], ['c', 'd']), 0.0);
  });

  it('partial overlap', () => {
    const sim = jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd']);
    // intersection=2, union=4, sim=0.5
    assert.equal(sim, 0.5);
  });
});

// --- Integration Tests ---

describe('processDecay', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('archives entry that has decayed below threshold', async () => {
    const oldDate = '2024-01-01T00:00:00Z'; // ~2 years ago
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0001.md'),
      makeEntry({ id: '019503a7-0001', type: 'idea', importance: 0.5, created: oldDate, body: 'Old idea' })
    );

    const result = await processDecay(new Date('2026-02-17T00:00:00Z'));
    assert.equal(result.archived.length, 1);
    assert.ok(existsSync(join(testRoot, 'mind', '.archived', 'idea', '019503a7-0001.md')));
    assert.ok(!existsSync(join(testRoot, 'mind', 'idea', '019503a7-0001.md')));
  });

  it('does not archive recently reinforced entry', async () => {
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0002.md'),
      makeEntry({ id: '019503a7-0002', type: 'idea', importance: 0.5, created: '2024-01-01T00:00:00Z', lastReinforced: '2026-02-16T00:00:00Z', body: 'Fresh idea' })
    );

    const result = await processDecay(new Date('2026-02-17T00:00:00Z'));
    assert.equal(result.archived.length, 0);
    assert.ok(existsSync(join(testRoot, 'mind', 'idea', '019503a7-0002.md')));
  });

  it('preferences do not decay', async () => {
    writeFileSync(
      join(testRoot, 'mind', 'preference', '019503a7-0003.md'),
      makeEntry({ id: '019503a7-0003', type: 'preference', importance: 0.4, created: '2020-01-01T00:00:00Z', body: 'Old preference' })
    );

    const result = await processDecay(new Date('2026-02-17T00:00:00Z'));
    assert.equal(result.archived.length, 0);
    assert.ok(existsSync(join(testRoot, 'mind', 'preference', '019503a7-0003.md')));
  });
});

describe('processReinforcements', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('updates last_reinforced from state.json', async () => {
    const id = '019503a7-0010';
    writeFileSync(
      join(testRoot, 'mind', 'idea', `${id}.md`),
      makeEntry({ id, type: 'idea', importance: 0.8, created: '2026-01-01T00:00:00Z', body: 'Reinforceable idea' })
    );

    writeFileSync(
      join(testRoot, 'queue', 'state.json'),
      JSON.stringify({ observationFileOffset: 0, lastRun: '2026-02-16T00:00:00Z', reinforcements: { [id]: '2026-02-17T12:00:00Z' } })
    );

    const result = await processReinforcements();
    assert.equal(result.processed.length, 1);

    const content = readFileSync(join(testRoot, 'mind', 'idea', `${id}.md`), 'utf-8');
    assert.ok(content.includes('last_reinforced: 2026-02-17T12:00:00Z'));

    const state = JSON.parse(readFileSync(join(testRoot, 'queue', 'state.json'), 'utf-8'));
    assert.deepEqual(state.reinforcements, {});
  });
});

describe('processDedup', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('archives older duplicate with high similarity', async () => {
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0020.md'),
      makeEntry({ id: '019503a7-0020', type: 'idea', importance: 0.8, body: 'the quick brown fox jumps over the lazy dog near the river' })
    );
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0021.md'),
      makeEntry({ id: '019503a7-0021', type: 'idea', importance: 0.8, body: 'the quick brown fox jumps over the lazy dog near the river' })
    );

    const result = await processDedup();
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].kept, '019503a7-0021');
    assert.equal(result.duplicates[0].archived, '019503a7-0020');
    assert.ok(existsSync(join(testRoot, 'mind', '.archived', 'idea', '019503a7-0020.md')));
  });

  it('leaves dissimilar entries alone', async () => {
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0030.md'),
      makeEntry({ id: '019503a7-0030', type: 'idea', importance: 0.8, body: 'the quick brown fox jumps over the lazy dog' })
    );
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0031.md'),
      makeEntry({ id: '019503a7-0031', type: 'idea', importance: 0.8, body: 'completely different topic about databases and SQL queries' })
    );

    const result = await processDedup();
    assert.equal(result.duplicates.length, 0);
  });
});

describe('rebuildIndex', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('generates entries.json and graph.json', async () => {
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0040.md'),
      makeEntry({ id: '019503a7-0040', type: 'idea', importance: 0.7, body: 'Index test entry' })
    );
    writeFileSync(
      join(testRoot, 'vault', 'fact', '019503a7-0041.md'),
      makeEntry({ id: '019503a7-0041', type: 'fact', importance: 0.5, body: 'A fact entry', relatesTo: '019503a7-0040' })
    );

    const result = await rebuildIndex();
    assert.equal(result.entryCount, 2);

    const entries = JSON.parse(readFileSync(join(testRoot, 'index', 'entries.json'), 'utf-8'));
    assert.equal(entries.length, 2);

    const graph = JSON.parse(readFileSync(join(testRoot, 'index', 'graph.json'), 'utf-8'));
    assert.equal(graph.nodes.length, 2);
    assert.ok(graph.edges.length > 0);
  });
});

describe('writeStats', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('writes correct stats', async () => {
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0050.md'),
      makeEntry({ id: '019503a7-0050', body: 'Stats test' })
    );

    const result = await writeStats({ archivedCount: 2, dupCount: 1 });
    assert.equal(result.stats.total, 1);
    assert.equal(result.stats.archivedThisRun, 2);
    assert.equal(result.stats.duplicatesThisRun, 1);

    const stats = JSON.parse(readFileSync(join(testRoot, 'queue', 'stats.json'), 'utf-8'));
    assert.equal(stats.total, 1);
  });
});

describe('idempotency', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('running decay twice produces same state', async () => {
    const oldDate = '2024-01-01T00:00:00Z';
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0060.md'),
      makeEntry({ id: '019503a7-0060', type: 'idea', importance: 0.5, created: oldDate, body: 'Decaying idea' })
    );
    writeFileSync(
      join(testRoot, 'mind', 'idea', '019503a7-0061.md'),
      makeEntry({ id: '019503a7-0061', type: 'idea', importance: 0.9, created: '2026-02-16T00:00:00Z', body: 'Fresh idea' })
    );

    const now = new Date('2026-02-17T00:00:00Z');
    const r1 = await processDecay(now);
    const r2 = await processDecay(now);

    // First run archives the old one, second run finds nothing to archive
    assert.equal(r1.archived.length, 1);
    assert.equal(r2.archived.length, 0);

    // State is consistent
    assert.ok(existsSync(join(testRoot, 'mind', '.archived', 'idea', '019503a7-0060.md')));
    assert.ok(existsSync(join(testRoot, 'mind', 'idea', '019503a7-0061.md')));
  });
});
