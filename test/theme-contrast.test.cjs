const assert = require('node:assert/strict');
const test = require('node:test');

// Keep these values in step with the CSS theme tokens. The checks cover the
// combinations used by text, native select popups, and selected options.
const themes = {
  classic: { panel: '#fffed8', text: '#29270f', muted: '#66643f', accent: '#655f99', accentText: '#ffffff' },
  codex: { panel: '#333333', text: '#eeeeec', muted: '#b8b8b5', accent: '#7097ff', accentText: '#101827' },
  midnight: { panel: '#172a47', text: '#e8f1ff', muted: '#a9bdd8', accent: '#64a5ff', accentText: '#07111f' },
  terminal: { panel: '#0b1d13', text: '#a8ffca', muted: '#79c99c', accent: '#45e88d', accentText: '#031008' },
  synthwave: { panel: '#2b1b49', text: '#fff1ff', muted: '#d3b6d8', accent: '#ff5bd3', accentText: '#210d2c' },
};

function luminance(hex) {
  const values = hex.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = values.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('all theme dropdown states meet WCAG AA text contrast', () => {
  for (const [name, theme] of Object.entries(themes)) {
    assert.ok(contrast(theme.text, theme.panel) >= 4.5, `${name} option popup lacks text contrast`);
    assert.ok(contrast(theme.muted, theme.panel) >= 4.5, `${name} supporting text lacks contrast`);
    assert.ok(contrast(theme.accentText, theme.accent) >= 4.5, `${name} selected option lacks text contrast`);
  }
});
