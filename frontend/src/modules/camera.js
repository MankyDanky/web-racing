// Chase + spectator camera logic, extracted from the old main.js god file (#28).

import * as THREE from 'three';
import { getSettings } from './settings.js';

const CAMERA_LERP = 0.1;
const CAMERA_LOOK_AHEAD = 2;

const _carPos = new THREE.Vector3();
const _carDir = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _target = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

// Follow the local player's car. Distance/height come from user settings (#49).
export function updateChaseCamera(camera, carModel) {
  if (!carModel) return;
  const s = getSettings();
  _carPos.copy(carModel.position);
  carModel.getWorldDirection(_carDir);

  // Position the camera behind (-distance along forward) and above the car.
  _offset.set(0, s.cameraHeight, 0);
  _target.copy(_carPos).addScaledVector(_carDir, -s.cameraDistance).add(_offset);

  camera.position.lerp(_target, CAMERA_LERP);
  _lookAt.copy(_carPos).addScaledVector(_carDir, CAMERA_LOOK_AHEAD);
  camera.lookAt(_lookAt);
}

// Broadcast / "live stream" camera (#5). Follows a target car from a dramatic,
// slightly elevated 3/4-rear angle that gently swings side to side, the way a TV
// director frames a moving car. `t` is elapsed seconds (for the slow sweep).
const _bcTarget = new THREE.Vector3();
const _bcLook = new THREE.Vector3();
const _bcDir = new THREE.Vector3();
const _bcSide = new THREE.Vector3();
export function updateBroadcastCamera(camera, targetCar, t = 0) {
  if (!targetCar) return;
  _carPos.copy(targetCar.position);
  targetCar.getWorldDirection(_bcDir);
  _bcDir.y = 0;
  if (_bcDir.lengthSq() < 1e-4) _bcDir.set(0, 0, 1);
  _bcDir.normalize();
  // Perpendicular (right) vector for the lateral swing.
  _bcSide.set(_bcDir.z, 0, -_bcDir.x);

  // Slow cinematic sweep: swing from behind-left to behind-right over ~9s and
  // ride a touch higher at the extremes for a heroic angle.
  const swing = Math.sin(t * 0.7);
  const back = 22;      // distance behind the car
  const side = swing * 12;
  const height = 8.5 + Math.abs(swing) * 3.5;

  _bcTarget.copy(_carPos)
    .addScaledVector(_bcDir, -back)
    .addScaledVector(_bcSide, side);
  _bcTarget.y = _carPos.y + height;

  // Smoothly ease toward the framed position (lower lerp = more graceful glide).
  camera.position.lerp(_bcTarget, 0.06);

  // Look slightly ahead of the car so it sits in the lower third of frame.
  _bcLook.copy(_carPos).addScaledVector(_bcDir, 6);
  _bcLook.y = _carPos.y + 1.5;
  camera.lookAt(_bcLook);
}

// Spectator: follow an arbitrary target car model.
export function updateSpectatorCamera(camera, targetCar) {
  if (!targetCar) return;
  const s = getSettings();
  _carPos.copy(targetCar.position);
  _carDir.set(0, 0, 1).applyQuaternion(targetCar.quaternion);
  _offset.set(0, s.cameraHeight, 0);
  _target.copy(_carPos).addScaledVector(_carDir, -s.cameraDistance).add(_offset);
  camera.position.lerp(_target, CAMERA_LERP);
  _lookAt.copy(_carPos).addScaledVector(_carDir, CAMERA_LOOK_AHEAD);
  camera.lookAt(_lookAt);
}
