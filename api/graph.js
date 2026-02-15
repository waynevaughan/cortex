import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/graph/builder.js';
import { checkAuth } from './_auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = join(__dirname, '..', 'vault');

let cachedGraph = null;

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    if (!cachedGraph) cachedGraph = await build([vaultRoot]);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(cachedGraph);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
