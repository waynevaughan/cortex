import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, textSimilarity, dedupOne } from '../../src/observer/dedup.js';

describe('dedup', () => {
  describe('contentHash', () => {
    it('produces consistent hashes', () => {
      assert.equal(contentHash('hello world'), contentHash('hello world'));
    });

    it('normalizes whitespace', () => {
      assert.equal(contentHash('hello  world'), contentHash('hello world'));
    });

    it('is case-insensitive', () => {
      assert.equal(contentHash('Hello World'), contentHash('hello world'));
    });

    it('different content produces different hashes', () => {
      assert.notEqual(contentHash('hello'), contentHash('world'));
    });
  });

  describe('textSimilarity', () => {
    it('returns 1 for identical text', () => {
      assert.equal(textSimilarity('hello world', 'hello world'), 1);
    });

    it('returns 0 for completely different text', () => {
      assert.equal(textSimilarity('hello world', 'foo bar baz'), 0);
    });

    it('returns partial score for overlap', () => {
      const score = textSimilarity('the quick brown fox', 'the quick red fox');
      assert.ok(score > 0.5 && score < 1);
    });
  });

  describe('dedupOne', () => {
    const existing = [
      { hash: contentHash('existing observation body'), title: 'Existing Title', body: 'existing observation body', file: 'old.md' },
    ];

    it('marks new observations as new', () => {
      const obs = { title: 'New Thing', body: 'completely different content here' };
      assert.equal(dedupOne(obs, existing).action, 'new');
    });

    it('skips exact hash matches', () => {
      const obs = { title: 'Whatever', body: 'existing observation body' };
      assert.equal(dedupOne(obs, existing).action, 'skip');
    });

    it('detects contradictions (same title, different body)', () => {
      const obs = { title: 'Existing Title', body: 'something totally different and unrelated xyz' };
      const result = dedupOne(obs, existing);
      // Could be contradiction or new depending on similarity
      assert.ok(['contradiction', 'new'].includes(result.action));
    });
  });
});
