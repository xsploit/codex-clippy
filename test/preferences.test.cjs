const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePreferences, updateUserSettings } = require('../src/preferences.cjs');

test('migrates old Clippy preferences into the settings schema', () => {
  const preferences = normalizePreferences({ mode: 'codex', chatgpt: { model: 'auto' } });
  assert.equal(preferences.mode, 'codex');
  assert.equal(preferences.settings.alwaysOnTop, true);
  assert.equal(preferences.settings.syncWebHistory, true);
  assert.equal(preferences.settings.webHistoryLimit, 50);
});

test('sanitizes settings updates to supported values', () => {
  const preferences = updateUserSettings(normalizePreferences(), {
    alwaysOnTop: false,
    openAtLogin: true,
    startupMode: 'codex',
    webHistoryLimit: 25,
  });
  assert.equal(preferences.settings.alwaysOnTop, false);
  assert.equal(preferences.settings.openAtLogin, true);
  assert.equal(preferences.settings.startupMode, 'codex');
  assert.equal(preferences.settings.webHistoryLimit, 25);

  const sanitized = updateUserSettings(preferences, { startupMode: 'wat', webHistoryLimit: 999 });
  assert.equal(sanitized.settings.startupMode, 'last');
  assert.equal(sanitized.settings.webHistoryLimit, 50);
});
