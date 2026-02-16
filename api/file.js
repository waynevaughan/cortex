/**
 * Vercel serverless function: GET /api/file?path=<relative-path>
 * Returns raw markdown content from the vault.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = resolve(__dirname, '..', 'vault');

/** Validate path is within vault root — no traversal */
function safePath(requested) {
  const resolved = resolve(vaultRoot, requested);
  if (!resolved.startsWith(vaultRoot + '/') && resolved !== vaultRoot) {
    return null;
  }
  return resolved;
}

export default async function handler(req, res) {
  const filePath = req.query.path;
  
  if (!filePath) {
    return res.status(400).json({ error: 'Missing path param' });
  }

  const safe = safePath(filePath);
  if (!safe) {
    return res.status(403).json({ error: 'Invalid path' });
  }

  try {
    const content = await readFile(safe, 'utf-8');
    res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send(content);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
}
