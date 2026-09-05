import * as THREE from 'three';
import { createGLTFLoader } from './loaders.js';
import Peer from 'peerjs';
import {
  sanitizePlayerName, sanitizePlayerColor, sanitizePeerId,
} from './sanitize.js';
import { sanitizePreciseTime, formatTime } from './timing.js';
import { log, warn, error } from './debug.js';
import { getPeerOptions, generatePeerId } from './netConfig.js';
import {
  SnapshotBuffer, encodeTransform, decodeTransform, isBinaryTransform, INTERP_DELAY_MS,
} from './netcode.js';
import { createNameSprite } from './nametag.js';

const CAR_TINT = {
  red: 0xff5a5a, orange: 0xffa54d, yellow: 0xffe14d, green: 0x3fae4a,
  blue: 0x4a8bd6, indigo: 0xb35ad0, violet: 0x8a4fc0,
};

function isFiniteNumber(value) {
  return typeof value === 'number' && isFinite(value);
}

// Module state
const state = {
  peer: null,
  playerConnections: [],
  opponentCars: {},
  gameConfig: null,
  isHost: false,
  hostId: null,
  allPlayers: [],
  allCarsData: {},      // host: latest transform per peer (binary-decoded objects)
  lastBroadcastTime: 0,
  // Host-authoritative gate progression per peer (#3)
  gateProgress: {},     // peerId -> { gateIndex, updatedAt, finishMs }
  raceStartAt: 0,       // absolute start timestamp (#4)
  lastHeartbeatSent: 0,
  lastPingFrom: {},     // peerId -> timestamp (#8)
  onJoinFailed: null,   // UI callback (#6)
  onHostMigrated: null, // UI callback (#9)
};

let connectionRetryCount = 0;
const MAX_RETRIES = 8;         // bounded (#6)
const HEARTBEAT_INTERVAL = 2000;
const PEER_TIMEOUT = 6000;     // mark DNF after this silence (#8)
const BROADCAST_INTERVAL = 55; // ~18 Hz (#2)


// Shared store (#29) - replaces ad-hoc window.* coordination. Injected via
// initMultiplayer; falls back to window.* if absent for safety.
let store = null;

function emit(event, payload) {
  if (store) store.emit(event, payload);
}
function getFinishTimes() {
  return (store && store.playerFinishTimes) || window.playerFinishTimes || {};
}
function getGateData() {
  return (store && store.gateData) || window.gateData;
}
function refreshLeaderboard() {
  // Notify listeners (main.js subscribes to 'leaderboardDirty') and fall back to
  // the global hook. NB: must NOT call itself — that was an infinite-recursion
  // stack overflow that silently killed the finish-time leaderboard update (#4).
  emit('leaderboardDirty');
  if (typeof window !== 'undefined' && typeof window.updateLeaderboard === 'function') {
    window.updateLeaderboard();
  }
}

// Initialize multiplayer from game config
export function initMultiplayer(gameState, injectedStore = null) {
  store = injectedStore;
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      state.gameConfig = JSON.parse(savedConfig);
      const myPlayerId = localStorage.getItem('myPlayerId');
      state.isHost = state.gameConfig.players.some((p) => p.id === myPlayerId && p.isHost);
      const host = state.gameConfig.players.find((p) => p.isHost);
      state.hostId = host ? host.id : null;
      log('Game config loaded. Host:', state.isHost);

      // Roster is the trusted source of names/colors (#11)
      state.allPlayers = state.gameConfig.players.map((p) => ({
        ...p,
        name: sanitizePlayerName(p.name),
        playerColor: sanitizePlayerColor(p.playerColor),
      }));
    }
  } catch (e) {
    error('Error loading game config:', e);
  }

  // Only spin up PeerJS for genuine multiplayer games. A single-player race
  // (one player, or an explicit isSinglePlayer flag) must never try to reach a
  // host - doing so previously surfaced a spurious "Couldn't reach the host".
  const isMultiplayerGame = !!(
    state.gameConfig &&
    state.gameConfig.multiplayer === true &&
    Array.isArray(state.gameConfig.players) &&
    state.gameConfig.players.length > 1
  );
  if (isMultiplayerGame) {
    initPeerConnection(gameState);
  } else {
    log('Single-player game - networking disabled');
  }

  state.checkAllPlayersConnected = checkAllPlayersConnected;
  state.broadcastRaceStart = broadcastRaceStart;
  state.broadcastCountdownStart = broadcastCountdownStart;
  return state;
}

function trustedPlayer(peerId) {
  return state.allPlayers.find((p) => p.id === peerId);
}

function initPeerConnection(gameState) {
  const myPlayerId = localStorage.getItem('myPlayerId');
  if (!myPlayerId) {
    error('No player ID found in localStorage');
    return;
  }
  if (!state.gameConfig || !state.gameConfig.players || state.gameConfig.players.length === 0) {
    warn('No game config found - multiplayer disabled');
    return;
  }

  const peerOptions = getPeerOptions();
  state.peer = peerOptions ? new Peer(myPlayerId, peerOptions) : new Peer(myPlayerId);

  // Proper open sequencing instead of a blind 1s delay (#7)
  state.peer.on('open', (id) => {
    log('Peer open:', id);
    if (state.isHost) {
      state.peer.on('connection', (conn) => {
        conn.on('open', () => {
          // Only accept connections from peers in the roster (#11)
          if (!trustedPlayer(conn.peer)) {
            warn('Rejected connection from unknown peer:', conn.peer);
            try { conn.close(); } catch (e) {}
            return;
          }
          log('Player connected:', conn.peer);
          state.playerConnections.push(conn);
          state.lastPingFrom[conn.peer] = Date.now();
          setupMessageHandlers(conn, gameState);
        });
      });
      loadOpponentCarModels(gameState.scene);
      startHeartbeat();
    } else {
      connectToHost(gameState);
    }
  });

  state.peer.on('error', (err) => {
    error('Peer error:', err.type);
    if (err.type === 'unavailable-id') {
      // The original id collided. Retry with a fresh crypto id, bounded (#6, #12)
      if (connectionRetryCount < MAX_RETRIES) {
        connectionRetryCount++;
        const fresh = generatePeerId();
        localStorage.setItem('myPlayerId', fresh);
        warn(`ID unavailable, retrying with fresh id (${connectionRetryCount}/${MAX_RETRIES})`);
        setTimeout(() => {
          try { state.peer.destroy(); } catch (e) {}
          initPeerConnection(gameState);
        }, 800);
      } else if (state.onJoinFailed) {
        state.onJoinFailed("Couldn't get a network id. Please try again.");
      }
    } else if (err.type === 'peer-unavailable' && state.onJoinFailed) {
      state.onJoinFailed("Couldn't reach the host.");
    }
  });
}

function connectToHost(gameState) {
  const hostPlayer = state.gameConfig.players.find((p) => p.isHost);
  if (!hostPlayer) {
    error('No host player in config');
    if (state.onJoinFailed) state.onJoinFailed('No host found for this party.');
    return;
  }
  state.hostId = hostPlayer.id;

  function attempt() {
    log(`Connecting to host (attempt ${connectionRetryCount + 1})`);
    const conn = state.peer.connect(hostPlayer.id, { reliable: false });
    let ok = false;
    const timeout = setTimeout(() => {
      if (ok) return;
      connectionRetryCount++;
      if (connectionRetryCount < MAX_RETRIES) {
        setTimeout(attempt, 1500);
      } else {
        error(`Failed to connect after ${MAX_RETRIES} attempts`);
        if (state.onJoinFailed) state.onJoinFailed("Couldn't join the race. The host may have left.");
      }
    }, 4000);

    conn.on('open', () => {
      ok = true;
      clearTimeout(timeout);
      connectionRetryCount = 0;
      log('Connected to host!');
      state.playerConnections.push(conn);
      state.lastPingFrom[conn.peer] = Date.now();
      setupMessageHandlers(conn, gameState);
      loadOpponentCarModels(gameState.scene);
      startHeartbeat();
    });
    conn.on('error', (err) => error('Error connecting to host:', err));
  }
  attempt();
}

function startHeartbeat() {
  if (state._heartbeatTimer) return;
  state._heartbeatTimer = setInterval(() => {
    const now = Date.now();
    // Send pings (#8)
    state.playerConnections.forEach((conn) => {
      if (conn && conn.open) {
        try { conn.send({ type: 'ping', t: now }); } catch (e) {}
      }
    });
    // Detect silent peers -> DNF (#8)
    Object.entries(state.lastPingFrom).forEach(([peerId, last]) => {
      if (now - last > PEER_TIMEOUT) {
        const opp = state.opponentCars[peerId];
        if (opp && !opp.dnf) {
          opp.dnf = true;
          opp.raceFinished = true;
          if (opp.model) opp.model.visible = false;
          warn(`Peer ${peerId} timed out -> DNF`);
          getFinishTimes()[peerId] = 'DNF';
          refreshLeaderboard();
          // Host migration (#9): if the host disconnected, elect a new one.
          if (peerId === state.hostId) handleHostLoss();
        }
      }
    });
  }, HEARTBEAT_INTERVAL);
}

// Host migration (#9): deterministically elect the lowest surviving peer id as
// the new host. If that's us, take over broadcasting.
function handleHostLoss() {
  const survivors = state.allPlayers
    .map((p) => p.id)
    .filter((id) => id === state.peer.id || (state.opponentCars[id] && !state.opponentCars[id].dnf));
  survivors.sort();
  const newHostId = survivors[0];
  if (!newHostId) return;
  state.hostId = newHostId;
  if (newHostId === state.peer.id && !state.isHost) {
    state.isHost = true;
    log('Elected as new host after migration');
    if (state.onHostMigrated) state.onHostMigrated(true);
  } else {
    if (state.onHostMigrated) state.onHostMigrated(false);
  }
}

function setupMessageHandlers(conn, gameState) {
  conn.on('data', (data) => {
    try {
      // Binary transform fast-path (#2)
      if (isBinaryTransform(data)) {
        const decoded = decodeTransform(data);
        handleTransform(conn.peer, decoded);
        return;
      }
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'ping':
          state.lastPingFrom[conn.peer] = Date.now();
          try { conn.send({ type: 'pong', t: data.t }); } catch (e) {}
          break;
        case 'pong':
          state.lastPingFrom[conn.peer] = Date.now();
          break;
        case 'carUpdate':
          // Guest -> host transform (JSON fallback). Host records + rebroadcasts.
          if (state.isHost) {
            recordHostProgress(conn.peer, data);
          }
          handleTransform(conn.peer, normalizeJsonTransform(data));
          break;
        case 'carUpdateAll':
          if (!state.isHost && data.cars) {
            Object.entries(data.cars).forEach(([pid, carData]) => {
              if (pid === state.peer.id) return;
              handleTransform(pid, carData);
            });
          }
          break;
        case 'countdownStart':
          // Absolute-timestamp countdown sync (#4)
          if (typeof data.startAt === 'number' && window.startCountdownAt) {
            window.startCountdownAt(data.startAt);
          } else if (window.startCountdown) {
            window.startCountdown();
          }
          break;
        case 'raceStart':
          window.raceState.raceStarted = true;
          break;
        case 'finishResult':
          // Host-authoritative finish time (#3): only the host may set these.
          if (conn.peer === state.hostId && data.peerId && data.finishTime) {
            const ft = sanitizePreciseTime(data.finishTime);
            if (ft) {
              getFinishTimes()[data.peerId] = ft;
              const opp = state.opponentCars[data.peerId];
              if (opp) opp.raceFinished = true;
              refreshLeaderboard();
            }
          }
          break;
        default:
          break;
      }
      state.lastPingFrom[conn.peer] = Date.now();
    } catch (err) {
      error('Error processing message:', err);
    }
  });

  conn.on('close', () => {
    log('Connection closed:', conn.peer);
    state.playerConnections = state.playerConnections.filter((c) => c.peer !== conn.peer);
    const opp = state.opponentCars[conn.peer];
    if (opp) { opp.dnf = true; opp.raceFinished = true; if (opp.model) opp.model.visible = false; }
    getFinishTimes()[conn.peer] = 'DNF';
    if (conn.peer === state.hostId) handleHostLoss();
    refreshLeaderboard();
  });

  conn.on('error', (err) => error('Connection error with', conn.peer, ':', err));
}

function normalizeJsonTransform(data) {
  return {
    position: data.position || {},
    quaternion: data.quaternion || {},
    gateIndex: data.raceProgress ? data.raceProgress.currentGateIndex : 0,
    distanceToNextGate: data.raceProgress ? data.raceProgress.distanceToNextGate : 1e6,
    finished: false,
  };
}

// Host-authoritative gate progression tracking (#3). The host derives finish
// times from the gate-progression stream it already receives and rejects
// out-of-order jumps. Peers can no longer simply self-report a winning time.
function recordHostProgress(peerId, data) {
  if (!state.raceStartAt) return;
  const gp = state.gateProgress[peerId] || { gateIndex: 0, updatedAt: 0, finishMs: null };
  let claimed = 0;
  if (data.raceProgress && Number.isFinite(Number(data.raceProgress.currentGateIndex))) {
    claimed = Math.floor(Number(data.raceProgress.currentGateIndex));
  }
  // Only allow advancing by at most 1 gate at a time, and never backwards past
  // what we've already recorded (rejects out-of-order jumps).
  if (claimed === gp.gateIndex + 1) {
    gp.gateIndex = claimed;
    gp.updatedAt = Date.now();
    const gd = getGateData(); const totalGates = gd ? gd.totalGates : 8;
    if (gp.gateIndex >= totalGates && gp.finishMs == null) {
      gp.finishMs = Date.now() - state.raceStartAt;
      const timeStr = formatTime(gp.finishMs);
      getFinishTimes()[peerId] = timeStr;
      // Broadcast the authoritative result to everyone (#3)
      broadcastFinishResult(peerId, timeStr);
      refreshLeaderboard();
      log(`Host recorded finish for ${peerId}: ${timeStr}`);
    }
  } else if (claimed > gp.gateIndex) {
    // Suspicious multi-gate jump - ignore, keep our recorded value.
    warn(`Rejected out-of-order gate jump from ${peerId}: ${gp.gateIndex} -> ${claimed}`);
  }
  state.gateProgress[peerId] = gp;
}

function broadcastFinishResult(peerId, timeStr) {
  state.playerConnections.forEach((conn) => {
    if (conn && conn.open) {
      try { conn.send({ type: 'finishResult', peerId, finishTime: timeStr }); } catch (e) {}
    }
  });
}

function loadOpponentCarModels(scene) {
  if (!state.gameConfig || !state.gameConfig.players) return;
  const myPlayerId = localStorage.getItem('myPlayerId');
  state.gameConfig.players.forEach((player) => {
    if (player.id === myPlayerId) return;
    loadOpponentCarModel(player.id, scene);
  });
}

function tintOpponent(model, colorName) {
  const hex = CAR_TINT[colorName] || CAR_TINT.red;
  const color = new THREE.Color(hex);
  model.traverse((node) => {
    if (node.isMesh) {
      const name = (node.name || '').toLowerCase();
      const isWheel = name.includes('wheel') || name.includes('tire') || name.includes('tyre');
      node.material = node.material.clone();
      node.material.transparent = true;
      node.material.opacity = 0.6;
      node.material.depthWrite = false;
      node.castShadow = false;
      if (!isWheel && node.material.color) node.material.color.copy(color);
    }
  });
}

function loadOpponentCarModel(playerId, scene) {
  const loader = createGLTFLoader(window.loadingManager);
  // Name/color come from the trusted roster, NOT per-packet fields (#11)
  const info = trustedPlayer(playerId) || {};
  const playerName = sanitizePlayerName(info.name);
  const playerColor = sanitizePlayerColor(info.playerColor);

  const finalize = (gltf, useTint) => {
    const model = gltf.scene.clone();
    model.scale.set(4, 4, 4);
    model.position.set(0, 2, 0);
    if (useTint) {
      tintOpponent(model, playerColor);
    } else {
      model.traverse((node) => {
        if (node.isMesh) {
          node.material = node.material.clone();
          node.material.transparent = true;
          node.material.opacity = 0.6;
          node.material.depthWrite = false;
          node.castShadow = false;
        }
      });
    }
    // The model is scaled 4x, so child transforms are multiplied by 4: use
    // fractional local values for a sensible world-space label size (#1).
    const nameSprite = createNameSprite(playerName, playerColor);
    nameSprite.position.y = 0.55;
    nameSprite.scale.set(1.6, 0.4, 1);
    model.add(nameSprite);
    model.visible = false;
    scene.add(model);

    state.opponentCars[playerId] = {
      model,
      nameLabel: nameSprite,
      name: playerName,
      color: playerColor,
      lastUpdate: Date.now(),
      buffer: new SnapshotBuffer(), // interpolation buffer (#1)
      _pos: new THREE.Vector3(),
      _quat: new THREE.Quaternion(),
      raceProgress: { currentGateIndex: 0, distanceToNextGate: 1e6 },
      dnf: false,
    };
  };

  // Try the single base model + tint first (#22), then fall back to colored GLB.
  loader.load('/models/car.glb',
    (gltf) => finalize(gltf, true),
    undefined,
    () => {
      loader.load(`/models/car_${playerColor}.glb`,
        (gltf) => finalize(gltf, false),
        undefined,
        () => loader.load('/models/car_red.glb', (gltf) => finalize(gltf, false), undefined,
          (err) => error('Error loading opponent car model:', err))
      );
    }
  );
}

// Push a decoded transform into the opponent's snapshot buffer (#1). We no
// longer write straight to model.position - the render loop samples the buffer.
function handleTransform(playerId, data) {
  const opponent = state.opponentCars[playerId];
  if (!opponent || !opponent.model || !data) return;
  if (opponent.dnf) return;

  opponent.lastUpdate = Date.now();
  state.lastPingFrom[playerId] = Date.now();

  const position = (typeof data.position === 'object' && data.position) ? data.position : {};
  const quaternion = (typeof data.quaternion === 'object' && data.quaternion) ? data.quaternion : {};

  const safePos = {
    x: isFiniteNumber(position.x) ? position.x : 0,
    y: isFiniteNumber(position.y) ? position.y : 0,
    z: isFiniteNumber(position.z) ? position.z : 0,
  };
  const safeQuat = {
    x: isFiniteNumber(quaternion.x) ? quaternion.x : 0,
    y: isFiniteNumber(quaternion.y) ? quaternion.y : 0,
    z: isFiniteNumber(quaternion.z) ? quaternion.z : 0,
    w: isFiniteNumber(quaternion.w) ? quaternion.w : 1,
  };

  opponent.buffer.add({ position: safePos, quaternion: safeQuat, t: Date.now() });

  // Race progress for the leaderboard.
  const gi = Number(data.gateIndex);
  opponent.raceProgress.currentGateIndex = Number.isFinite(gi) && gi >= 0 ? Math.floor(gi) : opponent.raceProgress.currentGateIndex;
  const dn = Number(data.distanceToNextGate);
  opponent.raceProgress.distanceToNextGate = Number.isFinite(dn) && dn >= 0 ? Math.min(dn, 1e6) : opponent.raceProgress.distanceToNextGate;
}

// Called every render frame to advance interpolation (#1).
export function updateOpponentInterpolation(now = Date.now()) {
  Object.values(state.opponentCars).forEach((opp) => {
    if (!opp.model || opp.dnf) return;
    if (opp.buffer.sample(opp._pos, opp._quat, now, INTERP_DELAY_MS)) {
      opp.model.visible = true;
      opp.model.position.copy(opp._pos);
      opp.model.quaternion.copy(opp._quat);
    }
  });
}

export function updateMarkers() {
  Object.values(state.opponentCars).forEach((opponent) => {
    if (opponent.model && opponent.model.visible && opponent.nameLabel) {
      opponent.nameLabel.visible = true;
    }
  });
}

// Called by the game loop when the host locks in the absolute race start time.
export function setRaceStartAt(ts) {
  state.raceStartAt = ts;
}

// Send local car data. Now sends a compact binary transform (#2) at ~18 Hz.
export function sendCarData(gameState) {
  if (!gameState.carModel || !state.peer) return;
  const myPlayerId = localStorage.getItem('myPlayerId');

  const gateData = getGateData();
  const currentGateIndex = gateData ? gateData.currentGateIndex : 0;

  let distanceToNextGate = 1e6;
  try {
    if (gateData && gateData.gates && gateData.gates.length > currentGateIndex && gameState.carModel) {
      const nextGate = gateData.gates[currentGateIndex];
      if (nextGate) {
        const gatePos = new THREE.Vector3();
        nextGate.getWorldPosition(gatePos);
        const dx = gameState.carModel.position.x - gatePos.x;
        const dy = gameState.carModel.position.y - gatePos.y;
        const dz = gameState.carModel.position.z - gatePos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (isFinite(d)) distanceToNextGate = Math.min(d, 1e6);
      }
    }
  } catch (err) { /* ignore */ }

  const pos = gameState.carModel.position;
  const quat = gameState.carModel.quaternion;
  const transformBuf = encodeTransform({
    position: pos,
    quaternion: quat,
    gateIndex: currentGateIndex,
    distanceToNextGate,
    finished: !!window.raceState.raceFinished,
  });

  if (state.isHost) {
    // Store host's own decoded transform for rebroadcast.
    state.allCarsData[myPlayerId] = {
      position: { x: pos.x, y: pos.y, z: pos.z },
      quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
      gateIndex: currentGateIndex,
      distanceToNextGate,
    };
    // Host derives its own finish from gate progression too (#3).
    recordHostProgress(myPlayerId, { raceProgress: { currentGateIndex } });

    if (Date.now() - state.lastBroadcastTime >= BROADCAST_INTERVAL) {
      broadcastAllCarsData();
    }
  } else {
    // Guests send compact binary to host at ~18 Hz.
    if (Date.now() - state.lastBroadcastTime >= BROADCAST_INTERVAL) {
      state.lastBroadcastTime = Date.now();
      state.playerConnections.forEach((conn) => {
        if (conn && conn.open) {
          try { conn.send(transformBuf); } catch (err) { error('Error sending car data:', err); }
        }
      });
    }
  }
}

export function checkAllPlayersConnected() {
  if (!state.gameConfig || !state.gameConfig.players) return false;
  const myPlayerId = localStorage.getItem('myPlayerId');
  let connectedCount = 1;
  for (const player of state.gameConfig.players) {
    if (player.id === myPlayerId) continue;
    if (state.playerConnections.some((conn) => conn.peer === player.id)) connectedCount++;
  }
  return connectedCount === state.gameConfig.players.length;
}

export function broadcastRaceStart() {
  state.playerConnections.forEach((conn) => {
    if (conn && conn.open) {
      try { conn.send({ type: 'raceStart', timestamp: Date.now() }); } catch (err) { error(err); }
    }
  });
}

// Absolute-timestamp countdown (#4): broadcast a start instant everyone counts
// down to, instead of a fire-and-forget signal that spreads by latency.
export function broadcastCountdownStart(startAt) {
  if (state.playerConnections.length === 0) {
    warn('No connections to broadcast countdown to');
    return;
  }
  state.playerConnections.forEach((conn) => {
    if (conn && conn.open) {
      try { conn.send({ type: 'countdownStart', startAt }); } catch (err) { error(err); }
    }
  });
}

function broadcastAllCarsData() {
  if (!state.isHost || state.playerConnections.length === 0) return;
  const broadcastPacket = {
    type: 'carUpdateAll',
    timestamp: Date.now(),
    cars: state.allCarsData,
  };
  state.playerConnections.forEach((conn) => {
    if (conn && conn.open) {
      try { conn.send(broadcastPacket); } catch (err) { error('Error broadcasting cars:', err); }
    }
  });
  state.lastBroadcastTime = Date.now();
}
