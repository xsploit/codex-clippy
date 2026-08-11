const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const DEFAULT_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const DEFAULT_MODEL = 'gpt-live-transcribe';
const DEFAULT_TIMEOUT_MS = 30_000;

class OpenAIRealtimeTranscriber extends EventEmitter {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    WebSocketImpl = WebSocket,
    url = DEFAULT_URL,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.WebSocketImpl = WebSocketImpl;
    this.url = url;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.active = false;
    this.deltaText = '';
  }

  async start() {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not available for GPT transcription.');
    if (this.socket) throw new Error('A GPT transcription session is already active.');

    this.deltaText = '';
    const socket = new this.WebSocketImpl(this.url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
    this.socket = socket;
    socket.on('message', (data) => this._handleMessage(data));
    socket.on('error', (error) => this._handleSocketError(error));
    socket.on('close', (code, reason) => {
      const wasActive = this.active;
      this.socket = null;
      this.active = false;
      this.emit('_closed', { code, reason: reason?.toString() || '', wasActive });
    });

    try {
      await this._waitForOpen(socket);
      const updated = this._waitForEvent('session.updated');
      this._send({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24_000 },
              transcription: { model: this.model },
              turn_detection: null,
            },
          },
        },
      });
      await updated;
      this.active = true;
      return { sampleRate: 24_000, numChannels: 1, model: this.model };
    } catch (error) {
      this.cancel();
      throw new Error(`GPT transcription could not start: ${error.message}`);
    }
  }

  appendAudio(audio) {
    if (!this.active) throw new Error('No GPT transcription session is active.');
    const bytes = Buffer.from(audio || []);
    if (!bytes.length) return { ok: true };
    this._send({ type: 'input_audio_buffer.append', audio: bytes.toString('base64') });
    return { ok: true };
  }

  async stop() {
    if (!this.active) throw new Error('No GPT transcription session is active.');
    const completed = this._waitForEvent('conversation.item.input_audio_transcription.completed');
    this._send({ type: 'input_audio_buffer.commit' });
    try {
      const event = await completed;
      const text = String(event.transcript || this.deltaText).trim();
      if (!text) throw new Error('GPT transcription did not hear any speech.');
      return { text, provider: 'openai-realtime', model: this.model };
    } finally {
      this.cancel();
    }
  }

  cancel() {
    const socket = this.socket;
    this.socket = null;
    this.active = false;
    if (!socket) return;
    if (socket.readyState === this.WebSocketImpl.OPEN || socket.readyState === this.WebSocketImpl.CONNECTING) {
      socket.close(1000, 'dictation finished');
    }
  }

  _send(message) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error('The GPT transcription connection is not open.');
    }
    this.socket.send(JSON.stringify(message));
  }

  _handleMessage(data) {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    this.emit('_event', event);
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      const delta = String(event.delta || '');
      this.deltaText += delta;
      this.emit('delta', delta);
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.emit('done', String(event.transcript || this.deltaText));
    } else if (event.type === 'error') {
      this.emit('transcription-error', new Error(event.error?.message || event.message || 'Realtime transcription failed.'));
    }
  }

  _handleSocketError(error) {
    this.emit('transcription-error', error);
    this.emit('_socket-error', error);
  }

  _waitForOpen(socket) {
    if (socket.readyState === this.WebSocketImpl.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Realtime connection timed out.')), this.timeoutMs);
      const onOpen = () => finish();
      const onError = (error) => finish(error);
      const onClose = () => finish(new Error('Realtime connection closed before opening.'));
      const finish = (error) => {
        clearTimeout(timeout);
        socket.removeListener('open', onOpen);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        if (error) reject(error);
        else resolve();
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('close', onClose);
    });
  }

  _waitForEvent(type) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`${type} timed out.`)), this.timeoutMs);
      const onEvent = (event) => {
        if (event.type === type) finish(null, event);
        else if (event.type === 'error') finish(new Error(event.error?.message || event.message || 'Realtime transcription failed.'));
      };
      const onError = (error) => finish(error);
      const onClose = () => finish(new Error('Realtime transcription connection closed early.'));
      const finish = (error, event) => {
        clearTimeout(timeout);
        this.removeListener('_event', onEvent);
        this.removeListener('_socket-error', onError);
        this.removeListener('_closed', onClose);
        if (error) reject(error);
        else resolve(event);
      };
      this.on('_event', onEvent);
      this.once('_socket-error', onError);
      this.once('_closed', onClose);
    });
  }
}

module.exports = { OpenAIRealtimeTranscriber };
