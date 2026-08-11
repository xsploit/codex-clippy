const assert = require('node:assert/strict');
const test = require('node:test');
const createClippyMarkdown = require('../src/markdown-renderer.js');

test('renders assistant Markdown with formatting and safe external links', () => {
  const markdown = createClippyMarkdown();
  const html = markdown.render('## JustRayen\n\nHe built **Riko**.\n\n- Voice\n- Memory\n\n[Project](https://github.com/rayenfeng/riko_project)');

  assert.match(html, /<h2>JustRayen<\/h2>/);
  assert.match(html, /<strong>Riko<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /href="https:\/\/github\.com\/rayenfeng\/riko_project"/);
  assert.match(html, /target="_blank"/);
});

test('escapes raw HTML and rejects executable or local links', () => {
  const markdown = createClippyMarkdown();
  const html = markdown.render('<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))\n\n[local](file:///C:/secret.txt)');

  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /&lt;img/);
});
