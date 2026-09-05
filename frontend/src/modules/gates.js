import * as THREE from 'three';
import { createGLTFLoader } from './loaders.js';
import { log, warn, error } from './debug.js';
import { getTrack, getAssetMap, isReverse } from './tracks.js';

// Gate-related constants and variables
const GATE_FADE_DURATION = 1.0;
let _tempVector1 = new THREE.Vector3();
// Previous car position, for segment-vs-sphere crossing tests (#20)
let _prevCarPos = new THREE.Vector3();
let _hasPrevCarPos = false;

// Function to load gates model. `trackId` may be a reverse variant (#43).
export function loadGates(trackId, scene, loadingManager, onGatesLoaded) {
  const assetMap = getAssetMap(trackId);
  const reverse = isReverse(trackId);
  const trackInfo = getTrack(trackId);

  const gates = [];
  const fadingGates = {};
  let currentGateIndex = 0;
  const totalGates = trackInfo.totalGates || 8;
  const currentGatePosition = new THREE.Vector3(0, 2, 0);
  const currentGateQuaternion = new THREE.Quaternion();

  _hasPrevCarPos = false;

  const loader = createGLTFLoader(loadingManager);

  loader.load(
    `/models/maps/${assetMap}/gates.glb`,
    (gltf) => {
      const gatesModel = gltf.scene;
      gatesModel.scale.set(8, 8, 8);

      const loaded = [];

      // Find all numbered gates (0..6)
      for (let i = 0; i < 7; i++) {
        const gate = gatesModel.getObjectByName(`gate-${i}`);
        if (gate) {
          gate.userData.index = i;
          gate.userData.passed = false;
          gate.visible = false;
          gate.traverse((child) => {
            if (child.isMesh) {
              child.material = child.material.clone();
              child.material.transparent = true;
              child.material.opacity = 1;
            }
          });
          loaded.push(gate);
        } else {
          warn(`Could not find gate-${i}`);
        }
      }

      const finishGate = gatesModel.getObjectByName('gate-finish');
      if (finishGate) {
        finishGate.userData.index = 7;
        finishGate.userData.passed = false;
        finishGate.userData.isFinish = true;
        finishGate.visible = false;
        finishGate.traverse((child) => {
          if (child.isMesh) {
            child.material = child.material.clone();
            child.material.transparent = true;
            child.material.opacity = 0;
          }
        });
        loaded.push(finishGate);
      } else {
        warn('Could not find gate-finish');
      }

      // Reverse mode (#43): drive the gate sequence backwards. The last gate
      // becomes the finish line.
      let ordered = loaded;
      if (reverse) {
        ordered = loaded.slice().reverse();
        ordered.forEach((g, idx) => {
          g.userData.index = idx;
          g.userData.isFinish = idx === ordered.length - 1;
        });
      }

      ordered.forEach((g) => gates.push(g));

      // Only the first gate visible initially.
      if (gates[0]) {
        gates[0].visible = true;
        gates[0].traverse((child) => { if (child.isMesh) child.material.opacity = 0; });
      }

      scene.add(gatesModel);
      log(`Loaded ${gates.length} gates for ${trackId} (reverse=${reverse})`);

      startGateFadeIn(0, gates, fadingGates);

      if (onGatesLoaded) {
        onGatesLoaded({
          gates, fadingGates, currentGateIndex,
          totalGates: gates.length,
          currentGatePosition, currentGateQuaternion,
          trackId,
        });
      }
    },
    undefined,
    (err) => {
      error(`Error loading gates for ${trackId}:`, err);
    }
  );

  return {
    gates, fadingGates, currentGateIndex, totalGates,
    currentGatePosition, currentGateQuaternion, trackId,
  };
}

export function startGateFadeIn(gateIndex, gates, fadingGates) {
  if (gateIndex >= gates.length) return;
  const gate = gates[gateIndex];
  if (!gate) return;
  gate.visible = true;
  gate.traverse((child) => { if (child.isMesh) child.material.opacity = 0; });
  fadingGates[gateIndex] = {
    gate,
    startTime: Date.now(),
    duration: GATE_FADE_DURATION * 1000,
  };
}

export function updateGateFading(fadingGates) {
  const currentTime = Date.now();
  Object.entries(fadingGates).forEach(([index, fadeData]) => {
    const { gate, startTime, duration } = fadeData;
    const elapsed = currentTime - startTime;
    if (elapsed >= duration) {
      gate.traverse((child) => { if (child.isMesh) child.material.opacity = 1.0; });
      delete fadingGates[index];
    } else {
      const opacity = elapsed / duration;
      gate.traverse((child) => { if (child.isMesh) child.material.opacity = opacity; });
    }
  });
}

// Reset previous-position tracking (call on car reset so we don't register a
// bogus crossing across the teleport).
export function resetGateTracking() {
  _hasPrevCarPos = false;
}

// Segment-vs-sphere crossing test (#20). Instead of only checking if the car is
// currently within the gate radius (which can be tunnelled through at high speed
// between physics ticks), we test whether the segment from the car's previous
// position to its current position passes within the gate radius. This also
// makes corner-cutting harder.
function segmentHitsSphere(p0, p1, center, radiusSq) {
  // Closest point on segment p0->p1 to center.
  const d = _tempVector1.subVectors(p1, p0); // reuse temp for direction
  const lenSq = d.lengthSq();
  let t = 0;
  if (lenSq > 1e-8) {
    t = ((center.x - p0.x) * d.x + (center.y - p0.y) * d.y + (center.z - p0.z) * d.z) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = p0.x + d.x * t;
  const cy = p0.y + d.y * t;
  const cz = p0.z + d.z * t;
  const dx = cx - center.x;
  const dy = cy - center.y;
  const dz = cz - center.z;
  return (dx * dx + dy * dy + dz * dz) < radiusSq;
}

export function checkGateProximity(carModel, gateData) {
  const { gates, currentGateIndex, currentGatePosition, currentGateQuaternion } = gateData;

  if (!carModel || gates.length === 0 || currentGateIndex >= gates.length) return false;

  const gate = gates[currentGateIndex];
  if (!gate || gate.userData.passed) return false;

  const gatePos = new THREE.Vector3();
  gate.getWorldPosition(gatePos);

  const radiusSq = 256; // (2 * 8)^2

  let crossed = false;
  if (_hasPrevCarPos) {
    crossed = segmentHitsSphere(_prevCarPos, carModel.position, gatePos, radiusSq);
  } else {
    // First frame: fall back to a simple proximity check.
    const dx = carModel.position.x - gatePos.x;
    const dy = carModel.position.y - gatePos.y;
    const dz = carModel.position.z - gatePos.z;
    crossed = (dx * dx + dy * dy + dz * dz) < radiusSq;
  }

  // Update previous position for next tick.
  _prevCarPos.copy(carModel.position);
  _hasPrevCarPos = true;

  if (crossed) {
    log(`Passed through gate index ${currentGateIndex}${gate.userData.isFinish ? ' (finish)' : ''}`);
    currentGatePosition.copy(gatePos);
    currentGateQuaternion.copy(gate.quaternion);
    gate.userData.passed = true;

    if (gate.userData.isFinish) {
      gateData.currentGateIndex++;
      return true;
    }
    gateData.currentGateIndex++;
    if (gateData.currentGateIndex < gates.length) {
      startGateFadeIn(gateData.currentGateIndex, gates, gateData.fadingGates);
    }
  }

  return false;
}

// Function to show finish message. `finalTimeText` is now provided by the caller
// with millisecond precision (#44).
export function showFinishMessage(totalGates, resetCallback, finalTimeText = '0:00.000') {
  window.raceState.raceFinished = true;

  const speedometer = document.getElementById('speedometer');
  if (speedometer) {
    speedometer.style.opacity = '0';
    speedometer.style.transition = 'opacity 0.5s ease';
  }

  const finalTime = finalTimeText;

  if (window.playerPositions) {
    const myPlayerId = localStorage.getItem('myPlayerId');
    const myPlayerIndex = window.playerPositions.findIndex((p) => p.id === myPlayerId);
    if (myPlayerIndex !== -1) {
      window.playerPositions[myPlayerIndex].finishTime = finalTime;
    }
  } else if (window.playerFinishTimes) {
    window.playerFinishTimes[localStorage.getItem('myPlayerId')] = finalTime;
  }

  const finishUI = document.createElement('div');
  finishUI.id = 'finish-ui';
  finishUI.style.position = 'absolute';
  finishUI.style.top = '50%';
  finishUI.style.left = '0';
  finishUI.style.right = '0';
  finishUI.style.transform = 'translateY(-50%)';
  finishUI.style.textAlign = 'center';
  finishUI.style.zIndex = '1000';

  const finishText = document.createElement('div');
  finishText.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  finishText.style.boxShadow = '0 0 20px hsla(0, 0.00%, 0.00%, 0.50)';
  finishText.style.borderRadius = '10px';
  finishText.textContent = 'FINISH';
  finishText.style.fontFamily = "'Poppins', sans-serif";
  finishText.style.fontWeight = '900';
  finishText.style.fontSize = '120px';
  finishText.style.color = '#ff0080';
  finishText.style.textShadow = '0 0 20px rgba(255, 0, 128, 0.7)';
  finishText.style.letterSpacing = '10px';
  finishText.style.transform = 'translateX(-100%)';
  finishText.style.display = 'inline-block';
  finishText.style.opacity = '0';
  finishText.style.transition = 'transform 1s cubic-bezier(0.12, 0.93, 0.27, 0.98), opacity 1s ease';
  finishText.style.padding = '5px 20px';
  finishText.style.userSelect = 'none';

  const timeContainer = document.createElement('div');
  timeContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  timeContainer.style.borderRadius = '10px';
  timeContainer.style.padding = '5px 20px';
  timeContainer.style.width = 'fit-content';
  timeContainer.style.margin = '0 auto';
  timeContainer.style.marginTop = '30px';
  timeContainer.style.fontSize = '36px';
  timeContainer.style.fontWeight = 'bold';
  timeContainer.style.color = '#ffffff';
  timeContainer.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
  timeContainer.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  timeContainer.style.opacity = '0';
  timeContainer.style.transition = 'opacity 1s ease';
  timeContainer.style.transitionDelay = '1s';
  timeContainer.textContent = `TIME: ${finalTime}`;

  finishUI.appendChild(finishText);
  finishUI.appendChild(timeContainer);
  document.body.appendChild(finishUI);

  setTimeout(() => {
    finishText.style.transform = 'translateX(0)';
    finishText.style.opacity = '1';
    timeContainer.style.opacity = '1';
  }, 100);

  setTimeout(() => {
    timeContainer.style.transitionDelay = '0s';
    finishText.style.transform = 'translateX(100%)';
    finishText.style.opacity = '0';
    timeContainer.style.opacity = '0';
    setTimeout(() => {
      if (finishUI.parentNode) document.body.removeChild(finishUI);
      // Hand control back to main.js: it decides whether to show the post-race
      // options (Home / Spectate) and, once everyone finishes, the final
      // leaderboard (#4, #5). Works for both solo and multiplayer.
      if (window.onLocalPlayerFinished) window.onLocalPlayerFinished();
    }, 1000);
  }, 4000);

  return finishUI;
}

export function resetRace(gateData, ammo, carBody, vehicle, currentSteeringAngle, resetCarPosition) {
  const { gates, fadingGates } = gateData;
  gates.forEach((gate, index) => {
    gate.userData.passed = false;
    gate.visible = (index === 0);
  });
  gateData.currentGateIndex = 0;
  startGateFadeIn(0, gates, fadingGates);
  resetGateTracking();
  if (ammo && carBody) {
    return resetCarPosition(
      ammo, carBody, vehicle, currentSteeringAngle,
      gateData.currentGatePosition, gateData.currentGateQuaternion
    );
  }
  return currentSteeringAngle;
}
