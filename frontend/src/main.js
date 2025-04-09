import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import "./style.css";
import Ammo from './lib/ammo.js';
import Peer from 'peerjs';
import { createVehicle, updateSteering, resetCarPosition, updateCarPosition } from './modules/car.js';
import { loadTrackModel, loadMapDecorations, checkGroundCollision } from './modules/track.js';

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

// Vehicle parameters
const VEHICLE_WIDTH = 2.0;
const VEHICLE_HEIGHT = 0.6;
const VEHICLE_LENGTH = 4.0;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.25;
const SUSPENSION_REST_LENGTH = 0.5;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 30;
const SUSPENSION_DAMPING = 4.5;
const SUSPENSION_COMPRESSION = 4.5;
const ROLL_INFLUENCE = 0.05;
const WHEEL_FRICTION = 150;

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
const MAX_STEERING_ANGLE = 0.25; // Maximum steering angle in radians
const STEERING_SPEED = 2;    // Speed of steering adjustment
const STEERING_RETURN_SPEED = 2; // Speed of returning to center
let currentSteeringAngle = 0;   // Current steering angle

// UI variables
let speedElement;
let needleElement;
let speedValueElement;
let currentSpeed = 0;
const MAX_SPEED_KPH = 200; // Maximum speed on the gauge

// Multiplayer variables
let peer;
let connection;
let opponentCarModel;
let opponentCarData = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  wheelPositions: []
};
let opponentCars = {};

let gates = [];
let currentGateIndex = 0;
let totalGates = 8;
let fadingGates = {};
const GATE_FADE_DURATION = 1.0; 
let _tempVector1 = new THREE.Vector3();
let currentGatePosition = new THREE.Vector3(0, 2, 0);
let currentGateQuaternion = new THREE.Quaternion();

// Initialize everything
function init() {
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
  scene.background = new THREE.Color(0x66ccff);
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
    
    initPhysics(ammo);
    
    // Load the track as a single model
    loadTrackModel(ammo, "map1", scene, physicsWorld);
    
    // Load map decorations
    loadMapDecorations("map1", scene, renderer, camera);
    
    // Load gates - add this line
    loadGates("map1");
    
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
    initPeerConnection();
    
    // Animation will start in the callback when the car is fully loaded
  });
}

// Initialize physics
function initPhysics(ammo) {
  // Create physics configuration
  const collisionConfig = new ammo.btDefaultCollisionConfiguration();
  const dispatcher = new ammo.btCollisionDispatcher(collisionConfig);
  const broadphase = new ammo.btDbvtBroadphase();
  const solver = new ammo.btSequentialImpulseConstraintSolver();
  
  // Create physics world
  physicsWorld = new ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
  physicsWorld.setGravity(new ammo.btVector3(0, -20, 0));
  
  // Create temporary transform for reuse
  tmpTrans = new ammo.btTransform();
}

// Setup key controls for vehicle
function setupKeyControls() {
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = true;
    if (event.key.toLowerCase() === 's') keyState.s = true;
    if (event.key.toLowerCase() === 'a') keyState.a = true;
    if (event.key.toLowerCase() === 'd') keyState.d = true;

    if (event.key.toLowerCase() === 'r') {
      if (window.Ammo && carBody) {
        currentSteeringAngle = resetCarPosition(window.Ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion);
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

// Update physics
function updatePhysics(deltaTime, ammo) {
  if (!vehicle || !carModel) return;
  
  // Update steering with time-based gradual changes
  currentSteeringAngle = updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle);
  
  // Get current velocity to determine if we're moving forward or backward
  const velocity = carBody.getLinearVelocity();
    // FIXED SECTION: Use Three.js for vector math instead of Ammo.js
  // Get forward direction using Three.js
  const carForward = new THREE.Vector3();
  carModel.getWorldDirection(carForward);
  
  // Convert Ammo velocity to Three.js vector
  const velocityThree = new THREE.Vector3(
    velocity.x(), 
    velocity.y(), 
    velocity.z()
  );
  
  // Calculate dot product using Three.js
  const dotForward = carForward.dot(velocityThree);
  const maxEngineForce = 4000;
  const maxBrakingForce = 50;
  let engineForce = 0;
  let brakingForce = 0;
  
  // Handle key inputs with proper braking logic
  if (keyState.w) {
    // Accelerate forward
    engineForce = maxEngineForce;
    brakingForce = 0;
  } else if (keyState.s) {
    if (dotForward > 0.1) {
      // Moving forward - apply brakes when S is pressed
      engineForce = 0;
      brakingForce = maxBrakingForce;
    } else {
      // Stopped or moving backward - apply reverse
      engineForce = -maxEngineForce / 2;
      brakingForce = 0;
    }
  } else {
    // No key pressed - engine off, light braking
    engineForce = 0;
    brakingForce = 20;
  }
  
  // Apply forces to all wheels
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    // Engine force to rear wheels only
    if (i >= 2) {
      vehicle.applyEngineForce(engineForce, i);
    }
    
    // Braking force to all wheels for better braking
    vehicle.setBrake(brakingForce, i);
  }
  
  // Calculate car speed in km/h (assuming your units are meters)
  const speedKPH = velocityThree.length() * 3.6; // Convert m/s to km/h
  
  // Update speedometer UI
  updateSpeedometer(speedKPH);
  
  // Clean up Ammo.js objects to prevent memory leaks
  ammo.destroy(velocity);
  
  // Continue with physics step and updates...
  physicsWorld.stepSimulation(deltaTime, 10);
  
  // Update chassis transform
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();

  // Use either car model or chassis based on what's available
  const carVisual = carModel;
  carVisual.position.set(position.x(), position.y(), position.z());
  carVisual.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());
  
  // Update wheel transforms
  updateCarPosition(ammo, vehicle, carModel, wheelMeshes);
  
  // Update debug visuals
  debugObjects.forEach((obj, index) => {
    if (obj.isWheel) {
      const wheelIndex = obj.wheelIndex % 4;
      vehicle.updateWheelTransform(wheelIndex, true);
      const transform = vehicle.getWheelInfo(wheelIndex).get_m_worldTransform();
      const pos = transform.getOrigin();
      const quat = transform.getRotation();
      
      obj.mesh.position.set(pos.x(), pos.y(), pos.z());
      obj.mesh.quaternion.set(quat.x(), quat.y(), quat.z(), quat.w());
    } else if (obj.body) {
      const ms = obj.body.getMotionState();
      if (ms) {
        ms.getWorldTransform(tmpTrans);
        const p = tmpTrans.getOrigin();
        const q = tmpTrans.getRotation();
        
        obj.mesh.position.set(p.x(), p.y(), p.z());
        obj.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
      }
    }
  });
  
  // Send car data to connected peer
  sendCarData();
  
  // Check for collision with ground respawn plane
  checkGroundCollision(ammo, carBody, () => {
    currentSteeringAngle = resetCarPosition(ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion);
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
const FIXED_PHYSICS_STEP = 1/60; // 60Hz physics
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;
  
  if (physicsWorld) {
    // Run physics at fixed intervals
    while (accumulator >= FIXED_PHYSICS_STEP) {
      updatePhysics(FIXED_PHYSICS_STEP, window.Ammo);
      accumulator -= FIXED_PHYSICS_STEP;
      updateCamera();
      checkGateProximity(); // Add this line inside the physics step
    }
    
    updateMarkers();
    updateGateFading(); // Add this line for gate fade effect
    
    // Send car data as before
    if (Math.random() < 0.2) {
      sendCarData();
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
  const ambientLight = new THREE.AmbientLight(0xcccccc, 1);
  scene.add(ambientLight);
  
  // Primary directional light (sun)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
  directionalLight.position.set(40, 80, 30);
  
  scene.add(directionalLight);
  
  // Second light with wider frustum but lower resolution for distant shadows
  const secondaryLight = new THREE.DirectionalLight(0xffffcc, 1.2);
  secondaryLight.position.set(-30, 50, -30);
  
  scene.add(secondaryLight);
  
  // Add hemisphere light
  const hemisphereLight = new THREE.HemisphereLight(0xaaccff, 0x70a070, 1); // Reduced from 1.0
  scene.add(hemisphereLight);
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
  currentSpeed = currentSpeed * 0.9 + speed * 0.1;
  
  // Get speed as percentage of max speed
  const speedPercent = Math.min(currentSpeed / MAX_SPEED_KPH, 1);
  
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

// Update your initPeerConnection function

function initPeerConnection() {
  // Get the player ID that was stored during lobby creation
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  if (!myPlayerId) {
    console.error('No player ID found in localStorage');
    return;
  }
  
  // If we have game config, use that to establish connections
  if (gameConfig && gameConfig.players && gameConfig.players.length > 0) {
    console.log('Initializing peer connection with game config', gameConfig);
    
    // Create a new peer with the ORIGINAL ID, but with a slight delay
    // to ensure any previous connections are fully closed
    setTimeout(() => {
      peer = new Peer(myPlayerId);
      
      peer.on('open', (id) => {
        console.log('Game peer connection established with ID:', id);
        
        if (isHost) {
          console.log('Playing as host - waiting for player connections');
          
          // Host waits for connections from players
          peer.on('connection', (conn) => {
            console.log('Player connected:', conn.peer);
            playerConnections.push(conn);
            handlePlayerConnection(conn);
          });
          
          // Load opponent car models
          loadOpponentCarModels();
        } else {
          console.log('Playing as guest - connecting to host');
          
          // Find the host player
          const hostPlayer = gameConfig.players.find(player => player.isHost);
          
          if (hostPlayer) {
            console.log('Connecting to host:', hostPlayer.id);
            
            // Connect to host using original ID
            const conn = peer.connect(hostPlayer.id);
            
            conn.on('open', () => {
              console.log('Connected to host!');
              playerConnections.push(conn);
              handlePlayerConnection(conn);
              loadOpponentCarModels();
            });
            
            conn.on('error', (err) => {
              console.error('Error connecting to host:', err);
            });
          } else {
            console.error('No host player found in game config');
          }
        }
      });
      
      peer.on('error', (err) => {
        console.error('Peer connection error:', err);
        if (err.type === 'unavailable-id') {
          console.log('ID is taken, waiting 2 seconds before retrying...');
          // Try again with a longer delay
          setTimeout(() => initPeerConnection(), 2000);
        }
      });
    }, 1000); // Add a 1-second delay before creating the peer
  } else {
    console.warn('No game config found - multiplayer disabled');
  }
}

// Improved player connection handler
function handlePlayerConnection(conn) {
  console.log('Handling player connection:', conn.peer);
  
  // Handle incoming data from any player
  conn.on('data', (data) => {
    if (data.type === 'carUpdate') {
      // Update the appropriate opponent car
      updateOpponentCarPosition(conn.peer, data);
    }
  });
  
  // If we're the host, we need to relay updates to all players
  if (isHost) {
    conn.on('data', (data) => {
      // Relay this player's position to all other players
      playerConnections.forEach(otherConn => {
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
    playerConnections = playerConnections.filter(c => c.peer !== conn.peer);
  });
  
  // Send initial state to the newly connected player
  if (carModel && isHost) {
    conn.send({
      type: 'carUpdate',
      playerId: peer.id,
      position: {
        x: carModel.position.x,
        y: carModel.position.y,
        z: carModel.position.z
      },
      quaternion: {
        x: carModel.quaternion.x,
        y: carModel.quaternion.y,
        z: carModel.quaternion.z,
        w: carModel.quaternion.w
      }
    });
  }
}

// Load opponent car models for all players
function loadOpponentCarModels() {
  if (!gameConfig || !gameConfig.players) return;
  
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  gameConfig.players.forEach(player => {
    // Don't create a model for ourselves
    if (player.id === myPlayerId) return;
    
    // Use the original player ID
    loadOpponentCarModel(player.id);
  });
}

// Update loadOpponentCarModel to use colored car models
function loadOpponentCarModel(playerId) {
  const loader = new GLTFLoader();
  
  // Find player info from gameConfig
  let playerName = 'Player';
  let playerColor = 'red'; // Default color
  
  if (gameConfig && gameConfig.players) {
    const playerInfo = gameConfig.players.find(p => p.id === playerId);
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
      opponentCars[playerId] = {
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
          // Same handlers as above...
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
function updateOpponentCarPosition(playerId, data) {
  // Just look up by the original ID
  let opponent = opponentCars[playerId];
  
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

// Update the updateMarkers function to handle text labels
function updateMarkers() {
  // Loop through all opponent cars and ensure name labels are visible
  Object.values(opponentCars).forEach(opponent => {
    if (opponent.model && opponent.model.visible && opponent.nameLabel) {
      // Make name label visible
      opponent.nameLabel.visible = true;
      
      // Make sure the text always faces the camera (this happens automatically with sprites)
    }
  });
}

function sendCarData() {
  if (!carModel || !peer || playerConnections.length === 0) return;
  
  // Prepare the data packet
  const carData = {
    type: 'carUpdate',
    playerId: peer.id,
    position: {
      x: carModel.position.x,
      y: carModel.position.y,
      z: carModel.position.z
    },
    quaternion: {
      x: carModel.quaternion.x,
      y: carModel.quaternion.y,
      z: carModel.quaternion.z,
      w: carModel.quaternion.w
    }
  };
  
  // Send to all connected players
  playerConnections.forEach(conn => {
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

// Function to initiate gate fade-in
function startGateFadeIn(gateIndex) {
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
function updateGateFading() {
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

// Function to load gates model
function loadGates(mapId = "map1") {
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
      startGateFadeIn(0);
    },
    undefined,
    (error) => {
      console.error(`Error loading gates for ${mapId}:`, error);
    }
  );
}

// Optimized function to check if player is near gates
function checkGateProximity() {
  if (!carModel || gates.length === 0 || currentGateIndex >= gates.length) return;
  
  const gate = gates[currentGateIndex];
  if (!gate || gate.userData.passed) return;
  
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
    currentGatePosition.copy(gatePos)
    currentGateQuaternion.copy(gate.quaternion);
    // Mark gate as passed
    gate.userData.passed = true;
    
    // If this is the finish gate
    if (gate.userData.isFinish) {
      showFinishMessage();
    } else {
      // Move to next gate
      currentGateIndex++;
      
      // Make next gate visible and start fade-in
      if (currentGateIndex < gates.length) {
        startGateFadeIn(currentGateIndex);
      }
    }
  }
}

// Function to show finish message
function showFinishMessage() {
  // Create finish message UI
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
    <p>You passed through all ${totalGates} gates!</p>
    <button id="restart-btn" style="background: #4dc9ff; border: none; padding: 10px 20px; 
    border-radius: 5px; color: black; font-weight: bold; cursor: pointer;">Restart Race</button>
  `;
  document.body.appendChild(finishUI);
  
  // Add restart button event listener
  document.getElementById('restart-btn').addEventListener('click', () => {
    resetRace();
    document.body.removeChild(finishUI);
  });
}

// Function to reset race
function resetRace() {
  // Reset gate states
  gates.forEach((gate, index) => {
    gate.userData.passed = false;
    gate.visible = (index === 0);
  });
  
  // Reset counters
  currentGateIndex = 0;
  gatesPassed = 0;
  
  // Start fade-in for first gate
  startGateFadeIn(0);
  
  // Reset car position
  if (window.Ammo && carBody) {
    currentSteeringAngle = resetCarPosition(window.Ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion);
  }
}

// Start initialization
init();