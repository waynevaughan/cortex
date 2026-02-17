#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.env.CORTEX_ROOT || resolve(import.meta.dirname, '..');
const PORT = process.env.PORT || 3000;

// ── Entry scanning ─────────────────────────────────────────────────────────────

function scanEntries(partition) {
  const base = join(ROOT, partition);
  if (!existsSync(base)) return [];
  const entries = [];

  for (const typeDir of readdirSync(base)) {
    const typePath = join(base, typeDir);
    if (!statSync(typePath).isDirectory() || typeDir.startsWith('.')) continue;

    for (const file of readdirSync(typePath)) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(typePath, file);
      const content = readFileSync(filePath, 'utf8');
      const parsed = parseFrontmatter(content);
      entries.push({
        ...parsed.meta,
        partition,
        type: typeDir,
        path: `${partition}/${typeDir}/${file}`,
        body: parsed.body,
      });
    }
  }

  return entries;
}

function parseFrontmatter(content) {
  const meta = {};
  let body = content;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const fmBlock = fmMatch[1];
    body = fmMatch[2].trim();

    const [cortexFields, appFields] = fmBlock.split('\n# ---\n');

    for (const section of [cortexFields, appFields]) {
      if (!section) continue;
      for (const line of section.split('\n')) {
        const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
        if (m) meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
      }
    }
  }

  return { meta, body };
}

function getAllEntries() {
  return [...scanEntries('mind'), ...scanEntries('vault')];
}

// ── API routes ─────────────────────────────────────────────────────────────────

function handleAPI(url, res) {
  const entries = getAllEntries();

  if (url.pathname === '/api/entries') {
    const type = url.searchParams.get('type');
    const partition = url.searchParams.get('partition');
    const q = url.searchParams.get('q');
    let filtered = entries;
    if (type) filtered = filtered.filter(e => e.type === type);
    if (partition) filtered = filtered.filter(e => e.partition === partition);
    if (q) filtered = filtered.filter(e =>
      e.body?.toLowerCase().includes(q.toLowerCase()) ||
      e.title?.toLowerCase().includes(q.toLowerCase())
    );
    json(res, filtered);
    return true;
  }

  if (url.pathname === '/api/stats') {
    const stats = {
      total: entries.length,
      byPartition: {},
      byType: {},
    };
    for (const e of entries) {
      stats.byPartition[e.partition] = (stats.byPartition[e.partition] || 0) + 1;
      stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
    }
    json(res, stats);
    return true;
  }

  if (url.pathname === '/api/graph') {
    const graph = buildGraph(entries);
    json(res, graph);
    return true;
  }

  if (url.pathname === '/api/entry') {
    const id = url.searchParams.get('id');
    const entry = entries.find(e => e.id === id);
    if (entry) json(res, entry);
    else { res.writeHead(404); res.end('Not found'); }
    return true;
  }

  return false;
}

// ── Graph builder ──────────────────────────────────────────────────────────────

function buildGraph(entries) {
  const nodes = [];
  const edges = [];
  const entityNodes = new Map(); // name → node id

  for (const e of entries) {
    // Entry node
    nodes.push({
      id: e.id || e.path,
      label: (e.title || e.body || '').slice(0, 60),
      type: e.type,
      partition: e.partition,
      category: getCat(e.type),
      importance: parseFloat(e.importance) || 0.6,
    });

    // Parse entities from frontmatter (stored as string, need to handle)
    // The body might reference people/projects via attribution
    if (e.attribution && e.attribution !== 'Cole') {
      const entityId = `person:${e.attribution.toLowerCase()}`;
      if (!entityNodes.has(entityId)) {
        entityNodes.set(entityId, {
          id: entityId,
          label: e.attribution,
          type: 'person_ref',
          partition: 'graph',
          category: 'entity',
          importance: 0.8,
        });
      }
      edges.push({ source: e.id || e.path, target: entityId, type: 'attributed_to' });
    }

    // Connect entries of same type (weak edges for clustering)
    // Connect via relates_to if present
    if (e.relates_to) {
      const ids = typeof e.relates_to === 'string' ? e.relates_to.split(',').map(s => s.trim()) : [];
      for (const rid of ids) {
        if (rid) edges.push({ source: e.id || e.path, target: rid, type: 'relates_to' });
      }
    }
  }

  // Add entity reference nodes
  for (const [, node] of entityNodes) {
    nodes.push(node);
  }

  // Connect entries that share attribution (co-occurrence)
  const byAttribution = new Map();
  for (const e of entries) {
    if (!e.attribution) continue;
    const key = e.attribution.toLowerCase();
    if (!byAttribution.has(key)) byAttribution.set(key, []);
    byAttribution.get(key).push(e.id || e.path);
  }

  return { nodes, edges };
}

function getCat(type) {
  const concepts = new Set(['idea','opinion','belief','preference','lesson','decision','commitment','goal_short','goal_long','aspiration','constraint']);
  const entities = new Set(['fact','document','person','milestone','task','event','resource']);
  if (concepts.has(type)) return 'concept';
  if (entities.has(type)) return 'entity';
  return 'relation';
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

// ── HTML ───────────────────────────────────────────────────────────────────────

function serveHTML(res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML);
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cortex Explorer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0f1a; --card: #111827; --border: #1e293b;
    --text: #e2e8f0; --muted: #94a3b8; --dim: #64748b;
    --accent: #818cf8; --green: #4ade80; --amber: #fbbf24; --rose: #fb7185;
  }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; padding-top: 72px; }
  .live-dot { display: inline-block; width: 8px; height: 8px; background: var(--green); border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
  .top-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; background: rgba(10,15,26,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 52px; }
  .nav-left { display: flex; align-items: center; }
  .nav-title { font-size: 18px; font-weight: 700; }
  .nav-links { display: flex; gap: 4px; }
  .nav-link { color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; padding: 6px 14px; border-radius: 6px; transition: all 0.2s; }
  .nav-link:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .nav-link.active { color: var(--accent); background: rgba(129,140,248,0.1); }
  .last-updated { font-size: 12px; color: var(--dim); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .stats { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; min-width: 100px; }
  .stat-value { font-size: 22px; font-weight: 700; color: var(--accent); }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }

  .controls { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
  input, select { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 14px; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  input { flex: 1; min-width: 200px; }
  .refresh-btn { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 8px 14px; color: var(--accent); font-size: 13px; cursor: pointer; transition: all 0.2s; }
  .refresh-btn:hover { border-color: var(--accent); background: rgba(129,140,248,0.1); }

  .entries { display: flex; flex-direction: column; gap: 10px; }
  .entry { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; cursor: pointer; transition: border-color 0.2s; }
  .entry:hover { border-color: var(--accent); }
  .entry-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
  .entry-type { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
  .type-concept { background: rgba(129,140,248,0.15); color: var(--accent); }
  .type-entity { background: rgba(74,222,128,0.15); color: var(--green); }
  .type-relation { background: rgba(251,191,36,0.15); color: var(--amber); }
  .entry-partition { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .entry-body { color: var(--muted); font-size: 14px; line-height: 1.6; max-height: 2.4em; overflow: hidden; transition: max-height 0.3s; }
  .entry-body.expanded { max-height: 500px; }
  .entry-meta { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: var(--dim); flex-wrap: wrap; }
  .entry-new { animation: fadeIn 0.5s ease-in; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

  .empty { text-align: center; padding: 48px; color: var(--dim); }
  .last-updated { font-size: 12px; color: var(--dim); }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: none; align-items: center; justify-content: center; }
  .modal-overlay.visible { display: flex; }
  .modal { background: var(--card); border: 1px solid var(--border); border-radius: 12px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; padding: 24px; position: relative; animation: modalIn 0.2s ease; }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  .modal-close { position: absolute; top: 12px; right: 16px; background: none; border: none; color: var(--dim); font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
  .modal-close:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .modal-type { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 12px; }
  .modal-body { font-size: 15px; line-height: 1.7; color: var(--text); white-space: pre-wrap; margin-bottom: 16px; }
  .modal-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--dim); padding-top: 12px; border-top: 1px solid var(--border); }
  .modal-field { display: flex; gap: 4px; }
  .modal-field-label { color: var(--dim); }
  .modal-field-value { color: var(--muted); }
</style>
</head>
<body>
<div class="container">
  <nav class="top-nav">
    <div class="nav-left"><span class="live-dot"></span><span class="nav-title">Cortex</span></div>
    <div class="nav-links">
      <a href="/" class="nav-link active">Entries</a>
      <a href="/graph" class="nav-link">Graph</a>
    </div>
    <span class="last-updated" id="updated"></span>
  </nav>

  <div class="stats" id="stats"></div>

  <div class="controls">
    <input type="text" id="search" placeholder="Search entries..." />
    <select id="partition-filter">
      <option value="">All partitions</option>
      <option value="mind">Mind</option>
      <option value="vault">Vault</option>
    </select>
    <select id="type-filter">
      <option value="">All types</option>
    </select>
    <button class="refresh-btn" onclick="load()">↻ Refresh</button>
  </div>

  <div class="entries" id="entries"></div>
</div>

<div class="modal-overlay" id="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div id="modal-type" class="modal-type"></div>
    <div id="modal-body" class="modal-body"></div>
    <div id="modal-meta" class="modal-meta"></div>
  </div>
</div>

<script>
const CONCEPTS = new Set(['idea','opinion','belief','preference','lesson','decision','commitment','goal_short','goal_long','aspiration','constraint']);
const ENTITIES = new Set(['fact','document','person','milestone','task','event','resource']);

function typeClass(type) {
  if (CONCEPTS.has(type)) return 'type-concept';
  if (ENTITIES.has(type)) return 'type-entity';
  return 'type-relation';
}

let allEntries = [];
let prevIds = new Set();

async function load() {
  const [statsRes, entriesRes] = await Promise.all([
    fetch('/api/stats').then(r => r.json()),
    fetch('/api/entries').then(r => r.json()),
  ]);

  const newIds = new Set(entriesRes.map(e => e.id));
  allEntries = entriesRes.sort((a, b) => (b.created || '').localeCompare(a.created || ''));

  document.getElementById('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();

  // Stats
  document.getElementById('stats').innerHTML =
    '<div class="stat"><div class="stat-value">' + statsRes.total + '</div><div class="stat-label">Total</div></div>' +
    Object.entries(statsRes.byPartition).map(([k,v]) =>
      '<div class="stat"><div class="stat-value">' + v + '</div><div class="stat-label">' + k + '</div></div>'
    ).join('') +
    Object.entries(statsRes.byType).sort((a,b) => b[1]-a[1]).map(([k,v]) =>
      '<div class="stat"><div class="stat-value">' + v + '</div><div class="stat-label">' + k + '</div></div>'
    ).join('');

  // Type filter (preserve selection)
  const tf = document.getElementById('type-filter');
  const currentType = tf.value;
  const types = [...new Set(allEntries.map(e => e.type))].sort();
  tf.innerHTML = '<option value="">All types</option>' +
    types.map(t => '<option value="' + t + '"' + (t === currentType ? ' selected' : '') + '>' + t + '</option>').join('');

  render(newIds);
  prevIds = newIds;
}

function render(newIds) {
  const q = document.getElementById('search').value.toLowerCase();
  const partition = document.getElementById('partition-filter').value;
  const type = document.getElementById('type-filter').value;

  let filtered = allEntries;
  if (partition) filtered = filtered.filter(e => e.partition === partition);
  if (type) filtered = filtered.filter(e => e.type === type);
  if (q) filtered = filtered.filter(e =>
    (e.body || '').toLowerCase().includes(q) ||
    (e.title || '').toLowerCase().includes(q)
  );

  const container = document.getElementById('entries');
  if (!filtered.length) {
    container.innerHTML = '<div class="empty">No entries found</div>';
    return;
  }

  container.innerHTML = filtered.map(e => {
    const title = e.title || e.body?.split('\\n')[0] || 'Untitled';
    const body = e.body || '';
    const isNew = newIds && !prevIds.has(e.id) && prevIds.size > 0;
    return '<div class="entry' + (isNew ? ' entry-new' : '') + '" onclick="showModal(allEntries.find(x=>x.id===\\'' + escHtml(e.id||'') + '\\'))">' +
      '<div class="entry-header">' +
        '<span class="entry-type ' + typeClass(e.type) + '">' + e.type + '</span>' +
        '<span class="entry-partition">' + e.partition + '</span>' +
      '</div>' +
      '<div class="entry-body">' + escHtml(body) + '</div>' +
      '<div class="entry-meta">' +
        (e.attribution ? '<span>by ' + escHtml(e.attribution) + '</span>' : '') +
        (e.importance ? '<span>importance: ' + e.importance + '</span>' : '') +
        (e.confidence ? '<span>confidence: ' + e.confidence + '</span>' : '') +
        (e.created ? '<span>' + e.created.replace('T', ' ').replace('Z', '') + '</span>' : '') +
        '<span>' + escHtml(e.path) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showModal(e) {
  if (!e) return;
  const tc = typeClass(e.type);
  document.getElementById('modal-type').className = 'modal-type ' + tc;
  document.getElementById('modal-type').textContent = e.type + ' · ' + e.partition;
  document.getElementById('modal-body').textContent = e.body || '';
  document.getElementById('modal-meta').innerHTML = [
    e.id ? field('id', e.id) : '',
    e.attribution ? field('by', e.attribution) : '',
    e.importance ? field('importance', e.importance) : '',
    e.confidence ? field('confidence', e.confidence) : '',
    e.created ? field('created', e.created) : '',
    e.path ? field('path', e.path) : '',
    e.session_id ? field('session', e.session_id) : '',
    e.source_hash ? field('hash', e.source_hash.slice(0,12) + '…') : '',
  ].filter(Boolean).join('');
  document.getElementById('modal-overlay').classList.add('visible');
}

function field(label, value) {
  return '<div class="modal-field"><span class="modal-field-label">' + escHtml(label) + ':</span><span class="modal-field-value">' + escHtml(String(value)) + '</span></div>';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

document.getElementById('search').addEventListener('input', () => render());
document.getElementById('partition-filter').addEventListener('change', () => render());
document.getElementById('type-filter').addEventListener('change', () => render());

load();
// Auto-refresh every 10 seconds
setInterval(load, 10000);
</script>
</body>
</html>`;

function serveGraphHTML(res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(GRAPH_HTML);
}

const GRAPH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cortex — Knowledge Graph</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0f1a; --card: #111827; --border: #1e293b;
    --text: #e2e8f0; --muted: #94a3b8; --dim: #64748b;
    --concept: #818cf8; --entity: #4ade80; --relation: #fbbf24; --ref: #fb7185;
  }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); overflow: hidden; height: 100vh; }
  canvas { display: block; margin-top: 52px; }
  .live-dot { display: inline-block; width: 8px; height: 8px; background: var(--entity); border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .top-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; background: rgba(10,15,26,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 24px; height: 52px; gap: 24px; }
  .nav-left { display: flex; align-items: center; }
  .nav-title { font-size: 18px; font-weight: 700; }
  .nav-links { display: flex; gap: 4px; }
  .nav-link { color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; padding: 6px 14px; border-radius: 6px; transition: all 0.2s; }
  .nav-link:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .nav-link.active { color: #818cf8; background: rgba(129,140,248,0.1); }
  .legend { display: flex; gap: 12px; font-size: 11px; margin-left: auto; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .tooltip { position: fixed; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; max-width: 350px; font-size: 13px; pointer-events: none; display: none; z-index: 20; }
  .tooltip-type { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .tooltip-body { color: var(--muted); line-height: 1.5; }
  .tooltip-meta { color: var(--dim); font-size: 11px; margin-top: 6px; }
  .stats-bar { position: fixed; bottom: 16px; left: 16px; font-size: 12px; color: var(--dim); z-index: 10; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: none; align-items: center; justify-content: center; }
  .modal-overlay.visible { display: flex; }
  .modal { background: #111827; border: 1px solid var(--border); border-radius: 12px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; padding: 24px; position: relative; animation: modalIn 0.2s ease; }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  .modal-close { position: absolute; top: 12px; right: 16px; background: none; border: none; color: var(--dim); font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
  .modal-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.05); }
  .modal-type { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 12px; }
  .modal-type.type-concept { background: rgba(129,140,248,0.15); color: var(--concept); }
  .modal-type.type-entity { background: rgba(74,222,128,0.15); color: var(--entity); }
  .modal-type.type-relation { background: rgba(251,191,36,0.15); color: var(--relation); }
  .modal-body { font-size: 15px; line-height: 1.7; color: #e2e8f0; white-space: pre-wrap; margin-bottom: 16px; }
  .modal-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--dim); padding-top: 12px; border-top: 1px solid var(--border); }
  .modal-field { display: flex; gap: 4px; }
  .modal-field-label { color: var(--dim); }
  .modal-field-value { color: #94a3b8; }
</style>
</head>
<body>
<nav class="top-nav">
  <div class="nav-left"><span class="live-dot"></span><span class="nav-title">Cortex</span></div>
  <div class="nav-links">
    <a href="/" class="nav-link">Entries</a>
    <a href="/graph" class="nav-link active">Graph</a>
  </div>
  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--concept)"></div>Concept</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--entity)"></div>Entity</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--relation)"></div>Relation</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--ref)"></div>Person</div>
  </div>
</nav>
<div class="tooltip" id="tooltip">
  <div class="tooltip-type" id="tt-type"></div>
  <div class="tooltip-body" id="tt-body"></div>
  <div class="tooltip-meta" id="tt-meta"></div>
</div>
<div class="stats-bar" id="stats-bar"></div>
<canvas id="canvas"></canvas>

<div class="modal-overlay" id="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div id="modal-type" class="modal-type"></div>
    <div id="modal-body" class="modal-body"></div>
    <div id="modal-meta" class="modal-meta"></div>
  </div>
</div>

<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');

let W, H, nodes = [], edges = [], dragging = null, hovering = null;
let offsetX = 0, offsetY = 0, scale = 1;
let dragStartX, dragStartY, isPanning = false;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight - 52;
}
window.addEventListener('resize', resize);
resize();

const COLORS = { concept: '#818cf8', entity: '#4ade80', relation: '#fbbf24', person_ref: '#fb7185' };

function nodeColor(n) {
  if (n.type === 'person_ref') return COLORS.person_ref;
  return COLORS[n.category] || '#94a3b8';
}

function nodeRadius(n) {
  const base = n.type === 'person_ref' ? 12 : 8;
  return base + (n.importance || 0.5) * 6;
}

async function loadGraph() {
  const data = await fetch('/api/graph').then(r => r.json());
  const oldIds = new Set(nodes.map(n => n.id));

  // Preserve positions for existing nodes
  const posMap = new Map();
  for (const n of nodes) posMap.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });

  nodes = data.nodes.map(n => {
    const old = posMap.get(n.id);
    return {
      ...n,
      x: old ? old.x : W/2 + (Math.random() - 0.5) * 300,
      y: old ? old.y : H/2 + (Math.random() - 0.5) * 300,
      vx: old ? old.vx : 0,
      vy: old ? old.vy : 0,
    };
  });
  edges = data.edges;

  document.getElementById('stats-bar').textContent =
    nodes.length + ' nodes · ' + edges.length + ' edges';
}

// Force simulation
function simulate() {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Center gravity
  for (const n of nodes) {
    n.vx += (W/2 - n.x) * 0.0005;
    n.vy += (H/2 - n.y) * 0.0005;
  }

  // Repulsion between all nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx*dx + dy*dy) || 1;
      let force = 800 / (dist * dist);
      let fx = dx / dist * force, fy = dy / dist * force;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
    }
  }

  // Attraction along edges
  for (const e of edges) {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
    if (!a || !b) continue;
    let dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.sqrt(dx*dx + dy*dy) || 1;
    let force = (dist - 120) * 0.005;
    let fx = dx / dist * force, fy = dy / dist * force;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // Category clustering — same-type nodes attract slightly
  const byType = new Map();
  for (const n of nodes) {
    if (!byType.has(n.type)) byType.set(n.type, []);
    byType.get(n.type).push(n);
  }
  for (const [, group] of byType) {
    if (group.length < 2) continue;
    let cx = 0, cy = 0;
    for (const n of group) { cx += n.x; cy += n.y; }
    cx /= group.length; cy /= group.length;
    for (const n of group) {
      n.vx += (cx - n.x) * 0.002;
      n.vy += (cy - n.y) * 0.002;
    }
  }

  // Damping and position update
  for (const n of nodes) {
    if (n === dragging) continue;
    n.vx *= 0.85;
    n.vy *= 0.85;
    n.x += n.vx;
    n.y += n.vy;
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Edges
  ctx.lineWidth = 1;
  for (const e of edges) {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
    if (!a || !b) continue;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Nodes
  for (const n of nodes) {
    const r = nodeRadius(n);
    const color = nodeColor(n);
    const isHover = hovering === n;

    // Glow
    if (isHover) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
    }

    ctx.fillStyle = color;
    ctx.globalAlpha = isHover ? 1 : 0.8;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = '#e2e8f0';
    ctx.font = (isHover ? 'bold ' : '') + '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = n.label.length > 30 ? n.label.slice(0, 30) + '…' : n.label;
    ctx.fillText(label, n.x, n.y + r + 14);
  }

  ctx.restore();
}

function getNodeAt(mx, my) {
  const x = (mx - offsetX) / scale;
  const y = (my - offsetY) / scale;
  for (const n of nodes) {
    const r = nodeRadius(n) + 12;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 < r * r) return n;
  }
  return null;
}

canvas.addEventListener('mousemove', (e) => {
  const n = getNodeAt(e.clientX, e.clientY);
  hovering = n;
  canvas.style.cursor = n ? 'pointer' : (isPanning ? 'grabbing' : 'default');

  if (n) {
    document.getElementById('tt-type').textContent = n.type + ' · ' + n.category + ' · ' + n.partition;
    document.getElementById('tt-body').textContent = n.label;
    document.getElementById('tt-meta').textContent = 'importance: ' + (n.importance || '?');
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 16) + 'px';
    tooltip.style.top = (e.clientY + 16) + 'px';
  } else {
    tooltip.style.display = 'none';
  }

  if (dragging) {
    dragging.x = (e.clientX - offsetX) / scale;
    dragging.y = (e.clientY - offsetY) / scale;
    dragging.vx = 0;
    dragging.vy = 0;
  } else if (isPanning) {
    offsetX += e.clientX - dragStartX;
    offsetY += e.clientY - dragStartY;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }
});

let dragDist = 0, mouseDownX = 0, mouseDownY = 0;
canvas.addEventListener('mousedown', (e) => {
  dragDist = 0;
  mouseDownX = e.clientX;
  mouseDownY = e.clientY;
  const n = getNodeAt(e.clientX, e.clientY);
  if (n) {
    dragging = n;
  } else {
    isPanning = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mouseup', (e) => {
  dragDist = Math.abs(e.clientX - mouseDownX) + Math.abs(e.clientY - mouseDownY);
  if (dragging && dragDist < 6) {
    openNodeModal(dragging);
  }
  dragging = null;
  isPanning = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoom = e.deltaY > 0 ? 0.9 : 1.1;
  const mx = e.clientX, my = e.clientY;
  offsetX = mx - (mx - offsetX) * zoom;
  offsetY = my - (my - offsetY) * zoom;
  scale *= zoom;
}, { passive: false });

function loop() {
  simulate();
  draw();
  requestAnimationFrame(loop);
}

async function openNodeModal(n) {
  if (!n || !n.id) return;
  // Person refs don't have full entries
  if (n.type === 'person_ref') {
    document.getElementById('modal-type').className = 'modal-type type-entity';
    document.getElementById('modal-type').textContent = 'person reference';
    document.getElementById('modal-body').textContent = n.label;
    document.getElementById('modal-meta').innerHTML = '<div class="modal-field"><span class="modal-field-label">id:</span><span class="modal-field-value">' + esc(n.id) + '</span></div>';
    document.getElementById('modal-overlay').classList.add('visible');
    return;
  }
  try {
    const entry = await fetch('/api/entry?id=' + encodeURIComponent(n.id)).then(r => r.ok ? r.json() : null);
    if (!entry) return;
    const catClass = n.category === 'concept' ? 'type-concept' : n.category === 'entity' ? 'type-entity' : 'type-relation';
    document.getElementById('modal-type').className = 'modal-type ' + catClass;
    document.getElementById('modal-type').textContent = (entry.type || n.type) + ' · ' + (entry.partition || n.partition);
    document.getElementById('modal-body').textContent = entry.body || n.label;
    document.getElementById('modal-meta').innerHTML = [
      entry.id ? fld('id', entry.id) : '',
      entry.attribution ? fld('by', entry.attribution) : '',
      entry.importance ? fld('importance', entry.importance) : '',
      entry.confidence ? fld('confidence', entry.confidence) : '',
      entry.created ? fld('created', entry.created) : '',
      entry.path ? fld('path', entry.path) : '',
    ].filter(Boolean).join('');
    document.getElementById('modal-overlay').classList.add('visible');
  } catch(e) { console.error(e); }
}

function fld(label, value) {
  return '<div class="modal-field"><span class="modal-field-label">' + esc(label) + ':</span><span class="modal-field-value">' + esc(String(value)) + '</span></div>';
}

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

loadGraph().then(loop);
setInterval(loadGraph, 15000);
</script>
</body>
</html>`;

// ── Server ─────────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    if (handleAPI(url, res)) return;
  }

  if (url.pathname === '/graph') {
    serveGraphHTML(res);
    return;
  }

  serveHTML(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[cortex-explorer] Running at http://0.0.0.0:${PORT}`);
  console.log(`[cortex-explorer] Root: ${ROOT}`);
});
