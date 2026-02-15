import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { preprocessTranscript, scrubCredentials, estimateTokens, chunkMessages, formatForExtraction } from '../../src/observer/preprocessor.js';

describe('preprocessor', () => {
  describe('scrubCredentials', () => {
    it('scrubs sk- API keys', () => {
      assert.ok(!scrubCredentials('key is sk-abcdefghijklmnopqrstuvwxyz1234').includes('sk-'));
    });

    it('scrubs ghp_ tokens', () => {
      assert.ok(!scrubCredentials('token ghp_abcdefghijklmnopqrstuvwxyz1234567890').includes('ghp_'));
    });

    it('scrubs xoxb- tokens', () => {
      assert.ok(!scrubCredentials('slack xoxb-1234567890-abcdefghijklm').includes('xoxb-'));
    });

    it('scrubs Bearer tokens', () => {
      assert.ok(!scrubCredentials('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9').includes('Bearer eyJ'));
    });

    it('leaves normal text alone', () => {
      assert.equal(scrubCredentials('hello world'), 'hello world');
    });
  });

  describe('preprocessTranscript', () => {
    it('parses JSONL lines', () => {
      const jsonl = [
        JSON.stringify({ role: 'user', content: 'hello', timestamp: 1000 }),
        JSON.stringify({ role: 'assistant', content: 'hi', timestamp: 2000 }),
      ].join('\n');

      const msgs = preprocessTranscript(jsonl);
      assert.equal(msgs.length, 2);
      assert.equal(msgs[0].role, 'user');
      assert.equal(msgs[1].role, 'assistant');
    });

    it('summarizes tool_use blocks', () => {
      const jsonl = JSON.stringify({
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'read', input: { path: '/foo' } }],
        timestamp: 1000,
      });
      const msgs = preprocessTranscript(jsonl);
      assert.ok(msgs[0].text.includes('[tool_use: read(path)]'));
    });

    it('summarizes tool_result blocks', () => {
      const jsonl = JSON.stringify({
        role: 'user',
        content: [{ type: 'tool_result', content: 'line1\nline2\nline3\nline4\nline5\nline6\nline7' }],
        timestamp: 1000,
      });
      const msgs = preprocessTranscript(jsonl);
      assert.ok(msgs[0].text.includes('[tool_result:'));
      assert.ok(msgs[0].text.includes('7 lines'));
    });

    it('strips base64 images', () => {
      const jsonl = JSON.stringify({
        role: 'assistant',
        content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }],
        timestamp: 1000,
      });
      const msgs = preprocessTranscript(jsonl);
      assert.ok(msgs[0].text.includes('[image]'));
    });

    it('scrubs credentials in content', () => {
      const jsonl = JSON.stringify({
        role: 'user',
        content: 'my key is sk-abcdefghijklmnopqrstuvwxyz1234',
        timestamp: 1000,
      });
      const msgs = preprocessTranscript(jsonl);
      assert.ok(!msgs[0].text.includes('sk-'));
      assert.ok(msgs[0].text.includes('[REDACTED]'));
    });

    it('skips malformed JSON lines', () => {
      const jsonl = 'not json\n' + JSON.stringify({ role: 'user', content: 'hi', timestamp: 1000 });
      const msgs = preprocessTranscript(jsonl);
      assert.equal(msgs.length, 1);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      assert.equal(estimateTokens('abcd'), 1);
      assert.equal(estimateTokens('abcdefgh'), 2);
    });
  });

  describe('chunkMessages', () => {
    it('returns single chunk for small content', () => {
      const msgs = [{ timestamp: 1000, role: 'user', text: 'hello' }];
      const chunks = chunkMessages(msgs);
      assert.equal(chunks.length, 1);
    });

    it('splits large content into multiple chunks', () => {
      // Create messages totaling >30K tokens (~120K chars)
      const msgs = [];
      for (let i = 0; i < 200; i++) {
        msgs.push({ timestamp: i * 1000, role: 'user', text: 'x'.repeat(600) });
      }
      const chunks = chunkMessages(msgs);
      assert.ok(chunks.length > 1, `Expected >1 chunk, got ${chunks.length}`);
    });
  });
});
