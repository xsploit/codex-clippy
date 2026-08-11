const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CodexDesktopTranscriber } = require('../src/codex-desktop-transcriber.cjs');

test('uses the existing Codex login for the desktop transcription request', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clippy-desktop-stt-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const authPath = path.join(directory, 'auth.json');
  await fs.writeFile(authPath, JSON.stringify({
    tokens: { access_token: 'access-test', account_id: 'account-test' },
  }));

  let request;
  const transcriber = new CodexDesktopTranscriber({
    authPath,
    userAgent: 'Clippy-Test-Agent',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ text: 'Clippy speech test successful.' }),
      };
    },
  });

  const result = await transcriber.transcribe(Buffer.alloc(512, 1), 'audio/webm');
  assert.deepEqual(result, { text: 'Clippy speech test successful.', provider: 'codex-desktop-transcribe' });
  assert.equal(request.url, 'https://chatgpt.com/backend-api/transcribe');
  assert.equal(request.options.headers.Authorization, 'Bearer access-test');
  assert.equal(request.options.headers['ChatGPT-Account-Id'], 'account-test');
  assert.equal(request.options.headers['User-Agent'], 'Clippy-Test-Agent');
  assert.equal(request.options.body.get('file').name, 'codex.webm');
});

test('rejects an empty desktop dictation before reading authentication', async () => {
  const transcriber = new CodexDesktopTranscriber({ authPath: 'unused.json' });
  await assert.rejects(() => transcriber.transcribe(Buffer.alloc(0)), /recording was empty/i);
});
