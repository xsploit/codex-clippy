const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BrowserWindow } = require('electron');
const { runChatGptConversation } = require('./chatgpt-page-client.cjs');

const CHATGPT_URL = 'https://chatgpt.com/';

function readCodexAuth(authPath = path.join(os.homedir(), '.codex', 'auth.json'), fsImpl = fs) {
  let auth;
  try {
    auth = JSON.parse(fsImpl.readFileSync(authPath, 'utf8'));
  } catch {
    throw new Error('Sign in to ChatGPT through Codex before using Chat mode.');
  }
  const token = auth?.tokens?.access_token;
  if (!token) throw new Error('Codex does not have a ChatGPT access token. Sign in again first.');
  let payload = {};
  try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch {}
  const accountId = auth.tokens.account_id || payload['https://api.openai.com/auth.chatgpt_account_id'] || '';
  const expiresAt = Number(payload.exp || 0);
  return { token, accountId, expiresAt };
}

function normalizeChatGptModels(catalog = {}) {
  const models = [{ id: 'auto', model: 'auto', effort: null, label: 'Auto' }];
  const seen = new Set(['auto']);
  for (const version of catalog.versions || []) {
    if (!version?.enabled) continue;
    const presets = version.intelligence_presets || [];
    if (!presets.length) {
      for (const slug of version.slugs || []) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        models.push({ id: slug, model: slug, effort: null, label: version.display_text_full || slug });
      }
      continue;
    }
    for (const preset of presets) {
      if (preset.preset_type && preset.preset_type !== 'available') continue;
      const effort = preset.thinking_effort || null;
      const id = `${preset.model_slug}${effort ? `:${effort}` : ''}`;
      if (!preset.model_slug || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        model: preset.model_slug,
        effort,
        label: preset.selected_display_title || `${version.display_text || version.id} ${preset.title}`,
      });
    }
  }
  return models;
}

function buildConversationBody({
  text,
  conversationId = null,
  parentMessageId = null,
  hideFromHistory = false,
  model = 'auto',
  effort = null,
  attachments = [],
}) {
  const imageParts = attachments
    .filter((attachment) => attachment.kind === 'image' && attachment.fileId)
    .map((attachment) => ({
      content_type: 'image_asset_pointer',
      asset_pointer: `file-service://${attachment.fileId}`,
      size_bytes: attachment.size,
      width: attachment.width || 1,
      height: attachment.height || 1,
    }));
  const fileAttachments = attachments
    .filter((attachment) => attachment.kind !== 'image' && attachment.fileId)
    .map((attachment) => ({
      id: attachment.fileId,
      size: attachment.size,
      name: attachment.name,
      mime_type: attachment.mimeType || 'application/octet-stream',
    }));
  return {
    action: 'next',
    client_prepare_state: 'sent',
    conversation_id: conversationId,
    hide_from_history: Boolean(hideFromHistory),
    messages: [{
      author: { role: 'user' },
      content: {
        content_type: imageParts.length ? 'multimodal_text' : 'text',
        parts: [text || '', ...imageParts],
      },
      id: randomUUID(),
      metadata: fileAttachments.length ? { attachments: fileAttachments } : {},
    }],
    model: model || 'auto',
    ...(effort ? { thinking_effort: effort } : {}),
    parent_message_id: parentMessageId || randomUUID(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset_min: new Date().getTimezoneOffset(),
  };
}

class ChatGptTransport extends EventEmitter {
  constructor(options = {}) {
    super();
    this.preloadPath = options.preloadPath || path.join(__dirname, 'chatgpt-page-preload.cjs');
    this.partition = options.partition || 'persist:codex-clippy-chatgpt';
    this.refreshAuth = options.refreshAuth || null;
    this.window = null;
    this.ready = false;
    this.startPromise = null;
    this.authToken = null;
    this.requests = new Map();
  }

  async start() {
    if (this.ready && this.window && !this.window.isDestroyed()) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async _start() {
    this.emit('status', { state: 'starting', label: 'Connecting ChatGPT…' });
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = new BrowserWindow({
      show: false,
      width: 480,
      height: 640,
      webPreferences: {
        preload: this.preloadPath,
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window.on('closed', () => { this.window = null; this.ready = false; });
    await this.ensureAuthenticated(true);
    this.ready = true;
    this.emit('status', { state: 'ready', label: 'ChatGPT ready' });
  }

  async ensureAuthenticated(force = false) {
    if (this.refreshAuth) {
      try { await this.refreshAuth(); } catch (error) { this.emit('log', `Codex auth refresh skipped: ${error.message}`); }
    }
    const auth = readCodexAuth();
    if (auth.expiresAt && auth.expiresAt <= Math.floor(Date.now() / 1000) + 30) {
      throw new Error('The ChatGPT login cached by Codex has expired. Sign in to Codex again.');
    }
    if (!force && this.ready && this.authToken === auth.token) return auth;
    if (!this.window || this.window.isDestroyed()) throw new Error('The hidden ChatGPT session is unavailable.');

    await this.window.loadURL(CHATGPT_URL);
    const expiresIn = Math.max(60, auth.expiresAt - Math.floor(Date.now() / 1000));
    const status = await this.window.webContents.executeJavaScript(`fetch('/api/auth/link-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-i-am-a-browser': 'true' },
      body: JSON.stringify(${JSON.stringify({ auth_token: auth.token, expires_in: expiresIn })})
    }).then((response) => response.status)`);
    if (status !== 200) throw new Error(`ChatGPT rejected the Codex login (${status}).`);
    await this.window.loadURL(CHATGPT_URL);
    this.authToken = auth.token;
    return auth;
  }

  async listModels() {
    if (!this.ready) await this.start();
    const auth = await this.ensureAuthenticated();
    const catalog = await this.window.webContents.executeJavaScript(`fetch('/backend-api/models?history_and_training_disabled=false', {
      headers: {
        authorization: ${JSON.stringify(`Bearer ${auth.token}`)},
        'chatgpt-account-id': ${JSON.stringify(auth.accountId)},
        'oai-language': navigator.language || 'en-US'
      }
    }).then(async (response) => {
      if (!response.ok) throw new Error('ChatGPT model list failed (' + response.status + ').');
      return response.json();
    })`);
    return normalizeChatGptModels(catalog);
  }

  async uploadAttachments(attachments = []) {
    if (!attachments.length) return [];
    if (!this.ready) await this.start();
    const auth = await this.ensureAuthenticated();
    const files = attachments.map((attachment) => ({
      ...attachment,
      bytes: fs.readFileSync(attachment.path).toString('base64'),
    }));
    return this.window.webContents.executeJavaScript(`(async () => {
      const files = ${JSON.stringify(files)};
      const headers = {
        authorization: ${JSON.stringify(`Bearer ${auth.token}`)},
        'chatgpt-account-id': ${JSON.stringify(auth.accountId)},
        'content-type': 'application/json',
        'oai-language': navigator.language || 'en-US',
        originator: 'codex_clippy'
      };
      const results = [];
      for (const file of files) {
        const created = await fetch('/backend-api/files', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            file_name: file.name,
            file_size: file.size,
            mime_type: file.mimeType,
            use_case: file.kind === 'image' ? 'multimodal' : 'my_files',
            timezone_offset_min: new Date().getTimezoneOffset(),
            reset_rate_limits: false,
            supports_direct_azure_multipart: true,
          }),
        });
        if (!created.ok) throw new Error('ChatGPT file setup failed (' + created.status + ').');
        const slot = await created.json();
        const binary = Uint8Array.from(atob(file.bytes), (character) => character.charCodeAt(0));
        const uploaded = await fetch(slot.upload_url, {
          method: 'PUT',
          headers: { 'content-type': file.mimeType, 'x-ms-blob-type': 'BlockBlob' },
          body: binary,
        });
        if (!uploaded.ok) throw new Error('ChatGPT file upload failed (' + uploaded.status + ').');
        const marked = await fetch('/backend-api/files/' + slot.file_id + '/uploaded', {
          method: 'POST', headers, body: '{}',
        });
        if (!marked.ok) throw new Error('ChatGPT file finalization failed (' + marked.status + ').');
        results.push({ ...file, bytes: undefined, fileId: slot.file_id });
      }
      return results;
    })()`);
  }

  receivePageEvent(sender, payload) {
    if (!this.window || this.window.isDestroyed() || sender !== this.window.webContents) return false;
    const requestId = payload?.requestId;
    if (!requestId || !this.requests.has(requestId)) return true;
    this.emit('event', { requestId, ...(payload.event || {}) });
    return true;
  }

  async send({ text, conversationId, parentMessageId, hideFromHistory = false, model = 'auto', effort = null, attachments = [] }) {
    if (!this.ready) await this.start();
    const auth = await this.ensureAuthenticated();
    const requestId = randomUUID();
    const uploadedAttachments = await this.uploadAttachments(attachments);
    const body = buildConversationBody({ text, conversationId, parentMessageId, hideFromHistory, model, effort, attachments: uploadedAttachments });
    this.requests.set(requestId, true);
    this.emit('event', { requestId, type: 'started' });
    try {
      const input = { requestId, token: auth.token, accountId: auth.accountId, body };
      return await this.window.webContents.executeJavaScript(`(${runChatGptConversation.toString()})(${JSON.stringify(input)})`);
    } finally {
      this.requests.delete(requestId);
    }
  }

  async stop() {
    if (!this.window || this.window.isDestroyed()) return;
    await this.window.webContents.executeJavaScript(`(() => {
      for (const controller of window.__clippyChatGptRequests?.values?.() || []) controller.abort();
    })()`);
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = false;
    this.startPromise = null;
    this.requests.clear();
  }
}

module.exports = { buildConversationBody, ChatGptTransport, normalizeChatGptModels, readCodexAuth };
