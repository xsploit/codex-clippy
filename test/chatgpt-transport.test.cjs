const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildConversationBody, normalizeChatGptModels, readCodexAuth } = require('../src/chatgpt-transport.cjs');

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

test('maps the live ChatGPT model catalog into selectable presets', () => {
  const models = normalizeChatGptModels({ versions: [{
    enabled: true,
    display_text: '5.6',
    intelligence_presets: [
      { model_slug: 'gpt-5-6-instant', selected_display_title: '5.6 Instant', preset_type: 'available' },
      { model_slug: 'gpt-5-6-thinking', selected_display_title: '5.6 High', thinking_effort: 'extended', preset_type: 'available' },
    ],
  }] });
  assert.deepEqual(models.map((model) => model.id), ['auto', 'gpt-5-6-instant', 'gpt-5-6-thinking:extended']);
  assert.equal(models[2].effort, 'extended');
});

test('builds a ChatGPT image-and-file request with a selected model', () => {
  const body = buildConversationBody({
    text: 'Read these', model: 'gpt-5-6-thinking', effort: 'extended',
    attachments: [
      { kind: 'image', fileId: 'file-image', size: 12, width: 20, height: 30 },
      { kind: 'file', fileId: 'file-notes', size: 44, name: 'notes.md', mimeType: 'text/markdown' },
    ],
  });
  assert.equal(body.model, 'gpt-5-6-thinking');
  assert.equal(body.thinking_effort, 'extended');
  assert.equal(body.messages[0].content.content_type, 'multimodal_text');
  assert.equal(body.messages[0].content.parts[1].asset_pointer, 'file-service://file-image');
  assert.equal(body.messages[0].metadata.attachments[0].id, 'file-notes');
});
