function runChatGptConversation(input) {
  const emit = (event) => window.clippyChatGptHost.emit(input.requestId, event);
  const authHeaders = {
    authorization: `Bearer ${input.token}`,
    'chatgpt-account-id': input.accountId,
    'content-type': 'application/json',
    'oai-language': navigator.language || 'en-US',
    originator: 'codex_clippy',
  };
  const encode = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
  const choose = (values) => values[Math.floor(Math.random() * values.length)];
  const fingerprint = () => {
    const memory = performance.memory;
    return [
      screen.width + screen.height, String(new Date()), memory?.jsHeapSizeLimit ?? null, Math.random(), navigator.userAgent,
      choose(Array.from(document.scripts).map((script) => script?.src).filter(Boolean)) || '',
      (Array.from(document.scripts || []).map((script) => script?.src?.match('c/[^/]*/_')).filter((match) => match?.length)[0] || [])[0]
        || document.documentElement.getAttribute('data-build'),
      navigator.language, navigator.languages?.join(','), Math.random(), '', choose(Object.keys(document)) || '',
      choose(Object.keys(window)) || '', performance.now(), localStorage.getItem('codex.chatgpt-conversations.device-id'),
      [...new URLSearchParams(window.location.search).keys()].join(','), navigator.hardwareConcurrency, performance.timeOrigin,
      Number('ai' in window), Number('createPRNG' in window), Number('cache' in window), Number('data' in window),
      Number('solana' in window), Number('dump' in window), Number('InstallTrigger' in window),
    ];
  };
  const hash = (value) => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619) >>> 0;
    }
    result ^= result >>> 16; result = Math.imul(result, 2246822507) >>> 0;
    result ^= result >>> 13; result = Math.imul(result, 3266489909) >>> 0;
    result ^= result >>> 16;
    return (result >>> 0).toString(16).padStart(8, '0');
  };
  const solveProof = (seed, difficulty) => {
    const started = performance.now();
    const values = fingerprint();
    for (let nonce = 0; nonce < 500000; nonce += 1) {
      values[3] = nonce;
      values[9] = Math.round(performance.now() - started);
      const candidate = encode(values);
      if (hash(`${seed}${candidate}`).substring(0, difficulty.length) <= difficulty) return `gAAAAAB${candidate}~S`;
    }
    return `gAAAAAB${encode('e')}`;
  };
  const xor = (value, key) => {
    let result = '';
    for (let index = 0; index < value.length; index += 1) result += String.fromCharCode(value.charCodeAt(index) ^ key.charCodeAt(index % key.length));
    return result;
  };
  const runVm = (encoded, key) => new Promise((resolve, reject) => {
    const memory = new Map();
    let steps = 0;
    let done = false;
    const finish = (callback, value) => { if (!done) { done = true; callback(value); } };
    const run = async () => {
      while (memory.get(9).length > 0) {
        const [opcode, ...args] = memory.get(9).shift() || [];
        const output = memory.get(opcode)?.(...args);
        if (output && typeof output.then === 'function') await output;
        steps += 1;
      }
    };
    const install = () => {
      memory.clear();
      memory.set(0, (value) => runVm(value, String(memory.get(16))));
      memory.set(1, (target, source) => memory.set(target, xor(String(memory.get(target)), String(memory.get(source)))));
      memory.set(2, (target, value) => memory.set(target, value));
      memory.set(3, (value) => finish(resolve, btoa(String(value))));
      memory.set(4, (value) => finish(reject, btoa(String(value))));
      memory.set(5, (target, source) => { const value = memory.get(target); if (Array.isArray(value)) value.push(memory.get(source)); else memory.set(target, value + memory.get(source)); });
      memory.set(27, (target, source) => { const value = memory.get(target); if (Array.isArray(value)) value.splice(value.indexOf(memory.get(source)), 1); else memory.set(target, value - memory.get(source)); });
      memory.set(29, (target, left, right) => memory.set(target, Number(memory.get(left)) < Number(memory.get(right))));
      memory.set(33, (target, left, right) => memory.set(target, Number(memory.get(left)) * Number(memory.get(right))));
      memory.set(35, (target, left, right) => { const divisor = Number(memory.get(right)); memory.set(target, divisor === 0 ? 0 : Number(memory.get(left)) / divisor); });
      memory.set(6, (target, object, property) => memory.set(target, memory.get(object)[String(memory.get(property))]));
      memory.set(7, (fn, ...args) => memory.get(fn)(...args.map((arg) => memory.get(arg))));
      memory.set(17, (target, fn, ...args) => { try { const value = memory.get(fn)(...args.map((arg) => memory.get(arg))); if (value?.then) return value.then((result) => memory.set(target, result)).catch((error) => memory.set(target, String(error))); memory.set(target, value); } catch (error) { memory.set(target, String(error)); } });
      memory.set(13, (target, fn, ...args) => { try { memory.get(fn)(...args); } catch (error) { memory.set(target, String(error)); } });
      memory.set(8, (target, source) => memory.set(target, memory.get(source)));
      memory.set(10, window);
      memory.set(11, (target, pattern) => memory.set(target, (Array.from(document.scripts || []).map((script) => script?.src?.match(String(memory.get(pattern)))).filter((match) => match?.length)[0] || [])[0] || null));
      memory.set(12, (target) => memory.set(target, memory));
      memory.set(14, (target, source) => memory.set(target, JSON.parse(String(memory.get(source)))));
      memory.set(15, (target, source) => memory.set(target, JSON.stringify(memory.get(source))));
      memory.set(18, (target) => memory.set(target, atob(String(memory.get(target)))));
      memory.set(19, (target) => memory.set(target, btoa(String(memory.get(target)))));
      memory.set(20, (left, right, fn, ...args) => memory.get(left) === memory.get(right) ? memory.get(fn)(...args) : null);
      memory.set(21, (left, right, threshold, fn, ...args) => Math.abs(Number(memory.get(left)) - Number(memory.get(right))) > Number(memory.get(threshold)) ? memory.get(fn)(...args) : null);
      memory.set(23, (value, fn, ...args) => memory.get(value) === undefined ? null : memory.get(fn)(...args));
      memory.set(24, (target, object, property) => { const value = memory.get(object); memory.set(target, value[String(memory.get(property))].bind(value)); });
      memory.set(34, (target, source) => Promise.resolve(memory.get(source)).then((value) => memory.set(target, value)));
      memory.set(22, (target, queue) => { const previous = [...memory.get(9)]; memory.set(9, [...queue]); return run().catch((error) => memory.set(target, String(error))).finally(() => memory.set(9, previous)); });
      memory.set(25, () => undefined); memory.set(26, () => undefined); memory.set(28, () => undefined);
      memory.set(30, (target, result, params, queue) => { const named = Array.isArray(queue); const names = named ? params : []; const instructions = (named ? queue : params) || []; memory.set(target, (...values) => { if (done) return undefined; const previous = [...memory.get(9)]; if (named) names.forEach((name, index) => memory.set(name, values[index])); memory.set(9, [...instructions]); return run().then(() => memory.get(result)).catch((error) => String(error)).finally(() => memory.set(9, previous)); }); });
    };
    install(); memory.set(16, key);
    setTimeout(() => finish(resolve, String(steps)), 500);
    try { memory.set(9, JSON.parse(xor(atob(encoded), String(memory.get(16))))); run().catch((error) => finish(resolve, btoa(`${steps}: ${String(error)}`))); }
    catch (error) { finish(resolve, btoa(`${steps}: ${String(error)}`)); }
  });
  const parseEvent = (raw, state) => {
    if (raw === '[DONE]') return;
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data.conversation_id) state.conversationId = data.conversation_id;
    if (data.type === 'message_stream_complete') state.conversationId = data.conversation_id || state.conversationId;
    const message = data.message;
    if (!message || message.author?.role !== 'assistant' || message.content?.content_type !== 'text') return;
    if (message.metadata?.is_visually_hidden_from_conversation) return;
    if (message.channel && message.channel !== 'final') return;
    const text = (message.content.parts || []).filter((part) => typeof part === 'string').join('');
    if (!text || text === state.text) return;
    state.text = text;
    state.parentMessageId = message.id || state.parentMessageId;
    emit({ type: 'text', text, conversationId: state.conversationId, parentMessageId: state.parentMessageId });
  };

  return (async () => {
    const controller = new AbortController();
    window.__clippyChatGptRequests ||= new Map();
    window.__clippyChatGptRequests.set(input.requestId, controller);
    const requirementsKey = `gAAAAAC${encode(fingerprint())}`;
    const requirementsResponse = await fetch('/backend-api/sentinel/chat-requirements/prepare', {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ p: requirementsKey }), signal: controller.signal,
    });
    if (!requirementsResponse.ok) throw new Error(`ChatGPT integrity check failed (${requirementsResponse.status}).`);
    const requirements = await requirementsResponse.json();
    const proof = requirements.proofofwork?.required ? solveProof(requirements.proofofwork.seed, requirements.proofofwork.difficulty) : null;
    const turnstile = requirements.turnstile?.required ? await runVm(requirements.turnstile.dx, requirementsKey) : null;
    const integrityHeaders = {};
    if (requirements.token) integrityHeaders['OpenAI-Sentinel-Chat-Requirements-Token'] = requirements.token;
    else if (requirements.prepare_token) integrityHeaders['OpenAI-Sentinel-Chat-Requirements-Prepare-Token'] = requirements.prepare_token;
    if (proof) integrityHeaders['OpenAI-Sentinel-Proof-Token'] = proof;
    if (turnstile) integrityHeaders['OpenAI-Sentinel-Turnstile-Token'] = turnstile;

    let conduit = 'no-token';
    try {
      const prepared = await fetch('/backend-api/f/conversation/prepare', {
        method: 'POST', headers: authHeaders, body: JSON.stringify(input.body), signal: controller.signal,
      });
      if (prepared.ok) conduit = (await prepared.json()).conduit_token || conduit;
    } catch {}

    const response = await fetch('/backend-api/f/conversation', {
      method: 'POST',
      headers: { ...authHeaders, ...integrityHeaders, 'x-conduit-token': conduit },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`ChatGPT conversation failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    const state = { text: '', conversationId: input.body.conversation_id || null, parentMessageId: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split('\n')) if (line.startsWith('data:')) parseEvent(line.slice(5).trim(), state);
      }
      if (done) break;
    }
    window.__clippyChatGptRequests.delete(input.requestId);
    const result = { text: state.text, conversationId: state.conversationId, parentMessageId: state.parentMessageId };
    emit({ type: 'done', ...result });
    return result;
  })().catch((error) => {
    window.__clippyChatGptRequests?.delete(input.requestId);
    if (error?.name === 'AbortError') {
      emit({ type: 'cancelled' });
      return { text: '', conversationId: input.body.conversation_id || null, parentMessageId: null, cancelled: true };
    }
    emit({ type: 'error', message: error?.message || String(error) });
    throw error;
  });
}

module.exports = { runChatGptConversation };
