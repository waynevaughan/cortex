import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontmatter, extractReferences, build, rebuild } from '../../src/graph/builder.js';

describe('parseFrontmatter', () => {
  it('parses basic frontmatter', () => {
    const content = `---
title: Test Doc
author: cole
tags:
  - type/decision
  - project/cortex
date: 2026-02-14
---
# Body here`;
    const { frontmatter, body } = parseFrontmatter(content);
    assert.equal(frontmatter.title, 'Test Doc');
    assert.equal(frontmatter.author, 'cole');
    assert.deepEqual(frontmatter.tags, ['type/decision', 'project/cortex']);
    assert.equal(frontmatter.date, '2026-02-14');
    assert.ok(body.includes('# Body here'));
  });

  it('handles inline arrays', () => {
    const content = `---
tags: [foo, bar, baz]
---
Body`;
    const { frontmatter } = parseFrontmatter(content);
    assert.deepEqual(frontmatter.tags, ['foo', 'bar', 'baz']);
  });

  it('returns empty frontmatter when none exists', () => {
    const { frontmatter, body } = parseFrontmatter('# Just a doc');
    assert.deepEqual(frontmatter, {});
    assert.ok(body.includes('Just a doc'));
  });
});

describe('extractReferences', () => {
  it('extracts wiki-links', () => {
    const { wikiLinks } = extractReferences('See [[some-doc]] and [[other]].');
    assert.deepEqual(wikiLinks, ['some-doc', 'other']);
  });

  it('extracts @mentions', () => {
    const { mentions } = extractReferences('Thanks @wayne and @cole for help.');
    assert.deepEqual(mentions, ['wayne', 'cole']);
  });

  it('does not match email-like @', () => {
    const { mentions } = extractReferences('Email user@example.com');
    assert.deepEqual(mentions, []);
  });

  it('extracts decision IDs', () => {
    const { decisionIds } = extractReferences('See D1, D#16, and D#2.');
    assert.deepEqual(decisionIds, ['D1', 'D16', 'D2']);
  });
});

describe('build (integration with real vault)', () => {
  it('builds graph from the cortex vault', async () => {
    const vaultRoot = join(import.meta.dirname, '..', '..', 'vault');
    const graph = await build([vaultRoot]);

    assert.equal(graph.version, 1);
    assert.ok(graph.builtAt);
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);

    // Should have document nodes
    const docs = graph.nodes.filter(n => n.type === 'document');
    assert.ok(docs.length > 0);

    // Should have tag nodes
    const tags = graph.nodes.filter(n => n.type === 'tag');
    assert.ok(tags.length > 0);
  });
});

describe('build (synthetic fixtures)', () => {
  const fixtureDir = join(tmpdir(), `cortex-test-${Date.now()}`);

  before(async () => {
    await mkdir(join(fixtureDir, 'sub'), { recursive: true });
    await writeFile(join(fixtureDir, 'doc1.md'), `---
title: First Doc
author: Wayne Vaughan
project: cortex
tags:
  - type/decision
date: 2026-01-01
---
# First Doc

This references [[doc2]] and mentions @cole.
Also see D#5 and D1.
`);
    await writeFile(join(fixtureDir, 'doc2.md'), `---
title: Second Doc
author: cole
tags:
  - type/spec
---
# Second Doc

Links to [[doc1]].
`);
    await writeFile(join(fixtureDir, 'sub', 'nested.md'), `---
title: Nested Doc
---
# Nested
`);
  });

  after(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('builds nodes and edges from fixtures', async () => {
    const graph = await build([fixtureDir]);

    // Document nodes
    const docs = graph.nodes.filter(n => n.type === 'document');
    assert.equal(docs.length, 3);

    // Person nodes (wayne-vaughan and cole)
    const persons = graph.nodes.filter(n => n.type === 'person');
    assert.ok(persons.some(p => p.id === 'person:wayne-vaughan'));
    assert.ok(persons.some(p => p.id === 'person:cole'));

    // Project node
    assert.ok(graph.nodes.some(n => n.id === 'project:cortex'));

    // Tag nodes
    assert.ok(graph.nodes.some(n => n.id === 'tag:type-decision'));
    assert.ok(graph.nodes.some(n => n.id === 'tag:type-spec'));

    // Decision nodes
    assert.ok(graph.nodes.some(n => n.id === 'decision:D5'));
    assert.ok(graph.nodes.some(n => n.id === 'decision:D1'));

    // Edges
    const authorEdges = graph.edges.filter(e => e.type === 'authored_by');
    assert.ok(authorEdges.length >= 2);

    const linkEdges = graph.edges.filter(e => e.type === 'links_to');
    assert.ok(linkEdges.length >= 2);

    const taggedEdges = graph.edges.filter(e => e.type === 'tagged');
    assert.ok(taggedEdges.length >= 2);
  });

  it('deduplicates edges', async () => {
    const graph = await build([fixtureDir]);
    const seen = new Set();
    for (const e of graph.edges) {
      const key = `${e.source}|${e.target}|${e.type}`;
      assert.ok(!seen.has(key), `Duplicate edge: ${key}`);
      seen.add(key);
    }
  });
});

describe('incremental rebuild', () => {
  const fixtureDir = join(tmpdir(), `cortex-rebuild-${Date.now()}`);

  before(async () => {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(join(fixtureDir, 'doc1.md'), `---
title: Doc One
author: cole
---
Content`);
    await writeFile(join(fixtureDir, 'doc2.md'), `---
title: Doc Two
---
Content`);
  });

  after(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('does not reparse unchanged files', async () => {
    const graph1 = await build([fixtureDir]);
    const graph2 = await rebuild([fixtureDir], graph1);
    assert.equal(graph2.nodes.length, graph1.nodes.length);
    assert.equal(graph2.edges.length, graph1.edges.length);
  });

  it('detects modified files', async () => {
    const graph1 = await build([fixtureDir]);

    // Modify doc1 after a small delay
    await new Promise(r => setTimeout(r, 50));
    await writeFile(join(fixtureDir, 'doc1.md'), `---
title: Doc One Updated
author: cole
tags:
  - new/tag
---
Updated content mentioning @wayne`);

    const graph2 = await rebuild([fixtureDir], graph1);
    // Should have the new tag node
    assert.ok(graph2.nodes.some(n => n.id === 'tag:new-tag'));
    // Should have wayne person node from @mention
    assert.ok(graph2.nodes.some(n => n.id === 'person:wayne-vaughan'));
  });

  it('cleans up ghost nodes from deleted files', async () => {
    const tempDir = join(tmpdir(), `cortex-ghost-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'keep.md'), `---
title: Keep
tags:
  - shared/tag
---
Content`);
    await writeFile(join(tempDir, 'delete-me.md'), `---
title: Delete Me
tags:
  - unique/tag
---
Content`);

    const graph1 = await build([tempDir]);
    assert.ok(graph1.nodes.some(n => n.id === 'tag:unique-tag'));

    // Delete the file
    await rm(join(tempDir, 'delete-me.md'));
    const graph2 = await rebuild([tempDir], graph1);

    // Document node should be gone
    const deletedDoc = graph2.nodes.find(n => n.type === 'document' && n.id.includes('delete-me'));
    assert.equal(deletedDoc, undefined);

    // Unique tag should be marked orphaned
    const orphanTag = graph2.nodes.find(n => n.id === 'tag:unique-tag');
    assert.ok(orphanTag?.orphaned, 'Orphaned entity should be marked');

    // Shared tag should NOT be orphaned
    const sharedTag = graph2.nodes.find(n => n.id === 'tag:shared-tag');
    assert.ok(!sharedTag?.orphaned);

    await rm(tempDir, { recursive: true, force: true });
  });
});
