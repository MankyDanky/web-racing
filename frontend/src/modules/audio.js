// WebAudio sound system (#41).
//
// Everything is synthesized with oscillators/noise so no audio assets need to
// ship. Provides: engine hum (pitch tracks speed/RPM), tire skid, collision
// thud, countdown beeps, finish fanfare, and light background music. Respects
// the music/SFX/master-volume settings (#49).

import { getSettings, onSettingsChange } from './settings.js';

let ctx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;

// Engine
let engineOsc = null;
let engineOsc2 = null;
let engineGain = null;

// Skid
let skidSource = null;
let skidGain = null;
let skidBuffer = null;

// Music
let musicTimer = null;
let musicPlaying = false;

let started = false;

function applyVolumes() {
  if (!ctx) return;
  const s = getSettings();
  masterGain.gain.value = s.masterVolume;
  sfxGain.gain.value = s.sfxEnabled ? 1 : 0;
  musicGain.gain.value = s.musicEnabled ? 0.35 : 0;
}

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  masterGain = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.connect(masterGain);
  musicGain.connect(masterGain);
  masterGain.connect(ctx.destination);

  // Pre-render a noise buffer for skids.
  const len = ctx.sampleRate * 1.0;
  skidBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = skidBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  applyVolumes();
  onSettingsChange(applyVolumes);
}

// Browsers require a user gesture to start audio. Call on first key/touch.
export function resumeAudio() {
  if (!ctx) initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function startEngine() {
  if (!ctx || started) return;
  started = true;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0.0;
  engineGain.connect(sfxGain);

  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 60;

  engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'square';
  engineOsc2.frequency.value = 30;
  const o2g = ctx.createGain();
  o2g.gain.value = 0.4;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;

  engineOsc.connect(lp);
  engineOsc2.connect(o2g).connect(lp);
  lp.connect(engineGain);

  engineOsc.start();
  engineOsc2.start();
}

// speedKPH ~ 0..200. Maps to engine pitch/volume.
export function updateEngine(speedKPH, throttle = 0) {
  if (!ctx || !engineOsc) return;
  const s = Math.max(0, Math.min(200, speedKPH));
  const base = 55 + s * 2.2 + (throttle ? 20 : 0);
  const now = ctx.currentTime;
  engineOsc.frequency.setTargetAtTime(base, now, 0.05);
  engineOsc2.frequency.setTargetAtTime(base * 0.5, now, 0.05);
  const vol = 0.08 + Math.min(0.22, s / 200 * 0.22) + (throttle ? 0.05 : 0);
  engineGain.gain.setTargetAtTime(vol, now, 0.1);
}

export function stopEngine() {
  if (engineOsc) { try { engineOsc.stop(); } catch (e) {} engineOsc = null; }
  if (engineOsc2) { try { engineOsc2.stop(); } catch (e) {} engineOsc2 = null; }
  started = false;
}

// Tire skid: continuous filtered noise whose gain tracks slip intensity.
export function setSkid(intensity) {
  if (!ctx) return;
  const target = Math.max(0, Math.min(1, intensity));
  if (target > 0.01 && !skidSource) {
    skidSource = ctx.createBufferSource();
    skidSource.buffer = skidBuffer;
    skidSource.loop = true;
    skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    skidSource.connect(bp).connect(skidGain).connect(sfxGain);
    skidSource.start();
  }
  if (skidGain) {
    skidGain.gain.setTargetAtTime(target * 0.25, ctx.currentTime, 0.05);
  }
  if (target <= 0.01 && skidSource) {
    try { skidSource.stop(ctx.currentTime + 0.1); } catch (e) {}
    skidSource = null;
    skidGain = null;
  }
}

export function playCollision(intensity = 1) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = skidBuffer;
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 250;
  g.gain.setValueAtTime(Math.min(0.6, 0.3 * intensity), now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  src.connect(lp).connect(g).connect(sfxGain);
  src.start(now);
  src.stop(now + 0.35);
}

export function playBeep(high = false) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = high ? 880 : 440;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  osc.connect(g).connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.32);
}

export function playFanfare() {
  if (!ctx) return;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const now = ctx.currentTime;
  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const t = now + i * 0.14;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// Simple looping arpeggio background music.
const MUSIC_SEQ = [220, 277.18, 329.63, 277.18, 246.94, 329.63, 392, 329.63];
export function startMusic() {
  if (!ctx || musicPlaying) return;
  musicPlaying = true;
  let step = 0;
  const stepDur = 260;
  musicTimer = setInterval(() => {
    if (!ctx) return;
    const now = ctx.currentTime;
    const f = MUSIC_SEQ[step % MUSIC_SEQ.length];
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(g).connect(musicGain);
    osc.start(now);
    osc.stop(now + 0.26);
    step++;
  }, stepDur);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  musicPlaying = false;
}
