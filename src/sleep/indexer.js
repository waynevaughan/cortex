import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cortexRoot } from '../cli/paths.js';
import { scanEntries, readEntryContent, getFirstLine } from '../cli/entries.js';
import { parseFrontmatter } from './decay.js';

/**
 * Rebuild index/entries.json and index/graph.json.
 * Returns { entryCount: number, nodeCount: number, edgeCount: number, log: string[] }
 */
export async function rebuildIndex() {
  const log = [];
  const indexDir = resolve(cortexRoot(), 'index');
  await mkdir(indexDir, { recursive: true });

  const allEntries = await scanEntries();
  const entriesIndex = [];
  const nodes = [];
  const edges = [];

  for (const entry of allEntries) {
    let content;
    try {
      content = await readEntryContent(entry.path);
    } catch {
      log.push(`[index] Failed to read ${entry.path}`);
      continue;
    }

    const { fields } = parseFrontmatter(content);
    const firstLine = getFirstLine(content);

    entriesIndex.push({
      id: entry.id,
      type: entry.type,
      category: entry.category,
      created: fields.created || null,
      path: entry.path,
      title: fields.title || firstLine,
      importance: fields.importance ? parseFloat(fields.importance) : null,
    });

    nodes.push({
      id: entry.id,
      type: entry.type,
      category: entry.category,
      title: fields.title || firstLine,
      path: entry.path,
      created: fields.created || null,
    });

    // Parse relates_to for edges
    if (fields.relates_to) {
      const targets = fields.relates_to.split(',').map(s => s.trim()).filter(Boolean);
      for (const target of targets) {
        edges.push({ from: entry.id, to: target, type: 'relates_to' });
        edges.push({ from: target, to: entry.id, type: 'relates_to' }); // bidirectional
      }
    }
  }

  await writeFile(resolve(indexDir, 'entries.json'), JSON.stringify(entriesIndex, null, 2) + '\n', 'utf-8');
  await writeFile(resolve(indexDir, 'graph.json'), JSON.stringify({ nodes, edges }, null, 2) + '\n', 'utf-8');

  log.push(`[index] Rebuilt: ${entriesIndex.length} entries, ${nodes.length} nodes, ${edges.length} edges`);
  return { entryCount: entriesIndex.length, nodeCount: nodes.length, edgeCount: edges.length, log };
}
