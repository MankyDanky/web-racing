// gates.js - Checkpoint gates system
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resetCarPosition } from './physics.js';

// Fade duration in seconds
const GATE_FADE_DURATION = 1.0;
let _tempVector1 = new THREE.Vector3();

// Load gates for the track
export function loadGates(mapId, gameState) {
  const { scene } = gameState;
  const loader = new GLTFLoader();
  
  // Reset gates array
  gameState.gates = [];
  gameState.currentGateIndex = 0;
  gameState.fadingGates = {};
  
  loader.load(
    `/models/maps/${mapId}/gates.glb`,
    (gltf) => {
      const gatesModel = gltf.scene;
      
      // Scale to match world
      gatesModel.scale.set(8, 8, 8);
      
      // Process numbered gates (0-6)
      for (let i = 0; i < 7; i++) {
        const gate = gatesModel.getObjectByName(`gate-${i}`);
        if (gate) {
          // Initialize properties
          gate.userData.index = i;
          gate.userData.passed = false;
          
          // Only first gate visible initially
          gate.visible = (i === 0);
          
          // Make materials transparent for fade effect
          gate.traverse(child => {
            if (child.isMesh) {
              child.material = child.material.clone();
              child.material.transparent = true;
              child.material.opacity = i === 0 ? 0 : 1;
            }
          });
          
          gameState.gates.push(gate);
          console.log(`Loaded gate-${i}, visible: ${gate.visible}`);
        } else {
          console.warn(`Could not find gate-${i}`);
        }
      }
      
      // Add finish gate
      const finishGate = gatesModel.getObjectByName('gate-finish');
      if (finishGate) {
        finishGate.userData.index = 7;
        finishGate.userData.passed = false;
        finishGate.userData.isFinish = true;
        finishGate.visible = false;
        
        finishGate.traverse(child => {
          if (child.isMesh) {
            child.material = child.material.clone();
            child.material.transparent = true;
            child.material.opacity = 0;
          }
        });
        
        gameState.gates.push(finishGate);
        console.log('Loaded gate-finish (initially hidden)');
      } else {
        console.warn('Could not find gate-finish');
      }
      
      // Add to scene
      scene.add(gatesModel);
      console.log(`Loaded ${gameState.gates.length} gates successfully`);
      
      // Start fade-in for first gate
      startGateFadeIn(0, gameState);
    },
    undefined,
    (error) => {
      console.error(`Error loading gates for ${mapId}:`, error);
    }
  );
}

// Start gate fade-in animation
export function startGateFadeIn(gateIndex, gameState) {
  const { gates, fadingGates } = gameState;
  
  if (gateIndex >= gates.length) return;
  
  const gate = gates[gateIndex];
  if (!gate) return;
  
  // Make gate visible
  gate.visible = true;
  
  // Reset opacity to 0
  gate.traverse(child => {
    if (child.isMesh) {
      child.material.opacity = 0;
    }
  });
  
  // Add to fading gates
  gameState.fadingGates[gateIndex] = {
    gate: gate,
    startTime: Date.now(),
    duration: GATE_FADE_DURATION * 1000
  };
}

// Update gate fade animations
export function updateGateFading(gameState) {
  const { fadingGates } = gameState;
  if (!fadingGates) return;
  
  const currentTime = Date.now();
  
  Object.entries(fadingGates).forEach(([index, fadeData]) => {
    const { gate, startTime, duration } = fadeData;
    const elapsed = currentTime - startTime;
    
    if (elapsed >= duration) {
      // Fading complete
      gate.traverse(child => {
        if (child.isMesh) {
          child.material.opacity = 1.0;
        }
      });
      
      // Remove from fading gates
      delete gameState.fadingGates[index];
    } else {
      // Calculate opacity based on elapsed time
      const opacity = elapsed / duration;
      
      // Update materials
      gate.traverse(child => {
        if (child.isMesh) {
          child.material.opacity = opacity;
        }
      });
    }
  });
}

// Check if player is near the current gate
export function checkGateProximity(gameState) {
  const { carModel, gates, currentGateIndex } = gameState;
  
  if (!carModel || gates.length === 0 || currentGateIndex >= gates.length) return;
  
  const gate = gates[currentGateIndex];
  if (!gate || gate.userData.passed) return;
  
  // Get gate position
  gate.getWorldPosition(_tempVector1);
  const gatePos = _tempVector1;
  
  // Calculate distance squared (avoid sqrt)
  const dx = carModel.position.x - gatePos.x;
  const dy = carModel.position.y - gatePos.y;
  const dz = carModel.position.z - gatePos.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  
  // Check if within threshold
  if (distanceSquared < 256) { // 2 units * 8 scale = 16, and 16² = 256
    console.log(`Passed through gate-${currentGateIndex === 7 ? 'finish' : currentGateIndex}`);
    
    // Store gate position and orientation for reset point
    gameState.currentGatePosition.copy(gatePos);
    gameState.currentGateQuaternion.copy(gate.quaternion);
    
    // Mark gate as passed
    gate.userData.passed = true;
    
    // Handle finish gate
    if (gate.userData.isFinish) {
      showFinishMessage(gameState);
    } else {
      // Move to next gate
      gameState.currentGateIndex++;
      
      // Make next gate visible with fade-in
      if (gameState.currentGateIndex < gates.length) {
        startGateFadeIn(gameState.currentGateIndex, gameState);
      }
    }
  }
}

// Show finish message
export function showFinishMessage(gameState) {
  // Create UI element
  const finishUI = document.createElement('div');
  finishUI.style.position = 'absolute';
  finishUI.style.top = '50%';
  finishUI.style.left = '50%';
  finishUI.style.transform = 'translate(-50%, -50%)';
  finishUI.style.background = 'rgba(0, 0, 0, 0.8)';
  finishUI.style.color = '#4dc9ff';
  finishUI.style.padding = '20px';
  finishUI.style.borderRadius = '10px';
  finishUI.style.fontFamily = "'Exo 2', sans-serif";
  finishUI.style.fontSize = '24px';
  finishUI.style.textAlign = 'center';
  finishUI.style.zIndex = '1000';
  finishUI.innerHTML = `
    <h2>Race Complete!</h2>
    <p>You passed through all ${gameState.gates.length} gates!</p>
    <button id="restart-btn" style="background: #4dc9ff; border: none; padding: 10px 20px; 
    border-radius: 5px; color: black; font-weight: bold; cursor: pointer;">Restart Race</button>
  `;
  document.body.appendChild(finishUI);
  
  // Add restart button event
  document.getElementById('restart-btn').addEventListener('click', () => {
    resetRace(gameState);
    document.body.removeChild(finishUI);
  });
}

// Reset race state
export function resetRace(gameState) {
  const { gates } = gameState;
  
  // Reset gate states
  gates.forEach((gate, index) => {
    gate.userData.passed = false;
    gate.visible = (index === 0);
  });
  
  // Reset counters
  gameState.currentGateIndex = 0;
  
  // Start fade-in for first gate
  startGateFadeIn(0, gameState);
  
  // Reset car position
  if (window.Ammo && gameState.carBody) {
    resetCarPosition(window.Ammo, gameState);
  }
}