/**
 * Integration tests: Observer → Staging → Promotion → Graph rebuild pipeline.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { formatObservation, writeToStaging } from '../../src/observer/staging.js';
import { parseFrontmatter, build, rebuild, buildIncremental } from '../../src/graph/builder.js';
import { resolveAlias, nodeId, normalizeId } from '../../src/graph/entities.js';

describe('staging file format compatibility', () => {
  it('graph builder can parse observation staging files', () => {
    const obs = {
      type: 'preference',
      confidence: 0.85,
      importance: 0.70,
      title: 'Wayne prefers simple solutions',
      body: 'Wayne consistently asks for the simplest approach.',
      entities: [
        { name: 'Wayne', type: 'person' },
        { name: 'cortex', type: 'project' },
      ],
    };

    const content = formatObservation(obs, 'test-session');
    const { frontmatter, body } = parseFrontmatter(content);

    assert.equal(frontmatter.type, 'preference');
    assert.equal(frontmatter.confidence, '0.85');
    assert.equal(frontmatter.importance, '0.70');
    assert.equal(frontmatter.title, 'Wayne prefers simple solutions');
    assert.ok(body.includes('Wayne consistently asks'));

    // Entities should be parsed as array of objects
    assert.ok(Array.isArray(frontmatter.entities), 'entities should be an array');
    assert.equal(frontmatter.entities.length, 2);
    assert.equal(frontmatter.entities[0].name, 'wayne-vaughan'); // canonicalized
    assert.equal(frontmatter.entities[0].type, 'person');
    assert.equal(frontmatter.entities[1].name, 'cortex');
    assert.equal(frontmatter.entities[1].type, 'project');
  });
});

describe('entity canonicalization consistency', () => {
  it('observer entities resolve to same IDs as graph entities', () => {
    // The observer staging now uses resolveAlias from graph/entities.js
    const testCases = [
      { raw: 'Wayne', expectedCanon: 'wayne-vaughan' },
      { raw: 'wayne vaughan', expectedCanon: 'wayne-vaughan' },
      { raw: '@waynevaughan', expectedCanon: 'wayne-vaughan' },
      { raw: 'Cole', expectedCanon: 'cole' },
      { raw: 'SomeNewPerson', expectedCanon: 'somenewperson' },
    ];

    for (const { raw, expectedCanon } of testCases) {
      const canon = resolveAlias(raw);
      assert.equal(canon, expectedCanon, `resolveAlias("${raw}") should be "${expectedCanon}"`);
      // nodeId should produce consistent typed IDs
      assert.equal(nodeId('person', canon), `person:${expectedCanon}`);
    }
  });
});

describe('full pipeline: staging → vault → graph', () => {
  let tmpDir;
  let vaultDir;
  let stagingDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cortex-integration-'));
    vaultDir = join(tmpDir, 'vault');
    stagingDir = join(tmpDir, 'staging');
    await mkdir(join(vaultDir, 'observations'), { recursive: true });
    await mkdir(stagingDir, { recursive: true });

    // Create a regular vault doc for the graph to parse
    await writeFile(join(vaultDir, 'readme.md'), `---
title: "Test Project"
author: Wayne
project: cortex
tags: [test]
---

This is a test document about @Cole.
`);
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('stages an observation, simulates memorization, and rebuilds graph with observation node', async () => {
    // Stage an observation
    const obs = {
      type: 'decision',
      confidence: 0.92,
      importance: 0.88,
      title: 'Use ESM for all modules',
      body: 'Decided to use ESM imports exclusively.',
      entities: [
        { name: 'Wayne', type: 'person' },
        { name: 'cortex', type: 'project' },
      ],
    };

    const stagedPath = await writeToStaging(obs, stagingDir, 'test-session');
    assert.ok(stagedPath.endsWith('.md'));

    // Simulate memorization: copy staging file to vault/observations/
    const stagedContent = await readFile(stagedPath, 'utf8');
    const filename = stagedPath.split('/').pop();
    const destPath = join(vaultDir, 'observations', filename);
    await writeFile(destPath, stagedContent);

    // Full build — should include both the doc and the observation
    const graph = await build([vaultDir]);

    // Verify regular document node exists
    const docNodes = graph.nodes.filter(n => n.type === 'document');
    assert.ok(docNodes.length >= 1, 'Should have at least 1 document node');

    // Verify observation node exists
    const obsNodes = graph.nodes.filter(n => n.type === 'observation');
    assert.equal(obsNodes.length, 1, 'Should have exactly 1 observation node');
    assert.equal(obsNodes[0].label, 'Use ESM for all modules');
    assert.ok(obsNodes[0].id.startsWith('obs:'), `Obs ID should start with obs:, got ${obsNodes[0].id}`);
    assert.equal(obsNodes[0].confidence, 0.92);
    assert.equal(obsNodes[0].importance, 0.88);
    assert.equal(obsNodes[0].obsType, 'decision');

    // Verify entity edges connect to observation
    const obsEdges = graph.edges.filter(
      e => e.target === obsNodes[0].id || e.source === obsNodes[0].id
    );
    assert.ok(obsEdges.length >= 1, 'Observation should have entity edges');

    // Verify Wayne entity is shared between doc and observation
    const wayneNodes = graph.nodes.filter(n => n.id === 'person:wayne-vaughan');
    assert.equal(wayneNodes.length, 1, 'Wayne should be a single canonical node');
    assert.ok(wayneNodes[0].mentions >= 2, 'Wayne should be mentioned by both doc and obs');

    // Incremental rebuild: add another observation
    const obs2 = {
      type: 'fact',
      confidence: 0.75,
      importance: 0.60,
      title: 'Node v25 supports ESM natively',
      body: 'No transpilation needed for ESM on Node v25+.',
      entities: [],
    };
    const staged2 = await writeToStaging(obs2, stagingDir, 'test-session');
    const staged2Content = await readFile(staged2, 'utf8');
    const filename2 = staged2.split('/').pop();
    await writeFile(join(vaultDir, 'observations', filename2), staged2Content);

    const graph2 = await rebuild([vaultDir], graph);
    const obsNodes2 = graph2.nodes.filter(n => n.type === 'observation');
    assert.equal(obsNodes2.length, 2, 'Should have 2 observation nodes after incremental rebuild');
  });
});
