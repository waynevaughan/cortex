import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeId, nodeId, resolveAlias, getAliases, toLabel } from '../../src/graph/entities.js';

describe('normalizeId', () => {
  it('lowercases and hyphenates', () => {
    assert.equal(normalizeId('Wayne Vaughan'), 'wayne-vaughan');
  });

  it('strips @ prefix', () => {
    assert.equal(normalizeId('@waynevaughan'), 'waynevaughan');
  });

  it('collapses multiple hyphens', () => {
    assert.equal(normalizeId('hello   world'), 'hello-world');
  });

  it('strips leading/trailing hyphens', () => {
    assert.equal(normalizeId('-test-'), 'test');
  });

  it('returns empty for falsy input', () => {
    assert.equal(normalizeId(''), '');
    assert.equal(normalizeId(null), '');
    assert.equal(normalizeId(undefined), '');
  });
});

describe('nodeId', () => {
  it('creates typed IDs', () => {
    assert.equal(nodeId('person', 'wayne-vaughan'), 'person:wayne-vaughan');
    assert.equal(nodeId('tag', 'architecture'), 'tag:architecture');
  });
});

describe('resolveAlias', () => {
  it('resolves known aliases', () => {
    assert.equal(resolveAlias('Wayne'), 'wayne-vaughan');
    assert.equal(resolveAlias('Wayne Vaughan'), 'wayne-vaughan');
    assert.equal(resolveAlias('@waynevaughan'), 'wayne-vaughan');
  });

  it('falls back to normalizeId for unknown names', () => {
    assert.equal(resolveAlias('Jane Doe'), 'jane-doe');
  });
});

describe('getAliases', () => {
  it('returns aliases for known canonical IDs', () => {
    const aliases = getAliases('wayne-vaughan');
    assert.ok(aliases.includes('wayne'));
    assert.ok(aliases.includes('@waynevaughan'));
  });

  it('returns empty for unknown IDs', () => {
    assert.deepEqual(getAliases('nobody'), []);
  });
});

describe('toLabel', () => {
  it('capitalizes hyphenated IDs', () => {
    assert.equal(toLabel('wayne-vaughan'), 'Wayne Vaughan');
  });

  it('handles single word', () => {
    assert.equal(toLabel('cortex'), 'Cortex');
  });
});
