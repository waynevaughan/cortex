import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNode, findNodes, neighbors } from '../../src/graph/query.js';

const testGraph = {
  version: 1,
  builtAt: '2026-02-14T00:00:00Z',
  mtimes: {},
  nodes: [
    { id: 'doc:private/doc1.md', type: 'document', vault: 'private', label: 'Doc 1', aliases: [], tags: [], created: '', mentions: 0 },
    { id: 'doc:shared/doc2.md', type: 'document', vault: 'shared', label: 'Doc 2', aliases: [], tags: [], created: '', mentions: 0 },
    { id: 'person:wayne-vaughan', type: 'person', vault: 'private', label: 'Wayne Vaughan', aliases: ['wayne'], tags: [], created: '', mentions: 3 },
    { id: 'project:cortex', type: 'project', vault: 'shared', label: 'Cortex', aliases: [], tags: [], created: '', mentions: 2 },
    { id: 'tag:architecture', type: 'tag', vault: 'shared', label: 'architecture', aliases: [], tags: [], created: '', mentions: 1 },
    { id: 'decision:D1', type: 'decision', vault: 'private', label: 'D1', aliases: [], tags: [], created: '', mentions: 1 },
  ],
  edges: [
    { source: 'doc:private/doc1.md', target: 'person:wayne-vaughan', type: 'authored_by' },
    { source: 'doc:private/doc1.md', target: 'project:cortex', type: 'about' },
    { source: 'doc:private/doc1.md', target: 'decision:D1', type: 'depends_on' },
    { source: 'doc:shared/doc2.md', target: 'project:cortex', type: 'about' },
    { source: 'doc:shared/doc2.md', target: 'tag:architecture', type: 'tagged' },
    { source: 'doc:private/doc1.md', target: 'doc:shared/doc2.md', type: 'links_to' },
  ],
};

describe('getNode', () => {
  it('finds a node by ID', () => {
    const node = getNode(testGraph, 'person:wayne-vaughan');
    assert.equal(node.label, 'Wayne Vaughan');
  });

  it('returns null for missing nodes', () => {
    assert.equal(getNode(testGraph, 'person:nobody'), null);
  });

  it('filters by vault', () => {
    const node = getNode(testGraph, 'doc:private/doc1.md', { vaults: ['shared'] });
    assert.equal(node, null);
  });

  it('allows matching vault', () => {
    const node = getNode(testGraph, 'doc:shared/doc2.md', { vaults: ['shared'] });
    assert.equal(node.label, 'Doc 2');
  });
});

describe('findNodes', () => {
  it('finds all nodes without filter', () => {
    assert.equal(findNodes(testGraph).length, 6);
  });

  it('filters by node type', () => {
    const docs = findNodes(testGraph, { nodeTypes: ['document'] });
    assert.equal(docs.length, 2);
  });

  it('filters by vault', () => {
    const shared = findNodes(testGraph, { vaults: ['shared'] });
    assert.ok(shared.every(n => n.vault === 'shared'));
  });
});

describe('neighbors', () => {
  it('finds 1-hop neighbors', () => {
    const result = neighbors(testGraph, 'project:cortex', 1);
    assert.ok(result.nodes.some(n => n.id === 'doc:private/doc1.md'));
    assert.ok(result.nodes.some(n => n.id === 'doc:shared/doc2.md'));
  });

  it('finds 2-hop neighbors', () => {
    const result = neighbors(testGraph, 'project:cortex', 2);
    // 2 hops from cortex should reach wayne, D1, architecture, etc.
    assert.ok(result.nodes.some(n => n.id === 'person:wayne-vaughan'));
    assert.ok(result.nodes.some(n => n.id === 'tag:architecture'));
  });

  it('respects vault filtering', () => {
    const result = neighbors(testGraph, 'project:cortex', 2, { vaults: ['shared'] });
    // Should NOT include private vault nodes
    assert.ok(!result.nodes.some(n => n.vault === 'private'));
    assert.ok(!result.edges.some(e => e.source.includes('private') || e.target.includes('private')));
  });

  it('filters by edge type', () => {
    const result = neighbors(testGraph, 'doc:private/doc1.md', 1, { edgeTypes: ['authored_by'] });
    assert.ok(result.edges.every(e => e.type === 'authored_by'));
  });
});
