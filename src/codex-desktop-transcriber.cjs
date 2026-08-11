const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/transcribe';
const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

class CodexDesktopTranscriber {
  constructor({
    authPath = path.join(os.homedir(), '.codex', 'auth.json'),
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = globalThis.fetch,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  } = {}) {
    this.authPath = authPath;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
  }

  async transcribe(audio, mimeType = 'audio/webm') {
    const bytes = Buffer.from(audio || []);
    if (bytes.length < 256) throw new Error('The microphone recording was empty.');
    if (bytes.length > MAX_RECORDING_BYTES) throw new Error('That recording is too large to transcribe.');

    const auth = JSON.parse(await fs.readFile(this.authPath, 'utf8'));
    const accessToken = auth.tokens?.access_token;
    if (!accessToken) throw new Error('The Codex login does not contain an access token.');

    const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : mimeType.includes('wav') ? 'wav' : 'webm';
    const body = new FormData();
    body.append('file', new Blob([bytes], { type: mimeType || 'audio/webm' }), `codex.${extension}`);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Origin: 'https://chatgpt.com',
      Referer: 'https://chatgpt.com/',
      'User-Agent': this.userAgent,
    };
    if (auth.tokens?.account_id) headers['ChatGPT-Account-Id'] = auth.tokens.account_id;

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.text();
    if (!response.ok) {
      const detail = response.headers?.get?.('content-type')?.includes('application/json')
        ? payload.slice(0, 300)
        : `HTTP ${response.status}`;
      throw new Error(`Codex desktop transcription failed: ${detail}`);
    }
    const result = JSON.parse(payload);
    const text = String(result.text || '').trim();
    if (!text) throw new Error('Codex desktop transcription did not hear any speech.');
    return { text, provider: 'codex-desktop-transcribe' };
  }
}

module.exports = { CodexDesktopTranscriber };
