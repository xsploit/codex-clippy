const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('ships a 2x Clippy sprite map for high-DPI rendering', () => {
  const assetPath = path.join(__dirname, '..', 'src', 'assets', 'clippy-map-2x.png');
  const png = fs.readFileSync(assetPath);

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 3348 * 2);
  assert.equal(png.readUInt32BE(20), 3162 * 2);
});

test('ships a resolution-independent Clippy with semantic animation states', () => {
  const vectorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'clippy-svg.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const geometry = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'clippy-trace-geometry.svg'), 'utf8');

  assert.match(vectorSource, /viewBox="0 0 240 240"/);
  assert.match(vectorSource, /clippy-eye-base clippy-eye-base-left/);
  assert.match(vectorSource, /clippy-eye-base clippy-eye-base-right/);
  assert.doesNotMatch(vectorSource, /clippy-eye-base clippy-eye-left/);
  assert.doesNotMatch(vectorSource, /clippy-eye-base clippy-eye-right/);
  for (const animation of ['Wave', 'Listening', 'Thinking', 'Searching', 'Writing', 'Explain', 'Congratulate', 'Alert', 'IdleSnooze']) {
    assert.match(vectorSource, new RegExp(`${animation}:`));
  }
  for (const rigPart of [
    'clippy-paper',
    'clippy-wire-arch',
    'clippy-wire-outer-loop',
    'clippy-wire-inner-loop',
    'clippy-left-eye',
    'clippy-right-eye',
    'clippy-left-pupil',
    'clippy-right-pupil',
  ]) {
    assert.match(geometry, new RegExp(`id="${rigPart}"`));
  }
  for (const keyframe of [
    'clippy-wave-body',
    'clippy-listen-tilt',
    'clippy-think-loop',
    'clippy-processing-loop',
    'clippy-search-gaze',
    'clippy-working-body',
    'clippy-explain-arch',
    'clippy-celebrate',
    'clippy-error-recoil',
    'clippy-sleep-loop',
  ]) {
    assert.match(styles, new RegExp(`@keyframes ${keyframe}`));
  }
  assert.match(styles, /\.is-thinking \.clippy-pupil-left \{ animation: clippy-think-gaze-left/);
  assert.match(styles, /\.is-thinking \.clippy-pupil-right \{ animation: clippy-think-gaze-right/);
  assert.match(styles, /\.clippy-vector\.is-sleeping/);
});
