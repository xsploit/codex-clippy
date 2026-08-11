import { createClippySvgAgent } from './clippy-svg.js';

const api = window.codexClippy;
const markdown = window.createClippyMarkdown();
const bubble = document.querySelector('#bubble');
const openBubble = document.querySelector('#open-bubble');
const transcript = document.querySelector('#transcript');
const form = document.querySelector('#composer');
const prompt = document.querySelector('#prompt');
const sendButton = document.querySelector('#send');
const stopButton = document.querySelector('#stop');
const micButton = document.querySelector('#mic');
const requestPanel = document.querySelector('#request-panel');
const statusLabel = document.querySelector('#status-label');
const statusDot = document.querySelector('#status-dot');
const historyButton = document.querySelector('#chat-history');
const headerNewChatButton = document.querySelector('#new-chat');
const chatMenu = document.querySelector('#chat-menu');
const chatList = document.querySelector('#chat-list');
const chatMenuNewButton = document.querySelector('#chat-menu-new');
const closeChatMenuButton = document.querySelector('#close-chat-menu');
const chatMenuSource = document.querySelector('#chat-menu-source');
const modeButtons = [...document.querySelectorAll('#mode-switch [data-mode]')];
const attachButton = document.querySelector('#attach');
const attachmentList = document.querySelector('#attachment-list');
const modelSelect = document.querySelector('#model-select');
const effortSelect = document.querySelector('#effort-select');
const effortWrap = document.querySelector('#effort-wrap');
const permissionSelect = document.querySelector('#permission-select');
const permissionWrap = document.querySelector('#permission-wrap');

let agent;
let busy = false;
let responseNode = null;
let responseText = '';
let activeRequest = null;
let drag = null;
let lastIgnoreState = null;
let microphoneStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let microphoneSource = null;
let audioProcessor = null;
let muteGain = null;
let nativeTranscriptionActive = false;
let nativeTranscriptionError = null;
let pendingAudioWrites = new Set();
let dictationFinalText = '';
let dictationLiveText = '';
let recording = false;
let finishingTranscript = false;
let dictationPrefix = '';
let currentThreadId = null;
let loadingChats = false;
let currentMode = 'chatgpt';
let attachments = [];
let composerOptions = null;

function readyLabel() {
  return currentMode === 'chatgpt' ? 'ChatGPT ready' : 'Codex ready';
}

function workingLabel() {
  return currentMode === 'chatgpt' ? 'ChatGPT is thinking…' : 'Codex is working…';
}

function canSend() {
  return !busy && !recording && !finishingTranscript && Boolean(prompt.value.trim() || attachments.length);
}

function updateComposerEnabled() {
  sendButton.disabled = !canSend();
  attachButton.disabled = busy || recording || finishingTranscript;
  modelSelect.disabled = busy || recording || finishingTranscript;
  effortSelect.disabled = busy || recording || finishingTranscript;
  permissionSelect.disabled = busy || recording || finishingTranscript;
}

function fillSelect(select, options, selected) {
  select.replaceChildren();
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.id;
    node.textContent = option.label || option.id;
    node.title = option.description || '';
    node.disabled = option.allowed === false;
    node.selected = option.id === selected;
    select.appendChild(node);
  }
}

function renderEfforts(selectedEffort = composerOptions?.selectedEffort) {
  const model = composerOptions?.models?.find((option) => option.id === modelSelect.value);
  const efforts = currentMode === 'codex' ? (model?.efforts || []) : [];
  effortWrap.hidden = !efforts.length;
  fillSelect(effortSelect, efforts, selectedEffort || model?.defaultEffort);
}

async function refreshComposerOptions() {
  modelSelect.replaceChildren(new Option('Loading…', ''));
  modelSelect.disabled = true;
  try {
    composerOptions = await api.getComposerOptions(currentMode);
    fillSelect(modelSelect, composerOptions.models || [], composerOptions.selectedModel);
    renderEfforts(composerOptions.selectedEffort);
    permissionWrap.hidden = currentMode !== 'codex';
    fillSelect(permissionSelect, composerOptions.permissions || [], composerOptions.selectedPermissions);
  } catch (error) {
    modelSelect.replaceChildren(new Option('Auto', 'auto'));
    effortWrap.hidden = true;
    permissionWrap.hidden = currentMode !== 'codex';
    console.warn(`Composer options unavailable: ${error.message}`);
  }
  updateComposerEnabled();
}

async function saveComposerSettings() {
  try {
    composerOptions = await api.setComposerSettings(currentMode, {
      model: modelSelect.value,
      effort: currentMode === 'codex' ? (effortSelect.value || null) : null,
      permissions: currentMode === 'codex' ? permissionSelect.value : null,
    });
    fillSelect(modelSelect, composerOptions.models || [], composerOptions.selectedModel);
    renderEfforts(composerOptions.selectedEffort);
    if (currentMode === 'codex') fillSelect(permissionSelect, composerOptions.permissions || [], composerOptions.selectedPermissions);
  } catch (error) {
    showError(error.message);
  }
  updateComposerEnabled();
}

function renderAttachments() {
  attachmentList.replaceChildren();
  attachmentList.hidden = !attachments.length;
  for (const attachment of attachments) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (attachment.preview) {
      const preview = document.createElement('img');
      preview.src = attachment.preview;
      preview.alt = '';
      chip.appendChild(preview);
    } else {
      const icon = document.createElement('span');
      icon.textContent = '📎';
      chip.appendChild(icon);
    }
    const name = document.createElement('span');
    name.textContent = attachment.name;
    name.title = attachment.path;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    remove.addEventListener('click', () => {
      attachments = attachments.filter((item) => item.id !== attachment.id);
      renderAttachments();
    });
    chip.append(name, remove);
    attachmentList.appendChild(chip);
  }
  updateComposerEnabled();
}

function renderMode() {
  for (const button of modeButtons) {
    const active = button.dataset.mode === currentMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  chatMenuSource.textContent = currentMode === 'chatgpt' ? 'ChatGPT.com + Clippy conversations' : 'Persisted by Codex';
  prompt.placeholder = currentMode === 'chatgpt' ? 'Chat with Clippy…' : 'Tell Clippy what to do…';
  prompt.setAttribute('aria-label', currentMode === 'chatgpt' ? 'Message ChatGPT Clippy' : 'Message Codex Clippy');
  sendButton.textContent = currentMode === 'chatgpt' ? 'Ask' : 'Do it';
  requestPanel.hidden = currentMode !== 'codex' || !activeRequest;
  permissionWrap.hidden = currentMode !== 'codex';
}

function appendMessage(className, text) {
  const node = document.createElement(className === 'assistant-message' ? 'div' : 'p');
  node.className = className;
  setMessageContent(node, text);
  transcript.appendChild(node);
  transcript.scrollTop = transcript.scrollHeight;
  return node;
}

function setMessageContent(node, text) {
  if (node.classList.contains('assistant-message')) node.innerHTML = markdown.render(text || '');
  else node.textContent = text;
}

function setBusy(next) {
  busy = next;
  micButton.disabled = next || finishingTranscript;
  historyButton.disabled = next || recording || finishingTranscript;
  headerNewChatButton.disabled = next || recording || finishingTranscript;
  chatMenuNewButton.disabled = next || recording || finishingTranscript;
  for (const button of modeButtons) button.disabled = next || recording || finishingTranscript;
  stopButton.hidden = !next;
  statusDot.className = `status-dot ${next ? 'busy' : 'ready'}`;
  if (next) statusLabel.textContent = workingLabel();
  updateComposerEnabled();
}

function setRecording(next) {
  recording = next;
  micButton.classList.toggle('recording', next);
  micButton.setAttribute('aria-pressed', String(next));
  micButton.setAttribute('aria-label', next ? 'Stop dictation' : 'Start dictation');
  micButton.textContent = next ? '■ Stop mic' : '🎙 Speak';
  historyButton.disabled = busy || next || finishingTranscript;
  headerNewChatButton.disabled = busy || next || finishingTranscript;
  chatMenuNewButton.disabled = busy || next || finishingTranscript;
  for (const button of modeButtons) button.disabled = busy || next || finishingTranscript;
  if (next) {
    statusDot.className = 'status-dot busy';
    statusLabel.textContent = 'Listening…';
  }
  updateComposerEnabled();
}

function setStatus(status) {
  statusLabel.textContent = status.label;
  statusDot.className = `status-dot ${status.state}`;
}

function safePlay(...names) {
  if (!agent) return;
  const name = names.find((candidate) => agent.hasAnimation(candidate));
  if (name) agent.play(name, 4_500);
}

function showError(message) {
  appendMessage('error-message', `Clippy hit a snag: ${message}`);
  setBusy(false);
  safePlay('GetAttention', 'Alert', 'Confused');
}

function toggleBubble(show) {
  bubble.hidden = !show;
  openBubble.hidden = show;
  if (show) prompt.focus();
}

function renderPersistedMessages(messages = []) {
  responseNode = null;
  responseText = '';
  transcript.replaceChildren();
  if (!messages.length) {
    appendMessage('assistant-message', 'Fresh sheet of paper, bro. What are we making?');
    return;
  }
  for (const message of messages) {
    appendMessage(message.role === 'user' ? 'user-message' : 'assistant-message', message.text);
  }
}

function formatChatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderChatList(chats) {
  chatList.replaceChildren();
  if (!chats.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-list-empty';
    empty.textContent = 'No saved Clippy chats yet.';
    chatList.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `chat-row${chat.id === currentThreadId || chat.active ? ' active' : ''}`;
    row.setAttribute('role', 'listitem');
    row.dataset.threadId = chat.id;

    const heading = document.createElement('span');
    heading.className = 'chat-row-heading';
    const title = document.createElement('span');
    title.className = 'chat-row-title';
    title.textContent = chat.name;
    heading.appendChild(title);
    if (currentMode === 'chatgpt') {
      const source = document.createElement('span');
      source.className = `chat-row-source ${chat.source === 'web' ? 'web' : 'clippy'}`;
      source.textContent = chat.source === 'web' ? 'WEB' : 'CLIPPY';
      heading.appendChild(source);
    }
    const preview = document.createElement('span');
    preview.className = 'chat-row-preview';
    preview.textContent = chat.preview || (chat.source === 'web' ? 'ChatGPT.com conversation' : 'New conversation');
    const time = document.createElement('span');
    time.className = 'chat-row-time';
    time.textContent = formatChatTime(chat.updatedAt);
    row.append(heading, preview, time);
    row.addEventListener('click', () => switchChat(chat.id));
    chatList.appendChild(row);
  }
}

async function refreshChatMenu() {
  if (loadingChats) return;
  loadingChats = true;
  chatList.innerHTML = '<p class="chat-list-empty">Loading chats…</p>';
  try {
    renderChatList(await api.listChats());
  } catch (error) {
    chatList.innerHTML = '';
    const empty = document.createElement('p');
    empty.className = 'chat-list-empty';
    empty.textContent = `Could not load chats: ${error.message}`;
    chatList.appendChild(empty);
  } finally {
    loadingChats = false;
  }
}

function toggleChatMenu(show) {
  chatMenu.hidden = !show;
  historyButton.setAttribute('aria-expanded', String(show));
  if (show) refreshChatMenu();
  else prompt.focus();
}

async function loadChat(threadId) {
  const payload = await api.getChat(threadId);
  currentThreadId = payload.chat.id;
  renderPersistedMessages(payload.messages);
  return payload;
}

async function switchChat(threadId) {
  if (!threadId || threadId === currentThreadId || busy || recording || finishingTranscript) {
    if (threadId === currentThreadId) toggleChatMenu(false);
    return;
  }
  setStatus({ state: 'starting', label: 'Opening chat…' });
  try {
    const payload = await api.switchChat(threadId);
    currentThreadId = payload.chat.id;
    renderPersistedMessages(payload.messages);
    toggleChatMenu(false);
    setStatus({ state: 'ready', label: readyLabel() });
    safePlay('Acknowledge', 'Explain');
  } catch (error) {
    showError(error.message);
  }
}

async function startNewChat() {
  if (busy || recording || finishingTranscript) return;
  try {
    const payload = await api.newChat();
    currentThreadId = payload.chat.id;
    renderPersistedMessages(payload.messages);
    toggleChatMenu(false);
    setStatus({ state: 'ready', label: readyLabel() });
  } catch (error) {
    showError(error.message);
  }
}

async function submitPrompt() {
  const text = prompt.value.trim();
  if ((!text && !attachments.length) || busy || recording || finishingTranscript) return;
  const submittedAttachments = attachments;
  const visibleText = [text, ...submittedAttachments.map((attachment) => `📎 ${attachment.name}`)].filter(Boolean).join('\n');
  appendMessage('user-message', visibleText);
  prompt.value = '';
  attachments = [];
  renderAttachments();
  responseNode = appendMessage('assistant-message', '');
  responseText = '';
  setBusy(true);
  safePlay('Thinking', 'Processing', 'Searching');
  try {
    await api.send({ text, attachments: submittedAttachments });
  } catch (error) {
    responseNode?.remove();
    responseNode = null;
    prompt.value = text;
    attachments = submittedAttachments;
    renderAttachments();
    showError(error.message);
  }
}

async function startDictation() {
  if (busy || recording || finishingTranscript) return;
  micButton.disabled = true;
  dictationPrefix = prompt.value.trim();
  recordedChunks = [];
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    // Keep a compressed recording only as a fallback while the experimental
    // app-server transcription stream is in flight.
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm']
      .find((candidate) => MediaRecorder.isTypeSupported(candidate));
    mediaRecorder = new MediaRecorder(microphoneStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener('error', (event) => {
      console.warn(event.error?.message || 'Fallback microphone recording failed.');
    });
    mediaRecorder.start(250);

    dictationFinalText = '';
    dictationLiveText = '';
    nativeTranscriptionError = null;
    pendingAudioWrites = new Set();
    try {
      await api.startTranscription();
      nativeTranscriptionActive = true;
      startPcmStreaming();
    } catch (error) {
      nativeTranscriptionActive = false;
      nativeTranscriptionError = error;
      statusLabel.textContent = 'Listening (Codex desktop fallback)…';
    }
    setRecording(true);
    micButton.disabled = false;
    safePlay('Listening', 'Thinking', 'LookDown');
  } catch (error) {
    cleanupDictation();
    micButton.disabled = busy;
    showError(error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message);
  }
}

async function stopDictation() {
  if (!recording) return;
  setRecording(false);
  finishingTranscript = true;
  micButton.disabled = true;
  sendButton.disabled = true;
  statusLabel.textContent = nativeTranscriptionActive ? 'Finishing GPT transcript…' : 'Transcribing locally…';
  stopPcmStreaming();
  const fallbackRecording = finishFallbackRecording();
  for (const track of microphoneStream?.getTracks() || []) track.stop();

  try {
    let result;
    if (nativeTranscriptionActive) {
      await Promise.allSettled([...pendingAudioWrites]);
      if (nativeTranscriptionError) throw nativeTranscriptionError;
      result = await api.stopTranscription();
    } else {
      throw nativeTranscriptionError || new Error('Codex transcription was unavailable.');
    }
    const spoken = result?.text?.trim();
    if (!spoken) throw new Error('GPT transcription did not hear any speech.');
    prompt.value = combineDictation(spoken);
    prompt.scrollTop = prompt.scrollHeight;
    finishDictation();
  } catch (nativeError) {
    try {
      if (nativeTranscriptionActive) await api.cancelTranscription().catch(() => {});
      statusLabel.textContent = 'Using Codex desktop transcription…';
      const blob = await fallbackRecording;
      const result = await api.transcribe(new Uint8Array(await blob.arrayBuffer()), blob.type);
      const spoken = result?.text?.trim();
      if (!spoken) throw nativeError;
      prompt.value = combineDictation(spoken);
      prompt.scrollTop = prompt.scrollHeight;
      finishDictation();
    } catch (fallbackError) {
      failDictation(`${nativeError.message} Recorded transcription also failed: ${fallbackError.message}`);
    }
  }
}

function startPcmStreaming() {
  audioContext = new AudioContext({ latencyHint: 'interactive' });
  microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
  audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  muteGain = audioContext.createGain();
  muteGain.gain.value = 0;
  audioProcessor.onaudioprocess = (event) => {
    if (!recording && !nativeTranscriptionActive) return;
    const samples = resampleMono(event.inputBuffer.getChannelData(0), audioContext.sampleRate, 24_000);
    const pcm = floatToPcm16(samples);
    const write = api.appendTranscriptionAudio(pcm, 24_000, samples.length)
      .catch((error) => { nativeTranscriptionError ||= error; })
      .finally(() => pendingAudioWrites.delete(write));
    pendingAudioWrites.add(write);
  };
  microphoneSource.connect(audioProcessor);
  audioProcessor.connect(muteGain);
  muteGain.connect(audioContext.destination);
  audioContext.resume();
}

function stopPcmStreaming() {
  audioProcessor?.disconnect();
  microphoneSource?.disconnect();
  muteGain?.disconnect();
  if (audioProcessor) audioProcessor.onaudioprocess = null;
  audioProcessor = null;
  microphoneSource = null;
  muteGain = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
}

function resampleMono(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return Float32Array.from(input);
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const start = index * ratio;
    const end = Math.min(input.length, (index + 1) * ratio);
    const first = Math.floor(start);
    const last = Math.max(first + 1, Math.ceil(end));
    let total = 0;
    let count = 0;
    for (let sourceIndex = first; sourceIndex < last && sourceIndex < input.length; sourceIndex += 1) {
      total += input[sourceIndex];
      count += 1;
    }
    output[index] = count ? total / count : 0;
  }
  return output;
}

function floatToPcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

function finishFallbackRecording() {
  if (!mediaRecorder) return Promise.resolve(new Blob([], { type: 'audio/webm' }));
  const recorder = mediaRecorder;
  return new Promise((resolve) => {
    const done = () => {
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
      recordedChunks = [];
      resolve(blob);
    };
    if (recorder.state === 'inactive') done();
    else {
      recorder.addEventListener('stop', done, { once: true });
      recorder.stop();
    }
  });
}

function combineDictation(spoken) {
  return [dictationPrefix, spoken].filter(Boolean).join(dictationPrefix ? ' ' : '');
}

function renderLiveDictation() {
  const spoken = [dictationFinalText, dictationLiveText].filter(Boolean).join(dictationFinalText ? ' ' : '');
  prompt.value = combineDictation(spoken);
  prompt.scrollTop = prompt.scrollHeight;
}

function acceptFinalDictation(text) {
  const spoken = String(text || '').trim();
  if (spoken && !dictationFinalText.endsWith(spoken)) {
    dictationFinalText = [dictationFinalText, spoken].filter(Boolean).join(dictationFinalText ? ' ' : '');
  }
  dictationLiveText = '';
  renderLiveDictation();
}

function cleanupDictation(discardRecording = false) {
  stopPcmStreaming();
  for (const track of microphoneStream?.getTracks() || []) track.stop();
  microphoneStream = null;
  if (discardRecording && nativeTranscriptionActive) api.cancelTranscription().catch(() => {});
  if (discardRecording && mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  mediaRecorder = null;
  recordedChunks = [];
  nativeTranscriptionActive = false;
  nativeTranscriptionError = null;
  pendingAudioWrites.clear();
  dictationFinalText = '';
  dictationLiveText = '';
  recording = false;
  finishingTranscript = false;
  micButton.classList.remove('recording');
  micButton.setAttribute('aria-pressed', 'false');
  micButton.setAttribute('aria-label', 'Start dictation');
  micButton.textContent = '🎙 Speak';
  micButton.disabled = busy;
  updateComposerEnabled();
  historyButton.disabled = busy;
  headerNewChatButton.disabled = busy;
  chatMenuNewButton.disabled = busy;
  for (const button of modeButtons) button.disabled = busy;
}

function finishDictation() {
  cleanupDictation();
  statusDot.className = 'status-dot ready';
  statusLabel.textContent = 'Transcript ready';
  prompt.focus();
  safePlay('Acknowledge', 'Explain');
}

function failDictation(message) {
  cleanupDictation();
  showError(message);
}

function approvalSummary(request) {
  const { method, params = {} } = request;
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
    const command = Array.isArray(params.command) ? params.command.join(' ') : params.command;
    return { title: 'Run this command?', detail: command || params.reason || 'Codex requested command access.' };
  }
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    const files = params.fileChanges ? Object.keys(params.fileChanges).join('\n') : '';
    return { title: 'Allow this file change?', detail: params.reason || params.grantRoot || files || 'Codex requested write access.' };
  }
  if (method === 'item/permissions/requestApproval') {
    return { title: 'Grant extra access?', detail: params.reason || JSON.stringify(params.permissions, null, 2) };
  }
  return { title: 'Codex needs your input', detail: '' };
}

function renderRequest(request) {
  activeRequest = request;
  requestPanel.replaceChildren();
  requestPanel.hidden = false;
  safePlay('GetAttention', 'Alert', 'GestureLeft');

  if (request.method === 'item/tool/requestUserInput') {
    const title = document.createElement('strong');
    title.textContent = 'Codex has a question';
    requestPanel.appendChild(title);
    for (const question of request.params.questions || []) {
      const label = document.createElement('label');
      label.textContent = question.question;
      label.htmlFor = `question-${question.id}`;
      const input = document.createElement('input');
      input.id = `question-${question.id}`;
      input.dataset.questionId = question.id;
      input.type = question.isSecret ? 'password' : 'text';
      if (question.options?.length) input.placeholder = question.options.map((option) => option.label).join(' / ');
      requestPanel.append(label, input);
    }
    const actions = document.createElement('div');
    actions.className = 'request-actions';
    const answer = document.createElement('button');
    answer.type = 'button';
    answer.className = 'approve';
    answer.textContent = 'Answer';
    answer.addEventListener('click', async () => {
      const answers = {};
      requestPanel.querySelectorAll('input[data-question-id]').forEach((input) => {
        answers[input.dataset.questionId] = { answers: [input.value] };
      });
      await respondToRequest({ answers });
    });
    actions.appendChild(answer);
    requestPanel.appendChild(actions);
    return;
  }

  if (request.method === 'mcpServer/elicitation/request') {
    renderElicitation(request);
    return;
  }

  const summary = approvalSummary(request);
  const title = document.createElement('strong');
  title.textContent = summary.title;
  const detail = document.createElement('code');
  detail.textContent = summary.detail;
  const actions = document.createElement('div');
  actions.className = 'request-actions';
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.textContent = 'Nope';
  decline.addEventListener('click', () => respondToRequest({ decision: 'decline' }));
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'approve';
  approve.textContent = 'Allow once';
  approve.addEventListener('click', () => respondToRequest({ decision: 'accept' }));
  actions.append(decline, approve);
  requestPanel.append(title, detail, actions);
}

function renderElicitation(request) {
  const { params = {} } = request;
  const title = document.createElement('strong');
  title.textContent = `${params.serverName || 'An app'} needs your input`;
  const detail = document.createElement('code');
  detail.textContent = [params.message, params.url].filter(Boolean).join('\n');
  requestPanel.append(title, detail);

  const schema = params.requestedSchema || {};
  if (params.mode !== 'url') {
    for (const [name, property] of Object.entries(schema.properties || {})) {
      const label = document.createElement('label');
      label.textContent = property.title || name;
      const input = document.createElement('input');
      input.dataset.formField = name;
      input.type = property.format === 'password' ? 'password' : 'text';
      input.placeholder = property.description || '';
      requestPanel.append(label, input);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'request-actions';
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.textContent = 'Decline';
  decline.addEventListener('click', () => respondToRequest({ decision: 'decline' }));
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'approve';
  accept.textContent = params.mode === 'url' ? 'Open link' : 'Continue';
  accept.addEventListener('click', async () => {
    if (params.mode === 'url' && params.url) await api.openExternal(params.url);
    const content = {};
    requestPanel.querySelectorAll('input[data-form-field]').forEach((input) => {
      content[input.dataset.formField] = input.value;
    });
    await respondToRequest({ decision: 'accept', content });
  });
  actions.append(decline, accept);
  requestPanel.appendChild(actions);
}

async function respondToRequest(payload) {
  if (!activeRequest) return;
  try {
    await api.respond({ requestId: activeRequest.id, ...payload });
    activeRequest = null;
    requestPanel.hidden = true;
    requestPanel.replaceChildren();
    safePlay('Acknowledge', 'Yes');
  } catch (error) {
    showError(error.message);
  }
}

function handleNotification(message) {
  const { method, params = {} } = message;
  if (method === 'thread/realtime/transcript/delta' && params.role === 'user' && (recording || finishingTranscript)) {
    dictationLiveText += params.delta || '';
    renderLiveDictation();
  } else if (method === 'thread/realtime/transcript/done' && params.role === 'user' && (recording || finishingTranscript)) {
    acceptFinalDictation(params.text);
  } else if (method === 'thread/realtime/error' && (recording || finishingTranscript)) {
    nativeTranscriptionError ||= new Error(params.message || 'GPT transcription failed.');
  } else if (method === 'turn/started') {
    setBusy(true);
  } else if (method === 'chatgpt/message') {
    if (!responseNode) responseNode = appendMessage('assistant-message', '');
    responseText = params.text || '';
    setMessageContent(responseNode, responseText);
    transcript.scrollTop = transcript.scrollHeight;
  } else if (method === 'chatgpt/done') {
    setBusy(false);
    statusLabel.textContent = readyLabel();
    if (!responseText) responseNode?.remove();
    responseNode = null;
    responseText = '';
    safePlay('Congratulate', 'Explain', 'Acknowledge');
    if (!chatMenu.hidden) refreshChatMenu();
  } else if (method === 'chatgpt/failed') {
    setBusy(false);
  } else if (method === 'item/started') {
    showItemActivity(params.item);
  } else if (method === 'item/completed') {
    completeItem(params.item);
  } else if (method === 'item/agentMessage/delta') {
    if (!responseNode) responseNode = appendMessage('assistant-message', '');
    responseText += params.delta || '';
    setMessageContent(responseNode, responseText);
    transcript.scrollTop = transcript.scrollHeight;
  } else if (method === 'item/commandExecution/outputDelta') {
    safePlay('Searching', 'Processing');
  } else if (method === 'item/fileChange/patchUpdated') {
    statusLabel.textContent = 'Updating files…';
    safePlay('Writing', 'Processing');
  } else if (method === 'item/mcpToolCall/progress') {
    statusLabel.textContent = params.message ? String(params.message).slice(0, 54) : 'Using an app…';
  } else if (method === 'turn/plan/updated') {
    statusLabel.textContent = 'Making a plan…';
  } else if (method === 'turn/diff/updated') {
    statusLabel.textContent = 'Reviewing changes…';
  } else if (method === 'model/rerouted') {
    statusLabel.textContent = 'Codex switched models…';
  } else if (method === 'warning' || method === 'error') {
    const warning = params.message || params.error?.message;
    if (warning) appendMessage('error-message', String(warning));
  } else if (method === 'turn/completed') {
    const status = params.turn?.status;
    setBusy(false);
    statusLabel.textContent = status === 'completed' ? readyLabel() : `Turn ${status || 'finished'}`;
    if (!responseText && status !== 'completed') appendMessage('error-message', params.turn?.error?.message || `The turn ${status || 'stopped'}.`);
    responseNode = null;
    responseText = '';
    safePlay(status === 'completed' ? 'Congratulate' : 'GetAttention', 'Explain', 'Acknowledge');
    if (!chatMenu.hidden) refreshChatMenu();
  } else if (method === 'thread/name/updated' && !chatMenu.hidden) {
    refreshChatMenu();
  }
}

function showItemActivity(item = {}) {
  if (item.type === 'commandExecution') {
    statusLabel.textContent = 'Running a command…';
    safePlay('Searching', 'Processing');
  } else if (item.type === 'fileChange') {
    statusLabel.textContent = 'Editing files…';
    safePlay('Writing', 'Processing');
  } else if (item.type === 'mcpToolCall') {
    statusLabel.textContent = `Using ${item.server || item.tool || 'an app'}…`;
    safePlay('Searching', 'Processing');
  } else if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') {
    statusLabel.textContent = 'Working with another agent…';
    safePlay('GetAttention', 'Thinking');
  } else if (item.type === 'webSearch') {
    statusLabel.textContent = 'Searching the web…';
    safePlay('Searching', 'Thinking');
  } else if (item.type === 'imageGeneration') {
    statusLabel.textContent = 'Making an image…';
    safePlay('Processing', 'Thinking');
  } else if (item.type === 'imageView') {
    statusLabel.textContent = 'Looking at an image…';
    safePlay('LookDown', 'Thinking');
  }
}

function completeItem(item = {}) {
  if (item.type === 'agentMessage' && item.text && !responseText) {
    if (!responseNode) responseNode = appendMessage('assistant-message', '');
    responseText = item.text;
    setMessageContent(responseNode, responseText);
  }
  if (item.type === 'mcpToolCall' && item.status === 'failed') {
    appendMessage('error-message', item.error?.message || `${item.tool || 'App tool'} failed.`);
  }
  if (busy && item.type !== 'agentMessage') statusLabel.textContent = workingLabel();
  transcript.scrollTop = transcript.scrollHeight;
}

async function switchMode(mode) {
  if (mode === currentMode || busy || recording || finishingTranscript) return;
  setStatus({ state: 'starting', label: mode === 'chatgpt' ? 'Opening ChatGPT…' : 'Opening Codex…' });
  try {
    const payload = await api.setMode(mode);
    currentMode = payload.mode;
    currentThreadId = payload.chat?.id || null;
    activeRequest = null;
    requestPanel.hidden = true;
    requestPanel.replaceChildren();
    renderMode();
    await refreshComposerOptions();
    renderPersistedMessages(payload.messages || []);
    toggleChatMenu(false);
    setStatus(payload.status || { state: 'ready', label: readyLabel() });
    safePlay('Acknowledge', 'Explain');
  } catch (error) {
    showError(error.message);
  }
}

api.onEvent((event) => {
  if (event.type === 'status') setStatus(event.status);
  else if (event.type === 'notification') handleNotification(event.message);
  else if (event.type === 'server-request') renderRequest(event.request);
  else if (event.type === 'error') showError(event.message);
  else if (event.type === 'mode') {
    currentMode = event.mode;
    currentThreadId = event.chat?.id || null;
    activeRequest = null;
    renderMode();
    refreshComposerOptions();
    renderPersistedMessages(event.messages || []);
    toggleChatMenu(false);
    setStatus(event.status || { state: 'ready', label: readyLabel() });
    setBusy(false);
  }
  else if (event.type === 'new-chat') {
    currentThreadId = event.chat?.id || currentThreadId;
    renderPersistedMessages(event.messages || []);
    toggleChatMenu(false);
    setBusy(false);
  } else if (event.type === 'thread' && !currentThreadId && event.threadId) {
    currentThreadId = event.threadId;
    loadChat(event.threadId).catch((error) => showError(error.message));
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitPrompt();
});
transcript.addEventListener('click', async (event) => {
  const link = event.target.closest?.('.assistant-message a[href]');
  if (!link) return;
  event.preventDefault();
  try {
    await api.openExternal(link.href);
  } catch (error) {
    showError(error.message);
  }
});
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    submitPrompt();
  }
});
prompt.addEventListener('input', updateComposerEnabled);
prompt.addEventListener('paste', async (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  try {
    for (const file of files.slice(0, Math.max(0, 10 - attachments.length))) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      attachments.push(await api.savePastedFile({ name: file.name || 'pasted-image.png', mimeType: file.type, bytes }));
    }
    renderAttachments();
  } catch (error) {
    showError(error.message);
  }
});
form.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
});
form.addEventListener('drop', async (event) => {
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  try {
    for (const file of files.slice(0, Math.max(0, 10 - attachments.length))) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      attachments.push(await api.savePastedFile({ name: file.name, mimeType: file.type, bytes }));
    }
    renderAttachments();
  } catch (error) {
    showError(error.message);
  }
});
attachButton.addEventListener('click', async () => {
  try {
    const picked = await api.pickFiles();
    attachments.push(...picked.slice(0, Math.max(0, 10 - attachments.length)));
    renderAttachments();
  } catch (error) {
    showError(error.message);
  }
});
modelSelect.addEventListener('change', async () => {
  renderEfforts();
  await saveComposerSettings();
});
effortSelect.addEventListener('change', saveComposerSettings);
permissionSelect.addEventListener('change', saveComposerSettings);
document.querySelector('#stop').addEventListener('click', () => api.stop());
micButton.addEventListener('click', () => recording ? stopDictation() : startDictation());
historyButton.addEventListener('click', () => toggleChatMenu(chatMenu.hidden));
closeChatMenuButton.addEventListener('click', () => toggleChatMenu(false));
headerNewChatButton.addEventListener('click', startNewChat);
chatMenuNewButton.addEventListener('click', startNewChat);
for (const button of modeButtons) button.addEventListener('click', () => switchMode(button.dataset.mode));
document.querySelector('#collapse').addEventListener('click', () => toggleBubble(false));
document.querySelector('#hide').addEventListener('click', async () => {
  if (recording) await stopDictation();
  api.hide();
});
openBubble.addEventListener('click', () => toggleBubble(true));

window.addEventListener('mousemove', (event) => {
  const interactive = Boolean(event.target.closest?.('.interactive'));
  const ignore = !interactive;
  if (ignore !== lastIgnoreState) {
    lastIgnoreState = ignore;
    api.setIgnoreMouse(ignore);
  }
});
window.addEventListener('beforeunload', () => cleanupDictation(true));

async function installCharacterDrag() {
  const el = agent._el;
  el.classList.add('interactive', 'clippy-character');
  el.setAttribute('aria-label', 'Clippy');
  el.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  el.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const [x, y] = await api.getWindowPosition();
    drag = { pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY, x, y, moved: false };
    el.setPointerCapture(event.pointerId);
  });
  el.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.screenX - drag.screenX;
    const dy = event.screenY - drag.screenY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    api.setWindowPosition(drag.x + dx, drag.y + dy);
  });
  el.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      toggleBubble(bubble.hidden);
      safePlay('ClickedOn', 'Acknowledge');
    }
    drag = null;
    el.releasePointerCapture(event.pointerId);
  });
}

async function boot() {
  const initial = await api.getState();
  currentMode = initial.mode || 'chatgpt';
  currentThreadId = initial.threadId || null;
  renderMode();
  await refreshComposerOptions();
  setStatus(initial.status);
  setBusy(initial.busy);
  if (currentThreadId) await loadChat(currentThreadId);
  agent = createClippySvgAgent();
  agent.show(true);
  agent.moveTo(window.innerWidth - 224, window.innerHeight - 235);
  installCharacterDrag();
  safePlay('Wave', 'Greeting', 'GetAttention');
}

boot().catch((error) => showError(error.message));
