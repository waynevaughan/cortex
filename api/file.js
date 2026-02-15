import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = resolve(join(__dirname, '..', 'vault'));

export default async function handler(req, res) {
  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path param' });

  const resolved = resolve(vaultRoot, path);
  if (!resolved.startsWith(vaultRoot + '/') && resolved !== vaultRoot) {
    return res.status(403).json({ error: 'Invalid path' });
  }

  try {
    const content = await readFile(resolved, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(content);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
}
