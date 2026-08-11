const assert = require('node:assert/strict');
const test = require('node:test');
const { WhisperTranscriber } = require('../src/whisper.cjs');

test('rejects an empty microphone recording before starting Python', async () => {
  const transcriber = new WhisperTranscriber({ workerPath: 'unused.py' });
  await assert.rejects(() => transcriber.transcribe(Buffer.alloc(0)), /recording was empty/i);
});

test('parses split Whisper worker responses', async () => {
  const transcriber = new WhisperTranscriber();
  const response = new Promise((resolve, reject) => {
    transcriber.pending.set(3, { resolve, reject, timeout: setTimeout(() => {}, 1_000) });
  });
  transcriber._consume('{"id":3,"result":{"text":"Clippy speech');
  transcriber._consume(' test successful","language":"en"}}\n');
  assert.deepEqual(await response, { text: 'Clippy speech test successful', language: 'en' });
});
