const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildConversationBody, readCodexAuth } = require('../src/chatgpt-transport.cjs');

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('reads the existing Codex ChatGPT identity without an API key', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clippy-chatgpt-auth-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'auth.json');
  fs.writeFileSync(file, JSON.stringify({ tokens: { access_token: jwt({ exp: 1234 }), account_id: 'account-test' } }));
  const auth = readCodexAuth(file);
  assert.equal(auth.accountId, 'account-test');
  assert.equal(auth.expiresAt, 1234);
  assert.match(auth.token, /^header\./);
});

test('builds the desktop ChatGPT conversation request with continuity', () => {
  const body = buildConversationBody({
    text: 'Hello Clippy',
    conversationId: 'conversation-1',
    parentMessageId: 'assistant-1',
  });
  assert.equal(body.action, 'next');
  assert.equal(body.model, 'auto');
  assert.equal(body.conversation_id, 'conversation-1');
  assert.equal(body.parent_message_id, 'assistant-1');
  assert.equal(body.messages[0].content.parts[0], 'Hello Clippy');
  assert.equal(body.hide_from_history, false);
});
