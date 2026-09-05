// Snapshot interpolation buffer + binary quantized packet codec.
//
// #1 Interpolation: remote cars used to teleport between 20 Hz snapshots. We now
//    keep a small time-stamped snapshot buffer per opponent and render ~100 ms
//    in the past, lerping position and slerping quaternion between the two
//    snapshots that straddle the render time.
//
// #2 Bandwidth: transforms are quantized to a compact binary ArrayBuffer
//    (Int16 positions, smallest-three-ish Int16 quaternion) instead of full
//    JSON, and only sent at ~20 Hz. Falls back to JSON objects transparently.

import * as THREE from 'three';

export const INTERP_DELAY_MS = 120; // render this far in the past
const MAX_SNAPSHOTS = 24;

// --- Snapshot buffer -------------------------------------------------------

export class SnapshotBuffer {
  constructor() {
    this.snaps = []; // { t, px,py,pz, qx,qy,qz,qw }
    this._pos = new THREE.Vector3();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
  }

  add(snapshot) {
    // snapshot: { position:{x,y,z}, quaternion:{x,y,z,w}, t }
    const t = snapshot.t || Date.now();
    const p = snapshot.position || {};
    const q = snapshot.quaternion || {};
    this.snaps.push({
      t,
      px: p.x || 0, py: p.y || 0, pz: p.z || 0,
      qx: q.x || 0, qy: q.y || 0, qz: q.z || 0, qw: q.w == null ? 1 : q.w,
    });
    // Keep sorted & bounded.
    if (this.snaps.length > 1 && t < this.snaps[this.snaps.length - 2].t) {
      this.snaps.sort((a, b) => a.t - b.t);
    }
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.shift();
  }

  // Sample the interpolated transform at (now - delay). Writes into
  // outPosition (THREE.Vector3) and outQuat (THREE.Quaternion). Returns true
  // if a value was produced.
  sample(outPosition, outQuat, now = Date.now(), delay = INTERP_DELAY_MS) {
    const n = this.snaps.length;
    if (n === 0) return false;
    if (n === 1) {
      const s = this.snaps[0];
      outPosition.set(s.px, s.py, s.pz);
      outQuat.set(s.qx, s.qy, s.qz, s.qw);
      return true;
    }

    const renderTime = now - delay;

    // Before the earliest snapshot: clamp to earliest.
    if (renderTime <= this.snaps[0].t) {
      const s = this.snaps[0];
      outPosition.set(s.px, s.py, s.pz);
      outQuat.set(s.qx, s.qy, s.qz, s.qw);
      return true;
    }
    // After the latest: clamp to latest (extrapolation avoided for stability).
    const last = this.snaps[n - 1];
    if (renderTime >= last.t) {
      outPosition.set(last.px, last.py, last.pz);
      outQuat.set(last.qx, last.qy, last.qz, last.qw);
      return true;
    }

    // Find the pair straddling renderTime.
    for (let i = 0; i < n - 1; i++) {
      const a = this.snaps[i];
      const b = this.snaps[i + 1];
      if (renderTime >= a.t && renderTime <= b.t) {
        const span = b.t - a.t || 1;
        const alpha = (renderTime - a.t) / span;
        outPosition.set(
          a.px + (b.px - a.px) * alpha,
          a.py + (b.py - a.py) * alpha,
          a.pz + (b.pz - a.pz) * alpha
        );
        this._qa.set(a.qx, a.qy, a.qz, a.qw);
        this._qb.set(b.qx, b.qy, b.qz, b.qw);
        outQuat.copy(this._qa).slerp(this._qb, alpha);
        return true;
      }
    }
    // Fallback.
    outPosition.set(last.px, last.py, last.pz);
    outQuat.set(last.qx, last.qy, last.qz, last.qw);
    return true;
  }

  clear() { this.snaps.length = 0; }
}

// --- Binary quantized transform codec (#2) --------------------------------
//
// Layout (little-endian), 20 bytes:
//   0  uint8   magic (0xRC -> 0xR? we use 0xCA)
//   1  uint8   flags (bit0 = finished)
//   2  int16   pos.x * POS_SCALE
//   4  int16   pos.y * POS_SCALE
//   6  int16   pos.z * POS_SCALE
//   8  int16   quat.x * Q_SCALE
//   10 int16   quat.y * Q_SCALE
//   12 int16   quat.z * Q_SCALE
//   14 int16   quat.w * Q_SCALE
//   16 uint8   currentGateIndex
//   17 uint8   reserved
//   18 uint16  distanceToNextGate (clamped/quantized, sqrt of dist^2)

const MAGIC = 0xca;
const POS_SCALE = 32;   // ~3 cm resolution over +-1024 units
const Q_SCALE = 32767;  // quaternion components in [-1,1]
export const TRANSFORM_BYTES = 20;

function clampInt16(v) {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v | 0;
}

export function encodeTransform({ position, quaternion, gateIndex = 0, distanceToNextGate = 0, finished = false }) {
  const buf = new ArrayBuffer(TRANSFORM_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, MAGIC);
  dv.setUint8(1, finished ? 1 : 0);
  dv.setInt16(2, clampInt16(Math.round((position.x || 0) * POS_SCALE)), true);
  dv.setInt16(4, clampInt16(Math.round((position.y || 0) * POS_SCALE)), true);
  dv.setInt16(6, clampInt16(Math.round((position.z || 0) * POS_SCALE)), true);
  dv.setInt16(8, clampInt16(Math.round((quaternion.x || 0) * Q_SCALE)), true);
  dv.setInt16(10, clampInt16(Math.round((quaternion.y || 0) * Q_SCALE)), true);
  dv.setInt16(12, clampInt16(Math.round((quaternion.z || 0) * Q_SCALE)), true);
  dv.setInt16(14, clampInt16(Math.round((quaternion.w == null ? 1 : quaternion.w) * Q_SCALE)), true);
  dv.setUint8(16, Math.max(0, Math.min(255, gateIndex | 0)));
  dv.setUint8(17, 0);
  // Store linear distance (sqrt of squared) so a uint16 covers a big range.
  const lin = Math.sqrt(Math.max(0, distanceToNextGate));
  dv.setUint16(18, Math.max(0, Math.min(65535, Math.round(lin))), true);
  return buf;
}

export function isBinaryTransform(data) {
  return (data instanceof ArrayBuffer) && data.byteLength === TRANSFORM_BYTES && new DataView(data).getUint8(0) === MAGIC;
}

export function decodeTransform(buf) {
  const dv = new DataView(buf);
  const lin = dv.getUint16(18, true);
  return {
    finished: (dv.getUint8(1) & 1) === 1,
    position: {
      x: dv.getInt16(2, true) / POS_SCALE,
      y: dv.getInt16(4, true) / POS_SCALE,
      z: dv.getInt16(6, true) / POS_SCALE,
    },
    quaternion: {
      x: dv.getInt16(8, true) / Q_SCALE,
      y: dv.getInt16(10, true) / Q_SCALE,
      z: dv.getInt16(12, true) / Q_SCALE,
      w: dv.getInt16(14, true) / Q_SCALE,
    },
    gateIndex: dv.getUint8(16),
    distanceToNextGate: lin * lin,
  };
}
