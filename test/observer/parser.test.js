import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/observer/parser.js';

describe('parser', () => {
  it('parses valid JSON array', () => {
    const raw = JSON.stringify([
      { type: 'decision', confidence: 0.9, importance: 0.8, title: 'Test', body: 'Test body' },
    ]);
    const { observations, errors } = parse(raw);
    assert.equal(observations.length, 1);
    assert.equal(errors.length, 0);
  });

  it('extracts JSON from surrounding text', () => {
    const raw = 'Here are observations:\n' + JSON.stringify([
      { type: 'fact', confidence: 0.7, importance: 0.6, title: 'A', body: 'B' },
    ]) + '\nDone.';
    const { observations } = parse(raw);
    assert.equal(observations.length, 1);
  });

  it('returns error on non-JSON', () => {
    const { observations, errors } = parse('not json at all');
    assert.equal(observations.length, 0);
    assert.ok(errors.length > 0);
  });

  it('skips observations with missing required fields', () => {
    const raw = JSON.stringify([
      { type: 'fact', confidence: 0.7, importance: 0.6, title: 'Good', body: 'Good body' },
      { type: 'fact', confidence: 0.7 }, // missing title, body, importance
    ]);
    const { observations, errors } = parse(raw);
    assert.equal(observations.length, 1);
    assert.ok(errors.some(e => e.includes('missing fields')));
  });

  it('caps at 20 observations by importance', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      type: 'fact', confidence: 0.5, importance: i / 25, title: `Obs ${i}`, body: `Body ${i}`,
    }));
    const { observations, errors } = parse(JSON.stringify(items));
    assert.equal(observations.length, 20);
    assert.ok(errors.some(e => e.includes('Too many')));
    // Should be sorted by importance desc
    assert.ok(observations[0].importance >= observations[19].importance);
  });

  it('handles empty array', () => {
    const { observations, errors } = parse('[]');
    assert.equal(observations.length, 0);
    assert.equal(errors.length, 0);
  });
});
