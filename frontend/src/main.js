import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import "./style.css";
import Ammo from './lib/ammo.js';
import Peer from 'peerjs';

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
  
  // Initialize Ammo.js and setup physics
  Ammo().then(ammo => {
    window.Ammo = ammo;
    
    document.body.removeChild(loadingEl);
    
    initPhysics(ammo);
    
    // Load the track as a single model
    loadTrackModel(ammo, "map1");
    
    // Load map decorations
    loadMapDecorations("map1");
    
    // Load gates - add this line
    loadGates("map1");
    
    // Now create the vehicle
    createVehicle(ammo);
    setupKeyControls();
    
    // Initialize peer connection for multiplayer
    initPeerConnection();
    
    // Start animation loop
    animate();
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
  physicsWorld.setGravity(new ammo.btVector3(0, -10, 0));
  
  // Create temporary transform for reuse
  tmpTrans = new ammo.btTransform();
}

// Create vehicle with wheel physics
function createVehicle(ammo) {
  // Create chassis physics body
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH/2, VEHICLE_HEIGHT/2, VEHICLE_LENGTH/2)
  );
  
  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  chassisTransform.setOrigin(new ammo.btVector3(0, 5, 0));
  
  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = 800;
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);
  
  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );
  
  carBody = new ammo.btRigidBody(chassisRbInfo);
  carBody.setActivationState(4); // DISABLE_DEACTIVATION
  physicsWorld.addRigidBody(carBody);
  
  // Create vehicle raycaster
  const tuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  vehicle = new ammo.btRaycastVehicle(tuning, carBody, vehicleRaycaster);
  
  // Configure vehicle
  vehicle.setCoordinateSystem(0, 1, 2); // X=right, Y=up, Z=forward
  physicsWorld.addAction(vehicle);
  
  // Wheel directions and axles
  const wheelDirCS = new ammo.btVector3(0, -1, 0); // Down
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0); // Left
  
  // Add all four wheels
  const wheelPositions = [
    { x: -WHEEL_X_OFFSET, y: 0.3, z: WHEEL_Z_OFFSET, name: 'wheel-fl' }, // Front left
    { x: WHEEL_X_OFFSET, y: 0.3, z: WHEEL_Z_OFFSET, name: 'wheel-fr' },  // Front right
    { x: -WHEEL_X_OFFSET, y: 0.3, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' }, // Back left
    { x: WHEEL_X_OFFSET, y: 0.3, z: -WHEEL_Z_OFFSET, name: 'wheel-br' }  // Back right
  ];
  
  // Create wheels with physics (but without visuals yet)
  for (let i = 0; i < wheelPositions.length; i++) {
    const pos = wheelPositions[i];
    const isFront = i < 2; // First two are front wheels
    
    // Connect wheel to vehicle
    const connectionPoint = new ammo.btVector3(pos.x, pos.y, pos.z);
    vehicle.addWheel(
      connectionPoint,
      wheelDirCS,
      wheelAxleCS,
      SUSPENSION_REST_LENGTH,
      WHEEL_RADIUS,
      tuning,
      isFront
    );
    
    // Configure wheel
    const wheelInfo = vehicle.getWheelInfo(i);
    wheelInfo.set_m_suspensionStiffness(SUSPENSION_STIFFNESS);
    wheelInfo.set_m_wheelsDampingRelaxation(SUSPENSION_DAMPING);
    wheelInfo.set_m_wheelsDampingCompression(SUSPENSION_COMPRESSION);
    wheelInfo.set_m_frictionSlip(WHEEL_FRICTION);
    wheelInfo.set_m_rollInfluence(ROLL_INFLUENCE);
    
    // Add a placeholder for the wheel mesh
    wheelMeshes.push(null);
  }
  
  // Create debug visualization for chassis
  createChassisDebugVisual(ammo);
  
  // Load the car model
  loadCarModel(ammo, wheelPositions);
}

// Function to load the car model
function loadCarModel(ammo, wheelPositions) {
  const loader = new GLTFLoader();
  
  // Get the player ID
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  // Determine car color with proper priority:
  let carColor = 'red';
  
  // Try getting from gameConfig first in multiplayer mode
  if (gameConfig && gameConfig.players) {
    const playerInfo = gameConfig.players.find(p => p.id === myPlayerId);
    if (playerInfo && playerInfo.playerColor) {
      carColor = playerInfo.playerColor;
      console.log(`Using car color from gameConfig: ${carColor}`);
    }
  }
  
  // Fall back to sessionStorage if not found in gameConfig
  if (carColor === 'red') {
    const storedColor = sessionStorage.getItem('carColor');
    if (storedColor) {
      carColor = storedColor;
      console.log(`Using car color from sessionStorage: ${carColor}`);
    } else {
      console.log('Using default red color');
    }
  }
  
  // Load the appropriate colored car model
  loader.load(
    `/models/car_${carColor}.glb`,
    (gltf) => {
      carModel = gltf.scene;
      
      // Adjust model scale and position if needed
      carModel.scale.set(4, 4, 4); // Adjust scale as needed
      carModel.position.set(0, 0, 0); // Position will be updated by physics
      
      // Make sure car casts shadows
      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });
      
      // Find wheel meshes in the car model
      let wheelMeshFL = carModel.getObjectByName('wheel-fr');
      let wheelMeshFR = carModel.getObjectByName('wheel-fl');
      let wheelMeshBL = carModel.getObjectByName('wheel-br');
      let wheelMeshBR = carModel.getObjectByName('wheel-bl');

      
      const wheelModelMeshes = [wheelMeshFL, wheelMeshFR, wheelMeshBL, wheelMeshBR];
      
      // Store reference to wheel meshes and detach them from car model
      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          // Get the original world matrix before removal to preserve transformations
          wheelModelMeshes[i].updateMatrixWorld(true);
          
          // Remove from car model
          carModel.remove(wheelModelMeshes[i]);
          
          // Add directly to scene so we can control it separately
          scene.add(wheelModelMeshes[i]);
          
          // Apply the same scale as the car model
          wheelModelMeshes[i].scale.set(4, 4, 4);
          
          // Save reference
          wheelMeshes[i] = wheelModelMeshes[i];
          
          console.log(`Found and set up wheel: ${wheelPositions[i].name}`);
        } else {
          console.warn(`Could not find wheel mesh: ${wheelPositions[i].name}`);
          
          // Create a default wheel as fallback
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI/2); // Align with X axis
          
          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          scene.add(wheelMesh);
          
          // Scale the default wheel to match too
          wheelMesh.scale.set(4, 4, 4);
          
          // Use this default wheel
          wheelMeshes[i] = wheelMesh;
        }
      }
      
      // Add car model to scene
      scene.add(carModel);
            
      // Store reference to update visual position
      rigidBodies.push({ mesh: carModel, body: carBody });
      
      console.log('Car model loaded successfully');
    },
    undefined,
    (error) => {
      console.error(`Error loading ${carColor} car model:`, error);
      // Fallback to red model if the requested color fails to load
      if (carColor !== 'red') {
        console.log('Falling back to red car model');
        loader.load(
          '/models/car_red.glb',
          (gltf) => {
            carModel = gltf.scene;
            
            // Adjust model scale and position if needed
            carModel.scale.set(4, 4, 4); // Adjust scale as needed
            carModel.position.set(0, 0, 0); // Position will be updated by physics
            
            // Make sure car casts shadows
            carModel.traverse((node) => {
              if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = false;
              }
            });
            
            // Find wheel meshes in the car model
            let wheelMeshFL = carModel.getObjectByName('wheel-fr');
            let wheelMeshFR = carModel.getObjectByName('wheel-fl');
            let wheelMeshBL = carModel.getObjectByName('wheel-br');
            let wheelMeshBR = carModel.getObjectByName('wheel-bl');

            
            const wheelModelMeshes = [wheelMeshFL, wheelMeshFR, wheelMeshBL, wheelMeshBR];
            
            // Store reference to wheel meshes and detach them from car model
            for (let i = 0; i < wheelModelMeshes.length; i++) {
              if (wheelModelMeshes[i]) {
                // Get the original world matrix before removal to preserve transformations
                wheelModelMeshes[i].updateMatrixWorld(true);
                
                // Remove from car model
                carModel.remove(wheelModelMeshes[i]);
                
                // Add directly to scene so we can control it separately
                scene.add(wheelModelMeshes[i]);
                
                // Apply the same scale as the car model
                wheelModelMeshes[i].scale.set(4, 4, 4);
                
                // Save reference
                wheelMeshes[i] = wheelModelMeshes[i];
                
                console.log(`Found and set up wheel: ${wheelPositions[i].name}`);
              } else {
                console.warn(`Could not find wheel mesh: ${wheelPositions[i].name}`);
                
                // Create a default wheel as fallback
                const wheelGeometry = new THREE.CylinderGeometry(
                  WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
                );
                wheelGeometry.rotateZ(Math.PI/2); // Align with X axis
                
                const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
                const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
                wheelMesh.castShadow = true;
                scene.add(wheelMesh);
                
                // Scale the default wheel to match too
                wheelMesh.scale.set(4, 4, 4);
                
                // Use this default wheel
                wheelMeshes[i] = wheelMesh;
              }
            }
            
            // Add car model to scene
            scene.add(carModel);
                  
            // Store reference to update visual position
            rigidBodies.push({ mesh: carModel, body: carBody });
            
            console.log('Car model loaded successfully');
          },
          undefined,
          (error) => {
            console.error('Error loading fallback red car model:', error);
          }
        );
      }
    }
  );
}

// Create debug visualization for the chassis
function createChassisDebugVisual(ammo) {
  const boxGeometry = new THREE.BoxGeometry(VEHICLE_WIDTH, VEHICLE_HEIGHT, VEHICLE_LENGTH);
  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    wireframe: true,
    opacity: 0.7,
    transparent: true
  });
  const chassisDebug = new THREE.Mesh(boxGeometry, boxMaterial);
  scene.add(chassisDebug);
  debugObjects.push({ mesh: chassisDebug, body: carBody, isWheel: false });
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
        resetCarPosition(window.Ammo);
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
  updateSteering(deltaTime);
  
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
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    // Sync wheels with physics
    vehicle.updateWheelTransform(i, true);
    const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
    const wheelPosition = transform.getOrigin();
    const wheelQuaternion = transform.getRotation();
    
    wheelMeshes[i].position.set(wheelPosition.x(), wheelPosition.y(), wheelPosition.z());
    wheelMeshes[i].quaternion.set(
      wheelQuaternion.x(), 
      wheelQuaternion.y(), 
      wheelQuaternion.z(), 
      wheelQuaternion.w()
    );
  }
  
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
  checkGroundCollision(ammo);
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

// Function to preload all track pieces
function preloadTrackPieces(callback) {
  const trackPieceFilenames = [
    'track-road-wide-cap-back.glb',
    'track-road-wide-cap-front.glb',
    'track-road-wide-corner-large-ramp.glb',
    'track-road-wide-corner-large.glb',
    'track-road-wide-corner-small-ramp.glb',
    'track-road-wide-corner-small.glb',
    'track-road-wide-curve.glb',
    'track-road-wide-straight-bend-large.glb',
    'track-road-wide-straight-bend.glb',
    'track-road-wide-straight-bump-down.glb',
    'track-road-wide-straight-bump-up.glb',
    'track-road-wide-straight-hill-beginning.glb',
    'track-road-wide-straight-hill-complete-half.glb',
    'track-road-wide-straight-hill-complete.glb',
    'track-road-wide-straight-hill-end.glb',
    'track-road-wide-straight-skew-left-side.glb',
    'track-road-wide-straight-skew-left.glb',
    'track-road-wide-straight-skew-right-side.glb',
    'track-road-wide-straight-skew-right.glb',
    'track-road-wide-straight.glb',
    'track-road-wide.glb',
    'track-end.glb',
  ];
  
  const loader = new GLTFLoader();
  let piecesLoaded = 0;
  const totalPieces = trackPieceFilenames.length;
  
  trackPieceFilenames.forEach(filename => {
    // Get piece type name by removing file extension
    const pieceType = filename.replace('.glb', '');
    
    loader.load(
      `/models/track/${filename}`,
      (gltf) => {
        // Store the model in our dictionary
        trackPieces[pieceType] = gltf.scene.clone();
        
        // Make sure track piece casts and receives shadows
        trackPieces[pieceType].traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = false;
          }
        });
        
        piecesLoaded++;
        console.log(`Loaded track piece ${piecesLoaded}/${totalPieces}: ${pieceType}`);
        
        // When all pieces are loaded, execute the callback
        if (piecesLoaded === totalPieces) {
          console.log('All track pieces loaded successfully');
          if (callback) callback();
        }
      },
      undefined,
      (error) => {
        console.error(`Error loading track piece ${filename}:`, error);
        piecesLoaded++;
        
        // Still continue if some pieces fail to load
        if (piecesLoaded === totalPieces) {
          console.log('All track pieces loaded (some with errors)');
          if (callback) callback();
        }
      }
    );
  });
}

// Function to build a track from JSON data
function buildTrack(trackData) {
  const track = new THREE.Group();
  
  trackData.track.forEach((piece, index) => {
    const pieceModel = trackPieces[piece.type];
    
    if (!pieceModel) {
      console.error(`Track piece type not found: ${piece.type}`);
      return;
    }
    
    // Clone the model so we can use it multiple times
    const trackPiece = pieceModel.clone();
    
    // Scale the track piece to match car's scale
    trackPiece.scale.set(8, 8, 8);
    
    // Position the track piece - multiply by 4 to account for scale
    trackPiece.position.set(
      piece.position[0] * 8,
      piece.position[1] * 8,
      piece.position[2] * 8
    );
    
    // Rotate the track piece
    trackPiece.rotation.set(
      piece.rotation[0],
      piece.rotation[1],
      piece.rotation[2]
    );
    
    // Add to track group
    track.add(trackPiece);
    
    console.log(`Added track piece ${index}: ${piece.type}`);
  });
  
  // Add the entire track to the scene
  scene.add(track);
  console.log('Track built successfully with', trackData.track.length, 'pieces');
  
  return track;
}

// Function to add physics to track pieces
function addTrackPhysics(trackData, ammoInstance) {
  // For each track piece, create a corresponding physics object
  trackData.track.forEach((piece, index) => {
    const pieceModel = trackPieces[piece.type];
    
    if (!pieceModel) {
      console.error(`Track piece type not found for physics: ${piece.type}`);
      return;
    }
    
    // Special handling for track-end barriers
    if (piece.type === 'track-end') {
      // Create box collider for track-end pieces
      const BARRIER_WIDTH = 30; // Very wide to block the entire track
      const BARRIER_HEIGHT = 15; // Tall enough to prevent jumping over
      const BARRIER_THICKNESS = 2;
      
      const barrierShape = new ammoInstance.btBoxShape(
        new ammoInstance.btVector3(BARRIER_WIDTH/2, BARRIER_HEIGHT/2, BARRIER_THICKNESS/2)
      );
      
      // Create transform and apply position/rotation
      const barrierTransform = new ammoInstance.btTransform();
      barrierTransform.setIdentity();
      
      // Position the barrier
      barrierTransform.setOrigin(
        new ammoInstance.btVector3(
          piece.position[0] * 8,
          (piece.position[1] * 8) + (BARRIER_HEIGHT/2), // Center vertically
          piece.position[2] * 8
        )
      );
      
      // Apply rotation
      const quat = new ammoInstance.btQuaternion();
      quat.setEulerZYX(piece.rotation[2], piece.rotation[1], piece.rotation[0]);
      barrierTransform.setRotation(quat);
      
      // Create motion state
      const motionState = new ammoInstance.btDefaultMotionState(barrierTransform);
      
      // Set up barrier rigid body (static - mass = 0)
      const mass = 0;
      const localInertia = new ammoInstance.btVector3(0, 0, 0);
      
      // Create rigid body
      const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(
        mass, motionState, barrierShape, localInertia
      );
      
      const barrierBody = new ammoInstance.btRigidBody(rbInfo);
      barrierBody.setFriction(0.8);
      barrierBody.setRestitution(0.2); // Slightly bouncy
      
      // Add to physics world
      physicsWorld.addRigidBody(barrierBody);
      
      console.log(`Added box collider barrier for track-end piece ${index}`);
    } else {
      // Regular track piece handling with triangle mesh collider
      const physicsModel = pieceModel.clone();
      
      // Apply the same transformations as the visual model
      physicsModel.scale.set(8, 8, 8);
      physicsModel.position.set(
        piece.position[0] * 8,
        piece.position[1] * 8,
        piece.position[2] * 8
      );
      physicsModel.rotation.set(
        piece.rotation[0],
        piece.rotation[1],
        piece.rotation[2]
      );
      
      // Update the world matrix to apply all transformations
      physicsModel.updateMatrixWorld(true);
      
      // Extract all mesh geometries from the track piece
      let vertices = [];
      let indices = [];
      let indexOffset = 0;
      
      physicsModel.traverse(child => {
        if (child.isMesh && child.geometry) {
          // Get vertices
          const positionAttr = child.geometry.getAttribute('position');
          const vertexCount = positionAttr.count;
          
          // Apply mesh's transform to vertices
          const worldMatrix = child.matrixWorld;
          
          // Extract vertices with transformation
          for (let i = 0; i < vertexCount; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
            vertex.applyMatrix4(worldMatrix);
            
            vertices.push(vertex.x, vertex.y, vertex.z);
          }
          
          // Get indices - if they exist
          if (child.geometry.index) {
            const indices32 = child.geometry.index.array;
            for (let i = 0; i < indices32.length; i++) {
              indices.push(indices32[i] + indexOffset);
            }
          } else {
            // No indices - assume vertices are already arranged as triangles
            for (let i = 0; i < vertexCount; i++) {
              indices.push(i + indexOffset);
            }
          }
          
          indexOffset += vertexCount;
        }
      });
      
      // Create Ammo triangle mesh
      const triangleMesh = new ammoInstance.btTriangleMesh();
      
      // Add all triangles to the mesh
      for (let i = 0; i < indices.length; i += 3) {
        const i1 = indices[i] * 3;
        const i2 = indices[i+1] * 3;
        const i3 = indices[i+2] * 3;
        
        const v1 = new ammoInstance.btVector3(vertices[i1], vertices[i1+1], vertices[i1+2]);
        const v2 = new ammoInstance.btVector3(vertices[i2], vertices[i2+1], vertices[i2+2]);
        const v3 = new ammoInstance.btVector3(vertices[i3], vertices[i3+1], vertices[i3+2]);
        
        triangleMesh.addTriangle(v1, v2, v3, false);
        
        // Clean up Ammo vectors
        ammoInstance.destroy(v1);
        ammoInstance.destroy(v2);
        ammoInstance.destroy(v3);
      }
      
      // Create track collision shape using triangle mesh
      const trackShape = new ammoInstance.btBvhTriangleMeshShape(triangleMesh, true, true);
      
      // Because we've already applied all transformations to the vertices,
      // the rigid body should be created at origin with identity rotation
      const trackTransform = new ammoInstance.btTransform();
      trackTransform.setIdentity();
      
      // Create motion state
      const motionState = new ammoInstance.btDefaultMotionState(trackTransform);
      
      // Set up track rigid body (static - mass = 0)
      const mass = 0;
      const localInertia = new ammoInstance.btVector3(0, 0, 0);
      
      // Create rigid body
      const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(
        mass, motionState, trackShape, localInertia
      );
      
      const trackBody = new ammoInstance.btRigidBody(rbInfo);
      trackBody.setFriction(0.8); // Track should have good grip
      
      // Add to physics world
      physicsWorld.addRigidBody(trackBody);
      
      console.log(`Added physics for track piece ${index}: ${piece.type}`);
    }
  });
}

// New function to load the entire track from a single model file
function loadTrackModel(ammo, mapId = "map1") {
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/track.glb`,
    (gltf) => {
      const track = gltf.scene;
      
      // Scale to match the world scale
      track.scale.set(8, 8, 8);
      
      // Position at origin
      track.position.set(0, 0, 0);
      track.rotation.set(0, 0, 0);
      
      // Make sure track casts and receives shadows
      track.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true; // Enable for better lighting
          
          // Enhance track materials
          if (node.material) {
            node.material.roughness = 0.7;
            node.material.metalness = 0.3;
          }
        }
      });
      
      // Add to scene
      scene.add(track);
      console.log(`Map ${mapId} track loaded successfully`);
      
      // Add physics collider for the track
      addTrackCollider(track, ammo);
    },
    (xhr) => {
      console.log(`Loading track: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
    },
    (error) => {
      console.error(`Error loading track for ${mapId}:`, error);
    }
  );
}

// Function to create a physics collider for the entire track
function addTrackCollider(trackModel, ammo) {
  // Extract all mesh geometries from the track
  let vertices = [];
  let indices = [];
  let indexOffset = 0;
  
  // Update world matrix to apply all transformations
  trackModel.updateMatrixWorld(true);
  
  // Traverse all meshes in the track model
  trackModel.traverse(child => {
    if (child.isMesh && child.geometry) {
      // Get vertices
      const positionAttr = child.geometry.getAttribute('position');
      const vertexCount = positionAttr.count;
      
      // Apply mesh's transform to vertices
      const worldMatrix = child.matrixWorld;
      
      // Extract vertices with transformation
      for (let i = 0; i < vertexCount; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
        vertex.applyMatrix4(worldMatrix);
        
        vertices.push(vertex.x, vertex.y, vertex.z);
      }
      
      // Get indices - if they exist
      if (child.geometry.index) {
        const indices32 = child.geometry.index.array;
        for (let i = 0; i < indices32.length; i++) {
          indices.push(indices32[i] + indexOffset);
        }
      } else {
        // No indices - assume vertices are already arranged as triangles
        for (let i = 0; i < vertexCount; i++) {
          indices.push(i + indexOffset);
        }
      }
      
      indexOffset += vertexCount;
    }
  });
  
  // Create Ammo triangle mesh
  const triangleMesh = new ammo.btTriangleMesh();
  
  // Add all triangles to the mesh
  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i] * 3;
    const i2 = indices[i+1] * 3;
    const i3 = indices[i+2] * 3;
    
    const v1 = new ammo.btVector3(vertices[i1], vertices[i1+1], vertices[i1+2]);
    const v2 = new ammo.btVector3(vertices[i2], vertices[i2+1], vertices[i2+2]);
    const v3 = new ammo.btVector3(vertices[i3], vertices[i3+1], vertices[i3+2]);
    
    triangleMesh.addTriangle(v1, v2, v3, false);
    
    // Clean up Ammo vectors
    ammo.destroy(v1);
    ammo.destroy(v2);
    ammo.destroy(v3);
  }
  
  // Create track collision shape using triangle mesh
  const trackShape = new ammo.btBvhTriangleMeshShape(triangleMesh, true, true);
  
  // The rigid body uses identity transform since all transformations are in the vertices
  const trackTransform = new ammo.btTransform();
  trackTransform.setIdentity();
  
  // Create motion state
  const motionState = new ammo.btDefaultMotionState(trackTransform);
  
  // Set up track rigid body (static - mass = 0)
  const mass = 0;
  const localInertia = new ammo.btVector3(0, 0, 0);
  
  // Create rigid body
  const rbInfo = new ammo.btRigidBodyConstructionInfo(
    mass, motionState, trackShape, localInertia
  );
  
  const trackBody = new ammo.btRigidBody(rbInfo);
  trackBody.setFriction(0.8); // Track should have good grip
  
  // Add to physics world
  physicsWorld.addRigidBody(trackBody);
  
  console.log("Track physics collider created successfully");
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

// New function for steering logic
function updateSteering(deltaTime) {
  // Calculate target steering angle based on key state
  let targetSteeringAngle = 0;
  
  if (keyState.a) {
    targetSteeringAngle = MAX_STEERING_ANGLE; // Left
  } else if (keyState.d) {
    targetSteeringAngle = -MAX_STEERING_ANGLE; // Right
  }
  
  // Determine appropriate steering speed
  const steeringSpeed = (targetSteeringAngle === 0 || (currentSteeringAngle > 0 && targetSteeringAngle < 0) || (currentSteeringAngle < 0 && targetSteeringAngle > 0)) ? 
    STEERING_RETURN_SPEED : // Return to center faster
    STEERING_SPEED;         // Turn at normal speed
  
  // Smoothly interpolate current steering angle towards target
  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;
  
  // Limit the steering change per frame
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    currentSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    currentSteeringAngle = targetSteeringAngle;
  }
  
  // Apply steering to front wheels
  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(currentSteeringAngle, i);
  }
}

// Function to load map decorations from a combined model file
function loadMapDecorations(mapId = "map1") {
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/decorations.glb`,
    (gltf) => {
      const decorations = gltf.scene;
      
      // Scale to match track scale
      decorations.scale.set(8, 8, 8);
      decorations.position.set(0, 0, 0);
      
      // Important: Process all materials in the decoration model
      const materials = new Set();
      
      decorations.traverse((node) => {
        if (node.isMesh) {
          // Critical: Clone materials to ensure unique instances
          if (node.material) {
            // Add to set to track unique materials
            materials.add(node.material);
            
            // Create a new instance of the material
            node.material = node.material.clone();
            
            // Enhance material properties
            node.material.roughness = 0.7;
            node.material.metalness = 0.2;
            node.material.needsUpdate = true;
            
            // Enable shadows
            node.castShadow = true;
            node.receiveShadow = true;
          }
        }
      });
      
      console.log(`Processed ${materials.size} unique materials in decorations`);
      
      // Add to scene
      scene.add(decorations);
      
      // Force a renderer update to ensure materials are processed
      renderer.renderLists.dispose();
      renderer.render(scene, camera);
      
      console.log(`Map ${mapId} decorations loaded successfully`);
    },
    undefined,
    (error) => {
      console.error(`Error loading map decorations for ${mapId}:`, error);
    }
  );
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

// Add function to check for collisions with ground plane
function checkGroundCollision(ammo) {
  // Get the car's position
  if (!carBody) return;
  
  const transform = new ammo.btTransform();
  const motionState = carBody.getMotionState();
  motionState.getWorldTransform(transform);
  const position = transform.getOrigin();
  
  // If car is below certain height, reset it
  if (position.y() < 0) {
    console.log("Car fell off track - resetting position");
    resetCarPosition(ammo);
  }
  
  // Clean up
  ammo.destroy(transform);
}

// Add function to reset car position
function resetCarPosition(ammo) {
  // Cancel all movement
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);
  
  // Reset position transform
  const resetTransform = new ammo.btTransform();
  resetTransform.setIdentity();
  resetTransform.setOrigin(new ammo.btVector3(currentGatePosition.x, currentGatePosition.y + 2, currentGatePosition.z)); 
  const rotQuat = new ammo.btQuaternion(
    currentGateQuaternion.x,
    currentGateQuaternion.y,
    currentGateQuaternion.z,
    currentGateQuaternion.w
  );
  resetTransform.setRotation(rotQuat);
  
  // Apply transform
  carBody.setWorldTransform(resetTransform);
  carBody.getMotionState().setWorldTransform(resetTransform);
  
  // Reset steering
  currentSteeringAngle = 0;
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i < 2) { // Front wheels only
      vehicle.setSteeringValue(0, i);
    }
    
    // Reset wheel rotation and position
    vehicle.updateWheelTransform(i, true);
  }
  
  // Clean up
  ammo.destroy(zero);
  ammo.destroy(resetTransform);
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
    resetCarPosition(window.Ammo);
  }
}

// Start initialization
init();