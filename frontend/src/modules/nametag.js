// Floating name label rendered above a car (#1). Shared by remote human players
// (multiplayer.js) and AI bots (ai.js) so every vehicle on track is labelled the
// same way. It's a camera-facing THREE.Sprite backed by a small canvas texture.

import * as THREE from 'three';

// Colours used to tint the little pill behind the name so a bot/player's colour
// is legible at a glance. Falls back to a neutral dark pill.
const PILL_HEX = {
  red: '#e23b3b', blue: '#3b7be2', green: '#39b552', yellow: '#e2c23b',
  orange: '#e2853b', violet: '#a05be2', indigo: '#5b6be2',
};

// Build a name sprite. `text` is the label; `color` optionally tints the pill.
export function createNameSprite(text, color) {
  const label = String(text == null ? '' : text).slice(0, 20) || 'Player';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;

  ctx.font = 'bold 30px Poppins, sans-serif';
  const textWidth = ctx.measureText(label).width;
  const padX = 22;
  const pillW = Math.min(canvas.width - 8, textWidth + padX * 2);
  const pillH = 44;
  const pillX = (canvas.width - pillW) / 2;
  const pillY = (canvas.height - pillH) / 2;

  // Rounded pill background tinted by the car colour.
  const pill = PILL_HEX[color] || 'rgba(20,20,28,0.9)';
  ctx.fillStyle = pill;
  const r = pillH / 2;
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
  ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
  ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
  ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
  ctx.closePath();
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Name text with a dark outline for contrast on any background.
  ctx.font = 'bold 30px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(label, canvas.width / 2, canvas.height / 2 + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999; // draw over cars so it never gets occluded
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}
