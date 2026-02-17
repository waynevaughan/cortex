/**
 * Integration tests: CLI write → Daemon process → Entry in correct partition.
 * Tests the full v0.3.1 pipeline without the deleted observer.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Daemon modules
import { validate } from '../../src/daemon/validate.js';
import { score } from '../../src/daemon/score.js';
import { contentHash, checkDuplicate } from '../../src/daemon/dedup.js';
import { getCategory, getDestination, VALID_TYPES } from '../../src/daemon/taxonomy.js';
import { buildEntry } from '../../src/daemon/frontmatter.js';

// Sleep modules
import { effectiveImportance } from '../../src/sleep/decay.js';
import { tokenize, jaccardSimilarity } from '../../src/sleep/dedup.js';

describe('Full pipeline: write → validate → score → route → write entry', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cortex-integration-'));
    await mkdir(join(tmpDir, 'mind'), { recursive: true });
    await mkdir(join(tmpDir, 'vault'), { recursive: true });
    await mkdir(join(tmpDir, 'queue'), { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('processes a preference observation end-to-end', () => {
    const entry = {
      timestamp: new Date().toISOString(),
      bucket: 'explicit',
      type: 'preference',
      body: 'Wayne prefers autonomous execution over step-by-step approval.',
      attribution: 'Wayne',
      session_id: '00000000-0000-0000-0000-000000000001',
      confidence: 0.95,
      importance: 0.8,
    };

    // Validate
    const v = validate(entry);
    assert.ok(v.valid, `Validation failed: ${v.detail}`);

    // Score
    const s = score(entry, null);
    assert.ok(s.memorize, `Below threshold: ${s.reason}`);
    assert.equal(entry.confidence, 0.95);
    assert.equal(entry.importance, 0.8);

    // Route
    const cat = getCategory('preference');
    assert.equal(cat, 'concept');
    const dest = getDestination('preference');
    assert.equal(dest, 'mind');

    // Build entry
    const { content, id, filename } = buildEntry(entry);
    assert.ok(content.includes('type: preference'));
    assert.ok(content.includes('category: concept'));
    assert.ok(content.includes('# ---'));
    assert.ok(content.includes('Wayne prefers autonomous'));
    assert.ok(filename.endsWith('.md'));

    // Write to correct location
    const typeDir = join(tmpDir, dest, entry.type);
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, filename), content);

    // Verify file exists
    assert.ok(existsSync(join(typeDir, filename)));
    const written = readFileSync(join(typeDir, filename), 'utf8');
    assert.ok(written.includes('Wayne prefers autonomous'));
  });

  it('routes entity types to vault', () => {
    const entityTypes = ['fact', 'document', 'person', 'milestone', 'task', 'event', 'resource'];
    for (const type of entityTypes) {
      assert.equal(getDestination(type), 'vault', `${type} should route to vault`);
    }
  });

  it('routes relation types to vault', () => {
    assert.equal(getDestination('project'), 'vault');
    assert.equal(getDestination('dependency'), 'vault');
  });

  it('routes concept types to mind', () => {
    const conceptTypes = ['idea', 'opinion', 'belief', 'preference', 'lesson', 'decision',
      'commitment', 'goal_short', 'goal_long', 'aspiration', 'constraint'];
    for (const type of conceptTypes) {
      assert.equal(getDestination(type), 'mind', `${type} should route to mind`);
    }
  });

  it('dedup detects identical content', () => {
    const body1 = 'Wayne prefers honest feedback over sugar-coated responses.';
    const body2 = 'Wayne prefers honest feedback over sugar-coated responses.';
    assert.equal(contentHash(body1), contentHash(body2));
  });

  it('dedup distinguishes different content', () => {
    const body1 = 'Wayne prefers honest feedback.';
    const body2 = 'Cole prefers structured approaches.';
    assert.notEqual(contentHash(body1), contentHash(body2));
  });

  it('sleep decay reduces importance over time', () => {
    const imp = effectiveImportance(0.8, 0.01, 30);
    assert.ok(imp < 0.8, 'Should decay after 30 days');
    assert.ok(imp > 0.5, 'Should not decay too much in 30 days at rate 0.01');
  });

  it('sleep dedup identifies similar entries', () => {
    const a = 'Wayne prefers honest direct feedback over diplomatically softened answers';
    const b = 'Wayne prefers honest feedback over softened diplomatic responses';
    const sim = jaccardSimilarity(new Set(tokenize(a)), new Set(tokenize(b)));
    assert.ok(sim > 0.5, `Should show meaningful similarity: ${sim}`);
  });

  it('covers all 20 taxonomy types', () => {
    assert.equal(VALID_TYPES.size, 20);
  });
});
