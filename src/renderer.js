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
const fullscreenButton = document.querySelector('#fullscreen');
const headerNewChatButton = document.querySelector('#new-chat');
const chatMenu = document.querySelector('#chat-menu');
const chatList = document.querySelector('#chat-list');
const chatMenuNewButton = document.querySelector('#chat-menu-new');
const closeChatMenuButton = document.querySelector('#close-chat-menu');
const chatMenuSource = document.querySelector('#chat-menu-source');
const settingsButton = document.querySelector('#settings');
const settingsMenu = document.querySelector('#settings-menu');
const closeSettingsButton = document.querySelector('#close-settings');
const settingAlwaysOnTop = document.querySelector('#setting-always-on-top');
const settingShowOnLaunch = document.querySelector('#setting-show-on-launch');
const settingBubbleOpen = document.querySelector('#setting-bubble-open');
const settingAnimations = document.querySelector('#setting-animations');
const settingDisplayMode = document.querySelector('#setting-display-mode');
const settingSkin = document.querySelector('#setting-skin');
const settingFont = document.querySelector('#setting-font');
const settingOpenAtLogin = document.querySelector('#setting-open-at-login');
const settingStartupMode = document.querySelector('#setting-startup-mode');
const settingSyncWebHistory = document.querySelector('#setting-sync-web-history');
const settingWebHistoryLimit = document.querySelector('#setting-web-history-limit');
const loginSettingDetail = document.querySelector('#login-setting-detail');
const settingsVersion = document.querySelector('#settings-version');
const settingsSaved = document.querySelector('#settings-saved');
const modeButtons = [...document.querySelectorAll('#mode-switch [data-mode]')];
const attachButton = document.querySelector('#attach');
const attachmentList = document.querySelector('#attachment-list');
const modelSelect = document.querySelector('#model-select');
const effortSelect = document.querySelector('#effort-select');
const effortWrap = document.querySelector('#effort-wrap');
const permissionSelect = document.querySelector('#permission-select');
const permissionWrap = document.querySelector('#permission-wrap');
const activityFeed = document.querySelector('#activity-feed');

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
let settingsState = null;
let animationsEnabled = true;
let settingsSaveTimer = null;
let petCollapsed = false;
const activityNodes = new Map();

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

function createCopyButton(label = 'Copy') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  const glyph = document.createElement('span');
  glyph.className = 'copy-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const feedback = document.createElement('span');
  feedback.className = 'copy-feedback';
  feedback.textContent = 'Copied';
  button.append(glyph, feedback);
  return button;
}

function ensureCopyButton(container) {
  if (!container || container.querySelector(':scope > .copy-button')) return;
  container.classList.add('copyable');
  container.appendChild(createCopyButton());
}

function enhanceMessageCode(node) {
  for (const block of node.querySelectorAll('pre')) ensureCopyButton(block);
}

async function copyFromButton(button) {
  const container = button.closest('pre, .activity-body');
  const source = container?.matches('pre')
    ? container.querySelector('code')
    : container?.querySelector('.activity-content');
  const value = source?.textContent || '';
  if (!value) return;
  await api.copyText(value);
  button.classList.add('copied');
  button.setAttribute('aria-label', 'Copied');
  button.title = 'Copied';
  window.clearTimeout(button.copyResetTimer);
  button.copyResetTimer = window.setTimeout(() => {
    button.classList.remove('copied');
    button.setAttribute('aria-label', 'Copy');
    button.title = 'Copy';
  }, 1_400);
}

function setMessageContent(node, text) {
  if (node.classList.contains('assistant-message')) {
    node.innerHTML = markdown.render(text || '');
    enhanceMessageCode(node);
  } else node.textContent = text;
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
  if (!agent || !animationsEnabled) return;
  const name = names.find((candidate) => agent.hasAnimation(candidate));
  if (name) agent.play(name, 4_500);
}

function showError(message) {
  appendMessage('error-message', `Clippy hit a snag: ${message}`);
  setBusy(false);
  safePlay('GetAttention', 'Alert', 'Confused');
}

function setBubbleVisibility(show) {
  bubble.hidden = !show;
  openBubble.hidden = show;
  if (show) prompt.focus();
}

async function toggleBubble(show) {
  const collapseFullscreen = !show && settingsState?.displayMode === 'fullscreen';
  if (collapseFullscreen) {
    petCollapsed = true;
    document.body.classList.add('pet-collapsed');
    setBubbleVisibility(false);
    try {
      await api.setPetCollapsed(true);
    } catch (error) {
      petCollapsed = false;
      document.body.classList.remove('pet-collapsed');
      setBubbleVisibility(true);
      throw error;
    }
    positionAgent();
    return;
  }
  if (show && petCollapsed) {
    await api.setPetCollapsed(false);
    petCollapsed = false;
    document.body.classList.remove('pet-collapsed');
    setBubbleVisibility(true);
    requestAnimationFrame(positionAgent);
    return;
  }
  setBubbleVisibility(show);
}

function positionAgent() {
  if (!agent) return;
  if (settingsState?.displayMode === 'fullscreen' && !petCollapsed) {
    const contentWidth = Math.min(820, window.innerWidth - 72);
    const contentLeft = (window.innerWidth - contentWidth) / 2;
    agent.moveTo(Math.max(24, Math.round(contentLeft - 225)), Math.min(window.innerHeight - 250, Math.round(window.innerHeight * .52)));
  } else {
    agent.moveTo(window.innerWidth - 224, window.innerHeight - 235);
  }
}

function applyClientSettings(settings) {
  if (settings.displayMode !== 'fullscreen' && petCollapsed) {
    petCollapsed = false;
    document.body.classList.remove('pet-collapsed');
  }
  animationsEnabled = settings.animations !== false;
  document.body.classList.toggle('animations-disabled', !animationsEnabled);
  document.body.dataset.displayMode = settings.displayMode;
  document.body.dataset.skin = settings.skin;
  document.body.dataset.font = settings.font;
  fullscreenButton.setAttribute('aria-pressed', String(settings.displayMode === 'fullscreen'));
  fullscreenButton.setAttribute('aria-label', settings.displayMode === 'fullscreen' ? 'Exit fullscreen pet mode' : 'Enter fullscreen pet mode');
  fullscreenButton.title = settings.displayMode === 'fullscreen' ? 'Compact companion' : 'Fullscreen pet mode';
  positionAgent();
  if (!animationsEnabled && agent) agent.play('RestPose', 0);
}

function renderSettings(settings) {
  settingsState = settings;
  settingAlwaysOnTop.checked = settings.alwaysOnTop;
  settingShowOnLaunch.checked = settings.showOnLaunch;
  settingBubbleOpen.checked = settings.bubbleOpenOnLaunch;
  settingAnimations.checked = settings.animations;
  settingDisplayMode.value = settings.displayMode;
  settingSkin.value = settings.skin;
  settingFont.value = settings.font;
  settingOpenAtLogin.checked = settings.openAtLogin;
  settingOpenAtLogin.disabled = !settings.loginSupported;
  loginSettingDetail.textContent = settings.loginSupported
    ? 'Launch Clippy after signing in'
    : 'Available in the packaged Clippy app';
  settingStartupMode.value = settings.startupMode;
  settingSyncWebHistory.checked = settings.syncWebHistory;
  settingWebHistoryLimit.value = String(settings.webHistoryLimit);
  settingWebHistoryLimit.disabled = !settings.syncWebHistory;
  settingsVersion.textContent = `Codex Clippy v${settings.version}`;
  applyClientSettings(settings);
}

function settingsPatchFromForm() {
  return {
    alwaysOnTop: settingAlwaysOnTop.checked,
    showOnLaunch: settingShowOnLaunch.checked,
    bubbleOpenOnLaunch: settingBubbleOpen.checked,
    animations: settingAnimations.checked,
    displayMode: settingDisplayMode.value,
    skin: settingSkin.value,
    font: settingFont.value,
    openAtLogin: settingOpenAtLogin.checked,
    startupMode: settingStartupMode.value,
    syncWebHistory: settingSyncWebHistory.checked,
    webHistoryLimit: Number(settingWebHistoryLimit.value),
  };
}

async function saveSettings() {
  window.clearTimeout(settingsSaveTimer);
  settingsSaved.textContent = 'Saving…';
  try {
    renderSettings(await api.setSettings(settingsPatchFromForm()));
    settingsSaved.textContent = 'Saved';
    settingsSaveTimer = window.setTimeout(() => { settingsSaved.textContent = 'Ready'; }, 1_400);
  } catch (error) {
    settingsSaved.textContent = 'Could not save';
    showError(error.message);
  }
}

async function toggleDisplayMode() {
  if (!settingsState) return;
  settingDisplayMode.value = settingsState.displayMode === 'fullscreen' ? 'compact' : 'fullscreen';
  await saveSettings();
}

function toggleSettings(show) {
  settingsMenu.hidden = !show;
  settingsButton.setAttribute('aria-expanded', String(show));
  if (show) {
    toggleChatMenu(false);
    settingsMenu.querySelector('input, select, button')?.focus();
  } else {
    prompt.focus();
  }
}

function renderPersistedMessages(messages = []) {
  responseNode = null;
  responseText = '';
  transcript.replaceChildren();
  clearActivityFeed();
  if (!messages.length) {
    appendMessage('assistant-message', 'Fresh sheet of paper, bro. What are we making?');
    return;
  }
  for (const message of messages) {
    appendMessage(message.role === 'user' ? 'user-message' : 'assistant-message', message.text);
  }
}

function clearActivityFeed() {
  activityNodes.clear();
  activityFeed.replaceChildren();
  activityFeed.hidden = true;
}

function activityMeta(type) {
  const meta = {
    reasoning: ['THINKING', 'Reasoning summary', ''],
    commandExecution: ['COMMAND', 'Running a command', '›_'],
    fileChange: ['FILES', 'Editing files', '✎'],
    mcpToolCall: ['TOOL', 'Using a tool', '◇'],
    dynamicToolCall: ['TOOL', 'Using a tool', '◇'],
    webSearch: ['SEARCH', 'Searched the web', '⌕'],
    imageGeneration: ['IMAGE', 'Generated an image', '▧'],
    imageView: ['VISION', 'Viewed an image', '▧'],
    collabAgentToolCall: ['AGENT', 'Worked with another agent', '◎'],
    subAgentActivity: ['AGENT', 'Worked with another agent', '◎'],
    plan: ['PLAN', 'Updated the plan', '☷'],
  };
  return meta[type] || ['ACTIVITY', type || 'Working', '•'];
}

function activityTitle(item = {}) {
  if (item.type === 'commandExecution') return item.status === 'inProgress' ? 'Running a command' : 'Ran a command';
  if (item.type === 'fileChange') {
    const count = item.changes?.length || 1;
    return `${item.status === 'inProgress' ? 'Editing' : 'Edited'} ${count === 1 ? 'a file' : `${count} files`}`;
  }
  if (item.type === 'mcpToolCall') return `${item.status === 'inProgress' ? 'Using' : 'Used'} ${item.tool || item.server || 'a tool'}`;
  if (item.type === 'dynamicToolCall') return `${item.status === 'inProgress' ? 'Using' : 'Used'} ${item.tool || item.namespace || 'a tool'}`;
  if (item.type === 'webSearch') return item.status === 'inProgress' ? 'Searching the web' : 'Searched the web';
  if (item.type === 'imageView') return 'Viewed an image';
  if (item.type === 'imageGeneration') return item.status === 'inProgress' ? 'Generating an image' : 'Generated an image';
  if (item.type === 'reasoning') return item.summary?.at(-1) || 'Reasoning summary';
  if (item.type === 'plan') return 'Plan';
  return activityMeta(item.type)[1];
}

function readableJson(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === 'string' && nested.length > 1_200) return `${nested.slice(0, 1_200)}…`;
      return nested;
    }, 2).slice(0, 16_000);
  } catch { return String(value).slice(0, 16_000); }
}

function activityBody(item = {}) {
  if (item.type === 'reasoning') return [...(item.summary || [])].join('\n\n');
  if (item.type === 'commandExecution') {
    return [item.command && `$ ${item.command}`, item.aggregatedOutput].filter(Boolean).join('\n\n');
  }
  if (item.type === 'fileChange') {
    return (item.changes || []).map((change) => change.path || change.filePath || readableJson(change)).join('\n');
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    return [item.arguments && `Arguments\n${readableJson(item.arguments)}`, item.result && `Result\n${readableJson(item.result)}`, item.error?.message].filter(Boolean).join('\n\n');
  }
  return item.text || item.query || item.message || '';
}

function ensureActivityCard(item = {}) {
  const id = item.id || `${item.type || 'activity'}-${activityNodes.size}`;
  let record = activityNodes.get(id);
  if (record) return record;
  const [kind, fallback, icon] = activityMeta(item.type);
  const details = document.createElement('details');
  details.className = `activity-card activity-${item.type || 'generic'}`;
  for (const existing of activityNodes.values()) existing.details.open = false;
  details.open = false;
  const summary = document.createElement('summary');
  const iconNode = document.createElement('span');
  iconNode.className = 'activity-icon';
  iconNode.textContent = icon;
  const heading = document.createElement('span');
  heading.className = 'activity-heading';
  const kindNode = document.createElement('small');
  kindNode.textContent = kind;
  const title = document.createElement('strong');
  title.textContent = activityTitle(item) || fallback;
  heading.append(kindNode, title);
  const status = document.createElement('span');
  status.className = 'activity-status running';
  status.textContent = 'RUNNING';
  summary.append(iconNode, heading, status);
  const body = document.createElement('div');
  body.className = 'activity-body';
  const contentNode = document.createElement('div');
  contentNode.className = 'activity-content';
  const content = activityBody(item);
  contentNode.textContent = content || 'Waiting for details…';
  body.appendChild(contentNode);
  if (content && item.type !== 'reasoning') ensureCopyButton(body);
  details.classList.toggle('has-details', Boolean(content));
  details.append(summary, body);
  activityFeed.appendChild(details);
  activityFeed.hidden = false;
  record = { details, title, status, body, content: contentNode, item: { ...item, id } };
  activityNodes.set(id, record);
  if (item.type === 'imageView' && item.path) loadActivityImage(record, item.path);
  activityFeed.scrollTop = activityFeed.scrollHeight;
  return record;
}

async function loadActivityImage(record, filePath) {
  try {
    const preview = await api.previewLocalImage(filePath);
    if (!preview) return;
    const image = document.createElement('img');
    image.className = 'activity-preview';
    image.src = preview;
    image.alt = `Viewed image: ${filePath}`;
    record.content.replaceChildren(image);
    record.body.querySelector(':scope > .copy-button')?.remove();
    record.details.classList.add('has-details');
  } catch (error) {
    console.warn(`Could not preview activity image: ${error.message}`);
  }
}

function updateActivityItem(item = {}, completed = false) {
  if (!item.id && !item.type) return;
  const record = ensureActivityCard(item);
  record.item = { ...record.item, ...item };
  record.title.textContent = activityTitle(record.item);
  const content = activityBody(record.item);
  if (content) {
    record.content.textContent = content;
    if (record.item.type !== 'reasoning') {
      record.details.classList.add('has-details');
      ensureCopyButton(record.body);
    }
  }
  if (completed) {
    const failed = item.status === 'failed' || Boolean(item.error);
    record.status.className = `activity-status ${failed ? 'failed' : 'done'}`;
    record.status.textContent = failed ? 'FAILED' : 'DONE';
    if (item.durationMs != null) record.status.textContent += ` · ${(item.durationMs / 1000).toFixed(1)}s`;
  }
}

function appendActivityDelta(itemId, delta) {
  if (!itemId || !delta) return;
  const record = activityNodes.get(itemId) || ensureActivityCard({ id: itemId, type: 'commandExecution' });
  if (record.content.textContent === 'Waiting for details…') record.content.textContent = '';
  if (!record.outputStarted && record.content.textContent) record.content.textContent += '\n\n';
  record.outputStarted = true;
  record.content.textContent += delta;
  record.details.classList.add('has-details');
  ensureCopyButton(record.body);
  activityFeed.scrollTop = activityFeed.scrollHeight;
}

function appendReasoningSummary(itemId, delta) {
  if (!itemId || !delta) return;
  const record = activityNodes.get(itemId) || ensureActivityCard({ id: itemId, type: 'reasoning' });
  if (record.content.textContent === 'Waiting for details…') record.content.textContent = '';
  record.content.textContent += delta;
  record.title.textContent = record.content.textContent.trim().split(/\r?\n/, 1)[0] || 'Reasoning summary';
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
  if (show) {
    settingsMenu.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    refreshChatMenu();
  }
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
  clearActivityFeed();
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
  } else if (method === 'item/reasoning/summaryTextDelta') {
    appendReasoningSummary(params.itemId, params.delta);
  } else if (method === 'item/agentMessage/delta') {
    if (!responseNode) responseNode = appendMessage('assistant-message', '');
    responseText += params.delta || '';
    setMessageContent(responseNode, responseText);
    transcript.scrollTop = transcript.scrollHeight;
  } else if (method === 'item/commandExecution/outputDelta') {
    appendActivityDelta(params.itemId, params.delta);
    safePlay('Searching', 'Processing');
  } else if (method === 'item/fileChange/patchUpdated') {
    updateActivityItem({ id: params.itemId, type: 'fileChange', changes: params.changes });
    statusLabel.textContent = 'Updating files…';
    safePlay('Writing', 'Processing');
  } else if (method === 'item/mcpToolCall/progress') {
    appendActivityDelta(params.itemId, `${params.message || 'Working…'}\n`);
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
  if (item.type !== 'agentMessage' && item.type !== 'userMessage') updateActivityItem(item);
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
  if (item.type !== 'agentMessage' && item.type !== 'userMessage') updateActivityItem(item, true);
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
  else if (event.type === 'settings') renderSettings(event.settings);
  else if (event.type === 'open-settings') {
    toggleBubble(true).then(() => toggleSettings(true)).catch((error) => showError(error.message));
  }
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
  const copyButton = event.target.closest?.('.copy-button');
  if (copyButton) {
    event.preventDefault();
    try { await copyFromButton(copyButton); } catch (error) { showError(error.message); }
    return;
  }
  const link = event.target.closest?.('.assistant-message a[href]');
  if (!link) return;
  event.preventDefault();
  try {
    await api.openExternal(link.href);
  } catch (error) {
    showError(error.message);
  }
});
activityFeed.addEventListener('click', async (event) => {
  const copyButton = event.target.closest?.('.copy-button');
  if (!copyButton) return;
  event.preventDefault();
  event.stopPropagation();
  try { await copyFromButton(copyButton); } catch (error) { showError(error.message); }
});
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.isComposing) {
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
fullscreenButton.addEventListener('click', toggleDisplayMode);
closeChatMenuButton.addEventListener('click', () => toggleChatMenu(false));
settingsButton.addEventListener('click', () => toggleSettings(settingsMenu.hidden));
closeSettingsButton.addEventListener('click', () => toggleSettings(false));
for (const control of settingsMenu.querySelectorAll('input, select')) control.addEventListener('change', saveSettings);
headerNewChatButton.addEventListener('click', startNewChat);
chatMenuNewButton.addEventListener('click', startNewChat);
for (const button of modeButtons) button.addEventListener('click', () => switchMode(button.dataset.mode));
document.querySelector('#collapse').addEventListener('click', () => toggleBubble(false).catch((error) => showError(error.message)));
document.querySelector('#hide').addEventListener('click', async () => {
  if (recording) await stopDictation();
  api.hide();
});
openBubble.addEventListener('click', () => toggleBubble(true).catch((error) => showError(error.message)));
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!settingsMenu.hidden) toggleSettings(false);
  else if (!chatMenu.hidden) toggleChatMenu(false);
});

window.addEventListener('mousemove', (event) => {
  const interactive = Boolean(event.target.closest?.('.interactive'));
  const ignore = !interactive;
  if (ignore !== lastIgnoreState) {
    lastIgnoreState = ignore;
    api.setIgnoreMouse(ignore);
  }
});
window.addEventListener('beforeunload', () => cleanupDictation(true));
window.addEventListener('resize', positionAgent);

document.documentElement.dataset.clippyRendererReady = 'true';

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
    if (settingsState?.displayMode === 'fullscreen' && !petCollapsed) return;
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
      if (settingsState?.displayMode !== 'fullscreen' || petCollapsed) {
        toggleBubble(bubble.hidden).catch((error) => showError(error.message));
      }
      safePlay('ClickedOn', 'Acknowledge');
    }
    drag = null;
    el.releasePointerCapture(event.pointerId);
  });
}

async function boot() {
  renderSettings(await api.getSettings());
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
  positionAgent();
  installCharacterDrag();
  await toggleBubble(settingsState.bubbleOpenOnLaunch !== false);
  safePlay('Wave', 'Greeting', 'GetAttention');
}

boot().catch((error) => showError(error.message));
