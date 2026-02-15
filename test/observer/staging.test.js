import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stagingFilename, formatObservation, writeToStaging, findOrphans } from '../../src/observer/staging.js';

describe('staging', () => {
  const obs = {
    type: 'decision',
    confidence: 0.85,
    importance: 0.9,
    title: 'Use Opus for extraction',
    body: 'Decided to use Opus model for observation extraction.',
    context: 'Cost vs quality tradeoff',
    source_quote: 'optimize for quality',
    entities: [{ name: 'Cortex', type: 'project' }],
  };

  describe('stagingFilename', () => {
    it('generates YYYY-MM-DD-hash.md format', () => {
      const name = stagingFilename(obs);
      assert.match(name, /^\d{4}-\d{2}-\d{2}-[a-f0-9]{8}\.md$/);
    });
  });

  describe('formatObservation', () => {
    it('produces valid YAML frontmatter', () => {
      const content = formatObservation(obs, 'session-123');
      assert.ok(content.startsWith('---'));
      assert.ok(content.includes('type: decision'));
      assert.ok(content.includes('confidence: 0.85'));
      assert.ok(content.includes('importance: 0.90'));
      assert.ok(content.includes('source_session: session-123'));
      assert.ok(content.includes('Use Opus for extraction'));
    });

    it('includes body and context', () => {
      const content = formatObservation(obs);
      assert.ok(content.includes('Decided to use Opus'));
      assert.ok(content.includes('**Context:**'));
      assert.ok(content.includes('optimize for quality'));
    });
  });

  describe('writeToStaging', () => {
    let tmpDir;

    it('writes file to staging directory', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'cortex-test-'));
      const path = await writeToStaging(obs, tmpDir, 'test-session');
      const content = await readFile(path, 'utf8');
      assert.ok(content.includes('type: decision'));
    });

    after(async () => {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    });
  });

  describe('findOrphans', () => {
    it('returns empty for non-existent directory', async () => {
      const orphans = await findOrphans('/nonexistent/path');
      assert.equal(orphans.length, 0);
    });
  });
});
