/**
 * Cortex Knowledge Graph Builder.
 *
 * Parses vault markdown documents and produces a JSON graph index
 * with typed nodes and edges. Supports full builds and incremental rebuilds.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { normalizeId, nodeId, resolveAlias, getAliases, toLabel } from './entities.js';

/**
 * Parse YAML frontmatter from a markdown string.
 * Simple parser — handles the subset used by vault docs (scalars, arrays, objects).
 * @param {string} content - Raw markdown content
 * @returns {{ frontmatter: Record<string, any>, body: string }}
 */
export function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: content };
  const yamlBlock = content.slice(4, end).trim();
  const body = content.slice(end + 4).trim();
  const frontmatter = {};

  let currentKey = null;
  let currentArray = null;

  for (const line of yamlBlock.split('\n')) {
    // Array item under current key: "  - name: val" (object) or "  - val" (scalar)
    if (/^\s+-\s+/.test(line) && currentKey) {
      const itemContent = line.replace(/^\s+-\s+/, '').trim();
      const kvMatch = itemContent.match(/^([a-z_-]+)\s*:\s*(.*)/i);
      if (!currentArray) {
        currentArray = [];
        frontmatter[currentKey] = currentArray;
      }
      if (kvMatch) {
        // Start of an object item in the array
        const obj = {};
        obj[kvMatch[1].toLowerCase()] = kvMatch[2].replace(/^["']|["']$/g, '').trim();
        currentArray.push(obj);
      } else {
        currentArray.push(itemContent.replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    // Continuation of an object item: "    type: person" (indented key under array item)
    if (/^\s{4,}[a-z_-]+\s*:/i.test(line) && currentArray?.length > 0) {
      const kvMatch = line.trim().match(/^([a-z_-]+)\s*:\s*(.*)/i);
      if (kvMatch) {
        const lastItem = currentArray[currentArray.length - 1];
        if (typeof lastItem === 'object' && lastItem !== null) {
          lastItem[kvMatch[1].toLowerCase()] = kvMatch[2].replace(/^["']|["']$/g, '').trim();
        }
      }
      continue;
    }

    // Key: value pair
    const match = line.match(/^([a-z_-]+)\s*:\s*(.*)/i);
    if (match) {
      currentKey = match[1].toLowerCase().replace(/-/g, '_');
      const rawVal = match[2].trim().replace(/^["']|["']$/g, '').trim();
      currentArray = null;

      if (rawVal === '' || rawVal === '[]') {
        // Could be a block array or empty
        frontmatter[currentKey] = rawVal === '[]' ? [] : '';
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        // Inline array: [a, b, c]
        frontmatter[currentKey] = rawVal
          .slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        frontmatter[currentKey] = rawVal;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Extract entity references from document body using rule-based Layer 1 detection.
 * @param {string} body - Markdown body (without frontmatter)
 * @returns {{ wikiLinks: string[], mentions: string[], decisionIds: string[] }}
 */
export function extractReferences(body) {
  const wikiLinks = [];
  const mentions = [];
  const decisionIds = [];

  // [[wiki-links]]
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    wikiLinks.push(m[1].trim());
  }

  // @mentions (word boundary, not email)
  for (const m of body.matchAll(/(?<![a-zA-Z0-9.])@([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    mentions.push(m[1].trim());
  }

  // D# decision IDs (e.g., D1, D#16, D#2)
  for (const m of body.matchAll(/\bD#?(\d+)\b/g)) {
    decisionIds.push(`D${m[1]}`);
  }

  return { wikiLinks, mentions, decisionIds };
}

/**
 * Recursively find all .md files under a directory.
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} Array of absolute file paths
 */
async function findMarkdownFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and archive
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...await findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Process a single markdown file and extract nodes and edges.
 * @param {string} filePath - Absolute path to the file
 * @param {string} vaultRoot - Vault root directory (for relative paths)
 * @param {string} vaultName - Vault name/identifier
 * @returns {Promise<{ nodes: Map<string, object>, edges: object[], mtime: number }>}
 */
async function processFile(filePath, vaultRoot, vaultName) {
  const nodes = new Map();
  const edges = [];

  const content = await readFile(filePath, 'utf-8');
  const fileStat = await stat(filePath);
  const relPath = relative(vaultRoot, filePath);
  const docId = nodeId('doc', `${vaultName}/${relPath}`);

  const { frontmatter, body } = parseFrontmatter(content);
  const { wikiLinks, mentions, decisionIds } = extractReferences(body);

  // Detect observation files by frontmatter fields
  const OBSERVATION_TYPES = new Set(['decision', 'preference', 'fact', 'commitment', 'milestone']);
  const isObservation = OBSERVATION_TYPES.has(frontmatter.type) &&
    frontmatter.confidence !== undefined;

  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];

  if (isObservation) {
    // Observation node — use obs:<hash> ID scheme
    const hash = basename(filePath, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const obsId = nodeId('obs', hash || normalizeId(frontmatter.title || relPath));
    nodes.set(obsId, {
      id: obsId,
      type: 'observation',
      vault: vaultName,
      label: frontmatter.title || basename(filePath, '.md'),
      aliases: [],
      tags,
      created: frontmatter.created || frontmatter.date || '',
      mentions: 0,
      confidence: parseFloat(frontmatter.confidence) || 0,
      importance: parseFloat(frontmatter.importance) || 0,
      obsType: frontmatter.type,
    });

    // Create edges from observation entities to the observation node
    const fmEntities = Array.isArray(frontmatter.entities) ? frontmatter.entities : [];
    for (const ent of fmEntities) {
      const eName = typeof ent === 'string' ? ent : ent.name;
      const eType = (typeof ent === 'object' && ent.type) || 'person';
      if (!eName) continue;
      const canonId = resolveAlias(eName);
      const entityNodeId = nodeId(eType, canonId);
      if (!nodes.has(entityNodeId)) {
        nodes.set(entityNodeId, {
          id: entityNodeId,
          type: eType,
          vault: vaultName,
          label: toLabel(canonId),
          aliases: getAliases(canonId),
          tags: [],
          created: '',
          mentions: 1,
        });
      }
      edges.push({ source: entityNodeId, target: obsId, type: 'observed_in' });
    }

    // Also process @mentions and wiki-links from the body
    for (const mention of mentions) {
      const personId = nodeId('person', resolveAlias(mention));
      if (!nodes.has(personId)) {
        nodes.set(personId, {
          id: personId,
          type: 'person',
          vault: vaultName,
          label: toLabel(resolveAlias(mention)),
          aliases: getAliases(resolveAlias(mention)),
          tags: [],
          created: '',
          mentions: 1,
        });
      }
      edges.push({ source: obsId, target: personId, type: 'about' });
    }

    return { nodes, edges, mtime: fileStat.mtimeMs };
  }

  // Document node
  nodes.set(docId, {
    id: docId,
    type: 'document',
    vault: vaultName,
    label: frontmatter.title || basename(filePath, '.md'),
    aliases: [],
    tags,
    created: frontmatter.date || '',
    mentions: 0,
  });

  // Author → person node + authored_by edge
  if (frontmatter.author) {
    const personId = nodeId('person', resolveAlias(frontmatter.author));
    if (!nodes.has(personId)) {
      nodes.set(personId, {
        id: personId,
        type: 'person',
        vault: vaultName,
        label: toLabel(resolveAlias(frontmatter.author)),
        aliases: getAliases(resolveAlias(frontmatter.author)),
        tags: [],
        created: '',
        mentions: 1,
      });
    }
    edges.push({ source: docId, target: personId, type: 'authored_by' });
  }

  // Tags → tag nodes + tagged edges
  for (const tag of tags) {
    const tagNorm = normalizeId(tag);
    const tagId = nodeId('tag', tagNorm);
    if (!nodes.has(tagId)) {
      nodes.set(tagId, {
        id: tagId,
        type: 'tag',
        vault: vaultName,
        label: tag,
        aliases: [],
        tags: [],
        created: '',
        mentions: 1,
      });
    }
    edges.push({ source: docId, target: tagId, type: 'tagged' });
  }

  // Project from frontmatter
  if (frontmatter.project) {
    const projNorm = normalizeId(frontmatter.project);
    const projId = nodeId('project', projNorm);
    if (!nodes.has(projId)) {
      nodes.set(projId, {
        id: projId,
        type: 'project',
        vault: vaultName,
        label: toLabel(projNorm),
        aliases: [],
        tags: [],
        created: '',
        mentions: 1,
      });
    }
    edges.push({ source: docId, target: projId, type: 'about' });
  }

  // Wiki-links → links_to edges (resolve to doc IDs in the same vault)
  for (const link of wikiLinks) {
    const targetDocId = nodeId('doc', `${vaultName}/${link.replace(/\.md$/, '')}.md`);
    edges.push({ source: docId, target: targetDocId, type: 'links_to' });
  }

  // @mentions → person nodes + about edges
  for (const mention of mentions) {
    const personId = nodeId('person', resolveAlias(mention));
    if (!nodes.has(personId)) {
      nodes.set(personId, {
        id: personId,
        type: 'person',
        vault: vaultName,
        label: toLabel(resolveAlias(mention)),
        aliases: getAliases(resolveAlias(mention)),
        tags: [],
        created: '',
        mentions: 1,
      });
    }
    edges.push({ source: docId, target: personId, type: 'about' });
  }

  // Decision references → decision nodes + depends_on edges
  for (const dId of decisionIds) {
    const decisionNodeId = nodeId('decision', dId);
    if (!nodes.has(decisionNodeId)) {
      nodes.set(decisionNodeId, {
        id: decisionNodeId,
        type: 'decision',
        vault: vaultName,
        label: dId,
        aliases: [],
        tags: [],
        created: '',
        mentions: 1,
      });
    }
    edges.push({ source: docId, target: decisionNodeId, type: 'depends_on' });
  }

  return { nodes, edges, mtime: fileStat.mtimeMs };
}

/**
 * Merge a file's nodes into the global node map, incrementing mention counts.
 * @param {Map<string, object>} globalNodes
 * @param {Map<string, object>} fileNodes
 */
function mergeNodes(globalNodes, fileNodes) {
  for (const [id, node] of fileNodes) {
    if (globalNodes.has(id)) {
      const existing = globalNodes.get(id);
      if (node.type !== 'document') {
        existing.mentions = (existing.mentions || 0) + (node.mentions || 0);
      }
      // Merge aliases
      for (const alias of node.aliases || []) {
        if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
      }
    } else {
      globalNodes.set(id, { ...node });
    }
  }
}

/**
 * Build a complete graph from one or more vault roots.
 * @param {string[]} vaultRoots - Array of vault root directories
 * @returns {Promise<object>} The graph JSON object
 */
export async function build(vaultRoots) {
  const globalNodes = new Map();
  const allEdges = [];
  const mtimes = {};

  for (const root of vaultRoots) {
    const vaultName = basename(root);
    const files = await findMarkdownFiles(root);

    for (const filePath of files) {
      const relPath = relative(root, filePath);
      try {
        const { nodes, edges, mtime } = await processFile(filePath, root, vaultName);
        mergeNodes(globalNodes, nodes);
        allEdges.push(...edges);
        mtimes[`${vaultName}/${relPath}`] = mtime;
      } catch (err) {
        console.error(`[cortex-graph] Error processing ${filePath}: ${err.message}`);
      }
    }
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    mtimes,
    nodes: [...globalNodes.values()],
    edges: deduplicateEdges(allEdges),
  };
}

/**
 * Incremental rebuild — only re-parse changed files, clean up ghosts.
 * @param {string[]} vaultRoots - Array of vault root directories
 * @param {object} existingGraph - Previously built graph JSON
 * @returns {Promise<object>} Updated graph JSON
 */
export async function rebuild(vaultRoots, existingGraph) {
  const oldMtimes = existingGraph.mtimes || {};
  const currentFiles = new Map(); // key → mtime

  // Discover all current files
  for (const root of vaultRoots) {
    const vaultName = basename(root);
    const files = await findMarkdownFiles(root);
    for (const filePath of files) {
      const relPath = relative(root, filePath);
      const key = `${vaultName}/${relPath}`;
      const fileStat = await stat(filePath);
      currentFiles.set(key, { mtime: fileStat.mtimeMs, filePath, root, vaultName });
    }
  }

  // Find changed and new files
  const toReparse = new Map();
  for (const [key, info] of currentFiles) {
    if (!oldMtimes[key] || oldMtimes[key] < info.mtime) {
      toReparse.set(key, info);
    }
  }

  // Find deleted files
  const deletedKeys = new Set();
  for (const key of Object.keys(oldMtimes)) {
    if (!currentFiles.has(key)) deletedKeys.add(key);
  }

  // If nothing changed, return as-is with updated timestamp
  if (toReparse.size === 0 && deletedKeys.size === 0) {
    return { ...existingGraph, builtAt: new Date().toISOString() };
  }

  // Remove nodes/edges from changed and deleted files
  const affectedDocIds = new Set();
  for (const key of [...toReparse.keys(), ...deletedKeys]) {
    const vaultName = key.split('/')[0];
    affectedDocIds.add(nodeId('doc', key));
  }

  // Keep nodes not sourced from affected docs
  let nodes = existingGraph.nodes.filter(n => !affectedDocIds.has(n.id));
  let edges = existingGraph.edges.filter(e => !affectedDocIds.has(e.source));
  const mtimes = { ...existingGraph.mtimes };

  // Remove deleted file mtimes
  for (const key of deletedKeys) {
    delete mtimes[key];
  }

  // Re-parse changed files
  const globalNodes = new Map(nodes.map(n => [n.id, n]));
  const newEdges = [...edges];

  for (const [key, info] of toReparse) {
    try {
      const { nodes: fileNodes, edges: fileEdges, mtime } = await processFile(
        info.filePath, info.root, info.vaultName
      );
      mergeNodes(globalNodes, fileNodes);
      newEdges.push(...fileEdges);
      mtimes[key] = mtime;
    } catch (err) {
      console.error(`[cortex-graph] Error processing ${key}: ${err.message}`);
    }
  }

  // Ghost node cleanup: mark entity nodes with no remaining document edges as orphaned
  const allNodes = [...globalNodes.values()];
  const dedupedEdges = deduplicateEdges(newEdges);
  const referencedEntityIds = new Set(dedupedEdges.map(e => e.target));

  for (const node of allNodes) {
    if (node.type !== 'document') {
      if (!referencedEntityIds.has(node.id)) {
        node.orphaned = true;
      } else {
        delete node.orphaned;
      }
    }
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    mtimes,
    nodes: allNodes,
    edges: dedupedEdges,
  };
}

/**
 * Convenience wrapper: load existing graph from disk and do an incremental rebuild.
 * If no existing graph is found, does a full build.
 * @param {string[]} vaultRoots - Array of vault root directories
 * @param {string} [graphPath] - Path to existing graph.json (defaults to graph.json in cwd)
 * @returns {Promise<object>} Updated graph JSON
 */
export async function buildIncremental(vaultRoots, graphPath) {
  const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
  const gp = graphPath || join(vaultRoots[0], '..', 'graph.json');
  let graph;
  try {
    const raw = await rf(gp, 'utf8');
    const existing = JSON.parse(raw);
    graph = await rebuild(vaultRoots, existing);
  } catch {
    // No existing graph — full build
    graph = await build(vaultRoots);
  }
  await wf(gp, JSON.stringify(graph, null, 2));
  return graph;
}

/**
 * Remove duplicate edges (same source, target, type).
 * @param {object[]} edges
 * @returns {object[]}
 */
function deduplicateEdges(edges) {
  const seen = new Set();
  return edges.filter(e => {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
