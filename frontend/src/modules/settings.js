// Persistent user settings + in-game settings menu (#49).
//
// FOV, camera distance, steering sensitivity, colorblind palette, FPS counter,
// master audio + music/SFX toggles, tilt-steering (mobile). Persisted to
// localStorage so they survive reloads.

const STORAGE_KEY = 'racezSettings';

const DEFAULTS = {
  fov: 45,
  cameraDistance: 10,
  cameraHeight: 5,
  sensitivity: 1.0,
  colorblind: false,
  showFps: false,
  masterVolume: 0.8,
  musicEnabled: true,
  sfxEnabled: true,
  tiltSteering: false,
  vibration: true,
  adaptiveResolution: true,
  // Mobile control scheme: 'joystick' (analog pad) or 'buttons' (D-pad style
  // gas/brake/steer). Tilt steering, when enabled, overrides the steering half
  // of whichever scheme is active.
  controlScheme: 'joystick',
};

let settings = { ...DEFAULTS };
const listeners = new Set();

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULTS, ...parsed };
    }
  } catch (e) {
    settings = { ...DEFAULTS };
  }
  return settings;
}

export function getSettings() {
  return settings;
}

export function updateSetting(key, value) {
  settings[key] = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) { /* ignore quota errors */ }
  listeners.forEach((fn) => {
    try { fn(key, value, settings); } catch (e) { /* ignore */ }
  });
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Colorblind-friendly palette (Okabe-Ito based) toggle helper.
const NORMAL_HEX = {
  red: '#ff7070', orange: '#ffb766', yellow: '#ffffa7', green: '#429849',
  blue: '#447bc9', indigo: '#cc57d0', violet: '#7c37b1',
};
const COLORBLIND_HEX = {
  red: '#d55e00', orange: '#e69f00', yellow: '#f0e442', green: '#009e73',
  blue: '#0072b2', indigo: '#56b4e9', violet: '#cc79a7',
};

export function colorHex(name) {
  const map = settings.colorblind ? COLORBLIND_HEX : NORMAL_HEX;
  return map[name] || map.red;
}

// Build the settings gear button + panel. Returns the panel element.
export function createSettingsMenu() {
  const btn = document.createElement('button');
  btn.id = 'settings-btn';
  btn.setAttribute('aria-label', 'Settings');
  btn.innerHTML = '<i class="fas fa-cog"></i>';
  Object.assign(btn.style, {
    position: 'absolute', top: '20px', right: '230px', width: '44px', height: '44px',
    borderRadius: '10px', border: '2px solid rgba(255,255,255,0.3)',
    background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '20px', cursor: 'pointer',
    zIndex: '1200', boxShadow: '0 0 10px rgba(0,0,0,0.5)',
  });
  if (!btn.textContent) btn.textContent = '⚙';

  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  Object.assign(panel.style, {
    position: 'absolute', top: '70px', right: '20px', width: '280px',
    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', color: '#fff',
    padding: '18px', borderRadius: '12px', fontFamily: "'Poppins', sans-serif",
    fontSize: '14px', zIndex: '1200', display: 'none',
    boxShadow: '0 0 20px rgba(0,0,0,0.6)', maxHeight: '80vh', overflowY: 'auto',
  });

  const row = (labelText, control) => {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0', gap: '10px' });
    const l = document.createElement('label');
    l.textContent = labelText;
    l.style.flex = '1';
    r.appendChild(l);
    r.appendChild(control);
    return r;
  };

  const slider = (key, min, max, step) => {
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = step;
    s.value = settings[key]; s.style.width = '110px';
    s.addEventListener('input', () => updateSetting(key, parseFloat(s.value)));
    return s;
  };
  const toggle = (key) => {
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = !!settings[key];
    c.addEventListener('change', () => updateSetting(key, c.checked));
    return c;
  };
  const select = (key, options) => {
    const s = document.createElement('select');
    Object.assign(s.style, {
      background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
      borderRadius: '6px', padding: '4px 8px', fontFamily: "'Poppins', sans-serif", cursor: 'pointer',
    });
    options.forEach(([value, label]) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      if (settings[key] === value) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', () => updateSetting(key, s.value));
    return s;
  };

  const title = document.createElement('div');
  title.textContent = 'SETTINGS';
  Object.assign(title.style, { fontWeight: '900', fontSize: '18px', textAlign: 'center', marginBottom: '8px', letterSpacing: '2px' });
  panel.appendChild(title);

  panel.appendChild(row('Field of view', slider('fov', 35, 90, 1)));
  panel.appendChild(row('Camera distance', slider('cameraDistance', 6, 18, 1)));
  panel.appendChild(row('Steering sensitivity', slider('sensitivity', 0.5, 2, 0.1)));
  panel.appendChild(row('Master volume', slider('masterVolume', 0, 1, 0.05)));
  panel.appendChild(row('Music', toggle('musicEnabled')));
  panel.appendChild(row('Sound effects', toggle('sfxEnabled')));
  panel.appendChild(row('Colorblind palette', toggle('colorblind')));
  panel.appendChild(row('FPS counter', toggle('showFps')));
  panel.appendChild(row('Adaptive resolution', toggle('adaptiveResolution')));
  panel.appendChild(row('Mobile controls', select('controlScheme', [
    ['joystick', 'Joystick'],
    ['buttons', 'Buttons'],
  ])));
  panel.appendChild(row('Tilt steering (mobile)', toggle('tiltSteering')));
  panel.appendChild(row('Vibration (mobile)', toggle('vibration')));

  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.body.appendChild(btn);
  document.body.appendChild(panel);
  return panel;
}
