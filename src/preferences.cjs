const DEFAULT_PREFERENCES = Object.freeze({
  mode: 'chatgpt',
  chatgpt: Object.freeze({ selection: 'auto', model: 'auto', effort: null }),
  codex: Object.freeze({ model: null, effort: null, permissions: ':workspace' }),
  settings: Object.freeze({
    alwaysOnTop: true,
    openAtLogin: false,
    showOnLaunch: true,
    bubbleOpenOnLaunch: true,
    animations: true,
    displayMode: 'compact',
    skin: 'classic',
    font: 'system',
    startupMode: 'last',
    syncWebHistory: true,
    webHistoryLimit: 50,
  }),
});

function normalizePreferences(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  return {
    mode: raw.mode === 'codex' ? 'codex' : 'chatgpt',
    chatgpt: { ...DEFAULT_PREFERENCES.chatgpt, ...(raw.chatgpt || {}) },
    codex: { ...DEFAULT_PREFERENCES.codex, ...(raw.codex || {}) },
    settings: {
      alwaysOnTop: settings.alwaysOnTop !== false,
      openAtLogin: settings.openAtLogin === true,
      showOnLaunch: settings.showOnLaunch !== false,
      bubbleOpenOnLaunch: settings.bubbleOpenOnLaunch !== false,
      animations: settings.animations !== false,
      displayMode: ['compact', 'fullscreen'].includes(settings.displayMode) ? settings.displayMode : 'compact',
      skin: ['classic', 'codex', 'midnight', 'terminal', 'synthwave'].includes(settings.skin) ? settings.skin : 'classic',
      font: ['system', 'classic', 'friendly', 'mono', 'serif'].includes(settings.font) ? settings.font : 'system',
      startupMode: ['last', 'chatgpt', 'codex'].includes(settings.startupMode) ? settings.startupMode : 'last',
      syncWebHistory: settings.syncWebHistory !== false,
      webHistoryLimit: [10, 25, 50].includes(Number(settings.webHistoryLimit)) ? Number(settings.webHistoryLimit) : 50,
    },
  };
}

function updateUserSettings(preferences, patch = {}) {
  return normalizePreferences({
    ...preferences,
    settings: { ...(preferences?.settings || {}), ...(patch || {}) },
  });
}

module.exports = { DEFAULT_PREFERENCES, normalizePreferences, updateUserSettings };
