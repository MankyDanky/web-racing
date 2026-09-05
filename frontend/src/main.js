import * as THREE from 'three';
import "./style.css";
import Ammo from './lib/ammo.js';
import {
  createVehicle, updateSteering, resetCarPosition,
  recordCarPhysicsState, renderCarInterpolated,
} from './modules/car.js';
import { loadTrackModel, loadMapDecorations, checkGroundCollision } from './modules/track.js';
import {
  loadGates, updateGateFading, checkGateProximity, showFinishMessage, resetGateTracking,
} from './modules/gates.js';
import {
  initMultiplayer, updateMarkers, sendCarData,
  updateOpponentInterpolation, setRaceStartAt,
} from './modules/multiplayer.js';
import { initPhysics, updatePhysics, applyVehicleControls, FIXED_PHYSICS_STEP } from './modules/physics.js';
import { createMinimap, extractTrackData, updateMinimapPlayers } from './modules/minimap.js';
// Shared, single-source sanitizers (#30)
import { sanitizePlayerName, sanitizePlayerColor } from './modules/sanitize.js';
import { sanitizePreciseTime, parseTime, formatTime } from './modules/timing.js';
import { log, warn, error } from './modules/debug.js';
import { loadGameConfig } from './modules/gameConfig.js';
import { getSettings, loadSettings, createSettingsMenu, onSettingsChange, colorHex } from './modules/settings.js';
import * as Audio from './modules/audio.js';
import { getTrack, getAssetMap, isReverse, loadManifest } from './modules/tracks.js';
import { updateChaseCamera, updateSpectatorCamera, updateBroadcastCamera } from './modules/camera.js';
import {
  GhostRecorder, GhostPlayer, loadGhost, AIBot,
  loadRacingLine, pickBotNames, botColor,
} from './modules/ai.js';
import { createStore } from './modules/store.js';

// Load persisted settings early (#49)
loadSettings();

// Shared store / event bus (#29): a single object passed into modules instead
// of coordinating through a pile of window.* globals. We keep thin window.*
// shims for the few DOM callbacks the finish overlay still triggers.
const store = createStore();

// ---- Versioned, validated game config (#35) ------------------------------
let gameConfig = loadGameConfig();
let isHost = false;
let allPlayers = [];

if (gameConfig) {
  const myPlayerId = localStorage.getItem('myPlayerId');
  isHost = gameConfig.players.some((player) => player.id === myPlayerId && player.isHost);
  allPlayers = gameConfig.players.map((player) => ({
    ...player,
    name: sanitizePlayerName(player.name),
    playerColor: sanitizePlayerColor(player.playerColor),
  }));
  log('Game config loaded. Host:', isHost);
} else {
  warn('No valid game config - a fresh single-player fallback will be used');
}

// Global variables
let camera, scene, renderer;
let physicsWorld, tmpTrans;
let debugObjects = [];
const clock = new THREE.Clock();

// Car components
let carBody;
let vehicle;
let wheelMeshes = [];
let carModel;
let carRenderState = null;

// Car flip detection
let carFlippedTime = 0;
let carIsFlipped = false;
let prevUpDot = 1.0;
let upDotDelta = 0;

// Control state
const keyState = { w: false, s: false, a: false, d: false, space: false, sensitivity: 1.0 };

// Camera look-ahead constants (chase camera lives in camera.js now)
let currentSteeringAngle = 0;

// UI variables
let speedElement, needleElement, speedValueElement;
let currentSpeed = 0;
const MAX_SPEED_KPH = 200;

// Multiplayer variables
let multiplayerState;

let gateData = null;
let currentGatePosition = new THREE.Vector3(0, 2, 0);
let currentGateQuaternion = new THREE.Quaternion();

// Track / trackId
let trackId = 'map1';

// Race state variables
let raceState = {
  isMultiplayer: false,
  allPlayersConnected: false,
  countdownStarted: false,
  raceStarted: false,
  raceFinished: false,
  countdownValue: 3,
};

// Timer variables (ms precision now #44)
let raceTimer;
let raceStartTime = 0;
let timerInterval;

window.raceState = raceState;

// UI Elements
let countdownOverlay;
let waitingForPlayersOverlay;
let leaderboard;
let playerPositions = [];

// Spectator
let spectatorMode = false;
let freeCam = false;
let spectatedPlayerIndex = -1;
let spectatorUI;
let activeRacers = [];

// Post-race options + cinematic broadcast ("live stream") (#5)
let postRaceOptions = null;
let broadcastMode = false;
let broadcastTarget = null;
let broadcastHUD = null;
let broadcastStartT = 0;

let minimapState;
let finalLeaderboardShown = false;

let playerFinishTimes = {};
window.playerFinishTimes = playerFinishTimes;

let loadingManager;

// Adaptive resolution (#24) + FPS counter (#49)
let currentPixelRatio = 1;
let fpsCounterEl = null;
let frameTimes = [];
let lastFpsUpdate = 0;

// Audio state (#41)
let audioStarted = false;
let engineRunning = false;

// Ghost / AI (#42)
let ghostRecorder = null;
let ghostPlayer = null;
let aiBots = [];
let racingLine = null;
let aiPlayerLastPos = null; // tracks the human's position to derive their speed for AI awareness

// ---- UI creation ---------------------------------------------------------

function createRaceUI() {
  waitingForPlayersOverlay = document.createElement('div');
  Object.assign(waitingForPlayersOverlay.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    background: 'rgba(0, 0, 0, 0.5)', color: '#fff', padding: '30px 40px',
    borderRadius: '10px', fontFamily: "'Poppins', sans-serif", fontSize: '24px',
    textAlign: 'center', zIndex: '1000', boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)',
  });
  waitingForPlayersOverlay.innerHTML = `
    <h2 style="margin-top: 0; color: #fff; text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);">Waiting for players...</h2>
    <div id="player-list" style="margin-top:20px; text-align:left;"></div>
  `;

  countdownOverlay = document.createElement('div');
  Object.assign(countdownOverlay.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    background: 'rgba(0, 0, 0, 0.5)', color: '#fff', padding: '40px 60px',
    borderRadius: '10px', fontFamily: "'Poppins', sans-serif", fontSize: '60px',
    fontWeight: 'bold', textAlign: 'center', zIndex: '1000',
    boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)', textShadow: '0 0 15px rgba(255, 255, 255, 0.5)',
  });
  countdownOverlay.innerHTML = `3`;
  countdownOverlay.style.display = 'none';

  if (raceState.isMultiplayer) document.body.appendChild(waitingForPlayersOverlay);
  document.body.appendChild(countdownOverlay);
  window.countdownOverlay = countdownOverlay;
}

function createRaceTimer() {
  raceTimer = document.createElement('div');
  raceTimer.id = "race-timer";
  raceTimer.style.position = 'absolute';
  raceTimer.style.top = '20px';
  raceTimer.style.left = '50%';

  const timerContent = document.createElement('div');
  Object.assign(timerContent.style, {
    position: 'relative', left: '-50%', background: 'rgba(0, 0, 0, 0.5)', color: '#fff',
    padding: '10px 20px', borderRadius: '10px', fontFamily: "'Poppins', sans-serif",
    fontSize: '28px', fontWeight: 'bold', textAlign: 'center',
    boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)', textShadow: '0 0 10px rgba(255, 255, 255, 0.5)',
    minWidth: '120px',
  });
  timerContent.innerText = '0:00.000';
  raceTimer.appendChild(timerContent);
  raceTimer.style.display = 'none';
  raceTimer.style.zIndex = '1000';
  document.body.appendChild(raceTimer);
  raceTimer.contentElement = timerContent;
}

function createLeaderboard() {
  leaderboard = document.createElement('div');
  leaderboard.id = "leaderboard";
  Object.assign(leaderboard.style, {
    position: 'absolute', top: '20px', left: '20px', background: 'rgba(0, 0, 0, 0.5)',
    color: '#fff', padding: '15px', borderRadius: '10px', fontFamily: "'Poppins', sans-serif",
    fontSize: '18px', fontWeight: 'bold', textAlign: 'left', zIndex: '1000',
    minWidth: '220px', boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)',
    textShadow: '0 0 10px rgba(255, 255, 255, 0.3)',
  });
  leaderboard.innerHTML = `
    <div style="margin-bottom: 10px; text-align: center; font-size: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 5px;">
      LEADERBOARD
    </div>
    <div id="leaderboard-positions"></div>
  `;
  leaderboard.style.display = 'none';
  document.body.appendChild(leaderboard);
}

function updateLeaderboard() {
  if (!leaderboard) return;
  const leaderboardPositions = document.getElementById('leaderboard-positions');
  if (!leaderboardPositions) return;

  playerPositions.forEach((player) => {
    if (player.finishTime) playerFinishTimes[player.id] = player.finishTime;
  });
  playerPositions = [];

  const myPlayerId = localStorage.getItem('myPlayerId');
  const myPlayerInfo = allPlayers.find((p) => p.id === myPlayerId);
  const myName = myPlayerInfo?.name || 'You';
  const myColor = myPlayerInfo?.playerColor || 'blue';

  const myGateIndex = gateData ? gateData.currentGateIndex : 0;
  let myDistanceToNextGate = 1e6;
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

  playerPositions.push({
    id: myPlayerId, name: myName, color: myColor,
    gateIndex: myGateIndex, distanceToNextGate: myDistanceToNextGate,
  });

  if (raceState.isMultiplayer) {
    Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
      if (Date.now() - opponent.lastUpdate < 8000 || opponent.dnf) {
        const gateIndex = (opponent.raceProgress && typeof opponent.raceProgress.currentGateIndex === 'number')
          ? opponent.raceProgress.currentGateIndex : 0;
        const distanceToNextGate = (opponent.raceProgress && typeof opponent.raceProgress.distanceToNextGate === 'number')
          ? opponent.raceProgress.distanceToNextGate : 1e6;
        playerPositions.push({
          id: playerId, name: sanitizePlayerName(opponent.name),
          color: sanitizePlayerColor(opponent.color),
          gateIndex, distanceToNextGate, dnf: opponent.dnf,
        });
      }
    });
    playerPositions.sort((a, b) => {
      if (a.dnf && !b.dnf) return 1;
      if (b.dnf && !a.dnf) return -1;
      if (b.gateIndex !== a.gateIndex) return b.gateIndex - a.gateIndex;
      const distA = isFinite(a.distanceToNextGate) ? a.distanceToNextGate : 1e6;
      const distB = isFinite(b.distanceToNextGate) ? b.distanceToNextGate : 1e6;
      return distA - distB;
    });
  }

  // Include AI opponents in single player (#42). Use their fine-grained progress
  // along the racing line so the ordering is smooth, and record finish times.
  if (!raceState.isMultiplayer && aiBots.length) {
    // The human's progress as a lap fraction, so we can rank against the bots.
    let myProgress = 0;
    if (gateData && gateData.totalGates) {
      myProgress = myGateIndex / gateData.totalGates;
    }
    // Give the human a small intra-gate bonus from distance-to-next-gate.
    playerPositions[0].progress = myProgress;

    aiBots.forEach((bot, i) => {
      if (bot.finished && bot.finishMs != null && !playerFinishTimes['bot-' + bot.name]) {
        playerFinishTimes['bot-' + bot.name] = formatTime(bot.finishMs);
      }
      playerPositions.push({
        id: 'bot-' + bot.name, name: bot.name, color: botColor(i),
        gateIndex: bot.gateIndex, distanceToNextGate: 0,
        progress: Math.max(0, Math.min(1, bot.progress)),
      });
    });
    playerPositions.sort((a, b) => (b.progress || 0) - (a.progress || 0));
  }

  playerPositions.forEach((player) => {
    if (playerFinishTimes[player.id]) player.finishTime = playerFinishTimes[player.id];
  });

  leaderboardPositions.replaceChildren();
  playerPositions.forEach((player, index) => {
    const showMulti = raceState.isMultiplayer || aiBots.length;
    const position = showMulti ? (index + 1) : 1;
    const positionLabel = getPositionLabel(position);
    const isCurrentPlayer = player.id === myPlayerId;

    const entry = document.createElement('div');
    entry.style.display = 'flex';
    entry.style.alignItems = 'center';
    entry.style.marginBottom = '8px';
    if (isCurrentPlayer) {
      entry.style.fontWeight = 'bold';
      entry.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.8)';
    }

    const positionSpan = document.createElement('span');
    positionSpan.textContent = positionLabel;
    positionSpan.style.color = getPositionColor(position);
    positionSpan.style.minWidth = '30px';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = sanitizePlayerName(player.name) + (player.dnf ? ' (DNF)' : '');
    nameSpan.style.marginLeft = '10px';
    if (isCurrentPlayer) nameSpan.style.textDecoration = 'underline';

    entry.appendChild(positionSpan);
    entry.appendChild(nameSpan);
    leaderboardPositions.appendChild(entry);
  });
}

function getPositionLabel(position) {
  switch (position) {
    case 1: return '1st';
    case 2: return '2nd';
    case 3: return '3rd';
    default: return `${position}th`;
  }
}
function getPositionColor(position) {
  switch (position) {
    case 1: return 'gold';
    case 2: return 'silver';
    case 3: return '#cd7f32';
    default: return 'white';
  }
}

window.updateLeaderboard = updateLeaderboard;

function startRaceTimer() {
  if (raceTimer) {
    raceTimer.style.display = 'block';
    // Absolute start time from the synced countdown (#4)
    raceStartTime = raceState._raceStartAt || Date.now();
    setRaceStartAt(raceStartTime);
    if (timerInterval) clearInterval(timerInterval);
    updateRaceTimer();
    // 50 ms display refresh so milliseconds tick visibly (#44)
    timerInterval = setInterval(updateRaceTimer, 47);
  }
}

function updateRaceTimer() {
  if (!raceTimer || !raceTimer.contentElement) return;
  const elapsed = Date.now() - raceStartTime;
  raceTimer.contentElement.innerText = formatTime(Math.max(0, elapsed));
}

function updateWaitingUI() {
  if (!waitingForPlayersOverlay || !raceState.isMultiplayer) return;
  const playerListEl = waitingForPlayersOverlay.querySelector('#player-list');
  if (!playerListEl) return;
  playerListEl.replaceChildren();
  allPlayers.forEach((player) => {
    const isConnected = multiplayerState.playerConnections.some((conn) => conn.peer === player.id) ||
      player.id === localStorage.getItem('myPlayerId');
    const row = document.createElement('div');
    row.style.marginBottom = '8px';
    const label = document.createElement('span');
    label.textContent = `${sanitizePlayerName(player.name)} (${sanitizePlayerColor(player.playerColor)}) - `;
    const connectionStatus = document.createElement('span');
    if (isConnected) {
      connectionStatus.textContent = '● Connected';
      connectionStatus.style.color = '#90ff90';
      connectionStatus.style.textShadow = '0 0 5px rgba(144, 255, 144, 0.7)';
    } else {
      connectionStatus.textContent = '○ Waiting...';
      connectionStatus.style.color = '#ff9090';
      connectionStatus.style.textShadow = '0 0 5px rgba(255, 144, 144, 0.7)';
    }
    row.appendChild(label);
    row.appendChild(connectionStatus);
    playerListEl.appendChild(row);
  });
}

// ---- Countdown (absolute-timestamp synced #4) ----------------------------

function runCountdownTo(startAt) {
  if (countdownOverlay.style.display === 'block') return;
  if (waitingForPlayersOverlay) waitingForPlayersOverlay.style.display = 'none';

  countdownOverlay.style.display = 'block';
  raceState.countdownStarted = true;
  raceState._raceStartAt = startAt;

  Audio.resumeAudio();

  const tick = () => {
    const remaining = startAt - Date.now();
    if (remaining > 2000) {
      setOverlay('3', 3);
    } else if (remaining > 1000) {
      setOverlay('2', 2);
    } else if (remaining > 0) {
      setOverlay('1', 1);
    } else if (remaining > -800) {
      setOverlay('GO!', 0);
    } else {
      clearInterval(cdInterval);
      countdownOverlay.style.display = 'none';
      startRace();
      return;
    }
  };

  let lastShown = -1;
  const beepIfNew = (val) => {
    if (val !== lastShown) {
      lastShown = val;
      if (val > 0) Audio.playBeep(false);
      else if (val === 0) Audio.playBeep(true);
    }
  };
  const setOverlay = (text, val) => {
    countdownOverlay.innerHTML = text;
    beepIfNew(val);
  };

  tick();
  const cdInterval = setInterval(tick, 60);
}

function startRace() {
  raceState.raceStarted = true;
  log('Race started');
  leaderboard.style.display = 'block';
  startRaceTimer();

  // Kick off engine audio (#41)
  if (!engineRunning) { Audio.startEngine(); engineRunning = true; }
  if (getSettings().musicEnabled) Audio.startMusic();

  // Ghost + AI bots start (#42)
  if (!raceState.isMultiplayer) {
    if (ghostRecorder) ghostRecorder.start();
    if (ghostPlayer) ghostPlayer.start();
    aiBots.forEach((b) => b.start());
  }

  if (isHost) multiplayerState.broadcastRaceStart();
}

// Host path: pick an absolute start ~3.8s in the future and broadcast it (#4)
function startCountdown() {
  const startAt = Date.now() + 3800;
  if (isHost && raceState.isMultiplayer) {
    multiplayerState.broadcastCountdownStart(startAt);
  }
  runCountdownTo(startAt);
}
// Guest path: start counting down to the host's absolute instant (#4)
function startCountdownAt(startAt) {
  runCountdownTo(startAt);
}
window.startCountdown = startCountdown;
window.startCountdownAt = startCountdownAt;

// ---- Spectator UI (with free-cam #47) ------------------------------------

function createSpectatorUI() {
  spectatorUI = document.createElement('div');
  spectatorUI.id = 'spectator-ui';
  Object.assign(spectatorUI.style, {
    position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.5)', color: '#fff', padding: '10px 20px', borderRadius: '10px',
    fontFamily: "'Poppins', sans-serif", fontSize: '18px', fontWeight: 'bold',
    textAlign: 'center', zIndex: '1000', display: 'none',
    boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)', textShadow: '0 0 10px rgba(255, 255, 255, 0.5)',
  });
  spectatorUI.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center;">
      <div id="prev-player" style="cursor: pointer; margin-right: 15px; font-size: 24px;">◀</div>
      <div id="spectated-player-name">Spectating: Player</div>
      <div id="next-player" style="cursor: pointer; margin-left: 15px; font-size: 24px;">▶</div>
    </div>
    <div style="font-size:12px;opacity:0.8;margin-top:4px;">F: free-cam · ←/→: switch</div>
  `;
  document.body.appendChild(spectatorUI);

  document.getElementById('prev-player').addEventListener('click', () => switchSpectatedPlayer(-1));
  document.getElementById('next-player').addEventListener('click', () => switchSpectatedPlayer(1));

  document.addEventListener('keydown', (event) => {
    if (!spectatorMode) return;
    if (event.key === 'ArrowLeft') switchSpectatedPlayer(-1);
    else if (event.key === 'ArrowRight') switchSpectatedPlayer(1);
    else if (event.key.toLowerCase() === 'f') freeCam = !freeCam; // free-cam toggle (#47)
  });
}

function enterSpectatorMode() {
  if (!raceState.isMultiplayer) return;
  spectatorMode = true;
  updateActiveRacers();
  if (activeRacers.length > 0) {
    spectatedPlayerIndex = 0;
    updateSpectatorUI();
    spectatorUI.style.display = 'block';
  }
}

function updateActiveRacers() {
  activeRacers = [];
  Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
    if (Date.now() - opponent.lastUpdate < 5000 && !opponent.raceFinished && !opponent.dnf) {
      activeRacers.push({ id: playerId, name: opponent.name || 'Player', model: opponent.model });
    }
  });
}

function switchSpectatedPlayer(direction) {
  if (activeRacers.length === 0) return;
  updateActiveRacers();
  if (activeRacers.length === 0) { exitSpectatorMode(); return; }
  spectatedPlayerIndex = (spectatedPlayerIndex + direction + activeRacers.length) % activeRacers.length;
  updateSpectatorUI();
}

function updateSpectatorUI() {
  if (!spectatorMode || activeRacers.length === 0) return;
  const spectatedPlayer = activeRacers[spectatedPlayerIndex];
  document.getElementById('spectated-player-name').textContent =
    freeCam ? 'Free camera' : `Spectating: ${spectatedPlayer.name}`;
}

function exitSpectatorMode() {
  spectatorMode = false;
  spectatedPlayerIndex = -1;
  spectatorUI.style.display = 'none';
}

// Free-cam: orbit slowly around the track center.
let freeCamAngle = 0;
function updateFreeCam() {
  freeCamAngle += 0.0015;
  const r = 220;
  camera.position.lerp(new THREE.Vector3(Math.cos(freeCamAngle) * r, 120, Math.sin(freeCamAngle) * r), 0.02);
  camera.lookAt(0, 0, 0);
}

// ---- Post-race options + cinematic broadcast/"live stream" (#5) -----------

// Collect every racer currently on track (player + bots in solo, player +
// opponents in multiplayer) as a uniform list we can spectate. Each entry is
// { id, name, color, model }.
function collectRacers() {
  const racers = [];
  const myPlayerId = localStorage.getItem('myPlayerId');
  const myInfo = allPlayers.find((p) => p.id === myPlayerId);
  if (carModel) {
    racers.push({
      id: myPlayerId, name: (myInfo?.name || 'You'),
      color: (myInfo?.playerColor || 'blue'), model: carModel, isSelf: true,
    });
  }
  if (raceState.isMultiplayer) {
    Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
      if (opponent.model && (Date.now() - opponent.lastUpdate < 10000 || opponent.dnf)) {
        racers.push({
          id: playerId, name: sanitizePlayerName(opponent.name || 'Player'),
          color: sanitizePlayerColor(opponent.color), model: opponent.model,
        });
      }
    });
  } else {
    aiBots.forEach((b, i) => {
      if (b.carModel) {
        racers.push({ id: 'bot-' + b.name, name: b.name, color: botColor(i), model: b.carModel, bot: b });
      }
    });
  }
  return racers;
}

// The panel shown after the local player finishes: Home + Spectate (#5). It
// deliberately does NOT block the final leaderboard, which still appears
// automatically once everyone is done.
function showPostRaceOptions() {
  if (postRaceOptions || finalLeaderboardShown) return;
  postRaceOptions = document.createElement('div');
  postRaceOptions.id = 'post-race-options';
  Object.assign(postRaceOptions.style, {
    position: 'absolute', bottom: '30px', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: '14px', zIndex: '1500',
    fontFamily: "'Poppins', sans-serif",
  });

  const mkBtn = (text, bg, shadow) => {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      fontFamily: "'Poppins', sans-serif", fontWeight: '900', fontSize: '1rem',
      padding: '12px 26px', backgroundColor: bg, border: `2px solid ${shadow}`,
      color: 'white', borderRadius: '8px', cursor: 'pointer',
      boxShadow: `0 4px 0 ${shadow}`, transition: 'all 0.15s ease',
    });
    b.addEventListener('mousedown', () => { b.style.transform = 'translateY(3px)'; b.style.boxShadow = `0 1px 0 ${shadow}`; });
    b.addEventListener('mouseup', () => { b.style.transform = ''; b.style.boxShadow = `0 4px 0 ${shadow}`; });
    return b;
  };

  const spectateBtn = mkBtn('👁  SPECTATE', '#7b2ff7', '#4a1c94');
  spectateBtn.addEventListener('click', () => openSpectatePicker());

  const homeBtn = mkBtn('🏠  HOME', '#ff0080', '#b30059');
  homeBtn.addEventListener('click', () => { window.location.href = 'index.html'; });

  postRaceOptions.appendChild(spectateBtn);
  postRaceOptions.appendChild(homeBtn);
  document.body.appendChild(postRaceOptions);
}

function hidePostRaceOptions() {
  if (postRaceOptions && postRaceOptions.parentNode) postRaceOptions.parentNode.removeChild(postRaceOptions);
  postRaceOptions = null;
}

// Modal: "Which racer do you want to watch?" (#5)
function openSpectatePicker() {
  const racers = collectRacers().filter((r) => !r.isSelf || raceState.isMultiplayer || true);
  if (racers.length === 0) return;

  const overlay = document.createElement('div');
  overlay.id = 'spectate-picker';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '3000',
    fontFamily: "'Poppins', sans-serif", opacity: '0', transition: 'opacity 0.3s ease',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'rgba(18,18,26,0.96)', borderRadius: '16px', padding: '28px 32px',
    minWidth: '320px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto',
    boxShadow: '0 0 40px rgba(123,47,247,0.45)', border: '1px solid rgba(123,47,247,0.5)',
  });

  const heading = document.createElement('h2');
  heading.textContent = 'Choose a racer to watch';
  Object.assign(heading.style, {
    color: '#fff', fontSize: '22px', fontWeight: '900', margin: '0 0 18px',
    textAlign: 'center', letterSpacing: '1px',
  });
  card.appendChild(heading);

  racers.forEach((r) => {
    const row = document.createElement('button');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
      padding: '12px 16px', marginBottom: '10px', cursor: 'pointer',
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '10px', color: '#fff', fontFamily: "'Poppins', sans-serif",
      fontSize: '16px', fontWeight: '700', transition: 'background 0.15s ease',
    });
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(123,47,247,0.3)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'rgba(255,255,255,0.06)'; });

    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '16px', height: '16px', borderRadius: '50%',
      backgroundColor: colorHex(r.color), flex: '0 0 auto',
      boxShadow: `0 0 8px ${colorHex(r.color)}`,
    });
    const label = document.createElement('span');
    label.textContent = r.name + (r.isSelf ? ' (you)' : '');
    row.appendChild(dot);
    row.appendChild(label);
    row.addEventListener('click', () => {
      overlay.style.opacity = '0';
      setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 250);
      startBroadcast(r);
    });
    card.appendChild(row);
  });

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  Object.assign(cancel.style, {
    display: 'block', margin: '8px auto 0', padding: '8px 22px', cursor: 'pointer',
    background: 'transparent', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '8px',
    color: '#bbb', fontFamily: "'Poppins', sans-serif", fontSize: '14px',
  });
  cancel.addEventListener('click', () => {
    overlay.style.opacity = '0';
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 250);
  });
  card.appendChild(cancel);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

// Cinematic "we're going live" transition, then the broadcast camera + HUD (#5).
function startBroadcast(racer) {
  hidePostRaceOptions();
  broadcastTarget = racer;

  // Full-screen cinematic wipe with an "ON AIR" flourish.
  const trans = document.createElement('div');
  Object.assign(trans.style, {
    position: 'fixed', inset: '0', zIndex: '3500', background: '#000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: '0', transition: 'opacity 0.4s ease', fontFamily: "'Poppins', sans-serif",
  });
  const inner = document.createElement('div');
  inner.style.textAlign = 'center';
  inner.style.transform = 'scale(0.8)';
  inner.style.transition = 'transform 0.6s cubic-bezier(0.12,0.93,0.27,0.98)';
  inner.innerHTML = `
    <div style="font-size:64px;font-weight:900;color:#ff2d2d;letter-spacing:6px;
      text-shadow:0 0 30px rgba(255,45,45,0.8);">● ON AIR</div>
    <div style="font-size:22px;color:#fff;margin-top:10px;letter-spacing:2px;opacity:0.9;">
      LIVE: ${sanitizePlayerName(racer.name)}</div>`;
  trans.appendChild(inner);
  document.body.appendChild(trans);
  requestAnimationFrame(() => { trans.style.opacity = '1'; inner.style.transform = 'scale(1)'; });

  // Hide gameplay HUD elements while broadcasting.
  const speedometer = document.getElementById('speedometer');
  if (speedometer) speedometer.style.display = 'none';
  if (raceTimer) raceTimer.style.display = 'none';
  if (leaderboard) leaderboard.style.display = 'none';

  setTimeout(() => {
    // Switch to the broadcast camera now (behind the black screen).
    broadcastMode = true;
    broadcastStartT = performance.now() / 1000;
    createBroadcastHUD(racer);
    // Fade the black screen away to reveal the live shot.
    trans.style.opacity = '0';
    setTimeout(() => { if (trans.parentNode) trans.parentNode.removeChild(trans); }, 450);
  }, 1500);
}

function createBroadcastHUD(racer) {
  if (broadcastHUD && broadcastHUD.parentNode) broadcastHUD.parentNode.removeChild(broadcastHUD);
  broadcastHUD = document.createElement('div');
  broadcastHUD.id = 'broadcast-hud';
  Object.assign(broadcastHUD.style, {
    position: 'fixed', inset: '0', zIndex: '1600', pointerEvents: 'none',
    fontFamily: "'Poppins', sans-serif",
  });
  broadcastHUD.innerHTML = `
    <div style="position:absolute;top:18px;left:18px;display:flex;align-items:center;gap:10px;
      background:rgba(0,0,0,0.45);padding:8px 14px;border-radius:8px;">
      <span id="live-dot" style="width:12px;height:12px;border-radius:50%;background:#ff2d2d;
        box-shadow:0 0 10px #ff2d2d;display:inline-block;"></span>
      <span style="color:#fff;font-weight:900;letter-spacing:3px;font-size:16px;">LIVE</span>
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:24px 28px;
      background:linear-gradient(to top,rgba(0,0,0,0.75),transparent);">
      <div style="display:flex;align-items:center;gap:14px;">
        <span id="bc-dot" style="width:22px;height:22px;border-radius:50%;
          background:${colorHex(racer.color)};box-shadow:0 0 12px ${colorHex(racer.color)};"></span>
        <div>
          <div id="bc-name" style="color:#fff;font-size:26px;font-weight:900;letter-spacing:1px;
            text-shadow:0 2px 8px rgba(0,0,0,0.8);">${sanitizePlayerName(racer.name)}</div>
          <div id="bc-sub" style="color:#ffd54a;font-size:15px;font-weight:700;margin-top:2px;">
            Position — · —</div>
        </div>
      </div>
    </div>
    <div style="position:absolute;top:18px;right:18px;display:flex;gap:10px;pointer-events:auto;">
      <button id="bc-switch" style="font-family:'Poppins',sans-serif;font-weight:700;font-size:14px;
        padding:8px 16px;background:rgba(123,47,247,0.85);border:1px solid #4a1c94;color:#fff;
        border-radius:8px;cursor:pointer;">↻ Switch racer</button>
      <button id="bc-exit" style="font-family:'Poppins',sans-serif;font-weight:700;font-size:14px;
        padding:8px 16px;background:rgba(255,0,128,0.85);border:1px solid #b30059;color:#fff;
        border-radius:8px;cursor:pointer;">✕ Leave</button>
    </div>`;
  document.body.appendChild(broadcastHUD);

  // Blink the LIVE dot.
  broadcastHUD._blink = setInterval(() => {
    const d = document.getElementById('live-dot');
    if (d) d.style.opacity = d.style.opacity === '0.2' ? '1' : '0.2';
  }, 600);

  document.getElementById('bc-switch').addEventListener('click', () => { stopBroadcast(); openSpectatePicker(); });
  document.getElementById('bc-exit').addEventListener('click', () => {
    stopBroadcast();
    if (!finalLeaderboardShown) showPostRaceOptions();
  });
}

function updateBroadcastHUD() {
  if (!broadcastMode || !broadcastTarget) return;
  const sub = document.getElementById('bc-sub');
  if (!sub) return;
  // Find the target's live position from the current ranking snapshot.
  const idx = playerPositions.findIndex((p) => p.id === broadcastTarget.id);
  const pos = idx >= 0 ? getPositionLabel(idx + 1) : '—';
  const total = playerPositions.length || collectRacers().length;
  const finishTime = playerFinishTimes[broadcastTarget.id];
  sub.textContent = finishTime
    ? `Finished · ${sanitizePreciseTime(finishTime) || finishTime}`
    : `Position ${pos} of ${total}`;
}

function stopBroadcast() {
  broadcastMode = false;
  broadcastTarget = null;
  if (broadcastHUD) {
    if (broadcastHUD._blink) clearInterval(broadcastHUD._blink);
    if (broadcastHUD.parentNode) broadcastHUD.parentNode.removeChild(broadcastHUD);
  }
  broadcastHUD = null;
}
window.startBroadcast = startBroadcast;

// ---- Final leaderboard (ms precision #44) --------------------------------

function showFinalLeaderboard() {
  const speedometer = document.getElementById('speedometer');
  if (speedometer) speedometer.style.display = 'none';
  if (raceTimer) raceTimer.style.display = 'none';
  if (leaderboard) leaderboard.style.display = 'none';
  if (spectatorUI) spectatorUI.style.display = 'none';
  if (minimapState && minimapState.canvas) minimapState.canvas.style.display = 'none';

  Audio.stopMusic();
  Audio.playFanfare();

  const finalLeaderboard = document.createElement('div');
  finalLeaderboard.id = 'final-leaderboard';
  Object.assign(finalLeaderboard.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-150%, -50%)',
    background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(10px)', color: '#fff',
    padding: '40px', borderRadius: '15px', fontFamily: "'Poppins', sans-serif",
    fontSize: '20px', textAlign: 'center', zIndex: '2000', minWidth: '400px',
    boxShadow: '0 0 30px rgba(0, 0, 0, 0.7)', opacity: '0',
    transition: 'transform 1s cubic-bezier(0.12, 0.93, 0.27, 0.98), opacity 1s ease',
  });

  const title = document.createElement('h2');
  title.textContent = 'RACE RESULTS';
  Object.assign(title.style, {
    fontSize: '36px', fontWeight: '900', marginBottom: '30px', color: '#ffffff',
    textShadow: '0 0 15px rgba(255, 255, 255, 0.5)', letterSpacing: '3px',
  });

  // Build the FULL final standings (#6): every racer, ranked. Finishers are
  // ordered by finish time; anyone who didn't finish is appended after the
  // finishers, ordered by how far they got, and marked DNF/—.
  const standings = buildFinalStandings();

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.marginBottom = '30px';

  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">POS</th>
    <th style="padding: 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.3);">PLAYER</th>
    <th style="padding: 10px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.3);">TIME</th>
  `;
  table.appendChild(headerRow);

  const myPlayerId = localStorage.getItem('myPlayerId');
  standings.forEach((player, index) => {
    const row = document.createElement('tr');
    const position = index + 1;
    const positionLabel = getPositionLabel(position);
    const positionColor = getPositionColor(position);
    const isMe = player.id === myPlayerId;
    if (isMe) row.style.background = 'rgba(255,255,255,0.08)';

    const positionCell = document.createElement('td');
    positionCell.textContent = positionLabel;
    Object.assign(positionCell.style, { padding: '10px 12px', textAlign: 'center', color: positionColor, fontWeight: 'bold' });

    const nameCell = document.createElement('td');
    Object.assign(nameCell.style, { padding: '10px 12px', textAlign: 'left' });
    const nameWrapper = document.createElement('div');
    nameWrapper.style.display = 'flex';
    nameWrapper.style.alignItems = 'center';
    const colorDot = document.createElement('div');
    Object.assign(colorDot.style, {
      width: '15px', height: '15px', backgroundColor: colorHex(player.color),
      marginRight: '10px', borderRadius: '50%', flex: '0 0 auto',
    });
    const nameText = document.createElement('span');
    nameText.textContent = sanitizePlayerName(player.name) + (isMe ? ' (you)' : '');
    if (isMe) nameText.style.fontWeight = '900';
    nameWrapper.appendChild(colorDot);
    nameWrapper.appendChild(nameText);
    nameCell.appendChild(nameWrapper);

    const timeCell = document.createElement('td');
    timeCell.textContent = player.finished ? player.timeText : (player.dnf ? 'DNF' : '—');
    Object.assign(timeCell.style, {
      padding: '10px 12px', textAlign: 'right', fontWeight: 'bold',
      color: player.finished ? '#ffffff' : '#ff8a8a',
    });

    row.appendChild(positionCell);
    row.appendChild(nameCell);
    row.appendChild(timeCell);
    table.appendChild(row);
  });

  if (standings.length === 0) {
    const noResultsRow = document.createElement('tr');
    noResultsRow.innerHTML = `
      <td colspan="3" style="padding: 30px; text-align: center; color: #aaaaaa;">
        No players have finished the race yet.
      </td>`;
    table.appendChild(noResultsRow);
  }

  // Button row: Spectate (re-watch the action) + Home (#5).
  const buttonRow = document.createElement('div');
  Object.assign(buttonRow.style, { display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '10px' });

  const mkBtn = (text, bg, shadow) => {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      fontFamily: "'Poppins', sans-serif", fontWeight: '900', fontSize: '1.1rem',
      padding: '10px 28px', backgroundColor: bg, border: `2px solid ${shadow}`,
      color: 'white', borderRadius: '6px', cursor: 'pointer', boxShadow: `0 4px 0 ${shadow}`,
      transition: 'all 0.15s ease',
    });
    return b;
  };

  const spectateButton = mkBtn('👁 SPECTATE', '#7b2ff7', '#4a1c94');
  spectateButton.addEventListener('click', () => {
    finalLeaderboard.style.opacity = '0';
    finalLeaderboard.style.transform = 'translate(-50%, -70%)';
    setTimeout(() => { if (finalLeaderboard.parentNode) finalLeaderboard.parentNode.removeChild(finalLeaderboard); }, 400);
    openSpectatePicker();
  });

  const homeButton = mkBtn('🏠 HOME', '#ff0080', '#b30059');
  homeButton.addEventListener('click', () => { window.location.href = 'index.html'; });

  buttonRow.appendChild(spectateButton);
  buttonRow.appendChild(homeButton);

  finalLeaderboard.appendChild(title);
  finalLeaderboard.appendChild(table);
  finalLeaderboard.appendChild(buttonRow);
  document.body.appendChild(finalLeaderboard);

  // Clean up any lingering post-race options / broadcast HUD.
  hidePostRaceOptions();
  stopBroadcast();

  setTimeout(() => {
    finalLeaderboard.style.opacity = '1';
    finalLeaderboard.style.transform = 'translate(-50%, -50%)';
  }, 100);
  return finalLeaderboard;
}

// Assemble the complete, ordered final standings from every racer we know about
// (player + bots in solo; player + opponents in MP). Finishers first (by time),
// then non-finishers by progress. Every entry has { id, name, color, finished,
// dnf, timeText, timeMs, progress } (#4, #6).
function buildFinalStandings() {
  const myPlayerId = localStorage.getItem('myPlayerId');
  const entries = [];

  const pushEntry = (id, name, color, rawTime, progress, dnf) => {
    const timeText = rawTime ? (sanitizePreciseTime(rawTime) || rawTime) : null;
    const timeMs = rawTime && rawTime !== 'DNF' ? (parseTime(rawTime) ?? null) : null;
    const finished = !!timeMs && rawTime !== 'DNF';
    entries.push({
      id, name, color,
      finished, dnf: !!dnf || rawTime === 'DNF',
      timeText: finished ? timeText : null,
      timeMs: finished ? timeMs : Infinity,
      progress: progress || 0,
    });
  };

  // The local player.
  const myInfo = allPlayers.find((p) => p.id === myPlayerId);
  const myName = myInfo?.name || 'You';
  const myColor = myInfo?.playerColor || 'blue';
  const myTime = playerFinishTimes[myPlayerId] || null;
  const myProgress = gateData && gateData.totalGates ? (gateData.currentGateIndex || 0) / gateData.totalGates : 0;
  pushEntry(myPlayerId, myName, myColor, myTime, raceState.raceFinished ? 1 : myProgress, false);

  if (raceState.isMultiplayer) {
    Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
      const rawTime = playerFinishTimes[playerId] || (opponent.raceFinished ? null : null);
      const prog = opponent.raceProgress && gateData && gateData.totalGates
        ? (opponent.raceProgress.currentGateIndex || 0) / gateData.totalGates : 0;
      pushEntry(playerId, sanitizePlayerName(opponent.name || 'Player'),
        sanitizePlayerColor(opponent.color), rawTime, prog, opponent.dnf);
    });
  } else {
    aiBots.forEach((b, i) => {
      const rawTime = playerFinishTimes['bot-' + b.name] || (b.finished && b.finishMs != null ? formatTime(b.finishMs) : null);
      pushEntry('bot-' + b.name, b.name, botColor(i), rawTime, Math.max(0, Math.min(1, b.progress || 0)), false);
    });
  }

  // Finishers (by time) first, then DNF/unfinished by progress (desc).
  entries.sort((a, b) => {
    if (a.finished && b.finished) return a.timeMs - b.timeMs;
    if (a.finished) return -1;
    if (b.finished) return 1;
    if (a.dnf && !b.dnf) return 1;
    if (b.dnf && !a.dnf) return -1;
    return (b.progress || 0) - (a.progress || 0);
  });
  return entries;
}
window.showFinalLeaderboard = showFinalLeaderboard;

// Called (via window hook) once the local player crosses the finish line and the
// FINISH banner animation completes. If everyone is already done we go straight
// to the final leaderboard; otherwise we offer Home / Spectate while the rest of
// the field is still racing (#5). The final leaderboard still appears
// automatically once the last car finishes.
function onLocalPlayerFinished() {
  if (checkAllPlayersFinished()) {
    // The render loop's own check will fire the final leaderboard shortly.
    return;
  }
  showPostRaceOptions();
}
window.onLocalPlayerFinished = onLocalPlayerFinished;

function setupCartoonySkybox(scene) {
  const skyGeo = new THREE.SphereGeometry(1000, 32, 32);
  const uniforms = {
    topColor: { value: new THREE.Color(0x88ccff) },
    bottomColor: { value: new THREE.Color(0xbbe2ff) },
    offset: { value: 0 }, exponent: { value: 0.6 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
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
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// Detect low-power/mobile devices for a reduced lighting/shadow preset (#25)
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768;
}

// ---- init ----------------------------------------------------------------

function init() {
  handleOrientationChange();
  setupRotateButton();
  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('resize', handleOrientationChange);

  loadingManager = new THREE.LoadingManager();
  loadingManager.onLoad = () => { log('All assets loaded'); hideLoadingScreen(); };
  loadingManager.onError = (url) => error('Error loading asset:', url);
  window.loadingManager = loadingManager;

  // Resolve track (supports reverse variants #43)
  trackId = gameConfig?.trackId || 'map1';
  loadManifest();

  const loadingEl = document.createElement('div');
  Object.assign(loadingEl.style, {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    backgroundColor: '#000', color: '#fff', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: '999', fontSize: '24px',
  });
  loadingEl.textContent = 'Loading Physics Engine...';
  document.body.appendChild(loadingEl);

  scene = new THREE.Scene();
  setupCartoonySkybox(scene);
  setupEnhancedLighting();

  const s = getSettings();
  camera = new THREE.PerspectiveCamera(s.fov, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 10, 20);

  renderer = new THREE.WebGLRenderer({ antialias: !isMobileDevice() });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Cap pixel ratio at 2 (#24)
  currentPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(currentPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Mobile shadow preset (#25)
  renderer.shadowMap.enabled = !isMobileDevice();
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  initUI();
  createSettingsMenu();
  createFpsCounter();

  onSettingsChange((key, value) => {
    if (key === 'fov' && camera) { camera.fov = value; camera.updateProjectionMatrix(); }
    if (key === 'sensitivity') keyState.sensitivity = value;
    if (key === 'showFps' && fpsCounterEl) fpsCounterEl.style.display = value ? 'block' : 'none';
    if (key === 'musicEnabled') { if (value && raceState.raceStarted) Audio.startMusic(); else Audio.stopMusic(); }
  });
  keyState.sensitivity = s.sensitivity;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  log('Initializing Ammo.js');
  Ammo().then((ammo) => {
    log('Ammo.js initialized');
    window.Ammo = ammo;
    if (loadingEl.parentNode) document.body.removeChild(loadingEl);

    const physicsState = initPhysics(ammo, trackId);
    physicsWorld = physicsState.physicsWorld;
    tmpTrans = physicsState.tmpTrans;

    loadTrackModel(ammo, trackId, scene, physicsWorld, loadingManager, (trackModel) => {
      extractTrackData(trackModel);
    });
    loadMapDecorations(trackId, scene, renderer, camera, loadingManager);

    gateData = loadGates(trackId, scene, loadingManager, (loadedGateData) => {
      gateData = loadedGateData;
      window.gateData = gateData;
      store.gateData = gateData; // keep the shared store fresh (#29)
      log(`Gates loaded for ${trackId}. Total gates: ${gateData.totalGates}`);
      maybeSetupSolo();
    });

    const carComponents = createVehicle(ammo, scene, physicsWorld, debugObjects, (loadedComponents) => {
      carBody = loadedComponents.carBody;
      vehicle = loadedComponents.vehicle;
      wheelMeshes = loadedComponents.wheelMeshes;
      carModel = loadedComponents.carModel;
      carRenderState = loadedComponents.renderState;
      currentSteeringAngle = loadedComponents.currentSteeringAngle;
      multiplayerState.carModel = carModel;

      if (!raceState.isMultiplayer) {
        setTimeout(() => startCountdown(), 500);
      }
      animate();
    }, trackId);

    carBody = carComponents.carBody;
    vehicle = carComponents.vehicle;
    carRenderState = carComponents.renderState;

    setupKeyControls();

    // Point the store at the live race objects so modules can read them without
    // reaching for window.* (#29).
    store.raceState = raceState;
    store.gateData = gateData;
    store.playerFinishTimes = playerFinishTimes;
    store.on('leaderboardDirty', () => updateLeaderboard());

    multiplayerState = initMultiplayer({ scene, camera, carModel: null }, store);
    // Surface join failures / host migration to the user (#6, #9)
    multiplayerState.onJoinFailed = showJoinFailed;
    multiplayerState.onHostMigrated = (becameHost) => {
      isHost = becameHost || isHost;
      showToast(becameHost ? 'You are the new host' : 'Host changed');
    };
  }).catch((err) => {
    // wasm/ammo failure path (#26)
    error('Failed to initialize physics engine:', err);
    if (loadingEl) {
      loadingEl.textContent = 'Failed to load the physics engine. Please refresh.';
    }
    const ls = document.getElementById('loading-screen');
    if (ls) {
      const lt = ls.querySelector('.loading-text');
      if (lt) lt.textContent = 'Failed to load. Please refresh.';
    }
  });

  raceState.isMultiplayer = !!(gameConfig && gameConfig.players && gameConfig.players.length > 1 && gameConfig.multiplayer);

  createRaceUI();
  createRaceTimer();
  createLeaderboard();
  createSpectatorUI();

  minimapState = createMinimap(trackId);

  window.enterSpectatorMode = enterSpectatorMode;
  window.exitSpectatorMode = exitSpectatorMode;

  createMobileControls();
  createResetButton();
  // Now that every mobile UI element exists, apply the active scheme once more
  // (createMobileControls ran before the reset button was created).
  updateMobileControlVisibility();
}

// Single-player ghost + AI bots setup, once gates are ready (#42)
// Lightweight debug hook so automated tests (and curious devs) can inspect the
// AI opponents at runtime. No-op cost when unused.
window.__aiDebug = () => aiBots.map((b) => ({
  name: b.name,
  ready: !!b.ready,
  progress: +(b.progress || 0).toFixed(4),
  speedKPH: +((b.speed || 0) * 3.6).toFixed(1),
  recover: +(b.recoverT || 0).toFixed(1),
  gate: b.gateIndex,
  keys: b.keyState ? `${b.keyState.w ? 'W' : '-'}${b.keyState.a ? 'A' : '-'}${b.keyState.s ? 'S' : '-'}${b.keyState.d ? 'D' : '-'}${b.keyState.space ? '_' : '-'}` : '',
  pos: b.carModel ? [
    +b.carModel.position.x.toFixed(1),
    +b.carModel.position.y.toFixed(1),
    +b.carModel.position.z.toFixed(1),
  ] : null,
}));

function maybeSetupSolo() {
  if (raceState.isMultiplayer || !gateData || !gateData.gates || gateData.gates.length === 0) return;
  // Ghost
  ghostRecorder = new GhostRecorder();
  const ghostData = loadGhost(trackId);
  if (ghostData) ghostPlayer = new GhostPlayer(scene, ghostData);

  // AI opponents that are REAL Ammo vehicles (createAIVehicle) sharing the
  // player's physicsWorld, driven by a W/A/S/D brain. Perfect staggered grid
  // placement behind the start line, corner-aware target speeds, per-driver
  // skill, and a randomised field so it reads like a real lobby (#42, #2).
  //
  // The racing line now comes from the ACTUAL track centerline (track-outline.glb)
  // instead of just the 8 gate points, so the bots take real corners cleanly and
  // are genuinely quick. Loading is async; fall back to the gate line on error.
  if (window.Ammo && physicsWorld) {
    const assetMap = getAssetMap(trackId);
    loadRacingLine(trackId, assetMap, gateData.gates, (line) => {
      racingLine = line;
      window.racingLine = racingLine;
      buildAIField();
    });
  }
}

// Build the AI grid + bots once the racing line is ready.
function buildAIField() {
  if (!racingLine || !window.Ammo || !physicsWorld || !gateData) return;
  {
    const totalGates = gateData.totalGates || gateData.gates.length;

    // "Matchmake" a randomly-sized field (#2) so every solo race feels freshly
    // populated. A spread of skills keeps the pack varied.
    const FIELD = 4 + Math.floor(Math.random() * 3); // 4..6 opponents
    const names = pickBotNames(FIELD);

    // ---- Perfect grid placement (#2 demand) ----
    // Build a clean 2-column starting grid BEHIND the start gate, aligned to the
    // track direction. The player sits on pole; bots fill staggered rows behind.
    // Full nearest-point search (not the cheap local `projectNear`): the start
    // line can sit anywhere along the centerline's index order, so a windowed
    // search around index 0 would mis-seed the grid on some maps.
    const startArc = racingLine.project(
      new THREE.Vector3(
        gateData.currentGatePosition.x,
        gateData.currentGatePosition.y,
        gateData.currentGatePosition.z
      )
    );
    const tan = new THREE.Vector3();
    racingLine.tangentAt(startArc, tan);
    tan.y = 0; tan.normalize();
    const heading = Math.atan2(tan.x, tan.z);
    const spawnQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);

    const ROW_GAP = 10.0;  // spacing between grid rows (world units)
    const LANE_OFF = 4.0;  // half-width of the two grid columns
    const linePt = new THREE.Vector3();

    aiBots = names.map((name, i) => {
      // Row/column: bots start one full row behind the player (row index i+1).
      const row = Math.floor(i / 2) + 1;
      const col = (i % 2 === 0) ? -1 : 1;
      const laneBias = col * LANE_OFF;

      // Base grid point: back along the track by `row` rows from the start.
      racingLine.pointAt(startArc - row * ROW_GAP, linePt);
      // Offset sideways into the column, using the track perpendicular.
      const perp = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const spawnPos = linePt.clone().addScaledVector(perp, laneBias);
      // Spawn at a safe height ABOVE the surface (like the player, who spawns at
      // y=5.2 and settles). The centerline's own y sits near/under the track, so
      // using it directly buried the chassis and pinned the car. Drop + settle.
      spawnPos.y = Math.max(linePt.y, gateData.currentGatePosition.y) + 5.0;

      // Skills fan out from strong to weak across the field.
      const base = 0.9 - (i / Math.max(1, FIELD - 1)) * 0.44; // 0.9 -> ~0.46
      const skill = THREE.MathUtils.clamp(base + (Math.random() - 0.5) * 0.08, 0.4, 0.96);

      return new AIBot(scene, {
        ammo: window.Ammo,
        physicsWorld,
        racingLine,
        color: botColor(i),
        name,
        skill,
        totalGates,
        laneBias,
        trackId,
        startArc,
        spawn: { position: spawnPos, quaternion: spawnQuat },
      });
    });

    // If the racing line finished loading AFTER the race already started
    // (async GLB), start the freshly-created bots immediately so they don't
    // sit frozen on the grid.
    if (raceState.raceStarted) aiBots.forEach((b) => b.start());
  }
}

function hideLoadingScreen() {
  setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
    }
  }, 500);
}

// ---- input ---------------------------------------------------------------

function firstGestureAudio() {
  if (!audioStarted) { Audio.initAudio(); Audio.resumeAudio(); audioStarted = true; }
}

function doReset() {
  if (window.Ammo && carBody && gateData) {
    currentSteeringAngle = resetCarPosition(
      window.Ammo, carBody, vehicle, currentSteeringAngle,
      gateData.currentGatePosition, gateData.currentGateQuaternion
    );
    resetGateTracking();
    vibrate(30);
  }
}

function setupKeyControls() {
  document.addEventListener('keydown', (event) => {
    firstGestureAudio();
    const k = event.key.toLowerCase();
    if (k === 'w' || event.key === 'ArrowUp') keyState.w = true;
    if (k === 's' || event.key === 'ArrowDown') keyState.s = true;
    if (k === 'a') keyState.a = true;
    if (k === 'd') keyState.d = true;
    if (event.code === 'Space') { keyState.space = true; event.preventDefault(); }
    if (k === 'r') doReset(); // manual reset (#21)
    if (k === 'p') { if (spectatorMode) exitSpectatorMode(); else enterSpectatorMode(); }
  });

  document.addEventListener('keyup', (event) => {
    const k = event.key.toLowerCase();
    if (k === 'w' || event.key === 'ArrowUp') keyState.w = false;
    if (k === 's' || event.key === 'ArrowDown') keyState.s = false;
    if (k === 'a') keyState.a = false;
    if (k === 'd') keyState.d = false;
    if (event.code === 'Space') keyState.space = false;
  });

  document.addEventListener('touchstart', firstGestureAudio, { once: true });

  // Tilt steering (#48)
  setupTiltSteering();
}

function vibrate(ms) {
  if (getSettings().vibration && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) {}
  }
}

// ---- animation loop ------------------------------------------------------

let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;

  measureFps(deltaTime);

  if (physicsWorld) {

    while (accumulator >= FIXED_PHYSICS_STEP) {
      // AI opponents are REAL Ammo vehicles in this SAME physicsWorld. Their
      // brains decide W/A/S/D, then we apply their control forces through the
      // IDENTICAL model the player uses (applyVehicleControls/updateSteering) —
      // BEFORE the single world step below, so every car is stepped once per
      // tick together. Stepping per-car would advance the sim N times too fast.
      if (!raceState.isMultiplayer && aiBots.length) {
        // Build the shared racer list so each driver is aware of the others
        // (drafting, overtaking, defending, avoiding) — the human included.
        let playerSpeedForAI = 0;
        if (carModel) {
          if (aiPlayerLastPos) {
            playerSpeedForAI = carModel.position.distanceTo(aiPlayerLastPos) / FIXED_PHYSICS_STEP;
            aiPlayerLastPos.copy(carModel.position);
          } else {
            aiPlayerLastPos = carModel.position.clone();
          }
        }
        const racers = aiBots.map((b) => ({ bot: b, position: b.pos, speed: b.speed }));
        if (carModel) racers.push({ bot: null, position: carModel.position, speed: playerSpeedForAI });

        aiBots.forEach((b) => {
          if (!b.ready) return;
          // 1) Brain decides which keys to press.
          b.think(FIXED_PHYSICS_STEP, {
            racers,
            started: raceState.raceStarted,
            raceStartTime,
          });
          // 2) Apply those keys through the SAME real force/steering model as
          //    the player. Does NOT step the world (that happens once below).
          const botState = {
            carBody: b.carBody, vehicle: b.vehicle, carModel: b.carModel,
            keyState: b.keyState, currentSteeringAngle: b.currentSteeringAngle,
            updateSteering, trackId,
          };
          // Bots must keep racing after the HUMAN finishes, otherwise they'd
          // freeze on the track and the final leaderboard would never trigger.
          // Give each bot its OWN race state driven by its own finished flag,
          // not the shared player raceState (which flips raceFinished when the
          // human crosses the line) (#4).
          const botRaceState = { raceStarted: raceState.raceStarted, raceFinished: b.finished };
          const res = applyVehicleControls(FIXED_PHYSICS_STEP, window.Ammo, botState, botRaceState);
          if (!res.aborted) {
            b.currentSteeringAngle = res.currentSteeringAngle;
            b.speed = res.currentSpeed / 3.6; // km/h -> units/sec for awareness
          }
        });
      }

      const carState = {
        carBody, vehicle, carModel, wheelMeshes,
        keyState, currentSteeringAngle, updateSteering, trackId,
      };
      // Player's controls are applied here too, then the world steps ONCE for
      // every vehicle (player + all bots) that already applied their forces.
      const physicsResult = updatePhysics(
        FIXED_PHYSICS_STEP, window.Ammo, { physicsWorld, tmpTrans },
        carState, debugObjects, raceState
      );

      // Now that the world advanced, record each bot's physics transform for
      // smooth render interpolation, and detect bots that fell off the track.
      if (!raceState.isMultiplayer && aiBots.length) {
        aiBots.forEach((b) => {
          if (!b.ready) return;
          recordCarPhysicsState(b.vehicle, b.renderState);
          checkGroundCollision(window.Ammo, b.carBody, () => {
            // Respawn a fallen bot at the start gate, like the player's reset.
            resetCarPosition(
              window.Ammo, b.carBody, b.vehicle, b.currentSteeringAngle,
              gateData.currentGatePosition, gateData.currentGateQuaternion
            );
          });
        });
      }

      const speedKPH = physicsResult.currentSpeed;
      updateSpeedometer(speedKPH);
      currentSteeringAngle = physicsResult.currentSteeringAngle;

      // Record physics transform for render interpolation (#16)
      recordCarPhysicsState(vehicle, carRenderState);

      // Audio: engine pitch + skid (#41)
      if (engineRunning) {
        Audio.updateEngine(speedKPH, keyState.w || keyState.s);
        Audio.setSkid(raceState.raceStarted && !raceState.raceFinished ? (physicsResult.slip > 0.4 ? physicsResult.slip : 0) : 0);
      }

      checkGroundCollision(window.Ammo, carBody, () => {
        currentSteeringAngle = resetCarPosition(
          window.Ammo, carBody, vehicle, currentSteeringAngle,
          gateData.currentGatePosition, gateData.currentGateQuaternion
        );
        resetGateTracking();
        Audio.playCollision(0.6);
        vibrate(60);
      });

      if (carModel && !raceState.raceFinished) checkCarFlipped(FIXED_PHYSICS_STEP);

      // Ghost recording (#42)
      if (!raceState.isMultiplayer && raceState.raceStarted && !raceState.raceFinished && ghostRecorder) {
        ghostRecorder.record(carModel);
      }

      accumulator -= FIXED_PHYSICS_STEP;


      if (gateData) {
        const raceFinished = checkGateProximity(carModel, gateData);
        currentGatePosition.copy(gateData.currentGatePosition);
        currentGateQuaternion.copy(gateData.currentGateQuaternion);
        window.gateData = gateData;

        if (raceFinished && !raceState.raceFinished) {
          const finishMs = Date.now() - raceStartTime;
          const timeStr = formatTime(finishMs);
          playerFinishTimes[localStorage.getItem('myPlayerId')] = timeStr;
          showFinishMessage(gateData.totalGates, null, timeStr);
          if (timerInterval) clearInterval(timerInterval);
          Audio.setSkid(0);
          vibrate([40, 40, 120]);
          // Save ghost best (#42)
          if (!raceState.isMultiplayer && ghostRecorder) ghostRecorder.finish(trackId, finishMs);
        }
        updateGateFading(gateData.fadingGates);
      }
    }

    // Render-frame interpolation of local car (#16): interpolate between the
    // last two physics states by the leftover accumulator fraction, so motion
    // is smooth on high-refresh (144 Hz) displays regardless of the 60 Hz tick.
    const alpha = accumulator / FIXED_PHYSICS_STEP;
    renderCarInterpolated(carModel, wheelMeshes, carRenderState, alpha);

    // Interpolate AI opponents the same way (they're real vehicles now).
    if (!raceState.isMultiplayer && aiBots.length) {
      aiBots.forEach((b) => {
        if (b.ready) renderCarInterpolated(b.carModel, b.wheelMeshes, b.renderState, alpha);
      });
    }

    // Interpolate remote cars every render frame (#1)
    if (raceState.isMultiplayer) updateOpponentInterpolation();

    // Ghost playback + camera etc.
    if (ghostPlayer) ghostPlayer.update();

    // Camera
    if (broadcastMode && broadcastTarget) {
      const t = performance.now() / 1000 - broadcastStartT;
      updateBroadcastCamera(camera, broadcastTarget.model, t);
      updateBroadcastHUD();
    } else if (spectatorMode) {
      if (freeCam) updateFreeCam(); else updateSpectatorCamera(camera, activeRacers[spectatedPlayerIndex]?.model);
    } else {
      updateChaseCamera(camera, carModel);
    }

    updateMarkers();

    if (raceState.raceStarted) {
      updateLeaderboard();
      if (carModel) {
        // Show AI opponents on the minimap in solo, remote players in MP.
        const minimapOpponents = raceState.isMultiplayer
          ? multiplayerState?.opponentCars
          : aiBots.reduce((acc, b) => { acc[b.name] = b; return acc; }, {});
        updateMinimapPlayers(carModel, minimapOpponents);
      }
    }

    if (raceState.isMultiplayer) sendCarData({ carModel });

    if (raceState.isMultiplayer && !raceState.allPlayersConnected) {
      updateWaitingUI();
      if (multiplayerState.checkAllPlayersConnected()) {
        raceState.allPlayersConnected = true;
        if (isHost) {
          log('All players connected - starting synced countdown');
          startCountdown();
        }
      }
    }

    // Once EVERY racer (player + bots in solo, player + opponents in MP) is
    // done, reveal the final leaderboard automatically (#4, #5). This runs for
    // both modes now so a solo race also waits for the bots to cross the line.
    if (raceState.raceStarted && !finalLeaderboardShown && checkAllPlayersFinished()) {
      finalLeaderboardShown = true;
      // Small delay so the last car's finish reads on screen first.
      setTimeout(showFinalLeaderboard, raceState.isMultiplayer ? 3000 : 1500);
    }

    // Adaptive resolution (#24)
    adaptResolution();
  }

  renderer.render(scene, camera);
}

function checkCarFlipped(deltaTime) {
  const carUpVector = new THREE.Vector3(0, 1, 0);
  carUpVector.applyQuaternion(carModel.quaternion);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const upDot = carUpVector.dot(worldUp);
  upDotDelta = Math.abs(upDot - prevUpDot);
  prevUpDot = upDot;

  const FLIPPED_THRESHOLD = 0.5;
  const DOT_DELTA_THRESHOLD = 0.01;

  if (upDot < FLIPPED_THRESHOLD && upDotDelta < DOT_DELTA_THRESHOLD) {
    if (!carIsFlipped) { carIsFlipped = true; carFlippedTime = 0; }
    else {
      carFlippedTime += deltaTime;
      if (carFlippedTime > 1) {
        carIsFlipped = false;
        carFlippedTime = 0;
        if (window.Ammo && carBody && gateData) {
          currentSteeringAngle = resetCarPosition(
            window.Ammo, carBody, vehicle, currentSteeringAngle,
            gateData.currentGatePosition, gateData.currentGateQuaternion
          );
          resetGateTracking();
        }
      }
    }
  } else {
    carIsFlipped = false;
    carFlippedTime = 0;
  }
}

function setupEnhancedLighting() {
  scene.children.forEach((child) => { if (child.isLight) scene.remove(child); });
  const mobile = isMobileDevice();
  const ambientLight = new THREE.AmbientLight(0xcccccc, mobile ? 2.6 : 2);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, mobile ? 3 : 3.5);
  directionalLight.position.set(40, 250, 30);
  if (!mobile) {
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
  }
  scene.add(directionalLight);
}

function initUI() {
  speedElement = document.querySelector('.gauge-fill');
  needleElement = document.querySelector('.gauge-needle');
  speedValueElement = document.querySelector('.speed-value');
  if (!speedElement || !needleElement || !speedValueElement) error('Speedometer elements not found');
}

function updateSpeedometer(speed) {
  currentSpeed = Math.max(speed - 1, 0);
  const speedPercent = Math.min(currentSpeed / 2 / MAX_SPEED_KPH, 1);
  const fillRotation = speedPercent * 180;
  if (speedElement) speedElement.style.transform = `rotate(${fillRotation}deg)`;
  if (needleElement) needleElement.style.transform = `rotate(${fillRotation - 90}deg)`;
  if (speedValueElement) speedValueElement.textContent = Math.round(currentSpeed);
}

function checkAllPlayersFinished() {
  if (!gateData) return false;

  // Solo: wait for the human AND every AI bot to complete the lap (#4, #5).
  if (!raceState.isMultiplayer) {
    if (!raceState.raceFinished) return false;      // player not done yet
    if (!aiBots.length) return raceState.raceFinished;
    return aiBots.every((b) => b.finished);
  }

  // Multiplayer: wait for the human and every still-connected, non-DNF opponent.
  if (!multiplayerState || !allPlayers || allPlayers.length === 0) return false;
  let activePlayers = 0;
  let finishedCount = 0;
  if (raceState.raceFinished) finishedCount++;
  activePlayers++;
  Object.values(multiplayerState.opponentCars).forEach((opponent) => {
    const isActive = opponent.lastUpdate && (Date.now() - opponent.lastUpdate < 10000);
    if (opponent.dnf) return; // DNF players don't block the finish (#8)
    if (isActive) {
      activePlayers++;
      if ((opponent.raceProgress && opponent.raceProgress.currentGateIndex >= gateData.totalGates) || opponent.raceFinished) {
        finishedCount++;
      }
    }
  });
  return finishedCount === activePlayers && activePlayers > 0;
}

// ---- FPS counter (#49) + adaptive resolution (#24) -----------------------

function createFpsCounter() {
  fpsCounterEl = document.createElement('div');
  Object.assign(fpsCounterEl.style, {
    position: 'absolute', bottom: '20px', right: '20px', background: 'rgba(0,0,0,0.5)',
    color: '#9f9', padding: '4px 10px', borderRadius: '6px', fontFamily: 'monospace',
    fontSize: '14px', zIndex: '1100', display: getSettings().showFps ? 'block' : 'none',
  });
  fpsCounterEl.textContent = '-- FPS';
  document.body.appendChild(fpsCounterEl);
}

let smoothedFrameMs = 16;
function measureFps(dt) {
  const ms = dt * 1000;
  smoothedFrameMs = smoothedFrameMs * 0.9 + ms * 0.1;
  frameTimes.push(ms);
  if (frameTimes.length > 60) frameTimes.shift();
  const now = performance.now();
  if (fpsCounterEl && getSettings().showFps && now - lastFpsUpdate > 250) {
    lastFpsUpdate = now;
    fpsCounterEl.textContent = `${Math.round(1000 / smoothedFrameMs)} FPS`;
  }
}

let lastAdapt = 0;
function adaptResolution() {
  if (!getSettings().adaptiveResolution) return;
  const now = performance.now();
  if (now - lastAdapt < 1000) return;
  lastAdapt = now;
  const cap = Math.min(window.devicePixelRatio || 1, 2);
  // Drop to 0.75x when frame time > 22 ms (under ~45 FPS), recover when smooth.
  if (smoothedFrameMs > 22 && currentPixelRatio > cap * 0.75) {
    currentPixelRatio = Math.max(cap * 0.75, currentPixelRatio - 0.25);
    renderer.setPixelRatio(currentPixelRatio);
  } else if (smoothedFrameMs < 15 && currentPixelRatio < cap) {
    currentPixelRatio = Math.min(cap, currentPixelRatio + 0.25);
    renderer.setPixelRatio(currentPixelRatio);
  }
}

// ---- toasts / join-failed / reset button ---------------------------------

function showToast(msg) {
  const t = document.createElement('div');
  Object.assign(t.style, {
    position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '10px 20px', borderRadius: '10px',
    fontFamily: "'Poppins', sans-serif", zIndex: '2500', opacity: '0', transition: 'opacity 0.3s',
  });
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}

function showJoinFailed(message) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.85)', color: '#fff',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: '3000', fontFamily: "'Poppins', sans-serif", textAlign: 'center', padding: '20px',
  });
  overlay.innerHTML = `<h2 style="font-size:32px;color:#ff5a7a;">Couldn't Join</h2><p style="font-size:18px;max-width:480px;">${message}</p>`;
  const btn = document.createElement('button');
  btn.textContent = 'BACK TO LOBBY';
  Object.assign(btn.style, {
    marginTop: '20px', padding: '10px 30px', fontWeight: '900', fontSize: '1rem',
    background: '#ff0080', color: '#fff', border: '2px solid #b30059', borderRadius: '5px',
    cursor: 'pointer',
  });
  btn.addEventListener('click', () => { window.location.href = 'index.html'; });
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
}

function createResetButton() {
  const btn = document.createElement('button');
  btn.id = 'reset-car-btn';
  btn.setAttribute('aria-label', 'Reset car (R)');
  btn.innerHTML = '<i class="fas fa-undo"></i>';
  if (!btn.textContent) btn.textContent = '⟲';
  Object.assign(btn.style, {
    position: 'absolute', bottom: '100px', right: '20px', width: '60px', height: '60px',
    borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.5)',
    color: '#fff', fontSize: '22px', cursor: 'pointer', zIndex: '1100',
    boxShadow: '0 0 10px rgba(0,0,0,0.5)',
  });
  const trigger = (e) => { e.preventDefault(); doReset(); };
  btn.addEventListener('click', trigger);
  btn.addEventListener('touchstart', trigger, { passive: false });
  document.body.appendChild(btn);
}

// ---- orientation / mobile controls ---------------------------------------

// Tap-to-rotate: request fullscreen then lock the screen to landscape. Browsers
// only allow orientation lock from a user gesture AND (on most engines) while
// fullscreen, so this must run from the tap handler. Everything is
// feature-detected and failures degrade gracefully to the "turn your phone"
// message. Returns true if a landscape lock was successfully requested.
async function forceLandscapeRotation() {
  let lockedOk = false;
  try {
    // 1. Go fullscreen (prefixed variants for Safari / older Edge).
    const docEl = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen ||
        docEl.msRequestFullscreen;
      if (req) {
        try { await req.call(docEl); } catch (e) { /* user may deny; keep going */ }
      }
    }

    // 2. Lock orientation to landscape. Try the generic 'landscape' first, then
    //    fall back to explicit primary/secondary if the browser is picky.
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      for (const mode of ['landscape', 'landscape-primary', 'landscape-secondary']) {
        try {
          await screen.orientation.lock(mode);
          lockedOk = true;
          break;
        } catch (e) { /* try next mode */ }
      }
    }
  } catch (error) {
    warn('Landscape rotation/fullscreen failed:', error);
  }
  // Re-evaluate layout regardless — the user may also just physically rotate.
  handleOrientationChange();
  return lockedOk;
}

function setupRotateButton() {
  const rotateMessage = document.getElementById('rotate-message');
  const btn = document.getElementById('rotate-tap-btn');
  if (!rotateMessage) return;
  const trigger = async (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    firstGestureAudio();
    vibrate(20);
    await forceLandscapeRotation();
  };
  if (btn) {
    btn.addEventListener('click', trigger);
    btn.addEventListener('touchend', trigger, { passive: false });
  }
  // Tapping anywhere on the overlay also works (nice big hit target on phones).
  rotateMessage.addEventListener('click', (e) => {
    if (e.target === btn || (btn && btn.contains(e.target))) return; // handled above
    trigger(e);
  });
}

function handleOrientationChange() {
  const rotateMessage = document.getElementById('rotate-message');
  const canvas = document.querySelector('canvas');
  const joystickContainer = document.getElementById('joystick-container');

  const buttonControls = document.getElementById('button-controls');

  if (window.innerHeight > window.innerWidth) {
    if (rotateMessage) rotateMessage.style.display = 'flex';
    if (canvas) canvas.style.display = 'none';
    if (joystickContainer) joystickContainer.style.display = 'none';
    if (buttonControls) buttonControls.style.display = 'none';
    document.querySelectorAll('#racing-ui, #connection-ui, #leaderboard').forEach((el) => { if (el) el.style.display = 'none'; });
  } else {
    if (rotateMessage) rotateMessage.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    const speedometer = document.getElementById('racing-ui');
    const lb = document.getElementById('leaderboard');
    if (speedometer) speedometer.style.display = 'block';
    if (lb && raceState.raceStarted) lb.style.display = 'block';
    // Show whichever mobile control scheme the player selected.
    updateMobileControlVisibility();
  }

  if (renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Tilt steering (#48): device orientation gamma controls left/right.
let tiltEnabled = false;
function setupTiltSteering() {
  const handler = (e) => {
    if (!getSettings().tiltSteering) { keyState._tiltA = false; keyState._tiltD = false; return; }
    const gamma = e.gamma || 0; // left-right tilt in degrees
    const dead = 6;
    keyState.a = gamma < -dead;
    keyState.d = gamma > dead;
  };
  // iOS requires permission; request on first touch.
  const enable = () => {
    if (tiltEnabled) return;
    tiltEnabled = true;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then((res) => {
        if (res === 'granted') window.addEventListener('deviceorientation', handler);
      }).catch(() => {});
    } else {
      window.addEventListener('deviceorientation', handler);
    }
  };
  document.addEventListener('touchstart', enable, { once: true });
}

// Build BOTH mobile control schemes (analog joystick + tap buttons) once, then
// show whichever the player picked in Settings (#2 / #49). Tilt steering, when
// enabled, still overrides the left/right of either scheme.
function createMobileControls() {
  const joystick = buildJoystick();
  const buttons = buildButtonPad();

  // Keep the active scheme in sync with settings + orientation + resize.
  onSettingsChange((key) => {
    if (key === 'controlScheme' || key === 'tiltSteering') updateMobileControlVisibility();
  });
  window.addEventListener('resize', updateMobileControlVisibility);
  updateMobileControlVisibility();
  return { joystick, buttons };
}

// Show the chosen control scheme (and hide the other) when on a mobile device in
// landscape. Clears any latched movement keys when swapping so nothing sticks.
function updateMobileControlVisibility() {
  const joystick = document.getElementById('joystick-container');
  const buttons = document.getElementById('button-controls');
  const landscape = window.innerWidth >= window.innerHeight;
  const on = isMobileDevice() && landscape;
  const scheme = getSettings().controlScheme || 'joystick';
  const tilt = !!getSettings().tiltSteering;
  if (joystick) joystick.style.display = (on && scheme === 'joystick') ? 'block' : 'none';
  if (buttons) buttons.style.display = (on && scheme === 'buttons') ? 'flex' : 'none';
  // Steering buttons are redundant (and disabled) when tilt steering is on.
  document.querySelectorAll('.btn-steer').forEach((b) => {
    b.style.opacity = tilt ? '0.35' : '1';
    b.style.pointerEvents = tilt ? 'none' : 'auto';
  });
  // The button scheme's pedals sit bottom-right, where the reset button lives,
  // so lift the reset button clear of them while that scheme is active.
  const resetBtn = document.getElementById('reset-car-btn');
  if (resetBtn) {
    if (on && scheme === 'buttons') {
      // Sit above the left-hand steering buttons, clear of the right-hand pedals.
      resetBtn.style.bottom = 'calc(130px + env(safe-area-inset-bottom, 0px))';
      resetBtn.style.left = 'calc(24px + env(safe-area-inset-left, 0px))';
      resetBtn.style.right = 'auto';
    } else {
      resetBtn.style.bottom = '100px';
      resetBtn.style.right = '20px';
      resetBtn.style.left = 'auto';
    }
  }
  // Nothing should be latched after a swap.
  keyState.w = keyState.s = false;
  if (!tilt) { keyState.a = keyState.d = false; }
}

function buildJoystick() {
  const joystickContainer = document.createElement('div');
  joystickContainer.id = 'joystick-container';
  Object.assign(joystickContainer.style, {
    position: 'fixed', bottom: '100px', left: '20px', width: '140px', height: '140px',
    borderRadius: '50%', backgroundColor: 'rgba(0, 0, 0, 0.5)',
    border: '2px solid rgba(255, 255, 255, 0.3)', display: 'none', zIndex: '1000',
    boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)', touchAction: 'none',
  });

  const joystickKnob = document.createElement('div');
  joystickKnob.id = 'joystick-knob';
  Object.assign(joystickKnob.style, {
    position: 'absolute', top: '50%', left: '50%', width: '60px', height: '60px',
    borderRadius: '50%', backgroundColor: '#ff0080', border: '2px solid #b30059',
    transform: 'translate(-50%, -50%)', boxShadow: '0 0 10px rgba(255, 0, 128, 0.5)',
  });
  joystickContainer.appendChild(joystickKnob);
  document.body.appendChild(joystickContainer);

  let isJoystickActive = false;
  let centerX, centerY;
  const maxDistance = 50;

  function updateKnobPosition(x, y) {
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    let moveX = deltaX, moveY = deltaY;
    if (distance > maxDistance) { moveX = (deltaX / distance) * maxDistance; moveY = (deltaY / distance) * maxDistance; }
    joystickKnob.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    const threshold = maxDistance * 0.3;
    keyState.w = keyState.s = keyState.a = keyState.d = false;
    if (moveY < -threshold) keyState.w = true;
    if (moveY > threshold) keyState.s = true;
    if (!getSettings().tiltSteering) {
      if (moveX < -threshold) keyState.a = true;
      if (moveX > threshold) keyState.d = true;
    }
  }
  function resetKnobPosition() {
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    keyState.w = keyState.s = false;
    if (!getSettings().tiltSteering) { keyState.a = false; keyState.d = false; }
  }

  joystickContainer.addEventListener('touchstart', (e) => {
    firstGestureAudio();
    isJoystickActive = true;
    const rect = joystickContainer.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    updateKnobPosition(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  joystickContainer.addEventListener('touchmove', (e) => {
    if (!isJoystickActive) return;
    updateKnobPosition(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  const touchEndHandler = () => { if (!isJoystickActive) return; isJoystickActive = false; resetKnobPosition(); };
  joystickContainer.addEventListener('touchend', touchEndHandler);
  joystickContainer.addEventListener('touchcancel', touchEndHandler);
  return joystickContainer;
}

// Tap-button controls: steering (◄ ►) bottom-left, gas / brake bottom-right, and
// a small handbrake. Each button latches its key on press and releases on
// lift/cancel, and independent buttons can be held at once (multitouch), so you
// can accelerate and steer simultaneously.
function buildButtonPad() {
  const wrap = document.createElement('div');
  wrap.id = 'button-controls';
  Object.assign(wrap.style, {
    position: 'fixed', bottom: '0', left: '0', width: '100%', height: '0',
    display: 'none', justifyContent: 'space-between', alignItems: 'flex-end',
    pointerEvents: 'none', zIndex: '1000',
  });

  const makeGroup = () => {
    const g = document.createElement('div');
    Object.assign(g.style, {
      position: 'fixed', bottom: 'calc(30px + env(safe-area-inset-bottom, 0px))',
      display: 'flex', gap: '16px', alignItems: 'center', pointerEvents: 'none',
    });
    return g;
  };

  // A single hold-to-press button that drives keyState[key] while touched.
  const makeButton = (key, icon, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mobile-btn ${opts.className || ''}`.trim();
    b.setAttribute('aria-label', opts.label || key);
    b.innerHTML = `<i class="fas ${icon}"></i>`;
    const size = opts.size || 76;
    Object.assign(b.style, {
      width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.35)',
      background: opts.bg || 'rgba(0,0,0,0.5)', color: '#fff',
      fontSize: `${Math.round(size * 0.4)}px`, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'auto', touchAction: 'none', userSelect: 'none',
      WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
      boxShadow: '0 0 12px rgba(0,0,0,0.5)', transition: 'transform 0.08s, background 0.08s',
    });
    if (!b.querySelector('i')?.textContent) b.textContent = opts.fallback || '';

    let pressed = false;
    const down = (e) => {
      if (e) e.preventDefault();
      if (pressed) return;
      pressed = true;
      firstGestureAudio();
      if (opts.onDown) { opts.onDown(); }
      else { keyState[key] = true; }
      b.style.transform = 'scale(0.9)';
      b.style.background = opts.activeBg || 'rgba(255,0,128,0.55)';
      if (opts.haptic !== false) vibrate(10);
    };
    const up = (e) => {
      if (e) e.preventDefault();
      if (!pressed) return;
      pressed = false;
      if (!opts.onDown) keyState[key] = false;
      b.style.transform = 'scale(1)';
      b.style.background = opts.bg || 'rgba(0,0,0,0.5)';
    };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    // Mouse fallback (desktop testing / hybrid devices).
    b.addEventListener('mousedown', down);
    b.addEventListener('mouseup', up);
    b.addEventListener('mouseleave', up);
    return b;
  };

  // Left: steering.
  const left = makeGroup();
  left.style.left = 'calc(24px + env(safe-area-inset-left, 0px))';
  left.appendChild(makeButton('a', 'fa-caret-left', { label: 'Steer left', className: 'btn-steer', size: 80 }));
  left.appendChild(makeButton('d', 'fa-caret-right', { label: 'Steer right', className: 'btn-steer', size: 80 }));

  // Right: pedals (gas / brake) stacked, plus handbrake to the side.
  const right = makeGroup();
  right.style.right = 'calc(24px + env(safe-area-inset-right, 0px))';
  const handbrake = makeButton('space', 'fa-hand', {
    label: 'Handbrake', size: 60, bg: 'rgba(40,40,40,0.5)',
  });
  const pedals = document.createElement('div');
  Object.assign(pedals.style, { display: 'flex', flexDirection: 'column', gap: '14px', pointerEvents: 'none' });
  pedals.appendChild(makeButton('w', 'fa-angle-up', {
    label: 'Accelerate', size: 84, bg: 'rgba(20,120,40,0.55)', activeBg: 'rgba(30,180,60,0.75)',
  }));
  pedals.appendChild(makeButton('s', 'fa-angle-down', {
    label: 'Brake / reverse', size: 76, bg: 'rgba(160,30,30,0.55)', activeBg: 'rgba(220,50,50,0.8)',
  }));
  right.appendChild(handbrake);
  right.appendChild(pedals);

  wrap.appendChild(left);
  wrap.appendChild(right);
  document.body.appendChild(wrap);
  return wrap;
}

init();
