// Unit tests for the binary transform codec + snapshot buffer (#1, #2, #32).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  encodeTransform, decodeTransform, isBinaryTransform, TRANSFORM_BYTES, SnapshotBuffer,
} from '../src/modules/netcode.js';

test('encode/decode round-trips a transform within quantization error', () => {
  const buf = encodeTransform({
    position: { x: 123.45, y: -6.7, z: 88.2 },
    quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    gateIndex: 5,
    distanceToNextGate: 400, // squared distance; sqrt=20
    finished: true,
  });
  assert.equal(buf.byteLength, TRANSFORM_BYTES);
  assert.ok(isBinaryTransform(buf));

  const d = decodeTransform(buf);
  assert.ok(Math.abs(d.position.x - 123.45) < 0.1);
  assert.ok(Math.abs(d.position.y - -6.7) < 0.1);
  assert.ok(Math.abs(d.position.z - 88.2) < 0.1);
  assert.ok(Math.abs(d.quaternion.w - 0.9) < 0.001);
  assert.equal(d.gateIndex, 5);
  assert.equal(d.finished, true);
  // distance stored as sqrt -> re-squared, expect ~400
  assert.ok(Math.abs(d.distanceToNextGate - 400) < 50);
});

test('isBinaryTransform rejects plain objects and wrong sizes', () => {
  assert.equal(isBinaryTransform({ type: 'carUpdate' }), false);
  assert.equal(isBinaryTransform(new ArrayBuffer(4)), false);
});

test('binary transform is far smaller than JSON', () => {
  const json = JSON.stringify({
    type: 'carUpdate', playerId: 'racez-uuid-1234', playerName: 'Player',
    playerColor: 'red', position: { x: 123.45, y: 6.7, z: 88.2 },
    quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    raceProgress: { currentGateIndex: 5, distanceToNextGate: 400 },
  });
  assert.ok(TRANSFORM_BYTES < json.length / 5, `binary ${TRANSFORM_BYTES}B vs json ${json.length}B`);
});

test('SnapshotBuffer interpolates between two snapshots', () => {
  const b = new SnapshotBuffer();
  const t0 = 1000;
  b.add({ position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, t: t0 });
  b.add({ position: { x: 10, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, t: t0 + 100 });

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  // Sample at midpoint (render time = now - delay). now-delay = t0+50.
  const ok = b.sample(pos, quat, t0 + 50 + 120, 120);
  assert.ok(ok);
  assert.ok(Math.abs(pos.x - 5) < 0.001, `expected ~5 got ${pos.x}`);
});

test('SnapshotBuffer clamps to latest when render time is ahead', () => {
  const b = new SnapshotBuffer();
  b.add({ position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, t: 1000 });
  b.add({ position: { x: 10, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, t: 1100 });
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  b.sample(pos, quat, 5000, 0); // way ahead -> clamp to latest
  assert.equal(pos.x, 10);
});
