import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/graph/builder.js';
import { neighbors } from '../src/graph/query.js';
import { checkAuth } from './_auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = join(__dirname, '..', 'vault');

let cachedGraph = null;

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  const { node, hops } = req.query;
  if (!node) return res.status(400).json({ error: 'Missing node param' });

  try {
    if (!cachedGraph) cachedGraph = await build([vaultRoot]);
    const result = neighbors(cachedGraph, node, parseInt(hops || '1', 10));
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
