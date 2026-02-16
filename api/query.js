/**
 * Vercel serverless function: GET /api/query?node=<id>&hops=<n>
 * Returns neighborhood subgraph for a given node.
 */

import { build } from '../src/graph/builder.js';
import { neighbors } from '../src/graph/query.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = join(__dirname, '..', 'vault');

let cachedGraph = null;

async function getGraph() {
  if (!cachedGraph) {
    cachedGraph = await build([vaultRoot]);
  }
  return cachedGraph;
}

export default async function handler(req, res) {
  const nodeId = req.query.node;
  const hops = parseInt(req.query.hops || '1', 10);

  if (!nodeId) {
    return res.status(400).json({ error: 'Missing node param' });
  }

  try {
    const graph = await getGraph();
    const result = neighbors(graph, nodeId, hops);
    res.status(200).json(result);
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: error.message });
  }
}
