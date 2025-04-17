import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Gate-related constants and variables
const GATE_FADE_DURATION = 1.0;
let _tempVector1 = new THREE.Vector3();

// Function to load gates model
export function loadGates(mapId = "map1", scene, onGatesLoaded) {
  // Initialize arrays and counters
  const gates = [];
  const fadingGates = {};
  let currentGateIndex = 0;
  const totalGates = 8;
  const currentGatePosition = new THREE.Vector3(0, 2, 0);
  const currentGateQuaternion = new THREE.Quaternion();
  
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/gates.glb`,
    (gltf) => {
      const gatesModel = gltf.scene;
      
      // Scale to match the world scale
      gatesModel.scale.set(8, 8, 8);
      
      // Find all numbered gates
      for (let i = 0; i < 7; i++) {
        const gate = gatesModel.getObjectByName(`gate-${i}`);
        if (gate) {
          // Initialize gate properties
          gate.userData.index = i;
          gate.userData.passed = false;
          
          // Only first gate is visible initially
          gate.visible = (i === 0);
          
          // Make materials transparent for fade effect
          gate.traverse(child => {
            if (child.isMesh) {
              child.material = child.material.clone();
              child.material.transparent = true;
              child.material.opacity = i === 0 ? 0 : 1;
            }
          });
          
          gates.push(gate);
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
        
        gates.push(finishGate);
        console.log('Loaded gate-finish (initially hidden)');
      } else {
        console.warn('Could not find gate-finish');
      }
      
      // Add to scene
      scene.add(gatesModel);
      console.log(`Loaded ${gates.length} gates successfully`);
      
      // Start fade-in for first gate
      startGateFadeIn(0, gates, fadingGates);
      
      // Return gates and related data through callback
      if (onGatesLoaded) {
        onGatesLoaded({
          gates,
          fadingGates,
          currentGateIndex,
          totalGates,
          currentGatePosition,
          currentGateQuaternion
        });
      }
    },
    undefined,
    (error) => {
      console.error(`Error loading gates for ${mapId}:`, error);
    }
  );
  
  // Return initial objects
  return {
    gates,
    fadingGates,
    currentGateIndex,
    totalGates,
    currentGatePosition,
    currentGateQuaternion
  };
}

// Function to initiate gate fade-in
export function startGateFadeIn(gateIndex, gates, fadingGates) {
  if (gateIndex >= gates.length) return;
  
  const gate = gates[gateIndex];
  if (!gate) return;
  
  // Make sure gate is visible
  gate.visible = true;
  
  // Reset opacity to 0
  gate.traverse(child => {
    if (child.isMesh) {
      child.material.opacity = 0;
    }
  });
  
  // Add to fading gates
  fadingGates[gateIndex] = {
    gate: gate,
    startTime: Date.now(),
    duration: GATE_FADE_DURATION * 1000
  };
}

// Function to update gate fading
export function updateGateFading(fadingGates) {
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
      delete fadingGates[index];
    } else {
      // Calculate opacity based on elapsed time (0 to 1)
      const opacity = elapsed / duration;
      
      // Update all materials in the gate
      gate.traverse(child => {
        if (child.isMesh) {
          child.material.opacity = opacity;
        }
      });
    }
  });
}

// Optimized function to check if player is near gates
export function checkGateProximity(carModel, gateData) {
  const { gates, currentGateIndex, currentGatePosition, currentGateQuaternion } = gateData;
  
  if (!carModel || gates.length === 0 || currentGateIndex >= gates.length) return false;
  
  const gate = gates[currentGateIndex];
  if (!gate || gate.userData.passed) return false;
  
  // Get gate position in world space - reuse existing vector
  gate.getWorldPosition(_tempVector1);
  const gatePos = _tempVector1;
  
  // Calculate distance squared (avoid expensive sqrt)
  const dx = carModel.position.x - gatePos.x;
  const dy = carModel.position.y - gatePos.y;
  const dz = carModel.position.z - gatePos.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  
  // Compare with threshold squared (2 units * 8 scale factor)^2 = 256
  if (distanceSquared < 256) {
    console.log(`Passed through gate-${currentGateIndex === 7 ? 'finish' : currentGateIndex}`);
    currentGatePosition.copy(gatePos);
    currentGateQuaternion.copy(gate.quaternion);
    
    // Mark gate as passed
    gate.userData.passed = true;
    
    // If this is the finish gate
    if (gate.userData.isFinish) {
      return true; // Signal race is finished
    } else {
      // Move to next gate
      gateData.currentGateIndex++;
      
      // Make next gate visible and start fade-in
      if (gateData.currentGateIndex < gates.length) {
        startGateFadeIn(gateData.currentGateIndex, gates, gateData.fadingGates);
      }
    }
  }
  
  return false; // Race not finished
}

// Function to show finish message
export function showFinishMessage(totalGates, resetCallback) {
  // Set the raceFinished state to true
  window.raceState.raceFinished = true;
  
  // Hide speedometer
  const speedometer = document.getElementById('speedometer');
  if (speedometer) {
    speedometer.style.opacity = '0';
    speedometer.style.transition = 'opacity 0.5s ease';
  }
  
  // Get race completion time
  const raceTimer = document.querySelector('div[style*="position: absolute"][style*="top: 20px"][style*="left: 50%"]');
  const finalTime = raceTimer ? raceTimer.innerText : "00:00";
  
  // Create the FINISH text container
  const finishUI = document.createElement('div');
  finishUI.style.position = 'absolute';
  finishUI.style.top = '50%';
  finishUI.style.left = '0';
  finishUI.style.right = '0';
  finishUI.style.transform = 'translateY(-50%)';
  finishUI.style.textAlign = 'center';
  finishUI.style.zIndex = '1000';
  
  // Create the animated FINISH text
  const finishText = document.createElement('div');
  finishText.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  finishText.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  finishText.style.borderRadius = '10px';
  finishText.textContent = 'FINISH';
  finishText.style.fontFamily = "'Exo 2', sans-serif";
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
  
  // Create time display
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
  
  // Trigger the animation
  setTimeout(() => {
    finishText.style.transform = 'translateX(0)';
    finishText.style.opacity = '1';
    timeContainer.style.opacity = '1';
  }, 100);
  
  // Enter spectator mode in multiplayer after showing finish message
  if (window.raceState.isMultiplayer && window.enterSpectatorMode) {
    setTimeout(() => {
      window.enterSpectatorMode();
    }, 3000);
  }
  
  // Keep the finish message visible longer
  setTimeout(() => {
    // Animate out
    timeContainer.style.transitionDelay = '0s';
    finishText.style.transform = 'translateX(100%)';
    finishText.style.opacity = '0';
    timeContainer.style.opacity = '0';
    
    // Remove after animation completes
    setTimeout(() => {
      document.body.removeChild(finishUI);
    }, 1000);
  }, 4000);
  
  return finishUI;
}

// Function to reset race gates
export function resetRace(gateData, ammo, carBody, vehicle, currentSteeringAngle, resetCarPosition) {
  const { gates, fadingGates } = gateData;
  
  // Reset gate states
  gates.forEach((gate, index) => {
    gate.userData.passed = false;
    gate.visible = (index === 0);
  });
  
  // Reset counters
  gateData.currentGateIndex = 0;
  
  // Start fade-in for first gate
  startGateFadeIn(0, gates, fadingGates);
  
  // Reset car position
  if (ammo && carBody) {
    return resetCarPosition(
      ammo, 
      carBody, 
      vehicle, 
      currentSteeringAngle, 
      gateData.currentGatePosition, 
      gateData.currentGateQuaternion
    );
  }
  
  return currentSteeringAngle;
}