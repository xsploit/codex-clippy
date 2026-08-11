const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { OpenAIRealtimeTranscriber } = require('../src/realtime-transcriber.cjs');

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static last = null;

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.last = this;
    process.nextTick(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }

  send(raw) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.type === 'session.update') {
      process.nextTick(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated', session: { id: 'stt-1' } }))));
    } else if (message.type === 'input_audio_buffer.commit') {
      process.nextTick(() => {
        this.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'hello ' })));
        this.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello Clippy' })));
      });
    }
  }

  close(code, reason) {
    this.readyState = FakeWebSocket.CLOSED;
    process.nextTick(() => this.emit('close', code, Buffer.from(reason || '')));
  }
}

test('streams PCM16 to the official Realtime transcription protocol and commits the turn', async () => {
  const transcriber = new OpenAIRealtimeTranscriber({
    apiKey: 'test-key',
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 1_000,
  });
  const deltas = [];
  transcriber.on('delta', (delta) => deltas.push(delta));

  const session = await transcriber.start();
  assert.equal(session.model, 'gpt-live-transcribe');
  assert.equal(FakeWebSocket.last.url, 'wss://api.openai.com/v1/realtime?intent=transcription');
  assert.equal(FakeWebSocket.last.options.headers.Authorization, 'Bearer test-key');
  assert.equal(FakeWebSocket.last.sent[0].session.type, 'transcription');
  assert.equal(FakeWebSocket.last.sent[0].session.audio.input.format.rate, 24_000);
  assert.equal(FakeWebSocket.last.sent[0].session.audio.input.turn_detection, null);

  transcriber.appendAudio(Buffer.from([1, 0, 2, 0]));
  assert.deepEqual(FakeWebSocket.last.sent[1], { type: 'input_audio_buffer.append', audio: 'AQACAA==' });
  const result = await transcriber.stop();
  assert.deepEqual(result, { text: 'hello Clippy', provider: 'openai-realtime', model: 'gpt-live-transcribe' });
  assert.deepEqual(deltas, ['hello ']);
  assert.equal(FakeWebSocket.last.sent[2].type, 'input_audio_buffer.commit');
});

test('requires an API key before opening a transcription socket', async () => {
  const transcriber = new OpenAIRealtimeTranscriber({ apiKey: '', WebSocketImpl: FakeWebSocket });
  await assert.rejects(() => transcriber.start(), /OPENAI_API_KEY/);
});
