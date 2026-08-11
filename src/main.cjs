const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, shell: electronShell, Tray } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CodexAppServer } = require('./app-server.cjs');
const { readChatSettings, rememberChat, threadSummary, threadToMessages } = require('./chat-history.cjs');
const {
  appendMessage: appendChatGptMessage,
  chatSummary: chatGptSummary,
  createChat: createChatGptChat,
  ensureActiveChat: ensureActiveChatGptChat,
  getChat: getChatGptChat,
  readState: readChatGptState,
  setActiveChat: setActiveChatGptChat,
  upsertExternalChat: upsertExternalChatGptChat,
  updateChat: updateChatGptChat,
} = require('./chatgpt-history.cjs');
const { ChatGptTransport } = require('./chatgpt-transport.cjs');
const { CodexDesktopTranscriber } = require('./codex-desktop-transcriber.cjs');
const { OpenAIRealtimeTranscriber } = require('./realtime-transcriber.cjs');
const { WhisperTranscriber } = require('./whisper.cjs');

const WINDOW_WIDTH = 620;
const WINDOW_HEIGHT = 560;

if (process.env.CODEX_CLIPPY_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.CODEX_CLIPPY_USER_DATA_DIR));
}

let mainWindow;
let tray;
let bridge;
let chatgpt;
let realtimeTranscriber;
let hostedTranscriber;
let localTranscriber;
let realtimeTranscriptionUnavailable = null;
let quitting = false;
let state = {
  mode: 'chatgpt',
  status: { state: 'starting', label: 'Connecting ChatGPT…' },
  threadId: null,
  busy: false,
};
let codexThreadId = null;
let codexStatus = { state: 'starting', label: 'Starting Codex…' };
let chatGptStatus = { state: 'starting', label: 'Connecting ChatGPT…' };
let activeChatGptChatId = null;
const liveRequests = new Map();
let preferences;

const DEFAULT_PREFERENCES = {
  mode: 'chatgpt',
  chatgpt: { selection: 'auto', model: 'auto', effort: null },
  codex: { model: null, effort: null, permissions: ':workspace' },
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'clippy-state.json');
}

function chatGptHistoryPath() {
  return path.join(app.getPath('userData'), 'clippy-chatgpt-history.json');
}

function preferencesPath() {
  return path.join(app.getPath('userData'), 'clippy-preferences.json');
}

function loadPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8'));
    return {
      mode: parsed.mode === 'codex' ? 'codex' : 'chatgpt',
      chatgpt: { ...DEFAULT_PREFERENCES.chatgpt, ...(parsed.chatgpt || {}) },
      codex: { ...DEFAULT_PREFERENCES.codex, ...(parsed.codex || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}

function savePreferences() {
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(preferences, null, 2));
}

function attachmentMimeType(filePath, provided = '') {
  if (provided) return provided;
  const types = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.js': 'text/javascript', '.cjs': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript',
    '.html': 'text/html', '.css': 'text/css', '.csv': 'text/csv', '.xml': 'application/xml', '.zip': 'application/zip',
  };
  return types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function attachmentDescriptor(filePath, providedMimeType = '') {
  const stat = fs.statSync(filePath);
  const mimeType = attachmentMimeType(filePath, providedMimeType);
  const kind = mimeType.startsWith('image/') ? 'image' : 'file';
  const descriptor = { id: randomUUID(), path: filePath, name: path.basename(filePath), size: stat.size, mimeType, kind };
  if (kind === 'image') {
    const image = nativeImage.createFromPath(filePath);
    const size = image.getSize();
    descriptor.width = size.width;
    descriptor.height = size.height;
    if (stat.size <= 8 * 1024 * 1024) descriptor.preview = image.toDataURL();
  }
  return descriptor;
}

async function getComposerOptions(mode = state.mode) {
  if (mode === 'chatgpt') {
    let models = [{ id: 'auto', model: 'auto', effort: null, label: 'Auto' }];
    try { models = await chatgpt.listModels(); } catch (error) { console.log(`[chatgpt] Model list unavailable: ${error.message}`); }
    if (!models.some((model) => model.id === preferences.chatgpt.selection)) preferences.chatgpt = { ...DEFAULT_PREFERENCES.chatgpt };
    return { mode, models, selectedModel: preferences.chatgpt.selection, selectedEffort: null, permissions: [], selectedPermissions: null };
  }
  let rawModels = [];
  let rawPermissions = [];
  for (let attempt = 0; attempt < 60 && bridge && !bridge.ready; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (bridge?.ready) {
    [rawModels, rawPermissions] = await Promise.all([bridge.listModels(), bridge.listPermissionProfiles()]);
  }
  const models = rawModels.filter((model) => !model.hidden).map((model) => ({
    id: model.model,
    label: model.displayName,
    description: model.description,
    isDefault: model.isDefault,
    defaultEffort: model.defaultReasoningEffort,
    modalities: model.inputModalities || ['text', 'image'],
    efforts: (model.supportedReasoningEfforts || []).map((option) => ({ id: option.reasoningEffort, label: option.reasoningEffort, description: option.description })),
  }));
  const selected = models.find((model) => model.id === preferences.codex.model) || models.find((model) => model.isDefault) || models[0];
  const selectedEffort = selected?.efforts?.some((effort) => effort.id === preferences.codex.effort)
    ? preferences.codex.effort
    : selected?.defaultEffort || selected?.efforts?.[0]?.id || null;
  const permissions = rawPermissions.map((profile) => ({
    id: profile.id,
    label: profile.id === ':read-only' ? 'Read only' : profile.id === ':danger-full-access' ? 'Full access' : 'Workspace',
    description: profile.description,
    allowed: profile.allowed,
  }));
  return {
    mode, models, selectedModel: selected?.id || null, selectedEffort,
    permissions, selectedPermissions: preferences.codex.permissions,
  };
}

function loadSavedThread() {
  return readChatSettings(settingsPath()).threadId;
}

function saveThread(threadId) {
  rememberChat(settingsPath(), threadId);
}

function rememberedThreadIds() {
  return readChatSettings(settingsPath()).threadIds;
}

function ensureRememberedThread(threadId) {
  if (!rememberedThreadIds().includes(threadId)) throw new Error('That chat does not belong to Clippy.');
}

function chatPayload(thread) {
  return {
    chat: threadSummary(thread, state.threadId),
    messages: threadToMessages(thread),
  };
}

function chatGptPayload(chat) {
  return {
    chat: chatGptSummary(chat, readChatGptState(chatGptHistoryPath()).activeId),
    messages: chat.messages || [],
  };
}

async function openChatGptChat(chatId) {
  if (String(chatId).startsWith('web:')) {
    const conversationId = String(chatId).slice(4);
    const remote = await chatgpt.getConversation(conversationId);
    return upsertExternalChatGptChat(chatGptHistoryPath(), remote);
  }
  return setActiveChatGptChat(chatGptHistoryPath(), chatId);
}

async function listClippyChats() {
  if (state.mode === 'chatgpt') {
    const stored = readChatGptState(chatGptHistoryPath());
    const local = stored.chats.map((chat) => chatGptSummary(chat, stored.activeId));
    let remote = [];
    try {
      remote = await chatgpt.listConversations(50);
    } catch (error) {
      console.log(`[chatgpt] Web history unavailable: ${error.message}`);
    }
    const localByConversation = new Map(local.filter((chat) => chat.conversationId).map((chat) => [chat.conversationId, chat]));
    const mergedRemote = remote.map((chat) => {
      const existing = localByConversation.get(chat.conversationId);
      return existing ? { ...chat, ...existing } : chat;
    });
    const remoteConversationIds = new Set(remote.map((chat) => chat.conversationId));
    return [...local.filter((chat) => !chat.conversationId || !remoteConversationIds.has(chat.conversationId)), ...mergedRemote]
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }
  if (!bridge?.ready) return [];
  const ids = rememberedThreadIds();
  const listed = await bridge.listThreads(Math.max(100, ids.length));
  const byId = new Map(listed.filter((thread) => ids.includes(thread.id)).map((thread) => [thread.id, thread]));

  for (const threadId of ids) {
    if (byId.has(threadId)) continue;
    try {
      byId.set(threadId, await bridge.readThread(threadId, false));
    } catch (error) {
      console.log(`[history] Could not read ${threadId}: ${error.message}`);
    }
  }

  return ids
    .map((threadId) => byId.get(threadId))
    .filter(Boolean)
    .map((thread) => threadSummary(thread, state.threadId))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function getLocalTranscriber() {
  if (!localTranscriber) {
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, 'whisper-worker.py')
      : path.join(__dirname, 'whisper-worker.py');
    localTranscriber = new WhisperTranscriber({ workerPath });
    localTranscriber.on('log', (message) => console.log(`[whisper] ${message}`));
  }
  return localTranscriber;
}

function getHostedTranscriber() {
  if (!hostedTranscriber) {
    hostedTranscriber = new CodexDesktopTranscriber();
  }
  return hostedTranscriber;
}

async function transcribeRecording(audio, mimeType) {
  try {
    return await getHostedTranscriber().transcribe(audio, mimeType);
  } catch (error) {
    console.log(`[transcription] Codex desktop route unavailable: ${error.message}`);
    return getLocalTranscriber().transcribe(audio, mimeType);
  }
}

function getRealtimeTranscriber() {
  if (!realtimeTranscriber) {
    realtimeTranscriber = new OpenAIRealtimeTranscriber();
    realtimeTranscriber.on('delta', (delta) => emit({
      type: 'notification',
      message: { method: 'thread/realtime/transcript/delta', params: { threadId: state.threadId, role: 'user', delta } },
    }));
    realtimeTranscriber.on('done', (text) => emit({
      type: 'notification',
      message: { method: 'thread/realtime/transcript/done', params: { threadId: state.threadId, role: 'user', text } },
    }));
    realtimeTranscriber.on('transcription-error', (error) => console.log(`[transcription] ${error.message}`));
  }
  return realtimeTranscriber;
}

async function startRealtimeTranscription() {
  if (realtimeTranscriptionUnavailable) throw realtimeTranscriptionUnavailable;
  try {
    return await getRealtimeTranscriber().start();
  } catch (error) {
    if (/api key|401|authentication/i.test(error.message)) realtimeTranscriptionUnavailable = error;
    throw error;
  }
}

function emit(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clippy:event', payload);
}

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: area.x + area.width - WINDOW_WIDTH - 12,
    y: area.y + area.height - WINDOW_HEIGHT - 12,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    return webContents === mainWindow.webContents && permission === 'media' && details.mediaType === 'audio';
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const ownsWindow = webContents === mainWindow.webContents;
    const wantsAudio = permission === 'media' && (details.mediaTypes || []).includes('audio');
    callback(ownsWindow && wantsAudio);
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('console-message', (_event, details) => {
    console.log(`[renderer:${details.level}] ${details.message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] process gone: ${details.reason}`);
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    const capturePath = process.env.CODEX_CLIPPY_CAPTURE_PATH;
    if (capturePath) {
      setTimeout(async () => {
        try {
          const demoPrompt = process.env.CODEX_CLIPPY_DEMO_PROMPT;
          if (demoPrompt) {
            for (let attempt = 0; attempt < 60 && !chatgpt?.ready; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            await mainWindow.webContents.executeJavaScript(`(() => {
              const prompt = document.querySelector('#prompt');
              prompt.value = ${JSON.stringify(demoPrompt)};
              prompt.dispatchEvent(new Event('input', { bubbles: true }));
              document.querySelector('#composer').requestSubmit();
            })()`);
            for (let attempt = 0; attempt < 120; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              const reply = await mainWindow.webContents.executeJavaScript(`(() => {
                const messages = [...document.querySelectorAll('.assistant-message')];
                return messages.at(-1)?.innerText?.trim() || '';
              })()`);
              if (!state.busy && reply) break;
            }
          }
          for (let attempt = 0; attempt < 30; attempt += 1) {
            const composerReady = await mainWindow.webContents.executeJavaScript(`(() => {
              const model = document.querySelector('#model-select');
              return model && !model.disabled && model.value && model.options[0]?.textContent !== 'Loading…';
            })()`);
            if (composerReady) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (process.env.CODEX_CLIPPY_DEMO_OPEN_HISTORY === '1') {
            await mainWindow.webContents.executeJavaScript(`document.querySelector('#chat-history')?.click()`);
            for (let attempt = 0; attempt < 60; attempt += 1) {
              const webHistoryReady = await mainWindow.webContents.executeJavaScript(`(() => {
                const rows = [...document.querySelectorAll('.chat-row')];
                return rows.length > 1 && rows.some((row) => row.querySelector('.chat-row-source.web'));
              })()`);
              if (webHistoryReady) break;
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(capturePath, image.toPNG());
          console.log(`[capture] ${capturePath}`);
        } catch (error) {
          console.error(`[capture] ${error.stack || error.message}`);
        }
      }, 3_000);
    }
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#fff59a"/><path d="M20 8v14a6 6 0 0 1-12 0V10a4 4 0 0 1 8 0v11a2 2 0 0 1-4 0V11" fill="none" stroke="#6962a8" stroke-width="2.6" stroke-linecap="round"/><circle cx="18.5" cy="12" r="3.5" fill="white" stroke="#333"/><circle cx="24" cy="13" r="3.5" fill="white" stroke="#333"/><circle cx="19.5" cy="12.5" r="1.5"/><circle cx="23" cy="13.5" r="1.5"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 });
}

function createTray() {
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('Codex Clippy');
    tray.on('click', () => {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.showInactive();
    });
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Clippy', click: () => mainWindow.showInactive() },
    { label: 'New chat', click: () => newChat() },
    { type: 'separator' },
    { label: 'ChatGPT chat', type: 'radio', checked: state.mode === 'chatgpt', click: () => setMode('chatgpt') },
    { label: 'Codex tools', type: 'radio', checked: state.mode === 'codex', click: () => setMode('codex') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

async function startBridge() {
  bridge = new CodexAppServer({ cwd: process.env.CODEX_CLIPPY_CWD || process.cwd() });
  bridge.configureComposer(preferences.codex);
  bridge.on('status', (status) => {
    codexStatus = status;
    if (state.mode === 'codex') {
      state.status = status;
      emit({ type: 'status', status });
    }
  });
  bridge.on('thread', ({ threadId }) => {
    codexThreadId = threadId;
    saveThread(threadId);
    if (state.mode === 'codex') {
      state.threadId = threadId;
      emit({ type: 'thread', threadId });
    }
  });
  bridge.on('notification', (message) => {
    if (state.mode !== 'codex') return;
    if (message.method === 'turn/started') state.busy = true;
    if (message.method === 'turn/completed') state.busy = false;
    emit({ type: 'notification', message });
  });
  bridge.on('server-request', (message) => {
    liveRequests.set(String(message.id), message);
    emit({ type: 'server-request', request: message });
  });
  bridge.on('log', (message) => console.log(`[codex] ${message}`));
  bridge.on('error', (error) => {
    if (state.mode === 'codex') emit({ type: 'error', message: error.message });
  });

  try {
    await bridge.start(loadSavedThread());
  } catch (error) {
    codexStatus = { state: 'error', label: 'Codex failed to start' };
    if (state.mode === 'codex') {
      state.status = codexStatus;
      emit({ type: 'error', message: error.message });
      emit({ type: 'status', status: state.status });
    }
  }
}

async function startChatGpt() {
  chatgpt = new ChatGptTransport({
    refreshAuth: async () => {
      if (bridge?.ready) await bridge.request('account/read', { refreshToken: true });
    },
  });
  chatgpt.on('status', (status) => {
    chatGptStatus = status;
    if (state.mode === 'chatgpt') {
      state.status = status;
      emit({ type: 'status', status });
    }
  });
  chatgpt.on('log', (message) => console.log(`[chatgpt] ${message}`));
  chatgpt.on('event', (event) => {
    if (state.mode !== 'chatgpt' || event.type !== 'text') return;
    emit({ type: 'notification', message: { method: 'chatgpt/message', params: { text: event.text } } });
  });
  try {
    await chatgpt.start();
  } catch (error) {
    chatGptStatus = { state: 'error', label: 'ChatGPT unavailable' };
    if (state.mode === 'chatgpt') {
      state.status = chatGptStatus;
      emit({ type: 'error', message: error.message });
      emit({ type: 'status', status: state.status });
    }
  }
}

async function newChat() {
  if (state.busy) throw new Error('Let Clippy finish the current turn first.');
  if (state.mode === 'chatgpt') {
    const chat = createChatGptChat(chatGptHistoryPath());
    state.threadId = chat.id;
    state.busy = false;
    const payload = chatGptPayload(chat);
    emit({ type: 'new-chat', ...payload });
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    return payload;
  }
  if (!bridge?.ready) throw new Error('Codex is still starting.');
  const thread = await bridge.newThread();
  codexThreadId = thread.id;
  state.threadId = codexThreadId;
  state.busy = false;
  saveThread(thread.id);
  const payload = chatPayload(thread);
  emit({ type: 'new-chat', ...payload });
  if (!mainWindow.isVisible()) mainWindow.showInactive();
  return payload;
}

async function setMode(mode, notify = true) {
  if (mode !== 'chatgpt' && mode !== 'codex') throw new Error('Unknown Clippy mode.');
  if (state.busy) throw new Error('Let Clippy finish the current turn first.');
  state.mode = mode;
  preferences.mode = mode;
  savePreferences();
  let payload;
  if (mode === 'chatgpt') {
    const chat = ensureActiveChatGptChat(chatGptHistoryPath());
    state.threadId = chat.id;
    state.status = chatGptStatus;
    if (!chatgpt?.ready) await chatgpt?.start();
    payload = chatGptPayload(chat);
  } else {
    state.threadId = codexThreadId;
    state.status = codexStatus;
    if (codexThreadId && bridge?.ready) payload = chatPayload(await bridge.readThread(codexThreadId, true));
    else if (bridge?.ready) payload = await newChat();
    else payload = { chat: { id: null }, messages: [] };
  }
  createTray();
  if (notify) emit({ type: 'mode', mode, status: state.status, ...payload });
  return { mode, status: state.status, ...payload };
}

ipcMain.handle('clippy:get-state', () => state);
ipcMain.handle('clippy:get-composer-options', (_event, mode) => getComposerOptions(mode));
ipcMain.handle('clippy:set-composer-settings', async (_event, mode, settings = {}) => {
  if (mode === 'chatgpt') {
    const models = await chatgpt.listModels();
    const selected = models.find((model) => model.id === settings.model) || models[0];
    preferences.chatgpt = { selection: selected.id, model: selected.model, effort: selected.effort || null };
  } else if (mode === 'codex') {
    preferences.codex = {
      model: settings.model || null,
      effort: settings.effort || null,
      permissions: settings.permissions || ':workspace',
    };
    bridge?.configureComposer(preferences.codex);
  } else {
    throw new Error('Unknown Clippy mode.');
  }
  savePreferences();
  return getComposerOptions(mode);
});
ipcMain.handle('clippy:pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Attach files to Clippy',
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths.map((filePath) => attachmentDescriptor(filePath));
});
ipcMain.handle('clippy:save-pasted-file', (_event, payload = {}) => {
  const bytes = Buffer.from(payload.bytes || []);
  if (!bytes.length) throw new Error('That pasted file was empty.');
  if (bytes.length > 25 * 1024 * 1024) throw new Error('Keep pasted files under 25 MB.');
  const safeName = path.basename(String(payload.name || 'pasted-image.png')).replace(/[^a-zA-Z0-9._-]/g, '-');
  const directory = path.join(app.getPath('userData'), 'attachments');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${randomUUID()}-${safeName}`);
  fs.writeFileSync(filePath, bytes);
  return attachmentDescriptor(filePath, payload.mimeType);
});
ipcMain.handle('clippy:send', async (_event, submitted) => {
  const payload = typeof submitted === 'string' ? { text: submitted, attachments: [] } : (submitted || {});
  const clean = typeof payload.text === 'string' ? payload.text.trim() : '';
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments.filter((attachment) => attachment?.path && fs.existsSync(attachment.path)).slice(0, 10)
    : [];
  if (!clean && !attachments.length) throw new Error('Give Clippy something to do first.');
  const visibleText = [clean, ...attachments.map((attachment) => `📎 ${attachment.name}`)].filter(Boolean).join('\n');
  state.busy = true;
  if (state.mode === 'chatgpt') {
    const chat = state.threadId ? getChatGptChat(chatGptHistoryPath(), state.threadId) : ensureActiveChatGptChat(chatGptHistoryPath());
    state.threadId = chat.id;
    activeChatGptChatId = chat.id;
    appendChatGptMessage(chatGptHistoryPath(), chat.id, { role: 'user', text: visibleText });
    emit({ type: 'notification', message: { method: 'turn/started', params: { mode: 'chatgpt' } } });
    try {
      const result = await chatgpt.send({
        text: clean,
        conversationId: chat.conversationId,
        parentMessageId: chat.parentMessageId,
        model: preferences.chatgpt.model,
        effort: preferences.chatgpt.effort,
        attachments,
      });
      updateChatGptChat(chatGptHistoryPath(), chat.id, (current) => ({
        ...current,
        conversationId: result.conversationId || current.conversationId,
        parentMessageId: result.parentMessageId || current.parentMessageId,
        messages: result.text ? [...(current.messages || []), { role: 'assistant', text: result.text }] : current.messages,
        preview: result.text ? result.text.trim().replace(/\s+/g, ' ').slice(0, 92) : current.preview,
      }));
      emit({ type: 'notification', message: { method: 'chatgpt/done', params: result } });
      return { turnId: result.parentMessageId || null };
    } catch (error) {
      emit({ type: 'notification', message: { method: 'chatgpt/failed', params: { message: error.message } } });
      throw error;
    } finally {
      activeChatGptChatId = null;
      state.busy = false;
    }
  }
  try {
    const turn = await bridge.sendPrompt({ text: clean, attachments }, preferences.codex);
    return { turnId: turn.id };
  } catch (error) {
    state.busy = false;
    throw error;
  }
});
ipcMain.handle('clippy:stop', () => state.mode === 'chatgpt' ? chatgpt?.stop() : bridge?.interrupt());
ipcMain.handle('clippy:transcribe', (_event, audio, mimeType) => transcribeRecording(audio, mimeType));
ipcMain.handle('clippy:transcription-start', () => startRealtimeTranscription());
ipcMain.handle('clippy:transcription-audio', (_event, audio) => getRealtimeTranscriber().appendAudio(audio));
ipcMain.handle('clippy:transcription-stop', () => getRealtimeTranscriber().stop());
ipcMain.handle('clippy:transcription-cancel', () => getRealtimeTranscriber().cancel());
ipcMain.handle('clippy:new-chat', () => newChat());
ipcMain.handle('clippy:list-chats', () => listClippyChats());
ipcMain.handle('clippy:get-chat', async (_event, threadId) => {
  if (state.mode === 'chatgpt') {
    if (String(threadId).startsWith('web:')) return chatGptPayload(await openChatGptChat(threadId));
    return chatGptPayload(getChatGptChat(chatGptHistoryPath(), threadId));
  }
  ensureRememberedThread(threadId);
  return chatPayload(await bridge.readThread(threadId, true));
});
ipcMain.handle('clippy:switch-chat', async (_event, threadId) => {
  if (state.busy) throw new Error('Let Clippy finish the current turn first.');
  if (state.mode === 'chatgpt') {
    const chat = await openChatGptChat(threadId);
    state.threadId = chat.id;
    return chatGptPayload(chat);
  }
  ensureRememberedThread(threadId);
  const thread = await bridge.resumeThread(threadId);
  state.threadId = thread.id;
  state.busy = false;
  saveThread(thread.id);
  return chatPayload(thread);
});
ipcMain.handle('clippy:set-mode', (_event, mode) => setMode(mode, false));
ipcMain.on('clippy-chatgpt:event', (event, payload) => chatgpt?.receivePageEvent(event.sender, payload));
ipcMain.handle('clippy:respond', (_event, payload) => {
  const key = String(payload?.requestId ?? '');
  const request = liveRequests.get(key);
  if (!request) throw new Error('That request is no longer active.');

  if (request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval') {
    bridge.reply(request.id, { decision: payload.decision === 'accept' ? 'accept' : 'decline' });
  } else if (request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') {
    bridge.reply(request.id, {
      decision: payload.decision === 'accept' ? 'approved' : { denied: { rejection: 'User declined in Codex Clippy.' } },
    });
  } else if (request.method === 'item/tool/requestUserInput') {
    bridge.reply(request.id, { answers: payload.answers || {} });
  } else if (request.method === 'item/permissions/requestApproval') {
    bridge.reply(request.id, {
      permissions: payload.decision === 'accept' ? request.params.permissions : {},
      scope: 'turn',
    });
  } else if (request.method === 'mcpServer/elicitation/request') {
    bridge.reply(request.id, {
      action: payload.decision === 'accept' ? 'accept' : 'decline',
      content: payload.decision === 'accept' ? (payload.content || {}) : null,
      _meta: null,
    });
  } else {
    bridge.replyError(request.id, -32601, `Codex Clippy cannot handle ${request.method} yet.`);
  }
  liveRequests.delete(key);
  return { ok: true };
});
ipcMain.handle('clippy:open-external', async (_event, rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links can be opened.');
  await electronShell.openExternal(url.toString());
  return { ok: true };
});
ipcMain.handle('window:get-position', () => mainWindow.getPosition());
ipcMain.on('window:set-position', (_event, point) => {
  if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
    mainWindow.setPosition(Math.round(point.x), Math.round(point.y), false);
  }
});
ipcMain.on('window:set-ignore-mouse', (_event, ignore) => {
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.on('clippy:hide', () => mainWindow.hide());
ipcMain.on('clippy:quit', () => { quitting = true; app.quit(); });

app.whenReady().then(() => {
  preferences = loadPreferences();
  state.mode = preferences.mode;
  codexThreadId = loadSavedThread();
  if (state.mode === 'chatgpt') {
    const chat = ensureActiveChatGptChat(chatGptHistoryPath());
    state.threadId = chat.id;
    state.status = chatGptStatus;
  } else {
    // The app server owns thread materialization. Wait for its `thread` event
    // instead of asking the renderer to read a remembered id during startup.
    state.threadId = null;
    state.status = codexStatus;
  }
  createWindow();
  createTray();
  startBridge();
  startChatGpt();
});

app.on('before-quit', () => {
  quitting = true;
  bridge?.stop();
  chatgpt?.close();
  realtimeTranscriber?.cancel();
  localTranscriber?.stop();
});
app.on('window-all-closed', (event) => event.preventDefault());
app.on('activate', () => mainWindow?.showInactive());
