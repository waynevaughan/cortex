import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, validateScores, applyThreshold } from '../../src/observer/scorer.js';

describe('scorer', () => {
  describe('clamp', () => {
    it('clamps values to [0, 1]', () => {
      assert.equal(clamp(1.5), 1);
      assert.equal(clamp(-0.5), 0);
      assert.equal(clamp(0.5), 0.5);
    });

    it('handles NaN', () => {
      assert.equal(clamp(NaN), 0.5);
      assert.equal(clamp('abc'), 0.5);
    });
  });

  describe('validateScores', () => {
    it('clamps out-of-range scores', () => {
      const obs = [{ confidence: 1.5, importance: -0.2, type: 'fact', title: 'T', body: 'B' }];
      const result = validateScores(obs);
      assert.equal(result[0].confidence, 1);
      assert.equal(result[0].importance, 0);
    });
  });

  describe('applyThreshold', () => {
    it('discards observations below 0.5 importance', () => {
      const obs = [
        { importance: 0.8, title: 'Keep' },
        { importance: 0.3, title: 'Discard' },
        { importance: 0.5, title: 'Keep too' },
      ];
      const { memorized, discarded } = applyThreshold(obs);
      assert.equal(memorized.length, 2);
      assert.equal(discarded.length, 1);
      assert.equal(discarded[0].title, 'Discard');
    });
  });
});
