const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('ships fullscreen pet mode, five skins, font choices, and activity cards', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');

  assert.match(html, /id="fullscreen"/);
  assert.match(html, /id="activity-feed"/);
  for (const skin of ['classic', 'codex', 'midnight', 'terminal', 'synthwave']) {
    assert.match(html, new RegExp(`<option value="${skin}">`));
  }
  for (const font of ['system', 'classic', 'friendly', 'mono', 'serif']) {
    assert.match(html, new RegExp(`<option value="${font}">`));
  }
  assert.match(styles, /body\[data-display-mode="fullscreen"\] \.bubble/);
  assert.match(styles, /body\[data-skin="synthwave"\]/);
  assert.match(styles, /color-scheme: dark/);
  assert.match(styles, /option:checked/);
  assert.match(renderer, /item\/reasoning\/summaryTextDelta/);
  assert.doesNotMatch(renderer, /method === 'item\/reasoning\/textDelta'/);
  assert.match(renderer, /item\/commandExecution\/outputDelta/);
  assert.match(renderer, /event\.key === 'Enter' && !event\.ctrlKey/);
  assert.match(renderer, /setPetCollapsed\(true\)/);
  assert.match(renderer, /setPetCollapsed\(false\)/);
  assert.match(styles, /\.pet-collapsed \{ background: transparent; \}/);
  assert.match(styles, /\.pet-collapsed \.open-bubble \{ display: block; \}/);
  assert.match(main, /mainWindow\.setBounds\(display\.bounds, false\)/);
});
