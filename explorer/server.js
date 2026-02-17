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

  if (url.pathname === '/api/entry') {
    const id = url.searchParams.get('id');
    const entry = entries.find(e => e.id === id);
    if (entry) json(res, entry);
    else { res.writeHead(404); res.end('Not found'); }
    return true;
  }

  return false;
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
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
  .live-dot { display: inline-block; width: 8px; height: 8px; background: var(--green); border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
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
</style>
</head>
<body>
<div class="container">
  <h1><span class="live-dot"></span>Cortex Explorer</h1>
  <p class="subtitle">Live view — reading directly from mind/ and vault/ &nbsp;·&nbsp; <span class="last-updated" id="updated"></span></p>

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
    return '<div class="entry' + (isNew ? ' entry-new' : '') + '" onclick="this.querySelector(\\'.entry-body\\').classList.toggle(\\'expanded\\')">' +
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

document.getElementById('search').addEventListener('input', () => render());
document.getElementById('partition-filter').addEventListener('change', () => render());
document.getElementById('type-filter').addEventListener('change', () => render());

load();
// Auto-refresh every 10 seconds
setInterval(load, 10000);
</script>
</body>
</html>`;

// ── Server ─────────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    if (handleAPI(url, res)) return;
  }

  serveHTML(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[cortex-explorer] Running at http://0.0.0.0:${PORT}`);
  console.log(`[cortex-explorer] Root: ${ROOT}`);
});
