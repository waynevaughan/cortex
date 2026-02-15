#!/usr/bin/env node

/**
 * CLI entry point for the Cortex graph builder.
 *
 * Usage:
 *   cortex-graph build <vault-root> [--output graph.json]
 *   cortex-graph rebuild <vault-root> [--graph graph.json]
 *   cortex-graph query <node-id> [--hops 1|2] [--graph graph.json]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, rebuild } from './builder.js';
import { neighbors, getNode } from './query.js';

const args = process.argv.slice(2);
const command = args[0];

/**
 * Parse --flag value pairs from args.
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

async function main() {
  if (!command) {
    console.error('Usage: cortex-graph <build|rebuild|query> [args]');
    process.exit(1);
  }

  const flags = parseFlags(args.slice(1));
  // Positional arg (first non-flag after command)
  const positional = args.slice(1).find(a => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') === false) || args[1];

  switch (command) {
    case 'build': {
      const vaultRoot = positional;
      if (!vaultRoot) {
        console.error('Usage: cortex-graph build <vault-root> [--output graph.json]');
        process.exit(1);
      }
      const output = flags.output || 'graph.json';
      const roots = [resolve(vaultRoot)];
      console.log(`Building graph from: ${roots.join(', ')}`);
      const graph = await build(roots);
      await writeFile(resolve(output), JSON.stringify(graph, null, 2));
      console.log(`Graph written to ${output}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      break;
    }

    case 'rebuild': {
      const vaultRoot = positional;
      if (!vaultRoot) {
        console.error('Usage: cortex-graph rebuild <vault-root> [--graph graph.json]');
        process.exit(1);
      }
      const graphPath = flags.graph || 'graph.json';
      let existingGraph;
      try {
        existingGraph = JSON.parse(await readFile(resolve(graphPath), 'utf-8'));
      } catch {
        console.error(`Could not read existing graph at ${graphPath}, doing full build instead.`);
        const graph = await build([resolve(vaultRoot)]);
        await writeFile(resolve(graphPath), JSON.stringify(graph, null, 2));
        console.log(`Graph written to ${graphPath}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
        return;
      }
      const graph = await rebuild([resolve(vaultRoot)], existingGraph);
      await writeFile(resolve(graphPath), JSON.stringify(graph, null, 2));
      console.log(`Graph rebuilt: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      break;
    }

    case 'query': {
      const nodeIdArg = positional;
      if (!nodeIdArg) {
        console.error('Usage: cortex-graph query <node-id> [--hops 1|2] [--graph graph.json]');
        process.exit(1);
      }
      const graphPath = flags.graph || 'graph.json';
      const hops = parseInt(flags.hops || '1', 10);
      let graph;
      try {
        graph = JSON.parse(await readFile(resolve(graphPath), 'utf-8'));
      } catch {
        console.error(`Could not read graph at ${graphPath}`);
        process.exit(1);
      }
      const node = getNode(graph, nodeIdArg);
      if (!node) {
        console.error(`Node not found: ${nodeIdArg}`);
        process.exit(1);
      }
      const result = neighbors(graph, nodeIdArg, hops);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`[cortex-graph] Fatal: ${err.message}`);
  process.exit(1);
});
