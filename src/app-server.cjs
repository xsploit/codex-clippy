const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30_000;

function titleFromPrompt(text) {
  const clean = String(text || '')
    .replace(/[`*_#>\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'New Clippy chat';
  return clean.length > 52 ? `${clean.slice(0, 49).trimEnd()}…` : clean;
}

class CodexAppServer extends EventEmitter {
  constructor({ cwd, spawnProcess = spawn } = {}) {
    super();
    this.cwd = cwd || process.cwd();
    this.spawnProcess = spawnProcess;
    this.proc = null;
    this.buffer = '';
    this.requestId = 0;
    this.pending = new Map();
    this.threadId = null;
    this.threadName = null;
    this.turnId = null;
    this.ready = false;
    this.stopping = false;
    this.composer = {
      model: null,
      effort: null,
      permissions: ':workspace',
    };
  }

  configureComposer(options = {}) {
    this.composer = {
      ...this.composer,
      model: options.model || null,
      effort: options.effort || null,
      permissions: options.permissions || ':workspace',
    };
  }

  _threadOptions() {
    return {
      cwd: this.cwd,
      approvalPolicy: 'on-request',
      permissions: this.composer.permissions,
      personality: 'friendly',
      ...(this.composer.model ? { model: this.composer.model } : {}),
    };
  }

  async start(resumeThreadId = null) {
    if (this.proc) return this.threadId;
    this.stopping = false;

    this.emit('status', { state: 'starting', label: 'Starting Codex…' });
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'codex';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'codex app-server'] : ['app-server'];
    this.proc = this.spawnProcess(command, args, {
      cwd: this.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._consume(chunk));
    this.proc.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit('log', message);
    });
    this.proc.on('error', (error) => this._failAll(error));
    this.proc.on('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      if (!this.stopping) this._failAll(new Error(`Codex app server exited (${detail}).`));
      this.proc = null;
      this.ready = false;
      if (!this.stopping) this.emit('status', { state: 'offline', label: 'Codex disconnected' });
    });

    await this.request('initialize', {
      clientInfo: {
        name: 'codex_clippy',
        title: 'Codex Clippy',
        version: '0.9.1',
      },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});

    let thread;
    if (resumeThreadId) {
      try {
        const resumed = await this.request('thread/resume', {
          threadId: resumeThreadId,
          ...this._threadOptions(),
        });
        thread = resumed.thread;
      } catch (error) {
        this.emit('log', `Could not resume ${resumeThreadId}: ${error.message}`);
      }
    }

    if (!thread) thread = await this._startThread();
    this.threadId = thread.id;
    this.threadName = thread.name || null;
    this.ready = true;
    this.emit('thread', { threadId: this.threadId });
    this.emit('status', { state: 'ready', label: 'Codex ready' });
    return this.threadId;
  }

  async _startThread() {
    const result = await this.request('thread/start', {
      ...this._threadOptions(),
      developerInstructions: [
        'You are speaking through a tiny desktop assistant called Codex Clippy.',
        'Be concise, useful, a little cheeky, and always truthful about actions you took.',
        'The visible UI is a compact speech bubble, so prefer short paragraphs unless detail is necessary.',
        'You have the normal Codex tools, installed skills, apps, and computer-control capabilities configured on this machine; use them when appropriate.',
      ].join(' '),
    });
    return result.thread;
  }

  async newThread() {
    const previousThreadId = this.threadId;
    const thread = await this._startThread();
    this.threadId = thread.id;
    this.threadName = thread.name || null;
    this.turnId = null;
    this.emit('thread', { threadId: this.threadId });
    if (previousThreadId && previousThreadId !== this.threadId) this._unsubscribe(previousThreadId);
    return thread;
  }

  async resumeThread(threadId) {
    if (!this.ready) throw new Error('Codex is not ready yet.');
    if (this.turnId) throw new Error('Finish or stop the current turn before switching chats.');
    if (threadId === this.threadId) return this.readThread(threadId, true);

    const previousThreadId = this.threadId;
    const result = await this.request('thread/resume', {
      threadId,
      ...this._threadOptions(),
    });
    this.threadId = result.thread.id;
    this.threadName = result.thread.name || null;
    this.turnId = null;
    this.emit('thread', { threadId: this.threadId });
    if (previousThreadId && previousThreadId !== this.threadId) this._unsubscribe(previousThreadId);
    return result.thread;
  }

  async listThreads(limit = 100) {
    const result = await this.request('thread/list', {
      limit,
      sortKey: 'recency_at',
      sortDirection: 'desc',
      sourceKinds: ['appServer'],
      cwd: this.cwd,
    });
    return result.data || [];
  }

  async readThread(threadId, includeTurns = true) {
    try {
      const result = await this.request('thread/read', { threadId, includeTurns });
      return result.thread;
    } catch (error) {
      if (includeTurns && /not materialized yet|includeTurns is unavailable/i.test(error.message)) {
        const result = await this.request('thread/read', { threadId, includeTurns: false });
        return { ...result.thread, turns: [] };
      }
      throw error;
    }
  }

  async listModels(limit = 100) {
    const result = await this.request('model/list', { limit, includeHidden: false });
    return result.data || [];
  }

  async listPermissionProfiles(limit = 100) {
    const result = await this.request('permissionProfile/list', { limit });
    return result.data || [];
  }

  async _unsubscribe(threadId) {
    try {
      await this.request('thread/unsubscribe', { threadId });
    } catch (error) {
      this.emit('log', `Could not unsubscribe from ${threadId}: ${error.message}`);
    }
  }

  async sendPrompt(prompt, options = {}) {
    if (!this.ready || !this.threadId) throw new Error('Codex is not ready yet.');
    const payload = typeof prompt === 'string' ? { text: prompt, attachments: [] } : (prompt || {});
    const text = String(payload.text || '').trim();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (!text && !attachments.length) throw new Error('Give Clippy something to do first.');
    if (!this.threadName) {
      const name = titleFromPrompt(text || attachments[0]?.name || 'Attached file');
      try {
        await this.request('thread/name/set', { threadId: this.threadId, name });
        this.threadName = name;
      } catch (error) {
        this.emit('log', `Could not name chat: ${error.message}`);
      }
    }
    const input = [];
    if (text) input.push({ type: 'text', text, text_elements: [] });
    for (const attachment of attachments) {
      if (!attachment?.path) continue;
      if (attachment.kind === 'image') {
        input.push({ type: 'localImage', path: attachment.path, detail: 'auto' });
      } else {
        input.push({ type: 'mention', name: attachment.name || attachment.path, path: attachment.path });
      }
    }
    const selected = { ...this.composer, ...options };
    const result = await this.request('turn/start', {
      threadId: this.threadId,
      input,
      model: selected.model || null,
      effort: selected.effort || null,
      permissions: selected.permissions || ':workspace',
    }, 60_000);
    this.turnId = result.turn.id;
    return result.turn;
  }

  async interrupt() {
    if (!this.threadId || !this.turnId) return;
    await this.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    });
  }

  reply(id, result) {
    this._write({ id, result });
  }

  replyError(id, code, message) {
    this._write({ id, error: { code, message } });
  }

  notify(method, params) {
    this._write({ method, params });
  }

  request(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
      try {
        this._write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  stop() {
    if (!this.proc) return;
    this.stopping = true;
    this.proc.stdin.end();
    const proc = this.proc;
    setTimeout(() => {
      if (!proc.killed) proc.kill();
    }, 1_000).unref();
  }

  _write(message) {
    if (!this.proc?.stdin?.writable) throw new Error('Codex app server is not running.');
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this._handleMessage(JSON.parse(line));
      } catch (error) {
        this.emit('log', `Bad app-server message: ${error.message}`);
      }
    }
  }

  _handleMessage(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `${pending.method} failed.`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      if (message.method === 'currentTime/read') {
        this.reply(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      }
      this.emit('server-request', message);
      return;
    }

    if (message.method === 'turn/started') this.turnId = message.params?.turn?.id || this.turnId;
    if (message.method === 'turn/completed') this.turnId = null;
    this.emit('notification', message);
  }

  _failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('error', error);
  }
}

module.exports = { CodexAppServer, titleFromPrompt };
