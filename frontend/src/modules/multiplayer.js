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
  allPlayers: [],
  allCarsData: {}, // Add this property to store all car positions
  lastBroadcastTime: 0 // Track when we last broadcasted
};

// Add these variables at the top of the file
let connectionRetryCount = 0;
const MAX_RETRIES = 15; // Try for 30 seconds

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
            
            // Define a function to attempt connection with retry
            function attemptConnection() {
              console.log(`Connection attempt ${connectionRetryCount + 1} to host: ${hostPlayer.id}`);
              
              // Connect to host
              const conn = state.peer.connect(hostPlayer.id);
              let connectionSuccessful = false;
              
              // Set a timeout to retry if connection doesn't complete
              const connectionTimeout = setTimeout(() => {
                if (!connectionSuccessful) {
                  console.log("Connection attempt timed out");
                  connectionRetryCount++;
                  if (connectionRetryCount < MAX_RETRIES) {
                    console.log(`Retrying connection in 2 seconds... (attempt ${connectionRetryCount + 1})`);
                    setTimeout(attemptConnection, 2000);
                  } else {
                    console.error(`Failed to connect after ${MAX_RETRIES} attempts`);
                  }
                }
              }, 5000); // Wait 5 seconds for connection to complete
              
              conn.on('open', () => {
                console.log('Connected to host!');
                connectionSuccessful = true;
                clearTimeout(connectionTimeout);
                connectionRetryCount = 0; // Reset counter on success
                state.playerConnections.push(conn);
                setupMessageHandlers(conn, gameState);
                loadOpponentCarModels(gameState.scene);
              });
              
              conn.on('error', (err) => {
                console.error('Error connecting to host:', err);
                // Error handling already covered by the timeout
              });
            }
            
            // Start the first connection attempt
            attemptConnection();
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
  
  // Update the message handler in setupMessageHandlers function
  conn.on('data', (data) => {
    try {
      if (data.type === 'connectionTest') {
        console.log('Connection test message received!');
        // Send acknowledgment
        conn.send({
          type: 'connectionTestAck',
          message: 'Test received!',
          timestamp: Date.now()
        });
      } else if (data.type === 'carUpdate') {
        // If host, store the car data for broadcasting later
        if (state.isHost) {
          state.allCarsData[conn.peer] = data;
        }
        // Update the opponent car position locally
        updateOpponentCarPosition(conn.peer, data);
      } else if (data.type === 'carUpdateAll') {
        // Client receives all car data from host
        if (!state.isHost && data.cars) {
          console.log(`Received positions for ${Object.keys(data.cars).length} cars`);
          // Update all car positions
          Object.entries(data.cars).forEach(([playerId, carData]) => {
            // Skip my own car
            if (playerId === state.peer.id) return;
            
            // Update this opponent car
            updateOpponentCarPosition(playerId, carData);
          });
        }
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
  context.font = 'bold 32px Poppins';
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
  
  // Store race progress data with detailed logging
  if (data.raceProgress) {
    // Create a fresh race progress object with explicit property assignments
    if (!opponent.raceProgress) {
      opponent.raceProgress = {};
    }
    
    opponent.raceProgress.currentGateIndex = Number(data.raceProgress.currentGateIndex);
    opponent.raceProgress.distanceToNextGate = Number(data.raceProgress.distanceToNextGate);
    
    if (data.playerName) {
      opponent.name = data.playerName;
    }
    if (data.playerColor) {
      opponent.color = data.playerColor;
    }
  }
  
  // Check if this player has just finished the race
  if (data.finishTime && window.playerFinishTimes) {
    console.log(`Received finish time for ${data.playerName || playerId}: ${data.finishTime}`);
    
    // Store the finish time in our permanent tracker
    window.playerFinishTimes[playerId] = data.finishTime;
    
    // Also update this opponent as having finished the race
    opponent.raceFinished = true;
    
    // Mark the last gate as passed for this opponent
    if (opponent.raceProgress) {
      if (window.gateData && window.gateData.totalGates) {
        opponent.raceProgress.currentGateIndex = window.gateData.totalGates;
      }
    }
    
    // Force the leaderboard to update
    setTimeout(() => {
      if (window.updateLeaderboard) {
        window.updateLeaderboard();
      }
    }, 100);
  }
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

// Modify the sendCarData function
export function sendCarData(gameState) {
  if (!gameState.carModel || !state.peer) return;
  
  // Get the current player ID
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  // Get player name and color from game config
  let playerName = 'Player';
  let playerColor = 'red';
  
  if (state.gameConfig && state.gameConfig.players) {
    const playerInfo = state.gameConfig.players.find(p => p.id === myPlayerId);
    if (playerInfo) {
      playerName = playerInfo.name || 'Player';
      playerColor = playerInfo.playerColor || 'red';
    }
  }
  
  // Get gate progress information from global window state
  const gateData = window.gateData;
  const currentGateIndex = gateData ? gateData.currentGateIndex : 0;
  
  // Calculate distance to next gate if possible - with safety checks
  let distanceToNextGate = 1000000; // Use a large but safe value instead of Number.MAX_VALUE
  
  try {
    if (gateData && gateData.gates && gateData.gates.length > currentGateIndex && gameState.carModel) {
      const nextGate = gateData.gates[currentGateIndex];
      if (nextGate) {
        const gatePos = new THREE.Vector3();
        nextGate.getWorldPosition(gatePos);
        
        // Check for valid position values
        if (isFinite(gatePos.x) && isFinite(gatePos.y) && isFinite(gatePos.z) &&
            isFinite(gameState.carModel.position.x) && 
            isFinite(gameState.carModel.position.y) && 
            isFinite(gameState.carModel.position.z)) {
            
          const dx = gameState.carModel.position.x - gatePos.x;
          const dy = gameState.carModel.position.y - gatePos.y;
          const dz = gameState.carModel.position.z - gatePos.z;
          
          // Calculate distance and round to avoid precision issues
          const calculatedDistance = Math.round((dx * dx + dy * dy + dz * dz) * 100) / 100;
          
          if (isFinite(calculatedDistance) && !isNaN(calculatedDistance)) {
            distanceToNextGate = Math.min(calculatedDistance, 1000000);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error calculating distance to gate:', err);
  }
  
  // Ensure all position and quaternion values are valid numbers
  const safePosition = {
    x: isFinite(gameState.carModel.position.x) ? Number(gameState.carModel.position.x.toFixed(2)) : 0,
    y: isFinite(gameState.carModel.position.y) ? Number(gameState.carModel.position.y.toFixed(2)) : 0,
    z: isFinite(gameState.carModel.position.z) ? Number(gameState.carModel.position.z.toFixed(2)) : 0
  };
  
  const safeQuaternion = {
    x: isFinite(gameState.carModel.quaternion.x) ? Number(gameState.carModel.quaternion.x.toFixed(4)) : 0,
    y: isFinite(gameState.carModel.quaternion.y) ? Number(gameState.carModel.quaternion.y.toFixed(4)) : 0,
    z: isFinite(gameState.carModel.quaternion.z) ? Number(gameState.carModel.quaternion.z.toFixed(4)) : 0,
    w: isFinite(gameState.carModel.quaternion.w) ? Number(gameState.carModel.quaternion.w.toFixed(4)) : 1
  };
  
  // Prepare the data packet with safe values
  const carData = {
    type: 'carUpdate',
    playerId: state.peer.id,
    playerName: playerName,
    playerColor: playerColor,
    position: safePosition,
    quaternion: safeQuaternion,
    // Add race progress data with safe values
    raceProgress: {
      currentGateIndex: currentGateIndex,
      distanceToNextGate: distanceToNextGate
    }
  };
  
  // Include finish time if the player has finished the race
  if (window.raceState.raceFinished && window.playerFinishTimes) {
    // Get the finish time from our permanent store
    const myFinishTime = window.playerFinishTimes[myPlayerId];
    if (myFinishTime) {
      carData.finishTime = myFinishTime;
      console.log("Sending finish time in car data:", myFinishTime);
    }
  }
  
  // Handle differently based on if we're host or client
  if (state.isHost) {
    // Store host's own car data for broadcasting
    state.allCarsData[myPlayerId] = carData;
    
    // Broadcast all car data at a reasonable interval (50ms = 20 updates/sec)
    if (!state.lastBroadcastTime || Date.now() - state.lastBroadcastTime >= 50) {
      broadcastAllCarsData();
    }
  } else {
    // For clients, just send their own car data to the host
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
        conn.send(message);
        successCount++;
      } else {
        console.error(`Connection ${index} is not open! State:`, conn ? conn.open : 'null');
      }
    } catch (err) {
      console.error(`Error sending countdown to player ${index}:`, err);
    }
  });
  
}

// Add this function to broadcast all car positions from host to clients
function broadcastAllCarsData() {
  if (!state.isHost || state.playerConnections.length === 0) return;
  
  // Create the broadcast packet
  const broadcastPacket = {
    type: 'carUpdateAll',
    timestamp: Date.now(),
    cars: state.allCarsData
  };
  
  // Send to all connected players
  state.playerConnections.forEach(conn => {
    try {
      if (conn && conn.open) {
        conn.send(broadcastPacket);
      }
    } catch (err) {
      console.error('Error broadcasting all cars data:', err);
    }
  });
  
  // Update the last broadcast time
  state.lastBroadcastTime = Date.now();
}