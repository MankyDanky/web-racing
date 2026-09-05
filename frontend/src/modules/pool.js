// Reusable temporaries to avoid per-frame allocations in hot paths (#17).
//
// Both Three.js Vector3/Quaternion and Ammo btVector3/btTransform temporaries
// were being newly allocated every physics tick, causing GC hitches on mobile.
// This module provides shared scratch objects. Ammo objects are created lazily
// once Ammo is initialised and never destroyed (they live for the session).

import * as THREE from 'three';

// Three.js scratch vectors/quaternions (safe to reuse within a single call
// chain - never hold references across awaits).
export const threePool = {
  v0: new THREE.Vector3(),
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  q0: new THREE.Quaternion(),
  q1: new THREE.Quaternion(),
  e0: new THREE.Euler(),
};

let ammoPool = null;

export function initAmmoPool(ammo) {
  if (ammoPool) return ammoPool;
  ammoPool = {
    v0: new ammo.btVector3(0, 0, 0),
    v1: new ammo.btVector3(0, 0, 0),
    trans0: new ammo.btTransform(),
  };
  return ammoPool;
}

export function getAmmoPool() {
  return ammoPool;
}
