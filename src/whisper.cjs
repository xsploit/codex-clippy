const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

class WhisperTranscriber extends EventEmitter {
  constructor({ workerPath, spawnProcess = spawn, tempDir = os.tmpdir() } = {}) {
    super();
    this.workerPath = workerPath;
    this.spawnProcess = spawnProcess;
    this.tempDir = tempDir;
    this.proc = null;
    this.buffer = '';
    this.requestId = 0;
    this.pending = new Map();
    this.stderrTail = '';
    this.stopping = false;
  }

  async transcribe(audio, mimeType = '') {
    const bytes = Buffer.from(audio || []);
    if (bytes.length < 256) throw new Error('The microphone recording was empty.');
    if (bytes.length > MAX_RECORDING_BYTES) throw new Error('That recording is too large to transcribe.');

    this._start();
    const extension = mimeType.includes('ogg') ? '.ogg' : mimeType.includes('mp4') ? '.m4a' : '.webm';
    const audioPath = path.join(this.tempDir, `codex-clippy-${randomUUID()}${extension}`);
    await fs.writeFile(audioPath, bytes);
    try {
      return await this._request({ path: audioPath });
    } finally {
      await fs.unlink(audioPath).catch(() => {});
    }
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

  _start() {
    if (this.proc) return;
    if (!this.workerPath) throw new Error('The local Whisper worker is missing.');
    this.stopping = false;
    this.stderrTail = '';
    const command = process.platform === 'win32' ? 'py' : 'python3';
    const args = process.platform === 'win32'
      ? ['-3.10', '-u', this.workerPath]
      : ['-u', this.workerPath];
    this.proc = this.spawnProcess(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._consume(chunk));
    this.proc.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_000);
      const message = String(chunk).trim();
      if (message) this.emit('log', message);
    });
    this.proc.on('error', (error) => this._failAll(error));
    this.proc.on('exit', (code, signal) => {
      const expected = this.stopping && (code === 0 || signal);
      this.proc = null;
      if (!expected) {
        const detail = this.stderrTail.trim().split(/\r?\n/).pop();
        this._failAll(new Error(detail || `Local Whisper exited with code ${code}. Install faster-whisper for Python 3.10.`));
      }
    });
  }

  _request(params) {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Local Whisper transcription timed out.'));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.proc.stdin.write(`${JSON.stringify({ id, ...params })}\n`);
    });
  }

  _consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.emit('log', `Unexpected Whisper output: ${line}`);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    }
  }

  _failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

module.exports = { WhisperTranscriber };
