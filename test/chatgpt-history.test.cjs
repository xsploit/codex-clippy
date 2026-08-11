const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  appendMessage,
  createChat,
  ensureActiveChat,
  readState,
  setActiveChat,
  upsertExternalChat,
  updateChat,
} = require('../src/chatgpt-history.cjs');

test('creates a materialized local ChatGPT chat before its first message', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clippy-chatgpt-history-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'history.json');
  const chat = createChat(file, fs, () => 1_000, () => 'test-id');
  assert.equal(chat.id, 'chatgpt:test-id');
  assert.equal(ensureActiveChat(file).id, chat.id);
  assert.deepEqual(readState(file).chats[0].messages, []);
});

test('imports and refreshes a ChatGPT.com conversation without duplicates', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clippy-chatgpt-history-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'history.json');
  const first = upsertExternalChat(file, {
    id: 'web:conversation-1', source: 'web', conversationId: 'conversation-1', parentMessageId: 'node-1',
    name: 'Existing web chat', messages: [{ role: 'user', text: 'Hello' }], updatedAt: 2,
  });
  const refreshed = upsertExternalChat(file, {
    id: 'web:conversation-1', source: 'web', conversationId: 'conversation-1', parentMessageId: 'node-2',
    name: 'Existing web chat', messages: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hey' }], updatedAt: 3,
  });
  const state = readState(file);
  assert.equal(first.id, 'web:conversation-1');
  assert.equal(refreshed.parentMessageId, 'node-2');
  assert.equal(state.chats.length, 1);
  assert.equal(state.activeId, 'web:conversation-1');
});

test('persists messages, backend continuity ids, and chat selection', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clippy-chatgpt-history-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'history.json');
  const first = createChat(file, fs, () => 1_000, () => 'first');
  appendMessage(file, first.id, { role: 'user', text: 'Who are you, Clippy?' }, fs, () => 2_000);
  updateChat(file, first.id, (chat) => ({
    ...chat,
    conversationId: 'conversation-1',
    parentMessageId: 'assistant-1',
    messages: [...chat.messages, { role: 'assistant', text: 'A helpful paperclip.' }],
  }), fs, () => 3_000);
  const second = createChat(file, fs, () => 4_000, () => 'second');
  setActiveChat(file, first.id);

  const state = readState(file);
  assert.equal(state.activeId, first.id);
  assert.equal(state.chats[0].id, first.id);
  assert.equal(state.chats.find((chat) => chat.id === first.id).conversationId, 'conversation-1');
  assert.equal(state.chats.find((chat) => chat.id === first.id).messages.length, 2);
  assert.equal(second.id, 'chatgpt:second');
});
