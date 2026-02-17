import { uuidv7 } from './uuidv7.js';
import { getCategory } from './taxonomy.js';
import { contentHash } from './dedup.js';

/**
 * Generate a title from the body: first 80 chars, truncate at last word boundary.
 */
export function generateTitle(body) {
  if (body.length <= 80) return body;
  const truncated = body.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace === -1) return truncated + '…';
  return truncated.slice(0, lastSpace) + '…';
}

/**
 * Build the full markdown entry with frontmatter.
 * Returns { content: string, id: string, filename: string }
 */
export function buildEntry(entry) {
  const id = uuidv7();
  const category = getCategory(entry.type);
  const hash = contentHash(entry.body);
  const title = generateTitle(entry.body);

  // Cortex fields (above # ---)
  let md = '---\n';
  md += `id: "${id}"\n`;
  md += `type: ${entry.type}\n`;
  md += `category: ${category}\n`;
  md += `created: ${entry.timestamp}\n`;
  md += `source_hash: ${hash}\n`;
  md += '\n# ---\n\n';

  // Application fields (below # ---)
  md += `title: "${title}"\n`;
  md += `bucket: ${entry.bucket}\n`;
  md += `attribution: ${entry.attribution}\n`;
  md += `confidence: ${entry.confidence}\n`;
  md += `importance: ${entry.importance}\n`;

  if (entry.entities && Array.isArray(entry.entities) && entry.entities.length > 0) {
    md += 'entities:\n';
    for (const e of entry.entities) {
      md += `  - name: ${e.name}\n`;
      if (e.type) md += `    type: ${e.type}\n`;
    }
  }

  if (entry.context) {
    md += `context: "${entry.context}"\n`;
  }

  if (entry.source_quote) {
    md += `source_quote: "${entry.source_quote}"\n`;
  }

  md += `session_id: "${entry.session_id}"\n`;
  md += '---\n\n';
  md += entry.body + '\n';

  return { content: md, id, filename: `${id}.md` };
}
