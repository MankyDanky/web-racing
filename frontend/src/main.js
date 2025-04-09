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
    
    const physicsState = initPhysics(ammo);
    physicsWorld = physicsState.physicsWorld;
    tmpTrans = physicsState.tmpTrans;
    
    // Load the track as a single model
    loadTrackModel(ammo, "map1", scene, physicsWorld);
    
    // Load map decorations
    loadMapDecorations("map1", scene, renderer, camera);
    
    // Load gates - add this line
    gateData = loadGates("map1", scene, (loadedGateData) => {
      // Store the reference when gates are fully loaded
      gateData = loadedGateData;
      console.log(`Gates loaded. Total gates: ${gateData.totalGates}`);
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
        debugObjects
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
      updateCamera();
      if (gateData) {
        // Check if player passed through a gate
        const raceFinished = checkGateProximity(carModel, gateData);
        
        // IMPORTANT: Update our local copies of the gate position for resets
        currentGatePosition.copy(gateData.currentGatePosition);
        currentGateQuaternion.copy(gateData.currentGateQuaternion);
        
        // Show finish message if race is complete
        if (raceFinished) {
          showFinishMessage(gateData.totalGates, () => {
            currentSteeringAngle = resetRace(
              gateData, 
              window.Ammo, 
              carBody, 
              vehicle, 
              currentSteeringAngle, 
              resetCarPosition
            );
          });
        }
        
        // Update gate fade effects
        updateGateFading(gateData.fadingGates);
      }
    }
    
    updateMarkers();
    
    // Send car data as before
    if (Math.random() < 0.2) {
      sendCarData({carModel});
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

// Start initialization
init();