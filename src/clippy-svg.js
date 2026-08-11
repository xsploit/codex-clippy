const ANIMATION_STATES = Object.freeze({
  RestPose: 'idle',
  Idle1_1: 'idle',
  Acknowledge: 'yes',
  Yes: 'yes',
  Wave: 'wave',
  Greeting: 'wave',
  Listening: 'listening',
  Hearing_1: 'listening',
  Thinking: 'thinking',
  Processing: 'processing',
  Searching: 'searching',
  Writing: 'working',
  Explain: 'explaining',
  GestureLeft: 'explaining',
  GestureRight: 'explaining',
  GestureUp: 'explaining',
  GestureDown: 'explaining',
  Congratulate: 'success',
  GetAttention: 'error',
  Alert: 'error',
  Confused: 'error',
  ClickedOn: 'clicked',
  LookDown: 'look-down',
  IdleSnooze: 'sleeping',
  GoodBye: 'wave',
});

const STATE_CLASSES = [...new Set(Object.values(ANIMATION_STATES))].map((state) => `is-${state}`);
const GEOMETRY_URL = new URL('./assets/clippy-trace-geometry.svg', import.meta.url).href;
const TRACE_TRANSFORM = 'translate(30 0) scale(.176)';

function characterMarkup() {
  return `
    <svg class="clippy-svg" viewBox="0 0 240 240" role="img" aria-label="Clippy" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fffed0"/>
          <stop offset=".52" stop-color="#f4f09d"/>
          <stop offset="1" stop-color="#d8d271"/>
        </linearGradient>
        <linearGradient id="wire" x1="0" y1="0" x2="1" y2=".32">
          <stop offset="0" stop-color="#343653"/>
          <stop offset=".1" stop-color="#777aa8"/>
          <stop offset=".25" stop-color="#e1e2f5"/>
          <stop offset=".39" stop-color="#9a9cc7"/>
          <stop offset=".63" stop-color="#4a4c78"/>
          <stop offset=".82" stop-color="#bfc1e3"/>
          <stop offset="1" stop-color="#3a3c61"/>
        </linearGradient>
        <radialGradient id="eye" cx="35%" cy="28%" r="72%">
          <stop offset="0" stop-color="#fff"/>
          <stop offset=".72" stop-color="#f5f5f6"/>
          <stop offset="1" stop-color="#b9bac1"/>
        </radialGradient>
        <filter id="soft-shadow" x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="4" dy="7" stdDeviation="4" flood-color="#171525" flood-opacity=".28"/>
        </filter>
        <filter id="eye-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#151522" flood-opacity=".38"/>
        </filter>
        <filter id="wire-depth" x="-30%" y="-20%" width="160%" height="150%" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.25" result="wire-softness"/>
          <feSpecularLighting in="wire-softness" surfaceScale="3.5" specularConstant=".72" specularExponent="18" lighting-color="#ffffff" result="wire-shine">
            <feDistantLight azimuth="225" elevation="52"/>
          </feSpecularLighting>
          <feComposite in="wire-shine" in2="SourceAlpha" operator="in" result="wire-clipped-shine"/>
          <feBlend in="SourceGraphic" in2="wire-clipped-shine" mode="screen"/>
        </filter>
        <mask id="outline-without-pupils" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
          <rect width="240" height="240" fill="#fff"/>
          <ellipse cx="98" cy="63" rx="10.5" ry="9" fill="#000"/>
          <ellipse cx="144" cy="71" rx="10.5" ry="9" fill="#000"/>
        </mask>
      </defs>

      <ellipse class="clippy-ground-shadow" cx="126" cy="220" rx="70" ry="10" fill="#171525" opacity=".2"/>

      <g class="clippy-actor" filter="url(#soft-shadow)">
        <g class="clippy-paper">
          <g transform="${TRACE_TRANSFORM}">
            <use href="${GEOMETRY_URL}#clippy-paper"/>
          </g>
        </g>

        <g class="clippy-props">
          <g class="prop prop-question" aria-hidden="true">
            <path d="M198 34 C212 17 233 28 229 44 C227 54 215 55 214 65" fill="none" stroke="#655f99" stroke-width="7" stroke-linecap="round"/>
            <circle cx="213" cy="78" r="4" fill="#655f99"/>
          </g>
          <g class="prop prop-listen" fill="none" stroke="#655f99" stroke-width="4" stroke-linecap="round">
            <path d="M202 83 Q218 94 202 105"/>
            <path d="M209 73 Q235 94 209 115" opacity=".65"/>
          </g>
          <g class="prop prop-processing" aria-hidden="true">
            <g transform="translate(207 67)">
              <circle r="15" fill="#f2ed9c" stroke="#575582" stroke-width="3" stroke-dasharray="5 4"/>
              <circle class="processing-orbit" cx="0" cy="-15" r="4" fill="#6f6ba1"/>
              <circle class="processing-core" r="5" fill="#fffbc1" stroke="#575582" stroke-width="2"/>
            </g>
          </g>
          <g class="prop prop-search">
            <circle cx="191" cy="147" r="24" fill="#d8eeff" fill-opacity=".2" stroke="#5d5c84" stroke-width="7"/>
            <path d="M208 165 L229 187" stroke="#5d5c84" stroke-width="9" stroke-linecap="round"/>
          </g>
          <g class="prop prop-pencil">
            <path d="M177 144 L219 186" stroke="#d29a31" stroke-width="11" stroke-linecap="round"/>
            <path d="M177 144 L170 134 L181 140 Z" fill="#3d395c"/>
            <path d="M219 186 L225 192" stroke="#d76d72" stroke-width="12" stroke-linecap="round"/>
          </g>
          <g class="prop prop-sparkles" fill="#f2c84b" stroke="#8f6e12" stroke-width="1.5">
            <path d="M40 58 L45 70 L57 75 L45 80 L40 93 L35 80 L23 75 L35 70 Z"/>
            <path d="M201 23 L205 32 L214 36 L205 40 L201 49 L197 40 L188 36 L197 32 Z"/>
            <path d="M213 98 L216 105 L224 108 L216 111 L213 119 L210 111 L202 108 L210 105 Z"/>
          </g>
          <g class="prop prop-alert">
            <path d="M210 27 L210 62" stroke="#c84842" stroke-width="10" stroke-linecap="round"/>
            <circle cx="210" cy="78" r="6" fill="#c84842"/>
          </g>
          <g class="prop prop-zzz" fill="#655f99" font-family="Tahoma, sans-serif" font-weight="700">
            <text x="184" y="76" font-size="24">Z</text>
            <text x="207" y="53" font-size="18">Z</text>
            <text x="224" y="34" font-size="13">Z</text>
          </g>
        </g>

        <g class="clippy-wire">
          <g class="clippy-rig-body" filter="url(#wire-depth)">
            <g transform="${TRACE_TRANSFORM}"><use href="${GEOMETRY_URL}#clippy-wire-fill" fill="url(#wire)"/></g>
          </g>

          <g class="clippy-arm clippy-arm-left">
            <path class="arm-outline" d="M96 126 Q49 128 28 110"/>
            <path class="arm-wire" d="M96 126 Q49 128 28 110"/>
            <path class="clippy-hand" d="M28 110 l-8 -8 m8 8 l-1 -12 m1 12 l7 -8"/>
          </g>
          <g class="clippy-arm clippy-arm-right">
            <path class="arm-outline" d="M160 122 Q181 108 190 84"/>
            <path class="arm-wire" d="M160 122 Q181 108 190 84"/>
            <path class="clippy-hand" d="M190 84 l-4 -12 m4 12 l5 -11 m-5 11 l12 -6"/>
          </g>
        </g>

        <g class="clippy-face">
          <g class="clippy-eye-base clippy-eye-base-left" filter="url(#eye-shadow)">
            <g transform="${TRACE_TRANSFORM}">
              <use class="clippy-eye-white" href="${GEOMETRY_URL}#clippy-left-eye"/>
            </g>
          </g>
          <g class="clippy-eye-base clippy-eye-base-right" filter="url(#eye-shadow)">
            <g transform="${TRACE_TRANSFORM}">
              <use class="clippy-eye-white" href="${GEOMETRY_URL}#clippy-right-eye"/>
            </g>
          </g>
          <g class="clippy-trace-outline" mask="url(#outline-without-pupils)">
            <g transform="${TRACE_TRANSFORM}"><use href="${GEOMETRY_URL}#clippy-outline"/></g>
          </g>
          <g class="clippy-eye clippy-eye-left">
            <g class="clippy-pupil clippy-pupil-left">
              <g transform="${TRACE_TRANSFORM}"><use class="clippy-pupil-shape" href="${GEOMETRY_URL}#clippy-left-pupil"/></g>
              <ellipse class="clippy-pupil-glint" cx="94" cy="59" rx="1.65" ry="1.25"/>
            </g>
          </g>
          <g class="clippy-eye clippy-eye-right">
            <g class="clippy-pupil clippy-pupil-right">
              <g transform="${TRACE_TRANSFORM}"><use class="clippy-pupil-shape" href="${GEOMETRY_URL}#clippy-right-pupil"/></g>
              <ellipse class="clippy-pupil-glint" cx="140" cy="67" rx="1.65" ry="1.25"/>
            </g>
          </g>
          <g class="clippy-lids">
            <path class="clippy-lid clippy-lid-left clippy-lid-top" d="M79 59 Q81 49 98 47 Q115 49 117 59 Z"/>
            <path class="clippy-lid clippy-lid-left clippy-lid-bottom" d="M79 69 L117 69 Q115 78 98 80 Q81 78 79 69 Z"/>
            <path class="clippy-lid clippy-lid-right clippy-lid-top" d="M125 67 Q127 57 144 55 Q161 57 163 67 Z"/>
            <path class="clippy-lid clippy-lid-right clippy-lid-bottom" d="M125 77 L163 77 Q161 86 144 88 Q127 86 125 77 Z"/>
          </g>
        </g>
      </g>
    </svg>`;
}

export function createClippySvgAgent() {
  const element = document.createElement('div');
  element.className = 'clippy-character clippy-vector is-idle';
  element.innerHTML = characterMarkup();
  document.body.appendChild(element);

  let animationTimer = null;

  function play(name, duration = 4_500) {
    const state = ANIMATION_STATES[name];
    if (!state) return false;
    if (animationTimer) window.clearTimeout(animationTimer);
    element.classList.remove(...STATE_CLASSES);
    // Restart finite CSS motions when the same semantic animation plays twice.
    void element.offsetWidth;
    element.classList.add(`is-${state}`);
    element.dataset.animation = name;
    if (state !== 'idle' && duration > 0) {
      animationTimer = window.setTimeout(() => {
        element.classList.remove(...STATE_CLASSES);
        element.classList.add('is-idle');
        element.dataset.animation = 'RestPose';
      }, duration);
    }
    return true;
  }

  return {
    _el: element,
    hasAnimation(name) {
      return Object.hasOwn(ANIMATION_STATES, name);
    },
    play,
    show() {
      element.hidden = false;
    },
    moveTo(x, y) {
      element.style.left = `${Math.round(x)}px`;
      element.style.top = `${Math.round(y)}px`;
    },
  };
}
