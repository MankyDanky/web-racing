import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import "./style.css";
import Ammo from './lib/ammo.js';
import Peer from 'peerjs';
import { createVehicle, updateSteering, resetCarPosition, updateCarPosition } from './modules/car.js';
import { loadTrackModel, loadMapDecorations, checkGroundCollision } from './modules/track.js';
import { 
  loadGates, 
  startGateFadeIn, 
  updateGateFading, 
  checkGateProximity, 
  showFinishMessage, 
  resetRace 
} from './modules/gates.js';
import { 
  initMultiplayer, 
  updateMarkers, 
  sendCarData,
  updateOpponentCarPosition 
} from './modules/multiplayer.js';
import { initPhysics, updatePhysics, FIXED_PHYSICS_STEP } from './modules/physics.js';
import { createMinimap, extractTrackData, updateMinimapPlayers } from './modules/minimap.js';

// Check for game config from lobby
let gameConfig = null;
let isHost = false;
let playerConnections = [];
let allPlayers = [];

try {
  const savedConfig = sessionStorage.getItem('gameConfig');
  if (savedConfig) {
    gameConfig = JSON.parse(savedConfig);
    
    // Check if we're the host
    const myPlayerId = localStorage.getItem('myPlayerId');
    isHost = gameConfig.players.some(player => player.id === myPlayerId && player.isHost);
    
    console.log('Game config loaded:', gameConfig);
    console.log('Playing as host:', isHost);
    
    // Store player list
    allPlayers = gameConfig.players;
  }
} catch (e) {
  console.error('Error loading game config:', e);
}

// Global variables
let camera, scene, renderer, controls;
let physicsWorld, tmpTrans;
const rigidBodies = [];
let debugObjects = [];
const clock = new THREE.Clock();
let trackPieces = {}; // Dictionary to store loaded track models

// Car components
let carBody;
let vehicle; // Ammo.js vehicle instance
let wheelMeshes = [];
let carModel;

// Control state
const keyState = {
  w: false, s: false, a: false, d: false
};

// Camera parameters
const CAMERA_DISTANCE = 10;   // Distance behind the car
const CAMERA_HEIGHT = 5;      // Height above the car
const CAMERA_LERP = 0.1;      // Smoothing factor (0-1)
const CAMERA_LOOK_AHEAD = 2;  // How far ahead of the car to look

// Steering parameters
let currentSteeringAngle = 0;   // Current steering angle

// UI variables
let speedElement;
let needleElement;
let speedValueElement;
let currentSpeed = 0;
const MAX_SPEED_KPH = 200; // Maximum speed on the gauge

// Multiplayer variables
let multiplayerState;

let gateData = null;
let _tempVector1 = new THREE.Vector3();
let currentGatePosition = new THREE.Vector3(0, 2, 0);
let currentGateQuaternion = new THREE.Quaternion();

// Race state variables
let raceState = {
  isMultiplayer: false,
  allPlayersConnected: false,
  countdownStarted: false,
  raceStarted: false,
  raceFinished: false,  // Add this line
  countdownValue: 3
};

// Timer variables
let raceTimer;
let raceStartTime = 0;
let timerInterval;

// Make raceState globally accessible for multiplayer.js
window.raceState = raceState;

// UI Elements
let countdownOverlay;
let waitingForPlayersOverlay;

// Add this to your global variables
let leaderboard;
let playerPositions = [];

// Add these spectator variables to your global declarations
let spectatorMode = false;
let spectatedPlayerIndex = -1;
let spectatorUI;
let activeRacers = [];

// Add this variable to your global variables section
let minimapState;

// Add this to the global variables section:
let finishedPlayers = new Set();
let finalLeaderboardShown = false;

// Add this to the global variables section
let playerFinishTimes = {};
window.playerFinishTimes = playerFinishTimes;

// Add these global variables at the top with your other globals:
let loadingManager;
let assetsToLoad = 0;
let assetsLoaded = 0;

// Add these functions before init():

// Create the waiting and countdown UI elements
function createRaceUI() {
  // Create waiting for players overlay
  waitingForPlayersOverlay = document.createElement('div');
  waitingForPlayersOverlay.style.position = 'absolute';
  waitingForPlayersOverlay.style.top = '50%';
  waitingForPlayersOverlay.style.left = '50%';
  waitingForPlayersOverlay.style.transform = 'translate(-50%, -50%)';
  
  // Updated to match speedometer
  waitingForPlayersOverlay.style.background = 'rgba(0, 0, 0, 0.5)'; // Match speedometer opacity
  waitingForPlayersOverlay.style.color = '#fff'; // White text like speedometer
  waitingForPlayersOverlay.style.padding = '30px 40px';
  waitingForPlayersOverlay.style.borderRadius = '10px';
  waitingForPlayersOverlay.style.fontFamily = "'Poppins', sans-serif";
  waitingForPlayersOverlay.style.fontSize = '24px';
  waitingForPlayersOverlay.style.textAlign = 'center';
  waitingForPlayersOverlay.style.zIndex = '1000';
  
  // Add the box shadow and text glow like the speedometer
  waitingForPlayersOverlay.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  
  // Updated HTML with styled title
  waitingForPlayersOverlay.innerHTML = `
    <h2 style="margin-top: 0; color: #fff; text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);">Waiting for players...</h2>
    <div id="player-list" style="margin-top:20px; text-align:left;"></div>
  `;
  
  // Create countdown overlay with matching style
  countdownOverlay = document.createElement('div');
  countdownOverlay.style.position = 'absolute';
  countdownOverlay.style.top = '50%';
  countdownOverlay.style.left = '50%';
  countdownOverlay.style.transform = 'translate(-50%, -50%)';
  
  // Updated to match speedometer
  countdownOverlay.style.background = 'rgba(0, 0, 0, 0.5)';
  countdownOverlay.style.color = '#fff';
  countdownOverlay.style.padding = '40px 60px';
  countdownOverlay.style.borderRadius = '10px';
  countdownOverlay.style.fontFamily = "'Poppins', sans-serif";
  countdownOverlay.style.fontSize = '60px'; // Larger font for better visibility
  countdownOverlay.style.fontWeight = 'bold';
  countdownOverlay.style.textAlign = 'center';
  countdownOverlay.style.zIndex = '1000';
  
  // Add the box shadow and text glow like the speedometer
  countdownOverlay.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  countdownOverlay.style.textShadow = '0 0 15px rgba(255, 255, 255, 0.5)';
  
  countdownOverlay.innerHTML = `3`;
  
  // Hide both initially
  countdownOverlay.style.display = 'none';
  
  if (raceState.isMultiplayer) {
    document.body.appendChild(waitingForPlayersOverlay);
  }
  document.body.appendChild(countdownOverlay);
  
  // Make countdown overlay globally accessible for multiplayer.js
  window.countdownOverlay = countdownOverlay; // Add this line
}

// Create the timer UI
function createRaceTimer() {
  // Create timer element
  raceTimer = document.createElement('div');
  raceTimer.style.position = 'absolute';
  raceTimer.style.top = '20px';
  raceTimer.style.left = '50%';
  raceTimer.style.transform = 'translateX(-50%)';
  
  // Match the styling of other UI elements
  raceTimer.style.background = 'rgba(0, 0, 0, 0.5)';
  raceTimer.style.color = '#fff';
  raceTimer.style.padding = '10px 20px';
  raceTimer.style.borderRadius = '10px';
  raceTimer.style.fontFamily = "'Poppins', sans-serif";
  raceTimer.style.fontSize = '28px';
  raceTimer.style.fontWeight = 'bold';
  raceTimer.style.textAlign = 'center';
  raceTimer.style.zIndex = '1000';
  
  // Add the box shadow and text glow like the speedometer
  raceTimer.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  raceTimer.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
  
  raceTimer.innerText = '00:00';
  
  // Hide initially
  raceTimer.style.display = 'none';
  
  // Add to document
  document.body.appendChild(raceTimer);
}

// Modify the createLeaderboard function to always display the leaderboard
function createLeaderboard() {
  // Create leaderboard container
  leaderboard = document.createElement('div');
  leaderboard.style.position = 'absolute';
  leaderboard.style.top = '20px';
  leaderboard.style.left = '20px';
  
  // Match the styling of other UI elements
  leaderboard.style.background = 'rgba(0, 0, 0, 0.5)';
  leaderboard.style.color = '#fff';
  leaderboard.style.padding = '15px';
  leaderboard.style.borderRadius = '10px';
  leaderboard.style.fontFamily = "'Poppins', sans-serif";
  leaderboard.style.fontSize = '18px';
  leaderboard.style.fontWeight = 'bold';
  leaderboard.style.textAlign = 'left';
  leaderboard.style.zIndex = '1000';
  leaderboard.style.minWidth = '220px';
  
  // Add the box shadow and text glow like the speedometer
  leaderboard.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  leaderboard.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.3)';
  
  // Initial content
  leaderboard.innerHTML = `
    <div style="margin-bottom: 10px; text-align: center; font-size: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 5px;">
      LEADERBOARD
    </div>
    <div id="leaderboard-positions"></div>
  `;
  
  // Hide initially - will be shown when race starts for both single and multiplayer
  leaderboard.style.display = 'none';
  
  // Add to document
  document.body.appendChild(leaderboard);
}

// Update the updateLeaderboard function to preserve finish times
function updateLeaderboard() {
  if (!leaderboard) return;
  
  const leaderboardPositions = document.getElementById('leaderboard-positions');
  if (!leaderboardPositions) return;
  
  // Before clearing the array, save any finish times to our permanent store
  playerPositions.forEach(player => {
    if (player.finishTime) {
      playerFinishTimes[player.id] = player.finishTime;
    }
  });
  
  // Clear the player positions array
  playerPositions = [];
  
  // Get my player info
  const myPlayerId = localStorage.getItem('myPlayerId');
  const myPlayerInfo = allPlayers.find(p => p.id === myPlayerId);
  const myName = myPlayerInfo?.name || 'You';
  const myColor = myPlayerInfo?.playerColor || 'blue';
  
  // Get my gate progress
  const myGateIndex = gateData ? gateData.currentGateIndex : 0;
  let myDistanceToNextGate = 1000000;
  
  if (gateData && gateData.gates && gateData.gates.length > myGateIndex && carModel) {
    const nextGate = gateData.gates[myGateIndex];
    if (nextGate) {
      const gatePos = new THREE.Vector3();
      nextGate.getWorldPosition(gatePos);
      
      const dx = carModel.position.x - gatePos.x;
      const dy = carModel.position.y - gatePos.y;
      const dz = carModel.position.z - gatePos.z;
      myDistanceToNextGate = dx * dx + dy * dy + dz * dz;
    }
  }
  
  // Add myself to positions array
  playerPositions.push({
    id: myPlayerId,
    name: myName,
    color: myColor,
    gateIndex: myGateIndex,
    distanceToNextGate: myDistanceToNextGate
  });
  
  // Only add opponents in multiplayer mode
  if (raceState.isMultiplayer) {
    Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
      // Only add if updated recently
      if (Date.now() - opponent.lastUpdate < 5000) {
        // Extract and validate race progress data
        const gateIndex = (opponent.raceProgress && 
                           typeof opponent.raceProgress.currentGateIndex === 'number') ? 
                           opponent.raceProgress.currentGateIndex : 0;
        
        const distanceToNextGate = (opponent.raceProgress && 
                                    typeof opponent.raceProgress.distanceToNextGate === 'number') ?
                                    opponent.raceProgress.distanceToNextGate : 1000000;
        
        playerPositions.push({
          id: playerId,
          name: opponent.name || 'Player',
          color: opponent.color || 'red',
          gateIndex: gateIndex,
          distanceToNextGate: distanceToNextGate
        });
      }
    });
    
    // Sort players by progress in multiplayer mode
    playerPositions.sort((a, b) => {
      // First by gate index (higher is better)
      if (b.gateIndex !== a.gateIndex) {
        return b.gateIndex - a.gateIndex;
      }
      // Then by distance to next gate (lower is better)
      const distA = isFinite(a.distanceToNextGate) ? a.distanceToNextGate : 1000000;
      const distB = isFinite(b.distanceToNextGate) ? b.distanceToNextGate : 1000000;
      return distA - distB;
    });
  }
  
  // Restore saved finish times from our permanent store
  playerPositions.forEach(player => {
    if (playerFinishTimes[player.id]) {
      player.finishTime = playerFinishTimes[player.id];
    }
  });
  
  // Generate HTML for leaderboard - REMOVED GATE INFORMATION
  let leaderboardHTML = '';
  playerPositions.forEach((player, index) => {
    // In single player mode, always show as position 1
    const position = raceState.isMultiplayer ? (index + 1) : 1;
    const positionLabel = getPositionLabel(position);
    const isCurrentPlayer = player.id === myPlayerId;
    
    leaderboardHTML += `
      <div style="display: flex; align-items: center; margin-bottom: 8px; 
          ${isCurrentPlayer ? 'font-weight: bold; text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);' : ''}">
        <span style="color: ${getPositionColor(position)}; min-width: 30px;">${positionLabel}</span>
        <span style="${isCurrentPlayer ? 'text-decoration: underline;' : ''}; margin-left: 10px;">
          ${player.name}
        </span>
      </div>
    `;
  });
  
  leaderboardPositions.innerHTML = leaderboardHTML;
}

// Helper function to get position label
function getPositionLabel(position) {
  switch (position) {
    case 1: return '1st';
    case 2: return '2nd';
    case 3: return '3rd';
    default: return `${position}th`;
  }
}

// Helper function to get position color
function getPositionColor(position) {
  switch (position) {
    case 1: return 'gold';
    case 2: return 'silver';
    case 3: return '#cd7f32'; // bronze
    default: return 'white';
  }
}

// Make updateLeaderboard available globally for multiplayer.js
window.updateLeaderboard = updateLeaderboard;

// Function to start the timer
function startRaceTimer() {
  if (raceTimer) {
    raceTimer.style.display = 'block';
    raceStartTime = Date.now();
    
    // Clear any existing interval
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    
    // Update the timer immediately
    updateRaceTimer();
    
    // Set interval to update timer every 100ms
    timerInterval = setInterval(updateRaceTimer, 100);
  }
}

// Function to update the timer display
function updateRaceTimer() {
  if (!raceTimer) return;
  
  const elapsedMilliseconds = Date.now() - raceStartTime;
  const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  
  // Format with leading zeros
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');
  
  raceTimer.innerText = `${formattedMinutes}:${formattedSeconds}`;
}

// Function to reset the timer
function resetRaceTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  if (raceTimer) {
    raceTimer.innerText = '00:00';
    raceTimer.style.display = 'none';
  }
}

// Update the waiting for players UI
function updateWaitingUI() {
  if (!waitingForPlayersOverlay || !raceState.isMultiplayer) return;
  
  const playerListEl = waitingForPlayersOverlay.querySelector('#player-list');
  if (!playerListEl) return;
  
  let playerListHTML = '';
  allPlayers.forEach(player => {
    // Check if this player is connected 
    const isConnected = multiplayerState.playerConnections.some(conn => conn.peer === player.id) || 
                        player.id === localStorage.getItem('myPlayerId');
    
    // Updated dot colors to match the white theme
    const connectionStatus = isConnected ? 
      '<span style="color:#90ff90; text-shadow: 0 0 5px rgba(144, 255, 144, 0.7);">● Connected</span>' : 
      '<span style="color:#ff9090; text-shadow: 0 0 5px rgba(255, 144, 144, 0.7);">○ Waiting...</span>';
    
    playerListHTML += `<div style="margin-bottom: 8px;">${player.name} (${player.playerColor}) - ${connectionStatus}</div>`;
  });
  
  playerListEl.innerHTML = playerListHTML;
}

// Improve the startCountdown function with better logging and state handling
function startCountdown() {
  console.log('startCountdown called, display state:', countdownOverlay.style.display);
  
  if (countdownOverlay.style.display === 'block') {
    console.log('Countdown already in progress, ignoring call');
    return; // Already counting down
  }
  
  // Hide waiting overlay
  if (waitingForPlayersOverlay) {
    waitingForPlayersOverlay.style.display = 'none';
  }
  
  console.log('Starting countdown sequence...');
  
  // Show countdown overlay
  countdownOverlay.style.display = 'block';
  raceState.countdownStarted = true;
  
  // Run countdown sequence
  raceState.countdownValue = 3;
  countdownOverlay.innerHTML = raceState.countdownValue.toString();
  
  const countdownInterval = setInterval(() => {
    raceState.countdownValue--;
    console.log(`Countdown: ${raceState.countdownValue}`);
    
    if (raceState.countdownValue > 0) {
      countdownOverlay.innerHTML = raceState.countdownValue.toString();
    } else if (raceState.countdownValue === 0) {
      countdownOverlay.innerHTML = 'GO!';
    } else {
      // Countdown complete
      clearInterval(countdownInterval);
      countdownOverlay.style.display = 'none';
      
      // Set race started and log it
      raceState.raceStarted = true;
      console.log('Race started!', raceState);

      // Show leaderboard when race starts for BOTH single player and multiplayer
      leaderboard.style.display = 'block';
      
      // Start the race timer
      startRaceTimer();
      
      // Broadcast race start to other players if host
      if (isHost) {
        console.log('Broadcasting race start as host');
        multiplayerState.broadcastRaceStart();
      }
    }
  }, 1000);
}

// Make startCountdown globally accessible for the multiplayer module
window.startCountdown = startCountdown;

// Create spectator UI elements
function createSpectatorUI() {
  spectatorUI = document.createElement('div');
  spectatorUI.style.position = 'absolute';
  spectatorUI.style.bottom = '20px';
  spectatorUI.style.left = '50%';
  spectatorUI.style.transform = 'translateX(-50%)';
  spectatorUI.style.background = 'rgba(0, 0, 0, 0.5)';
  spectatorUI.style.color = '#fff';
  spectatorUI.style.padding = '10px 20px';
  spectatorUI.style.borderRadius = '10px';
  spectatorUI.style.fontFamily = "'Poppins', sans-serif";
  spectatorUI.style.fontSize = '18px';
  spectatorUI.style.fontWeight = 'bold';
  spectatorUI.style.textAlign = 'center';
  spectatorUI.style.zIndex = '1000';
  spectatorUI.style.display = 'none';
  spectatorUI.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  spectatorUI.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
  
  // Create container for player name and navigation arrows
  spectatorUI.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center;">
      <div id="prev-player" style="cursor: pointer; margin-right: 15px; font-size: 24px;">◀</div>
      <div id="spectated-player-name">Spectating: Player</div>
      <div id="next-player" style="cursor: pointer; margin-left: 15px; font-size: 24px;">▶</div>
    </div>
  `;
  
  document.body.appendChild(spectatorUI);
  
  // Add event listeners to the navigation arrows
  document.getElementById('prev-player').addEventListener('click', () => {
    switchSpectatedPlayer(-1);
  });
  
  document.getElementById('next-player').addEventListener('click', () => {
    switchSpectatedPlayer(1);
  });
  
  // Also allow keyboard navigation with left/right arrows
  document.addEventListener('keydown', (event) => {
    if (!spectatorMode) return;
    
    if (event.key === 'ArrowLeft') {
      switchSpectatedPlayer(-1);
    } else if (event.key === 'ArrowRight') {
      switchSpectatedPlayer(1);
    }
  });
}

// Function to enter spectator mode
function enterSpectatorMode() {
  if (!raceState.isMultiplayer) return;
  
  console.log("Entering spectator mode");
  spectatorMode = true;
  
  // Get all active racers (players who haven't finished yet)
  updateActiveRacers();
  
  // If there are active racers, start spectating the first one
  if (activeRacers.length > 0) {
    spectatedPlayerIndex = 0;
    updateSpectatorUI();
    spectatorUI.style.display = 'block';
  } else {
    console.log("No active racers to spectate");
  }
}

// Update the list of active racers
function updateActiveRacers() {
  activeRacers = [];
  
  // Add all opponents who have updated recently and haven't finished
  Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
    // Only include players who have updated in the last 5 seconds and aren't finished
    if (Date.now() - opponent.lastUpdate < 5000 && !opponent.raceFinished) {
      activeRacers.push({
        id: playerId,
        name: opponent.name || 'Player',
        model: opponent.model
      });
    }
  });
  
  console.log(`Found ${activeRacers.length} active racers`);
}

// Switch to next/previous spectated player
function switchSpectatedPlayer(direction) {
  if (activeRacers.length === 0) return;
  
  // Update active racers list first
  updateActiveRacers();
  
  // If no more active racers, exit spectator mode
  if (activeRacers.length === 0) {
    exitSpectatorMode();
    return;
  }
  
  // Update spectated player index
  spectatedPlayerIndex = (spectatedPlayerIndex + direction + activeRacers.length) % activeRacers.length;
  updateSpectatorUI();
}

// Update spectator UI with current player name
function updateSpectatorUI() {
  if (!spectatorMode || activeRacers.length === 0) return;
  
  const spectatedPlayer = activeRacers[spectatedPlayerIndex];
  document.getElementById('spectated-player-name').textContent = `Spectating: ${spectatedPlayer.name}`;
}

// Exit spectator mode
function exitSpectatorMode() {
  spectatorMode = false;
  spectatedPlayerIndex = -1;
  spectatorUI.style.display = 'none';
}

// Update the spectator camera position
function updateSpectatorCamera() {
  if (!spectatorMode || activeRacers.length === 0) return;
  
  const targetCar = activeRacers[spectatedPlayerIndex].model;
  if (!targetCar) return;
  
  // Get car's position
  const carPos = targetCar.position.clone();
  
  // Get car's forward direction
  const carDirection = new THREE.Vector3(0, 0, 1);
  carDirection.applyQuaternion(targetCar.quaternion);
  
  // Calculate camera position - behind and above the car
  const cameraOffset = carDirection.clone().multiplyScalar(-CAMERA_DISTANCE);
  const targetPosition = carPos.clone()
    .add(cameraOffset)
    .add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
  
  // Smoothly interpolate camera position
  camera.position.lerp(targetPosition, CAMERA_LERP);
  
  // Look at a point slightly ahead of the car
  const lookAtPos = carPos.clone().add(
    carDirection.clone().multiplyScalar(CAMERA_LOOK_AHEAD)
  );
  camera.lookAt(lookAtPos);
}

// Add this function to main.js
function showFinalLeaderboard() {
  // Hide all existing UI elements
  if (speedometer) speedometer.style.display = 'none';
  if (raceTimer) raceTimer.style.display = 'none';
  if (leaderboard) leaderboard.style.display = 'none';
  if (spectatorUI) spectatorUI.style.display = 'none';
  if (minimapState && minimapState.canvas) minimapState.canvas.style.display = 'none';
  
  // Create final leaderboard container
  const finalLeaderboard = document.createElement('div');
  finalLeaderboard.style.position = 'absolute';
  finalLeaderboard.style.top = '50%';
  finalLeaderboard.style.left = '50%';
  finalLeaderboard.style.transform = 'translate(-50%, -50%)';
  finalLeaderboard.style.background = 'rgba(0, 0, 0, 0.5)';
  finalLeaderboard.style.backdropFilter = 'blur(10px)';
  finalLeaderboard.style.color = '#fff';
  finalLeaderboard.style.padding = '40px';
  finalLeaderboard.style.borderRadius = '15px';
  finalLeaderboard.style.fontFamily = "'Poppins', sans-serif";
  finalLeaderboard.style.fontSize = '20px';
  finalLeaderboard.style.textAlign = 'center';
  finalLeaderboard.style.zIndex = '2000';
  finalLeaderboard.style.minWidth = '400px';
  finalLeaderboard.style.boxShadow = '0 0 30px rgba(0, 0, 0, 0.7)';
  finalLeaderboard.style.opacity = '0';
  finalLeaderboard.style.transform = 'translate(-150%, -50%)'; // Start off-screen to the left
  finalLeaderboard.style.transition = 'transform 1s cubic-bezier(0.12, 0.93, 0.27, 0.98), opacity 1s ease';
  
  // Create title
  const title = document.createElement('h2');
  title.textContent = 'RACE RESULTS';
  title.style.fontSize = '36px';
  title.style.fontWeight = '900';
  title.style.marginBottom = '30px';
  title.style.color = '#ffffff';
  title.style.textShadow = '0 0 15px rgba(255, 255, 255, 0.5)';
  title.style.letterSpacing = '3px';
  
  // Helper function to convert MM:SS time string to seconds
  function timeToSeconds(timeString) {
    const [minutes, seconds] = timeString.split(':').map(Number);
    return minutes * 60 + seconds;
  }
  
  // Find finished players (who have finish times)
  const finishedPlayers = playerPositions.filter(player => {
    const finishTime = playerFinishTimes[player.id] || player.finishTime;
    return finishTime && finishTime !== "00:00" && finishTime !== "DNF";
  });
  
  // Sort players by their finish time (lowest first)
  const sortedPlayers = finishedPlayers.sort((a, b) => {
    const timeA = playerFinishTimes[a.id] || a.finishTime || "99:99";
    const timeB = playerFinishTimes[b.id] || b.finishTime || "99:99";
    
    // Convert time strings to seconds for comparison
    return timeToSeconds(timeA) - timeToSeconds(timeB);
  });
  
  // Take only top 3 players
  const topPlayers = sortedPlayers.slice(0, 3);
  
  // Create leaderboard table
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.marginBottom = '30px';
  
  // Add header row
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">POSITION</th>
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">PLAYER</th>
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">TIME</th>
  `;
  table.appendChild(headerRow);
  
  // Add player rows for top 3 only
  topPlayers.forEach((player, index) => {
    const row = document.createElement('tr');
    
    // Determine position indicator and style
    const position = index + 1;
    const positionLabel = getPositionLabel(position);
    const positionColor = getPositionColor(position);
    
    // Get finish time
    const finishTime = playerFinishTimes[player.id] || player.finishTime || "00:00";
    
    row.innerHTML = `
      <td style="padding: 12px; text-align: center; color: ${positionColor}; font-weight: bold;">${positionLabel}</td>
      <td style="padding: 12px; text-align: left;">
        <div style="display: flex; align-items: center;">
          <div style="width: 15px; height: 15px; background-color: ${getPlayerColorHex(player.color)}; margin-right: 10px; border-radius: 50%;"></div>
          ${player.name}
        </div>
      </td>
      <td style="padding: 12px; text-align: right; font-weight: bold; color: #ffffff;">${finishTime}</td>
    `;
    
    table.appendChild(row);
  });
  
  // Show a message if no players finished yet
  if (topPlayers.length === 0) {
    const noResultsRow = document.createElement('tr');
    noResultsRow.innerHTML = `
      <td colspan="3" style="padding: 30px; text-align: center; color: #aaaaaa;">
        No players have finished the race yet.
      </td>
    `;
    table.appendChild(noResultsRow);
  }
  
  // Create home button
  const homeButton = document.createElement('button');
  homeButton.textContent = 'HOME';
  homeButton.style.fontFamily = "'Poppins', sans-serif";
  homeButton.style.fontWeight = '900';
  homeButton.style.fontSize = '1.1rem';
  homeButton.style.padding = '10px 30px';
  homeButton.style.backgroundColor = '#ff0080';
  homeButton.style.border = '2px solid #b30059';
  homeButton.style.color = 'white';
  homeButton.style.borderRadius = '5px';
  homeButton.style.cursor = 'pointer';
  homeButton.style.boxShadow = '0 4px 0 #b30059';
  homeButton.style.transition = 'all 0.2s ease';
  homeButton.style.marginTop = '10px';
  
  // Add hover and active effects using event listeners
  homeButton.addEventListener('mouseover', () => {
    homeButton.style.backgroundColor = '#f5007c';
    homeButton.style.transform = 'translateY(2px)';
    homeButton.style.boxShadow = '0 2px 0 #b30059';
  });
  
  homeButton.addEventListener('mouseout', () => {
    homeButton.style.backgroundColor = '#ff0080';
    homeButton.style.transform = 'translateY(0)';
    homeButton.style.boxShadow = '0 4px 0 #b30059';
  });
  
  homeButton.addEventListener('mousedown', () => {
    homeButton.style.transform = 'translateY(4px)';
    homeButton.style.boxShadow = '0 0 0 #b30059';
  });
  
  homeButton.addEventListener('mouseup', () => {
    homeButton.style.transform = 'translateY(2px)';
    homeButton.style.boxShadow = '0 2px 0 #b30059';
  });
  
  // Add click handler to return to lobby
  homeButton.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  
  // Assemble final leaderboard
  finalLeaderboard.appendChild(title);
  finalLeaderboard.appendChild(table);
  finalLeaderboard.appendChild(homeButton);
  document.body.appendChild(finalLeaderboard);
  
  // Trigger the animation after a short delay
  setTimeout(() => {
    finalLeaderboard.style.opacity = '1';
    finalLeaderboard.style.transform = 'translate(-50%, -50%)';
  }, 100);
  
  return finalLeaderboard;
}

// Helper function to convert player color name to hex color
function getPlayerColorHex(colorName) {
  const colorMap = {
    red: '#ff7070',
    orange: '#ffb766',
    yellow: '#ffffa7',
    green: '#429849',
    blue: '#447bc9',
    indigo: '#cc57d0',
    violet: '#7c37b1'
  };
  return colorMap[colorName] || '#ff7070';
}

// Make this function available globally
window.showFinalLeaderboard = showFinalLeaderboard;

// Add this function to your code, before or after setupEnhancedLighting()
function setupCartoonySkybox(scene) {
  // Create shader materials for gradient skybox
  const skyGeo = new THREE.SphereGeometry(1000, 32, 32); // Large sphere to contain the scene
  
  // Shader material for gradient
  const uniforms = {
    topColor: { value: new THREE.Color(0x88ccff) },  // Light blue at top
    bottomColor: { value: new THREE.Color(0xbbe2ff) }, // White/light color at horizon
    offset: { value: 0 },
    exponent: { value: 0.6 }
  };
  
  const skyMat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }
    `,
    side: THREE.BackSide // Render the inside of the sphere
  });
  
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
}

// Initialize everything
function init() {
  // Set up loading manager to track all asset loading
  loadingManager = new THREE.LoadingManager();
  
  loadingManager.onLoad = function() {
    console.log('All assets loaded');
    hideLoadingScreen();
  };
  
  loadingManager.onProgress = function(url, itemsLoaded, itemsTotal) {
    console.log(`Loaded ${itemsLoaded} of ${itemsTotal} assets`);
  };
  
  loadingManager.onError = function(url) {
    console.error('Error loading asset:', url);
  };
  
  // Make loadingManager globally available to other modules
  window.loadingManager = loadingManager;

  console.log("Main module loaded");
  const loadingEl = document.createElement('div');
  loadingEl.style.position = 'absolute';
  loadingEl.style.left = '0';
  loadingEl.style.backgroundColor = '#000';
  loadingEl.style.color = '#fff';
  loadingEl.style.display = 'flex';
  loadingEl.style.alignItems = 'center';
  loadingEl.style.justifyContent = 'center';
  loadingEl.style.zIndex = '999';
  loadingEl.style.fontSize = '24px';
  loadingEl.textContent = 'Loading Physics Engine...';
  document.body.appendChild(loadingEl);

  // Setup scene
  scene = new THREE.Scene();
  setupCartoonySkybox(scene); // Add this line instead of setting scene.background
  setupEnhancedLighting();
  
  // Setup camera
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 10, 20);
  
  // Setup renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputEncoding = THREE.sRGBEncoding;  // or THREE.LinearSRGBEncoding in newer Three.js
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  
  // Initialize UI
  initUI();
  
  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  
  console.log("About to initialize Ammo.js");
  // Initialize Ammo.js and setup physics
  Ammo().then(ammo => {
    console.log("Ammo.js initialized");
    window.Ammo = ammo;
    
    document.body.removeChild(loadingEl);
    
    const physicsState = initPhysics(ammo);
    physicsWorld = physicsState.physicsWorld;
    tmpTrans = physicsState.tmpTrans;
    
    // Load the track as a single model
    const mapToLoad = gameConfig?.trackId || 'map1'; // Default to map1 if no config
    loadTrackModel(ammo, mapToLoad, scene, physicsWorld, loadingManager, (trackModel) => {
      console.log(`Track model loaded (${mapToLoad}), extracting for minimap`);
      // Extract track data for minimap when track is loaded
      extractTrackData(trackModel);
    });
    
    // Load map decorations
    loadMapDecorations(mapToLoad, scene, renderer, camera, loadingManager);
    
    // Load gates
    gateData = loadGates(mapToLoad, scene, loadingManager, (loadedGateData) => {
      // Store the reference when gates are fully loaded
      gateData = loadedGateData;
      // Make gate data globally available for multiplayer
      window.gateData = gateData;
      console.log(`Gates loaded for ${mapToLoad}. Total gates: ${gateData.totalGates}`);
    });
    
    console.log("About to create vehicle physics");

    // First create just the physics body, don't set global variables yet
    const carComponents = createVehicle(ammo, scene, physicsWorld, debugObjects, (loadedComponents) => {
      // This callback runs when the car model is FULLY loaded
      console.log("Car fully loaded callback - setting global variables now");
      
      // Now set all the global variables
      carBody = loadedComponents.carBody;
      vehicle = loadedComponents.vehicle;
      wheelMeshes = loadedComponents.wheelMeshes;
      carModel = loadedComponents.carModel;
      currentSteeringAngle = loadedComponents.currentSteeringAngle;
      
      console.log("Car model loaded and global variables set:", carModel);
      
      // Update car reference in multiplayer state
      multiplayerState.carModel = carModel;
      
      // For single player, start the countdown immediately
      if (!raceState.isMultiplayer) {
        console.log("Single player mode - starting countdown");
        setTimeout(() => startCountdown(), 500);
      }
      
      // Now that the car is fully loaded, we can start the animation loop
      animate();
    });
    
    // Set physics body immediately for physics to work
    carBody = carComponents.carBody;
    vehicle = carComponents.vehicle;
    
    // Don't set carModel or wheelMeshes yet
    // Don't start animation loop yet
    
    // Set up controls early so they work when the car loads
    setupKeyControls();
    
    // Initialize peer connection for multiplayer
    multiplayerState = initMultiplayer({
      scene: scene,
      camera: camera,
      carModel: null // Will be set later when loaded
    });
    
    // Animation will start in the callback when the car is fully loaded
  });

  // Check if this is a multiplayer game
  raceState.isMultiplayer = gameConfig && gameConfig.players && gameConfig.players.length > 1;

  // Later, after you've created the UI:
  createRaceUI();
  createRaceTimer();
  createLeaderboard();
  createSpectatorUI(); // Add this line
  
  // Create minimap
  const mapToLoad = gameConfig?.trackId || 'map1'; // Use the same map ID
  minimapState = createMinimap(mapToLoad);

  // Make spectator functions globally available
  window.enterSpectatorMode = enterSpectatorMode;
  window.exitSpectatorMode = exitSpectatorMode;
}

// Add this function to hide the loading screen
function hideLoadingScreen() {
  // Wait a small amount of time to ensure UI is ready
  setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      
      // Remove from DOM after fade out
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 500);
    }
  }, 500);
}

// Setup key controls for vehicle
function setupKeyControls() {
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = true;
    if (event.key.toLowerCase() === 's') keyState.s = true;
    if (event.key.toLowerCase() === 'a') keyState.a = true;
    if (event.key.toLowerCase() === 'd') keyState.d = true;

    // Replace the keydown R handler with this improved version:
    if (event.key.toLowerCase() === 'r') {
      if (window.Ammo && carBody && gateData) {
        // Use the gateData values instead of the global variables
        currentSteeringAngle = resetCarPosition(
          window.Ammo, 
          carBody, 
          vehicle, 
          currentSteeringAngle, 
          gateData.currentGatePosition, 
          gateData.currentGateQuaternion
        );
      }
    }

    // Add spectator mode toggle
    if (event.key.toLowerCase() === 'p') {
      if (spectatorMode) {
        exitSpectatorMode();
      } else {
        enterSpectatorMode();
      }
    }
  });
  
  document.addEventListener('keyup', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = false;
    if (event.key.toLowerCase() === 's') keyState.s = false;
    if (event.key.toLowerCase() === 'a') keyState.a = false;
    if (event.key.toLowerCase() === 'd') keyState.d = false;
  });
}

// Add this new camera update function
function updateCamera() {
  if (!carModel) return;
  
  // Get car's position
  const carPos = carModel.position.clone();
  
  // Get car's forward direction
  const carDirection = new THREE.Vector3();
  carModel.getWorldDirection(carDirection);
  
  // Calculate camera position - behind and above the car
  const cameraOffset = carDirection.clone().multiplyScalar(-CAMERA_DISTANCE);
  const targetPosition = carPos.clone()
    .add(cameraOffset)
    .add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
  
  // Smoothly interpolate camera position
  camera.position.lerp(targetPosition, CAMERA_LERP);
  
  // Look at a point slightly ahead of the car
  const lookAtPos = carPos.clone().add(
    carDirection.clone().multiplyScalar(CAMERA_LOOK_AHEAD)
  );
  camera.lookAt(lookAtPos);
}

// Replace your physics update in animate() with this
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;
  
  if (physicsWorld) {
    // Run physics at fixed intervals
    while (accumulator >= FIXED_PHYSICS_STEP) {
      const carState = {
        carBody, 
        vehicle, 
        carModel, 
        wheelMeshes,
        keyState,
        currentSteeringAngle,
        updateSteering
      };

      const physicsResult = updatePhysics(
        FIXED_PHYSICS_STEP, 
        window.Ammo, 
        { physicsWorld, tmpTrans }, 
        carState, 
        debugObjects,
        raceState // Pass the race state
      );

      // Update speed
      const speedKPH = physicsResult.currentSpeed;
      updateSpeedometer(speedKPH);
      currentSteeringAngle = physicsResult.currentSteeringAngle;
      // Update car position
      updateCarPosition(window.Ammo, vehicle, carModel, wheelMeshes);

      // Add this line to check if car has fallen off the track
      checkGroundCollision(window.Ammo, carBody, () => {
        // This will reset the car to the last gate position when it falls off
        currentSteeringAngle = resetCarPosition(
          window.Ammo, 
          carBody, 
          vehicle, 
          currentSteeringAngle, 
          gateData.currentGatePosition, 
          gateData.currentGateQuaternion
        );
      });
      
      accumulator -= FIXED_PHYSICS_STEP;
      if (spectatorMode) {
        updateSpectatorCamera();
      } else {
        updateCamera();
      }
      if (gateData) {
        // Check if player passed through a gate
        const raceFinished = checkGateProximity(carModel, gateData);
        
        // IMPORTANT: Update our local copies of the gate position for resets
        currentGatePosition.copy(gateData.currentGatePosition);
        currentGateQuaternion.copy(gateData.currentGateQuaternion);
        
        // Make sure global reference is updated
        window.gateData = gateData;
        
        // Show finish message if race is complete
        if (raceFinished) {
          // Only show finish message if we haven't already shown it
          if (!raceState.raceFinished) {
            showFinishMessage(gateData.totalGates, null); // Remove the reset callback
            
            // Stop the race timer
            if (timerInterval) {
              clearInterval(timerInterval);
            }
            
            // In multiplayer mode, broadcast that you've finished
            if (raceState.isMultiplayer && isHost) {
              // Use existing broadcast mechanism or add a new one for race finish
              multiplayerState.broadcastRaceStart(); // Reuse existing function
            }
          }
        }
        
        // Update gate fade effects
        updateGateFading(gateData.fadingGates);
      }
    }
    
    updateMarkers();

    // Update leaderboard for both single and multiplayer when race has started
    if (raceState.raceStarted) {
      updateLeaderboard();
      
      // Update minimap player positions
      if (carModel) {
        updateMinimapPlayers(carModel, multiplayerState?.opponentCars);
      }
    }

    // Send car data as before - only in multiplayer
    if (raceState.isMultiplayer) {
      sendCarData({carModel});
    }

    // Check if all players are connected in multiplayer
    if (raceState.isMultiplayer && !raceState.allPlayersConnected) {
      // Update waiting UI
      updateWaitingUI();
      
      // Check if all players are connected
      if (multiplayerState.checkAllPlayersConnected()) {
        raceState.allPlayersConnected = true;
        
        // Host triggers synchronized countdown
        if (isHost) {
          console.log("All players connected! Broadcasting countdown start...");
          // First broadcast countdown signal to all clients
          multiplayerState.broadcastCountdownStart();
          // Then start countdown locally (after a tiny delay to ensure network messages go out first)
          setTimeout(startCountdown, 50);
        }
      }
    }
    
    // Update leaderboard
    updateLeaderboard();

    // Check if all players have finished the race
    if (raceState.isMultiplayer && raceState.raceStarted && !finalLeaderboardShown) {
      const allFinished = checkAllPlayersFinished();
      
      if (allFinished) {
        finalLeaderboardShown = true;
        // Wait a moment to show the final leaderboard (after individual finish messages fade)
        setTimeout(showFinalLeaderboard, 5000);
      }
    }
  }
  
  renderer.render(scene, camera);
}

// Enhanced lighting system - add this function
function setupEnhancedLighting() {
  // Remove existing lights
  scene.children.forEach(child => {
    if (child.isLight) scene.remove(child);
  });
  
  // Reduce ambient light intensity for better shadow definition
  const ambientLight = new THREE.AmbientLight(0xcccccc, 2);
  scene.add(ambientLight);
  
  // Primary directional light (sun)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 3.5);
  directionalLight.position.set(40, 250, 30);
  
  
  scene.add(directionalLight);
}

// Function to initialize UI elements
function initUI() {
  speedElement = document.querySelector('.gauge-fill');
  needleElement = document.querySelector('.gauge-needle');
  speedValueElement = document.querySelector('.speed-value');
  
  if (!speedElement || !needleElement || !speedValueElement) {
    console.error('Speedometer elements not found');
  }
}

// Function to update the speedometer with perfect alignment
function updateSpeedometer(speed) {
  // Smooth the speed change
  currentSpeed = Math.max(speed - 1, 0);
  
  // Get speed as percentage of max speed
  const speedPercent = Math.min(currentSpeed / 2 / MAX_SPEED_KPH, 1);
  
  // Calculate rotation - 180 degrees is full scale
  const fillRotation = speedPercent * 180;
  
  // Update the gauge fill rotation
  speedElement.style.transform = `rotate(${fillRotation}deg)`;
  
  // Update the needle rotation to perfectly align with the gauge fill
  // Use the same exact rotation as the fill since we want them to align perfectly
  needleElement.style.transform = `rotate(${fillRotation - 90}deg)`;
  
  // Update the numeric display, rounded to integer
  speedValueElement.textContent = Math.round(currentSpeed);
}

// Add this new function to check if all players have finished
function checkAllPlayersFinished() {
  // If no multiplayer or no players, return false
  if (!raceState.isMultiplayer || !multiplayerState || !allPlayers || allPlayers.length === 0) {
    return false;
  }
  
  // Count active players (excluding disconnected ones)
  let activePlayers = 0;
  let finishedCount = 0;
  
  // Count myself if I've finished
  if (raceState.raceFinished) {
    finishedCount++;
  }
  activePlayers++; // Always count myself as active
  
  // Check opponents
  Object.values(multiplayerState.opponentCars).forEach(opponent => {
    // Only count opponents that are active (have been updated recently)
    const isActive = opponent.lastUpdate && (Date.now() - opponent.lastUpdate < 10000);
    
    if (isActive) {
      activePlayers++;
      
      // Check if this opponent has finished
      if (opponent.raceProgress && opponent.raceProgress.currentGateIndex >= gateData.totalGates) {
        finishedCount++;
      }
    }
  });
  console.log(`Active players: ${activePlayers}, Finished count: ${finishedCount}`); 
  // All players have finished when finished count equals active players
  return finishedCount === activePlayers && activePlayers > 0;
}

// Start initialization
init();