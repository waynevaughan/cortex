/**
 * Vercel serverless function: GET /api/reload
 * Rebuilds the graph cache (note: in serverless, cache is per-instance).
 */

import { build } from '../src/graph/builder.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = join(__dirname, '..', 'vault');

export default async function handler(req, res) {
  try {
    const graph = await build([vaultRoot]);
    res.status(200).json({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      note: 'Serverless cache is per-instance'
    });
  } catch (error) {
    console.error('Reload error:', error);
    res.status(500).json({ error: error.message });
  }
}
