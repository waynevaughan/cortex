/**
 * Vercel serverless function: GET /api/graph
 * Returns the full knowledge graph JSON.
 */

import { build } from '../src/graph/builder.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = join(__dirname, '..', 'vault');

let cachedGraph = null;

export default async function handler(req, res) {
  try {
    if (!cachedGraph) {
      cachedGraph = await build([vaultRoot]);
    }
    res.status(200).json(cachedGraph);
  } catch (error) {
    console.error('Graph build error:', error);
    res.status(500).json({ error: error.message });
  }
}
