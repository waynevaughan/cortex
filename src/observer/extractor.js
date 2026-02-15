/**
 * Stage 2: LLM Extraction
 *
 * Calls the Anthropic Messages API directly to extract observations
 * from preprocessed transcript chunks.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_MODEL = 'claude-opus-4-6';

/** System prompt for extraction — exactly as specified in observer.md */
const SYSTEM_PROMPT = `You are a knowledge extraction system. Your job is to identify observations from
a session transcript that would change how an agent behaves in future sessions.

RULES:
1. Every observation must pass the Write Gate: "Does this change future behavior?"
   If the answer is no, do not extract it.
2. Extract the MINIMUM number of high-quality observations. Fewer is better.
   10 great observations beat 50 mediocre ones.
3. Never extract:
   - Code snippets or implementation details (those belong in files, not observations)
   - Transient state ("currently working on X" — that's in HANDOFF.md)
   - Obvious facts ("JavaScript uses callbacks")
   - Anything already captured in a prior observation (check the provided existing list)
4. Always extract:
   - Owner corrections of agent behavior (highest priority)
   - Explicit decisions with stated alternatives and rationale
   - Stated preferences about communication, process, or tools
   - Lessons learned from failures or unexpected outcomes
5. Score confidence based on how clearly the observation is stated in the transcript.
   Score importance based on how broadly it affects future behavior.

OBSERVATION TYPES:
- decision: A choice was made between alternatives
- preference: A stated preference for how something should be done
- fact: A concrete fact relevant to future work
- commitment: A promise to do something by a specific time
- milestone: A significant achievement or completion
- lesson: Something learned from experience or failure
- relationship: A connection between people, projects, or concepts
- project: Project-level state, status, or direction

SCORING SIGNALS:
- Imperative language ("always", "never", "must"): confidence +0.1, importance +0.15
- Owner correction of agent behavior: confidence +0.15, importance +0.2
- Explicit decision with alternatives: confidence +0.2, importance +0.1
- Repeated across sessions: confidence +0.1, importance +0.1 (per occurrence)
- Emotional emphasis ("critical", "hate", "love"): confidence +0.05, importance +0.1
- Contradiction of prior observation: confidence +0.1, importance +0.15
- Casual/offhand mention: confidence -0.1, importance -0.1

Base scores: confidence 0.5, importance 0.3. Clamp to [0.0, 1.0].

OUTPUT FORMAT:
Return a JSON array of observations. Each observation is an object:

{
  "type": "<observation_type>",
  "confidence": <float>,
  "importance": <float>,
  "title": "<concise title for search/display>",
  "body": "<the observation text, 1-3 sentences>",
  "context": "<optional: additional detail for retrieval>",
  "entities": [{"name": "<entity>", "type": "<person|project|tag>"}],
  "source_quote": "<brief quote from transcript that supports this observation>"
}

Return ONLY the JSON array. No preamble, no commentary.
If there are no observations worth extracting, return an empty array: []`;

/**
 * Load the last N vault observations for dedup context.
 * @param {string} vaultDir - Vault root directory
 * @param {number} [limit=50] - Max observations to load
 * @returns {Promise<string>} Formatted observation list
 */
export async function loadVaultContext(vaultDir, limit = 50) {
  try {
    const obsDir = join(vaultDir, 'observations');
    const files = await readdir(obsDir).catch(() => []);
    const sorted = files.filter(f => f.endsWith('.md')).sort().reverse().slice(0, limit);
    const observations = [];

    for (const file of sorted) {
      const content = await readFile(join(obsDir, file), 'utf8');
      // Extract title and body from frontmatter/content
      const titleMatch = content.match(/^title:\s*(.+)$/m);
      const bodyMatch = content.match(/^body:\s*(.+)$/m) || content.match(/\n---\n([\s\S]*)/);
      if (titleMatch) {
        observations.push(`- ${titleMatch[1]}: ${bodyMatch?.[1]?.trim().slice(0, 200) || ''}`);
      }
    }

    return observations.join('\n');
  } catch {
    return '';
  }
}

/**
 * Load calibration rules if they exist.
 * @param {string} baseDir - Base directory containing observer/calibration.yml
 * @returns {Promise<string>} Calibration content or empty string
 */
export async function loadCalibration(baseDir) {
  try {
    const content = await readFile(join(baseDir, 'observer', 'calibration.yml'), 'utf8');
    if (content.length > 4096) {
      console.warn('[observer] calibration.yml exceeds 4KB, ignoring');
      return '';
    }
    return content;
  } catch {
    return '';
  }
}

/**
 * Build the user message for extraction.
 * @param {string} transcriptChunk - Preprocessed transcript text
 * @param {string} existingObservations - Formatted existing observations
 * @param {string} calibration - Calibration rules or empty
 * @returns {string}
 */
export function buildUserMessage(transcriptChunk, existingObservations, calibration) {
  let msg = '';
  if (existingObservations) {
    msg += `EXISTING OBSERVATIONS (do not duplicate):\n${existingObservations}\n\n`;
  }
  if (calibration) {
    msg += `CALIBRATION RULES:\n${calibration}\n\n`;
  }
  msg += `TRANSCRIPT SEGMENT:\n${transcriptChunk}`;
  return msg;
}

/**
 * Call the Anthropic Messages API for extraction.
 * @param {string} transcriptChunk - Preprocessed transcript text
 * @param {Object} options
 * @param {string} [options.model] - Model to use
 * @param {string} [options.apiKey] - Anthropic API key
 * @param {string} [options.vaultDir] - Vault directory for context
 * @param {string} [options.baseDir] - Base directory for calibration
 * @param {string} [options.existingObservations] - Pre-loaded observations context
 * @param {string} [options.calibration] - Pre-loaded calibration
 * @returns {Promise<string>} Raw LLM response text
 */
export async function extract(transcriptChunk, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = options.model || DEFAULT_MODEL;
  const existingObs = options.existingObservations ??
    (options.vaultDir ? await loadVaultContext(options.vaultDir) : '');
  const calibration = options.calibration ??
    (options.baseDir ? await loadCalibration(options.baseDir) : '');

  const userMessage = buildUserMessage(transcriptChunk, existingObs, calibration);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text || '[]';
}
