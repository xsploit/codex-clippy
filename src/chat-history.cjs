const fs = require('node:fs');
const path = require('node:path');

const MAX_CHATS = 50;

function readChatSettings(filePath, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    const current = typeof parsed.threadId === 'string' ? parsed.threadId : null;
    const stored = Array.isArray(parsed.threadIds) ? parsed.threadIds.filter((id) => typeof id === 'string') : [];
    const threadIds = [...new Set([current, ...stored].filter(Boolean))].slice(0, MAX_CHATS);
    return { threadId: current, threadIds };
  } catch {
    return { threadId: null, threadIds: [] };
  }
}

function rememberChat(filePath, threadId, fsImpl = fs) {
  if (typeof threadId !== 'string' || !threadId) throw new Error('A thread id is required.');
  const settings = readChatSettings(filePath, fsImpl);
  const next = {
    threadId,
    threadIds: [threadId, ...settings.threadIds.filter((id) => id !== threadId)].slice(0, MAX_CHATS),
  };
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, JSON.stringify(next, null, 2));
  return next;
}

function threadToMessages(thread = {}) {
  const messages = [];
  for (const turn of thread.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const text = (item.content || [])
          .filter((content) => content.type === 'text' && content.text)
          .map((content) => content.text)
          .join('\n')
          .trim();
        if (text) messages.push({ role: 'user', text });
      } else if (item.type === 'agentMessage' && item.text) {
        messages.push({ role: 'assistant', text: item.text });
      }
    }
  }
  return messages;
}

function threadSummary(thread, activeThreadId) {
  return {
    id: thread.id,
    name: thread.name || thread.preview || 'Fresh Clippy chat',
    preview: thread.preview || '',
    createdAt: thread.createdAt || 0,
    updatedAt: thread.recencyAt || thread.updatedAt || thread.createdAt || 0,
    active: thread.id === activeThreadId,
  };
}

module.exports = { MAX_CHATS, readChatSettings, rememberChat, threadSummary, threadToMessages };
