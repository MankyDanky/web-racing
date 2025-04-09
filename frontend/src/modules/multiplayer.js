import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Peer from 'peerjs';

// Module state
const state = {
  peer: null,
  playerConnections: [],
  opponentCars: {},
  gameConfig: null,
  isHost: false,
  allPlayers: []
};

// Initialize multiplayer from game config
export function initMultiplayer(gameState) {
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      state.gameConfig = JSON.parse(savedConfig);
      
      // Check if we're the host
      const myPlayerId = localStorage.getItem('myPlayerId');
      state.isHost = state.gameConfig.players.some(player => player.id === myPlayerId && player.isHost);
      
      console.log('Game config loaded:', state.gameConfig);
      console.log('Playing as host:', state.isHost);
      
      // Store player list
      state.allPlayers = state.gameConfig.players;
    }
  } catch (e) {
    console.error('Error loading game config:', e);
  }
  
  // Initialize peer connection if we have a game config
  if (state.gameConfig) {
    initPeerConnection(gameState);
  }
  
  // Add these two lines to attach methods to the state object
  state.checkAllPlayersConnected = checkAllPlayersConnected;
  state.broadcastRaceStart = broadcastRaceStart;
  state.broadcastCountdownStart = broadcastCountdownStart; // Add this line
  
  return state;
}

// Fix how connections are established and message handlers are attached

function initPeerConnection(gameState) {
  // Get the player ID that was stored during lobby creation
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  if (!myPlayerId) {
    console.error('No player ID found in localStorage');
    return;
  }
  
  // If we have game config, use that to establish connections
  if (state.gameConfig && state.gameConfig.players && state.gameConfig.players.length > 0) {
    console.log('Initializing peer connection with game config', state.gameConfig);
    
    // Create a new peer with the ORIGINAL ID, but with a slight delay
    setTimeout(() => {
      state.peer = new Peer(myPlayerId);
      
      state.peer.on('open', (id) => {
        console.log('Game peer connection established with ID:', id);
        
        if (state.isHost) {
          console.log('Playing as host - waiting for player connections');
          
          // Host waits for connections from players
          state.peer.on('connection', (conn) => {
            console.log('Player connected:', conn.peer);
            
            // CRITICAL FIX: Wait for connection to be fully ready
            conn.on('open', () => {
              console.log('Connection to player fully established:', conn.peer);
              state.playerConnections.push(conn);
              setupMessageHandlers(conn, gameState);
            });
          });
          
          // Load opponent car models
          loadOpponentCarModels(gameState.scene);
        } else {
          console.log('Playing as guest - connecting to host');
          
          // Find the host player
          const hostPlayer = state.gameConfig.players.find(player => player.isHost);
          
          if (hostPlayer) {
            console.log('Connecting to host:', hostPlayer.id);
            
            // Connect to host using original ID
            const conn = state.peer.connect(hostPlayer.id);
            
            conn.on('open', () => {
              console.log('Connected to host!');
              state.playerConnections.push(conn);
              setupMessageHandlers(conn, gameState);
              loadOpponentCarModels(gameState.scene);
            });
            
            conn.on('error', (err) => {
              console.error('Error connecting to host:', err);
            });
          } else {
            console.error('No host player found in game config');
          }
        }
      });
      
      state.peer.on('error', (err) => {
        console.error('Peer connection error:', err);
        if (err.type === 'unavailable-id') {
          console.log('ID is taken, waiting 2 seconds before retrying...');
          // Try again with a longer delay
          setTimeout(() => initPeerConnection(gameState), 2000);
        }
      });
    }, 1000); // Add a 1-second delay before creating the peer
  } else {
    console.warn('No game config found - multiplayer disabled');
  }
}

// Move the message handling to a separate function with extra debugging
function setupMessageHandlers(conn, gameState) {
  console.log('Setting up message handlers for connection:', conn.peer);
  
  // Test message send and receive
  if (!state.isHost) {
    // If client, send a test message to host
    try {
      conn.send({
        type: 'connectionTest',
        message: 'Hello from client!',
        timestamp: Date.now()
      });
      console.log('Test message sent to host');
    } catch (e) {
      console.error('Failed to send test message:', e);
    }
  }
  
  // Handle incoming data with enhanced logging
  conn.on('data', (data) => {
    try {
      console.log(`MESSAGE RECEIVED from ${conn.peer}:`, data);
      
      if (data.type === 'connectionTest') {
        console.log('Connection test message received!');
        // Send acknowledgment
        conn.send({
          type: 'connectionTestAck',
          message: 'Test received!',
          timestamp: Date.now()
        });
      } else if (data.type === 'carUpdate') {
        // Update the appropriate opponent car
        updateOpponentCarPosition(conn.peer, data);
      } else if (data.type === 'countdownStart') {
        console.log("🚦 COUNTDOWN START RECEIVED - starting countdown! 🚦");
        // Start countdown for all players simultaneously
        if (window.startCountdown) {
          window.startCountdown();
        } else {
          console.error('window.startCountdown not available!');
        }
      } else if (data.type === 'raceStart') {
        console.log("RACE START RECEIVED - force starting race!");
        // Force race to start if countdown was started but race hasn't started yet
        window.raceState.raceStarted = true;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });
  
  // Client data relay handling for host
  if (state.isHost) {
    console.log("Setting up host message relay for player:", conn.peer);
  }
  
  // Handle connection closing
  conn.on('close', () => {
    console.log('Connection closed:', conn.peer);
    state.playerConnections = state.playerConnections.filter(c => c.peer !== conn.peer);
  });
  
  // Handle connection errors
  conn.on('error', (err) => {
    console.error('Connection error with', conn.peer, ':', err);
  });
}

// Improved player connection handler
function handlePlayerConnection(conn, gameState) {
  // Handle incoming data from any player
  conn.on('data', (data) => {
    console.log('Received data from player:', conn.peer, data);
    if (data.type === 'carUpdate') {
      // Update the appropriate opponent car
      updateOpponentCarPosition(conn.peer, data);
    } else if (data.type === 'countdownStart') {
        console.log("Received countdown start from player:", conn.peer);
      // Start countdown for all players simultaneously
      if (window.startCountdown) {
        window.startCountdown();
      }
    } else if (data.type === 'raceStart') {
      // Fallback/backup for race start message
      if (!window.raceState.raceStarted) {
        // Force race to start if countdown was started but race hasn't started yet
        window.raceState.raceStarted = true;
      }
    }
  });
  
  // If we're the host, we need to relay updates to all players
  if (state.isHost) {
    conn.on('data', (data) => {
      // Relay this player's position to all other players
      state.playerConnections.forEach(otherConn => {
        if (otherConn.peer !== conn.peer) {
          otherConn.send(data);
        }
      });
    });
  }
  
  // Handle connection closing
  conn.on('close', () => {
    console.log('Player disconnected:', conn.peer);
    // Remove from connections list
    state.playerConnections = state.playerConnections.filter(c => c.peer !== conn.peer);
  });
  
  // Send initial state to the newly connected player
  if (gameState.carModel && state.isHost) {
    conn.send({
      type: 'carUpdate',
      playerId: state.peer.id,
      position: {
        x: gameState.carModel.position.x,
        y: gameState.carModel.position.y,
        z: gameState.carModel.position.z
      },
      quaternion: {
        x: gameState.carModel.quaternion.x,
        y: gameState.carModel.quaternion.y,
        z: gameState.carModel.quaternion.z,
        w: gameState.carModel.quaternion.w
      }
    });
  }
}

// Load opponent car models for all players
function loadOpponentCarModels(scene) {
  if (!state.gameConfig || !state.gameConfig.players) return;
  
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  state.gameConfig.players.forEach(player => {
    // Don't create a model for ourselves
    if (player.id === myPlayerId) return;
    
    // Use the original player ID
    loadOpponentCarModel(player.id, scene);
  });
}

// Load opponent car model with appropriate color
function loadOpponentCarModel(playerId, scene) {
  const loader = new GLTFLoader();
  
  // Find player info from gameConfig
  let playerName = 'Player';
  let playerColor = 'red'; // Default color
  
  if (state.gameConfig && state.gameConfig.players) {
    const playerInfo = state.gameConfig.players.find(p => p.id === playerId);
    if (playerInfo) {
      playerName = playerInfo.name || 'Player';
      playerColor = playerInfo.playerColor || 'red';
    }
  }
  
  // Load the appropriate colored car model
  loader.load(
    `/models/car_${playerColor}.glb`,
    (gltf) => {
      const opponentModel = gltf.scene.clone();
      
      // Adjust model scale and position
      opponentModel.scale.set(4, 4, 4);
      opponentModel.position.set(0, 2, 0);
      
      // Make car semi-transparent
      opponentModel.traverse((node) => {
        if (node.isMesh) {
          node.material = node.material.clone();
          node.material.transparent = true;
          node.material.opacity = 0.5;
          node.material.depthWrite = false;
          node.castShadow = false;
        }
      });
      
      // Create text sprite for player name
      const nameSprite = createTextSprite(playerName);
      nameSprite.position.y = 0.3; 
      nameSprite.scale.set(1, 0.25, 1);
      opponentModel.add(nameSprite); 
      
      console.log(`Added name label for player: ${playerName} (Car color: ${playerColor})`);
      
      // Make invisible initially
      opponentModel.visible = false;
      
      // Add to scene
      scene.add(opponentModel);
      
      // Store in opponent cars collection
      state.opponentCars[playerId] = {
        model: opponentModel,
        nameLabel: nameSprite,
        name: playerName,
        color: playerColor,
        lastUpdate: Date.now()
      };
    },
    undefined,
    (error) => {
      console.error(`Error loading ${playerColor} opponent car model:`, error);
      // Fallback to red model if the requested color fails to load
      if (playerColor !== 'red') {
        console.log('Falling back to red opponent car model');
        loader.load(
          '/models/car_red.glb',
          (gltf) => {
            // Same handling as above, but with red model
            const opponentModel = gltf.scene.clone();
            opponentModel.scale.set(4, 4, 4);
            opponentModel.position.set(0, 2, 0);
            
            opponentModel.traverse((node) => {
              if (node.isMesh) {
                node.material = node.material.clone();
                node.material.transparent = true;
                node.material.opacity = 0.5;
                node.material.depthWrite = false;
                node.castShadow = false;
              }
            });
            
            const nameSprite = createTextSprite(playerName);
            nameSprite.position.y = 0.3;
            nameSprite.scale.set(1, 0.25, 1);
            opponentModel.add(nameSprite);
            
            opponentModel.visible = false;
            scene.add(opponentModel);
            
            state.opponentCars[playerId] = {
              model: opponentModel,
              nameLabel: nameSprite,
              name: playerName,
              color: 'red',
              lastUpdate: Date.now()
            };
          },
          undefined,
          (err) => console.error('Error loading fallback car model:', err)
        );
      }
    }
  );
}

// Function to create a text sprite
function createTextSprite(text) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  
  // Clear canvas
  context.clearRect(0, 0, canvas.width, canvas.height);
  
  // Text style
  context.font = 'bold 32px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  
  // Draw text outline
  context.strokeStyle = 'black';
  context.lineWidth = 4;
  context.strokeText(text, canvas.width / 2, canvas.height / 2);
  
  // Draw text fill
  context.fillStyle = 'white';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // Create texture from canvas
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  
  // Create sprite material
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true
  });
  
  // Create sprite
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 1.5, 1); // Adjust size as needed
  
  return sprite;
}

// Update a specific opponent's car position
export function updateOpponentCarPosition(playerId, data) {
  // Just look up by the original ID
  let opponent = state.opponentCars[playerId];
  
  if (!opponent || !opponent.model) {
    console.log(`No opponent model found for ID: ${playerId}`);
    return;
  }
  
  // Update last seen timestamp
  opponent.lastUpdate = Date.now();
  
  // Make visible
  opponent.model.visible = true;
  
  // Update position and rotation
  opponent.model.position.set(
    data.position.x, 
    data.position.y, 
    data.position.z
  );
  
  opponent.model.quaternion.set(
    data.quaternion.x,
    data.quaternion.y,
    data.quaternion.z,
    data.quaternion.w
  );
}

// Update the markers (player name labels)
export function updateMarkers() {
  // Loop through all opponent cars and ensure name labels are visible
  Object.values(state.opponentCars).forEach(opponent => {
    if (opponent.model && opponent.model.visible && opponent.nameLabel) {
      // Make name label visible
      opponent.nameLabel.visible = true;
      
      // Make sure the text always faces the camera (this happens automatically with sprites)
    }
  });
}

// Send car position data to all connected players
export function sendCarData(gameState) {
  if (!gameState.carModel || !state.peer || state.playerConnections.length === 0) return;
  
  // Prepare the data packet
  const carData = {
    type: 'carUpdate',
    playerId: state.peer.id,
    position: {
      x: gameState.carModel.position.x,
      y: gameState.carModel.position.y,
      z: gameState.carModel.position.z
    },
    quaternion: {
      x: gameState.carModel.quaternion.x,
      y: gameState.carModel.quaternion.y,
      z: gameState.carModel.quaternion.z,
      w: gameState.carModel.quaternion.w
    }
  };
  
  // Send to all connected players
  state.playerConnections.forEach(conn => {
    try {
      // Check if connection is open before sending
      if (conn && conn.open) {
        conn.send(carData);
      }
    } catch (err) {
      console.error('Error sending car data:', err);
    }
  });
}

// Add method to check if all players are connected
export function checkAllPlayersConnected() {
  if (!state.gameConfig || !state.gameConfig.players) return false;
  
  const myPlayerId = localStorage.getItem('myPlayerId');
  let connectedCount = 1; // Count myself
  
  // Count all established connections
  for (const player of state.gameConfig.players) {
    if (player.id === myPlayerId) continue; // Skip myself
    
    // Check if this player is connected
    if (state.playerConnections.some(conn => conn.peer === player.id)) {
      connectedCount++;
    }
  }
  
  return connectedCount === state.gameConfig.players.length;
}

// Add method to broadcast race start
export function broadcastRaceStart() {
  state.playerConnections.forEach(conn => {
    try {
      if (conn && conn.open) {
        conn.send({
          type: 'raceStart',
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('Error sending race start event:', err);
    }
  });
}

// Completely revise the broadcast functions for better reliability
export function broadcastCountdownStart() {
  console.log(`🔴 Broadcasting countdown start to ${state.playerConnections.length} players...`);
  
  if (state.playerConnections.length === 0) {
    console.error('No player connections available for broadcasting!');
    return;
  }
  
  let successCount = 0;
  state.playerConnections.forEach((conn, index) => {
    try {
      if (conn && conn.open) {
        const message = {
          type: 'countdownStart',
          timestamp: Date.now()
        };
        console.log(`Sending countdown to player ${index + 1}:`, conn.peer);
        conn.send(message);
        successCount++;
      } else {
        console.error(`Connection ${index} is not open! State:`, conn ? conn.open : 'null');
      }
    } catch (err) {
      console.error(`Error sending countdown to player ${index}:`, err);
    }
  });
  
  console.log(`Countdown broadcast attempted: ${successCount}/${state.playerConnections.length} successful`);
}