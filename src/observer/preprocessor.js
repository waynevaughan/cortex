/**
 * Stage 1: Transcript Preprocessor
 *
 * Parses JSONL transcripts, summarizes tool calls, strips images,
 * scrubs credentials, preserves timestamps, and chunks large content.
 */

/** Credential patterns to scrub */
const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36,}/g,
  /xoxb-[a-zA-Z0-9\-]{20,}/g,
  /xoxp-[a-zA-Z0-9\-]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._\-]{20,}/gi,
  /AKIA[A-Z0-9]{16}/g,
  /(?:eyJ)[a-zA-Z0-9_-]{40,}\.(?:eyJ)[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{40,}/g,
  /[a-zA-Z0-9+/]{60,}={0,2}/g, // long base64 (>40 chars encoded)
];

/** Estimated tokens from character count (~4 chars/token) */
const CHARS_PER_TOKEN = 4;

/** Max tokens per chunk */
const MAX_CHUNK_TOKENS = 30000;

/** Overlap tokens between chunks */
const OVERLAP_TOKENS = 2000;

/**
 * Estimate token count from text.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / CHARS_PER_TOKEN);
}

/**
 * Scrub credentials from text.
 * @param {string} text
 * @returns {string}
 */
export function scrubCredentials(text) {
  if (!text) return text;
  let result = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Strip base64 images from content blocks.
 * @param {any} content - Message content (string or array of blocks)
 * @returns {any}
 */
function stripImages(content) {
  if (typeof content === 'string') {
    return content.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g, '[image]');
  }
  if (!Array.isArray(content)) return content;
  return content.map(block => {
    if (block.type === 'image') return { type: 'text', text: '[image]' };
    if (block.type === 'image_url') return { type: 'text', text: '[image]' };
    if (block.source?.type === 'base64') return { type: 'text', text: '[image]' };
    if (block.type === 'text' && block.text) {
      return { ...block, text: block.text.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g, '[image]') };
    }
    return block;
  });
}

/**
 * Summarize tool call content blocks.
 * @param {Array} content - Array of content blocks
 * @returns {Array}
 */
function summarizeToolCalls(content) {
  if (!Array.isArray(content)) return content;
  return content.map(block => {
    if (block.type === 'tool_use') {
      const name = block.name || 'unknown_tool';
      const inputSummary = block.input
        ? Object.keys(block.input).join(', ')
        : '';
      return { type: 'text', text: `[tool_use: ${name}(${inputSummary})]` };
    }
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map(b => b.text || '').join('')
          : '';
      const lines = text.split('\n');
      const summary = lines.length > 5
        ? `${lines.slice(0, 2).join(' ').slice(0, 100)}... (${lines.length} lines)`
        : text.slice(0, 200);
      return { type: 'text', text: `[tool_result: ${summary}]` };
    }
    return block;
  });
}

/**
 * Extract text from content (string or array of blocks).
 * @param {any} content
 * @returns {string}
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content.map(b => b.text || '').join('\n');
}

/**
 * Parse and preprocess a JSONL transcript.
 * @param {string} jsonlContent - Raw JSONL string
 * @returns {Array<{timestamp: number, role: string, text: string}>}
 */
export function preprocessTranscript(jsonlContent) {
  const lines = jsonlContent.split('\n').filter(l => l.trim());
  const messages = [];

  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }

    let content = msg.content;
    // Stage 1a: Summarize tool calls
    content = summarizeToolCalls(content);
    // Stage 1b: Strip images
    content = stripImages(content);
    // Convert to text
    let text = contentToText(content);
    // Stage 1c: Scrub credentials
    text = scrubCredentials(text);

    messages.push({
      timestamp: msg.timestamp || 0,
      role: msg.role || 'unknown',
      text,
      __openclaw: msg.__openclaw,
    });
  }

  return messages;
}

/**
 * Format preprocessed messages into a text block for the LLM.
 * @param {Array<{timestamp: number, role: string, text: string}>} messages
 * @returns {string}
 */
export function formatForExtraction(messages) {
  return messages.map(m => {
    const ts = m.timestamp ? new Date(m.timestamp).toISOString() : '?';
    return `${ts} | ${m.role} | ${m.text}`;
  }).join('\n');
}

/**
 * Chunk preprocessed messages into segments under the token limit.
 * @param {Array<{timestamp: number, role: string, text: string}>} messages
 * @returns {Array<Array<{timestamp: number, role: string, text: string}>>}
 */
export function chunkMessages(messages) {
  const fullText = formatForExtraction(messages);
  const totalTokens = estimateTokens(fullText);

  if (totalTokens <= MAX_CHUNK_TOKENS) {
    return [messages];
  }

  const chunks = [];
  let start = 0;
  const overlapMsgs = Math.max(1, Math.floor(messages.length * (OVERLAP_TOKENS / totalTokens)));

  while (start < messages.length) {
    let end = start;
    let tokenCount = 0;

    while (end < messages.length) {
      const msgTokens = estimateTokens(formatForExtraction([messages[end]]));
      if (tokenCount + msgTokens > MAX_CHUNK_TOKENS && end > start) break;
      tokenCount += msgTokens;
      end++;
    }

    chunks.push(messages.slice(start, end));
    start = Math.max(start + 1, end - overlapMsgs);
  }

  return chunks;
}

/**
 * Full preprocessing pipeline: parse JSONL → preprocess → chunk → format.
 * @param {string} jsonlContent - Raw JSONL transcript
 * @returns {string[]} Array of formatted text chunks ready for extraction
 */
export function preprocess(jsonlContent) {
  const messages = preprocessTranscript(jsonlContent);
  const chunks = chunkMessages(messages);
  return chunks.map(formatForExtraction);
}
