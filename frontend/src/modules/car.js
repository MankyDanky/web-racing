// car.js - Vehicle creation and control
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Vehicle configuration constants
const VEHICLE_WIDTH = 2.0;
const VEHICLE_HEIGHT = 0.6;
const VEHICLE_LENGTH = 4.0;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.25;
const SUSPENSION_REST_LENGTH = 0.5;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 25; // Softened from 30
const SUSPENSION_DAMPING = 3.5;  // Softened from 4.5
const SUSPENSION_COMPRESSION = 3.5; // Softened from 4.5
const ROLL_INFLUENCE = 0.01;     // Reduced from 0.05
const WHEEL_FRICTION = 100;      // Reduced from 150

// Steering parameters
const MAX_STEERING_ANGLE = 0.25; // Maximum steering angle in radians
const STEERING_SPEED = 2;        // Speed of steering adjustment
const STEERING_RETURN_SPEED = 2; // Speed of returning to center

// Create vehicle with physics
export function createVehicle(ammo, gameState) {
  const { physicsWorld, scene } = gameState;
  
  // Create chassis shape
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH/2, VEHICLE_HEIGHT/2, VEHICLE_LENGTH/2)
  );
  
  // Create chassis transform
  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  chassisTransform.setOrigin(new ammo.btVector3(0, 5, 0));
  
  // Create chassis body
  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = 800;
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);
  
  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );
  
  const carBody = new ammo.btRigidBody(chassisRbInfo);
  carBody.setActivationState(4); // DISABLE_DEACTIVATION
  physicsWorld.addRigidBody(carBody);
  
  // Save to gameState
  gameState.carBody = carBody;
  
  // Create vehicle raycaster
  const tuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  const vehicle = new ammo.btRaycastVehicle(tuning, carBody, vehicleRaycaster);
  
  // Configure vehicle
  vehicle.setCoordinateSystem(0, 1, 2); // X=right, Y=up, Z=forward
  physicsWorld.addAction(vehicle);
  
  // Save to gameState
  gameState.vehicle = vehicle;
  
  // Wheel directions and axles
  const wheelDirCS = new ammo.btVector3(0, -1, 0); // Down
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0); // Left
  
  // Define wheel positions
  const wheelPositions = [
    { x: -WHEEL_X_OFFSET, y: 0.3, z: WHEEL_Z_OFFSET, name: 'wheel-fl' }, // Front left
    { x: WHEEL_X_OFFSET, y: 0.3, z: WHEEL_Z_OFFSET, name: 'wheel-fr' },  // Front right
    { x: -WHEEL_X_OFFSET, y: 0.3, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' }, // Back left
    { x: WHEEL_X_OFFSET, y: 0.3, z: -WHEEL_Z_OFFSET, name: 'wheel-br' }  // Back right
  ];
  
  // Create wheels with physics
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
    wheelInfo.set_m_maxSuspensionForce(5000); // Limit suspension force
    
    // Add a placeholder for the wheel mesh
    gameState.wheelMeshes.push(null);
  }
  
  // Load the car model
  loadCarModel(ammo, gameState, wheelPositions);
}

// Function to load the car model
export function loadCarModel(ammo, gameState, wheelPositions) {
  const { scene } = gameState;
  const loader = new GLTFLoader();
  
  // Get the player ID
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  // Determine car color
  let carColor = 'red';
  
  // Try getting from gameConfig first in multiplayer mode
  if (gameState.gameConfig && gameState.gameConfig.players) {
    const playerInfo = gameState.gameConfig.players.find(p => p.id === myPlayerId);
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
    }
  }
  
  // Load the appropriate colored car model
  loader.load(
    `/models/car_${carColor}.glb`,
    (gltf) => {
      const carModel = gltf.scene;
      
      // Adjust model scale and position
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);
      
      // Enable shadows
      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });
      
      // Find wheel meshes
      let wheelMeshFL = carModel.getObjectByName('wheel-fr');
      let wheelMeshFR = carModel.getObjectByName('wheel-fl');
      let wheelMeshBL = carModel.getObjectByName('wheel-br');
      let wheelMeshBR = carModel.getObjectByName('wheel-bl');
      
      const wheelModelMeshes = [wheelMeshFL, wheelMeshFR, wheelMeshBL, wheelMeshBR];
      
      // Process wheel meshes
      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          // Update matrix before removal
          wheelModelMeshes[i].updateMatrixWorld(true);
          
          // Remove from car model
          carModel.remove(wheelModelMeshes[i]);
          
          // Add to scene
          scene.add(wheelModelMeshes[i]);
          
          // Apply scale
          wheelModelMeshes[i].scale.set(4, 4, 4);
          
          // Store reference
          gameState.wheelMeshes[i] = wheelModelMeshes[i];
        } else {
          // Create default wheel if missing
          console.warn(`Could not find wheel mesh: ${wheelPositions[i].name}`);
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI/2);
          
          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          scene.add(wheelMesh);
          
          wheelMesh.scale.set(4, 4, 4);
          gameState.wheelMeshes[i] = wheelMesh;
        }
      }
      
      // Add car to scene
      scene.add(carModel);
      gameState.carModel = carModel;
      
      console.log('Car model loaded successfully');
    },
    undefined,
    (error) => {
      console.error(`Error loading ${carColor} car model:`, error);
      if (carColor !== 'red') {
        console.log('Falling back to red car model');
        // Call self with red as fallback
        loadCarModel(ammo, gameState, wheelPositions, 'red');
      }
    }
  );
}

// Update steering based on key input
export function updateSteering(deltaTime, gameState) {
  const { vehicle, keyState } = gameState;
  
  // Calculate target steering angle
  let targetSteeringAngle = 0;
  
  if (keyState.a) {
    targetSteeringAngle = MAX_STEERING_ANGLE; // Left
  } else if (keyState.d) {
    targetSteeringAngle = -MAX_STEERING_ANGLE; // Right
  }
  
  // Determine appropriate steering speed
  const currentSteeringAngle = gameState.currentSteeringAngle;
  const isTurningOpposite = (currentSteeringAngle > 0 && targetSteeringAngle < 0) || 
                           (currentSteeringAngle < 0 && targetSteeringAngle > 0);
  
  // Use faster return speed when centering or changing direction
  const steeringSpeed = (targetSteeringAngle === 0 || isTurningOpposite) ? 
    STEERING_RETURN_SPEED : STEERING_SPEED;
  
  // Smoothly interpolate steering angle
  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;
  
  // Limit the steering change per frame
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    gameState.currentSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    gameState.currentSteeringAngle = targetSteeringAngle;
  }
  
  // Apply steering to front wheels
  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(gameState.currentSteeringAngle, i);
  }
}