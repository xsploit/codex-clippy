const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_CHATS = 50;

function blankState() {
  return { activeId: null, chats: [] };
}

function readState(filePath, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    const chats = Array.isArray(parsed.chats) ? parsed.chats.filter((chat) => chat && typeof chat.id === 'string') : [];
    const activeId = chats.some((chat) => chat.id === parsed.activeId) ? parsed.activeId : chats[0]?.id || null;
    return { activeId, chats: chats.slice(0, MAX_CHATS) };
  } catch {
    return blankState();
  }
}

function writeState(filePath, state, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return state;
}

function createChat(filePath, fsImpl = fs, now = () => Date.now(), uuid = randomUUID) {
  const state = readState(filePath, fsImpl);
  const timestamp = now() / 1000;
  const chat = {
    id: `chatgpt:${uuid()}`,
    conversationId: null,
    parentMessageId: null,
    name: 'Fresh Clippy chat',
    preview: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  };
  writeState(filePath, { activeId: chat.id, chats: [chat, ...state.chats].slice(0, MAX_CHATS) }, fsImpl);
  return chat;
}

function getChat(filePath, chatId, fsImpl = fs) {
  const chat = readState(filePath, fsImpl).chats.find((candidate) => candidate.id === chatId);
  if (!chat) throw new Error('That ChatGPT chat does not belong to Clippy.');
  return chat;
}

function setActiveChat(filePath, chatId, fsImpl = fs) {
  const state = readState(filePath, fsImpl);
  const chat = state.chats.find((candidate) => candidate.id === chatId);
  if (!chat) throw new Error('That ChatGPT chat does not belong to Clippy.');
  writeState(filePath, {
    activeId: chatId,
    chats: [chat, ...state.chats.filter((candidate) => candidate.id !== chatId)],
  }, fsImpl);
  return getChat(filePath, chatId, fsImpl);
}

function ensureActiveChat(filePath, fsImpl = fs, now, uuid) {
  const state = readState(filePath, fsImpl);
  if (state.activeId) return getChat(filePath, state.activeId, fsImpl);
  return createChat(filePath, fsImpl, now, uuid);
}

function updateChat(filePath, chatId, updater, fsImpl = fs, now = () => Date.now()) {
  const state = readState(filePath, fsImpl);
  const index = state.chats.findIndex((chat) => chat.id === chatId);
  if (index < 0) throw new Error('That ChatGPT chat does not belong to Clippy.');
  const updated = { ...updater(structuredClone(state.chats[index])), id: chatId, updatedAt: now() / 1000 };
  const chats = [updated, ...state.chats.filter((chat) => chat.id !== chatId)].slice(0, MAX_CHATS);
  writeState(filePath, { activeId: chatId, chats }, fsImpl);
  return updated;
}

function appendMessage(filePath, chatId, message, fsImpl = fs, now = () => Date.now()) {
  return updateChat(filePath, chatId, (chat) => {
    const messages = [...(chat.messages || []), { role: message.role, text: String(message.text || '') }];
    const firstUser = messages.find((entry) => entry.role === 'user' && entry.text.trim());
    return {
      ...chat,
      messages,
      name: chat.name === 'Fresh Clippy chat' && firstUser ? firstUser.text.trim().slice(0, 52) : chat.name,
      preview: String(message.text || '').trim().replace(/\s+/g, ' ').slice(0, 92),
    };
  }, fsImpl, now);
}

function upsertExternalChat(filePath, incoming, fsImpl = fs) {
  if (!incoming?.conversationId) throw new Error('Cannot save a ChatGPT web chat without a conversation id.');
  const state = readState(filePath, fsImpl);
  const existing = state.chats.find((chat) => chat.id === incoming.id || chat.conversationId === incoming.conversationId);
  const id = existing?.id || incoming.id || `web:${incoming.conversationId}`;
  const chat = {
    ...(existing || {}),
    ...incoming,
    id,
    source: 'web',
    conversationId: incoming.conversationId,
    messages: Array.isArray(incoming.messages) ? incoming.messages : (existing?.messages || []),
  };
  writeState(filePath, {
    activeId: id,
    chats: [chat, ...state.chats.filter((candidate) => candidate.id !== id && candidate.conversationId !== chat.conversationId)].slice(0, MAX_CHATS),
  }, fsImpl);
  return chat;
}

function chatSummary(chat, activeId) {
  return {
    id: chat.id,
    name: chat.name || chat.preview || 'Fresh Clippy chat',
    preview: chat.preview || '',
    createdAt: chat.createdAt || 0,
    updatedAt: chat.updatedAt || chat.createdAt || 0,
    active: chat.id === activeId,
    source: chat.source || 'clippy',
    conversationId: chat.conversationId || null,
  };
}

module.exports = {
  MAX_CHATS,
  appendMessage,
  chatSummary,
  createChat,
  ensureActiveChat,
  getChat,
  readState,
  setActiveChat,
  upsertExternalChat,
  updateChat,
};
