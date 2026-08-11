const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readChatSettings, rememberChat, threadSummary, threadToMessages } = require('../src/chat-history.cjs');

test('migrates the original single-thread state file', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clippy-history-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'clippy-state.json');
  fs.writeFileSync(file, JSON.stringify({ threadId: 'thread-old' }));
  assert.deepEqual(readChatSettings(file), { threadId: 'thread-old', threadIds: ['thread-old'] });
});

test('remembers chats with the active one first and no duplicates', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clippy-history-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'clippy-state.json');
  rememberChat(file, 'thread-a');
  rememberChat(file, 'thread-b');
  rememberChat(file, 'thread-a');
  assert.deepEqual(readChatSettings(file), {
    threadId: 'thread-a',
    threadIds: ['thread-a', 'thread-b'],
  });
});

test('restores user and assistant messages from stored turns', () => {
  const messages = threadToMessages({
    turns: [{
      items: [
        { type: 'userMessage', content: [{ type: 'text', text: 'Hello Clippy' }] },
        { type: 'commandExecution', command: 'dir' },
        { type: 'agentMessage', text: '**Done**, bro.' },
      ],
    }],
  });
  assert.deepEqual(messages, [
    { role: 'user', text: 'Hello Clippy' },
    { role: 'assistant', text: '**Done**, bro.' },
  ]);
});

test('summarizes a thread for the chat menu', () => {
  assert.deepEqual(threadSummary({
    id: 'thread-1',
    name: 'Menu work',
    preview: 'Make the chat picker',
    createdAt: 10,
    updatedAt: 20,
  }, 'thread-1'), {
    id: 'thread-1',
    name: 'Menu work',
    preview: 'Make the chat picker',
    createdAt: 10,
    updatedAt: 20,
    active: true,
  });
});
