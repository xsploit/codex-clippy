const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { CodexAppServer, titleFromPrompt } = require('../src/app-server.cjs');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => { proc.killed = true; };
  return proc;
}

test('parses split JSONL notifications', async () => {
  const bridge = new CodexAppServer();
  const seen = [];
  bridge.on('notification', (message) => seen.push(message));
  bridge._consume('{"method":"turn/sta');
  bridge._consume('rted","params":{"turn":{"id":"turn-1"}}}\n');
  assert.equal(bridge.turnId, 'turn-1');
  assert.equal(seen[0].method, 'turn/started');
});

test('matches app-server responses to pending requests', async () => {
  const proc = fakeProcess();
  const bridge = new CodexAppServer({ spawnProcess: () => proc });
  bridge.proc = proc;
  const response = bridge.request('test/method', { ok: true });
  const requestLine = await new Promise((resolve) => proc.stdin.once('data', (data) => resolve(data.toString())));
  const request = JSON.parse(requestLine);
  bridge._consume(`${JSON.stringify({ id: request.id, result: { value: 42 } })}\n`);
  assert.deepEqual(await response, { value: 42 });
});

test('answers currentTime/read locally', async () => {
  const proc = fakeProcess();
  const bridge = new CodexAppServer();
  bridge.proc = proc;
  const reply = new Promise((resolve) => proc.stdin.once('data', (data) => resolve(JSON.parse(data.toString()))));
  bridge._handleMessage({ id: 7, method: 'currentTime/read', params: { threadId: 'x' } });
  const message = await reply;
  assert.equal(message.id, 7);
  assert.equal(typeof message.result.currentTimeAt, 'number');
});

test('creates compact chat names from the first prompt', () => {
  assert.equal(titleFromPrompt('## Fix **the build**'), 'Fix the build');
  assert.equal(titleFromPrompt('x'.repeat(80)).length, 50);
  assert.match(titleFromPrompt('x'.repeat(80)), /…$/);
});

test('lists app-server threads for the current workspace', async () => {
  const bridge = new CodexAppServer({ cwd: 'C:\\clippy' });
  let call;
  bridge.request = async (method, params) => {
    call = { method, params };
    return { data: [{ id: 'thread-1' }] };
  };
  assert.deepEqual(await bridge.listThreads(25), [{ id: 'thread-1' }]);
  assert.deepEqual(call, {
    method: 'thread/list',
    params: {
      limit: 25,
      sortKey: 'recency_at',
      sortDirection: 'desc',
      sourceKinds: ['appServer'],
      cwd: 'C:\\clippy',
    },
  });
});

test('resumes a persisted thread and returns its turns', async () => {
  const bridge = new CodexAppServer({ cwd: 'C:\\clippy' });
  bridge.ready = true;
  bridge.threadId = 'old-thread';
  bridge._unsubscribe = async () => {};
  bridge.request = async (method, params) => {
    assert.equal(method, 'thread/resume');
    assert.equal(params.threadId, 'saved-thread');
    return { thread: { id: 'saved-thread', name: 'Saved work', turns: [{ id: 'turn-1', items: [] }] } };
  };
  const thread = await bridge.resumeThread('saved-thread');
  assert.equal(bridge.threadId, 'saved-thread');
  assert.equal(bridge.threadName, 'Saved work');
  assert.equal(thread.turns.length, 1);
});

test('names a fresh thread before starting its first turn', async () => {
  const bridge = new CodexAppServer();
  bridge.ready = true;
  bridge.threadId = 'thread-1';
  const calls = [];
  bridge.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    return {};
  };
  await bridge.sendPrompt('Make the menu persistent');
  assert.deepEqual(calls.map((call) => call.method), ['thread/name/set', 'turn/start']);
  assert.equal(calls[0].params.name, 'Make the menu persistent');
});

test('starts a multimodal turn with selected model, effort, and permissions', async () => {
  const bridge = new CodexAppServer();
  bridge.ready = true;
  bridge.threadId = 'thread-1';
  bridge.threadName = 'Attachments';
  let call;
  bridge.request = async (method, params) => {
    call = { method, params };
    return { turn: { id: 'turn-1' } };
  };
  await bridge.sendPrompt({
    text: 'Compare these',
    attachments: [
      { kind: 'image', name: 'screen.png', path: 'C:\\screen.png' },
      { kind: 'file', name: 'notes.md', path: 'C:\\notes.md' },
    ],
  }, { model: 'gpt-5.6-sol', effort: 'high', permissions: ':danger-full-access' });
  assert.equal(call.method, 'turn/start');
  assert.deepEqual(call.params.input, [
    { type: 'text', text: 'Compare these', text_elements: [] },
    { type: 'localImage', path: 'C:\\screen.png', detail: 'auto' },
    { type: 'mention', name: 'notes.md', path: 'C:\\notes.md' },
  ]);
  assert.equal(call.params.model, 'gpt-5.6-sol');
  assert.equal(call.params.effort, 'high');
  assert.equal(call.params.permissions, ':danger-full-access');
});

test('loads models and permission profiles from the app server', async () => {
  const bridge = new CodexAppServer();
  bridge.request = async (method) => ({ data: [{ id: method }] });
  assert.deepEqual(await bridge.listModels(), [{ id: 'model/list' }]);
  assert.deepEqual(await bridge.listPermissionProfiles(), [{ id: 'permissionProfile/list' }]);
});

test('reads an unmaterialized fresh thread as an empty chat', async () => {
  const bridge = new CodexAppServer();
  const calls = [];
  bridge.request = async (method, params) => {
    calls.push({ method, params });
    if (params.includeTurns) throw new Error('thread is not materialized yet; includeTurns is unavailable before first user message');
    return { thread: { id: 'fresh-thread', name: null } };
  };
  const thread = await bridge.readThread('fresh-thread', true);
  assert.deepEqual(calls.map((call) => call.params.includeTurns), [true, false]);
  assert.deepEqual(thread.turns, []);
});
