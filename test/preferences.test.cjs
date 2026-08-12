const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePreferences, updateUserSettings } = require('../src/preferences.cjs');

test('migrates old Clippy preferences into the settings schema', () => {
  const preferences = normalizePreferences({ mode: 'codex', chatgpt: { model: 'auto' } });
  assert.equal(preferences.mode, 'codex');
  assert.equal(preferences.settings.alwaysOnTop, true);
  assert.equal(preferences.settings.syncWebHistory, true);
  assert.equal(preferences.settings.webHistoryLimit, 50);
  assert.equal(preferences.settings.displayMode, 'compact');
  assert.equal(preferences.settings.skin, 'classic');
  assert.equal(preferences.settings.font, 'system');
});

test('sanitizes settings updates to supported values', () => {
  const preferences = updateUserSettings(normalizePreferences(), {
    alwaysOnTop: false,
    openAtLogin: true,
    startupMode: 'codex',
    webHistoryLimit: 25,
    displayMode: 'fullscreen',
    skin: 'midnight',
    font: 'mono',
  });
  assert.equal(preferences.settings.alwaysOnTop, false);
  assert.equal(preferences.settings.openAtLogin, true);
  assert.equal(preferences.settings.startupMode, 'codex');
  assert.equal(preferences.settings.webHistoryLimit, 25);
  assert.equal(preferences.settings.displayMode, 'fullscreen');
  assert.equal(preferences.settings.skin, 'midnight');
  assert.equal(preferences.settings.font, 'mono');

  const sanitized = updateUserSettings(preferences, {
    startupMode: 'wat', webHistoryLimit: 999, displayMode: 'huge', skin: 'ugly', font: 'wingdings',
  });
  assert.equal(sanitized.settings.startupMode, 'last');
  assert.equal(sanitized.settings.webHistoryLimit, 50);
  assert.equal(sanitized.settings.displayMode, 'compact');
  assert.equal(sanitized.settings.skin, 'classic');
  assert.equal(sanitized.settings.font, 'system');
});
