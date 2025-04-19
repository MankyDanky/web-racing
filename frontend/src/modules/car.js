import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Vehicle parameters
const VEHICLE_WIDTH = 2.0;
const VEHICLE_HEIGHT = 0.6;
const VEHICLE_LENGTH = 4.0;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.25;
const SUSPENSION_REST_LENGTH = 0.4;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 25;
const SUSPENSION_DAMPING = 3.0;
const SUSPENSION_COMPRESSION = 4.0;
const ROLL_INFLUENCE = 0.05;
const WHEEL_FRICTION = 50;

// Steering parameters
const MAX_STEERING_ANGLE = 0.25;
const STEERING_SPEED = 2;  
const STEERING_RETURN_SPEED = 2; 

// Modify createVehicle to accept a callback for when the car is fully loaded
export function createVehicle(ammo, scene, physicsWorld, debugObjects, onCarLoaded) {
  console.log("Starting vehicle creation");
  
  // Car components that will be returned immediately for physics setup
  const carComponents = {
    carBody: null,
    vehicle: null,
    wheelMeshes: [],
    carModel: null,
    currentSteeringAngle: 0
  };
  
  // Create chassis physics body with modified dimensions
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH/2, VEHICLE_HEIGHT/2 * 0.8, VEHICLE_LENGTH/2 * 0.9)
  );
  
  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  // Move the chassis origin up slightly to prevent underbody scraping
  chassisTransform.setOrigin(new ammo.btVector3(0, 5.2, 0));
  
  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = 800;
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);
  
  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );
  
  carComponents.carBody = new ammo.btRigidBody(chassisRbInfo);
  carComponents.carBody.setActivationState(4); 
  physicsWorld.addRigidBody(carComponents.carBody);
  
  // Create vehicle raycaster
  const tuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  carComponents.vehicle = new ammo.btRaycastVehicle(tuning, carComponents.carBody, vehicleRaycaster);
  
  // Configure vehicle
  carComponents.vehicle.setCoordinateSystem(0, 1, 2); // X=right, Y=up, Z=forward
  physicsWorld.addAction(carComponents.vehicle);
  
  // Wheel directions and axles
  const wheelDirCS = new ammo.btVector3(0, -1, 0); // Down
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0); // Left
  
  // Add all four wheels
  const wheelPositions = [
    { x: -WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fl' }, // Lowered y value
    { x: WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fr' },  
    { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' }, 
    { x: WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' }  
  ];
  
  // Create wheels with physics (but without visuals yet)
  for (let i = 0; i < wheelPositions.length; i++) {
    const pos = wheelPositions[i];
    const isFront = i < 2; // First two are front wheels
    
    // Connect wheel to vehicle
    const connectionPoint = new ammo.btVector3(pos.x, pos.y, pos.z);
    carComponents.vehicle.addWheel(
      connectionPoint,
      wheelDirCS,
      wheelAxleCS,
      SUSPENSION_REST_LENGTH,
      WHEEL_RADIUS,
      tuning,
      isFront
    );
    
    // Configure wheel
    const wheelInfo = carComponents.vehicle.getWheelInfo(i);
    wheelInfo.set_m_suspensionStiffness(SUSPENSION_STIFFNESS);
    wheelInfo.set_m_wheelsDampingRelaxation(SUSPENSION_DAMPING);
    wheelInfo.set_m_wheelsDampingCompression(SUSPENSION_COMPRESSION);
    wheelInfo.set_m_frictionSlip(WHEEL_FRICTION);
    wheelInfo.set_m_rollInfluence(ROLL_INFLUENCE);
    wheelInfo.set_m_maxSuspensionTravelCm(SUSPENSION_REST_LENGTH * 150); 
    
    // Add a placeholder for the wheel mesh
    carComponents.wheelMeshes.push(null);
  }
  
  // Now load the car model with a callback
  loadCarModel(ammo, scene, carComponents, wheelPositions, (updatedComponents) => {
    console.log("Car model fully loaded, calling onCarLoaded callback");
    // When the car model is fully loaded, call the callback with the updated components
    if (onCarLoaded) onCarLoaded(updatedComponents);
  });
  
  // Return physics body immediately for setting up physics
  return carComponents;
}

// Modify loadCarModel to accept and use a callback
function loadCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded) {
  const loader = new GLTFLoader();
  
  // Get the player ID
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  // Determine car color with proper priority:
  let carColor = 'red';
  
  // Try getting from gameConfig that might be in sessionStorage
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gameConfig = JSON.parse(savedConfig);
      if (gameConfig && gameConfig.players) {
        const playerInfo = gameConfig.players.find(p => p.id === myPlayerId);
        if (playerInfo && playerInfo.playerColor) {
          carColor = playerInfo.playerColor;
          console.log(`Using car color from gameConfig: ${carColor}`);
        }
      }
    }
  } catch (e) {
    console.error('Error getting car color from game config:', e);
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
      const carModel = gltf.scene;
      
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
          carComponents.wheelMeshes[i] = wheelModelMeshes[i];
          
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
          carComponents.wheelMeshes[i] = wheelMesh;
        }
      }
      
      // Add car model to scene
      scene.add(carModel);
      carComponents.carModel = carModel;
      
      console.log('Car model loaded successfully');
      
      // Now call the callback with the updated components
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    (error) => {
      console.error(`Error loading ${carColor} car model:`, error);
      // Handle fallback with callback
      if (carColor !== 'red') {
        loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded);
      }
    }
  );
}

// Update fallback model function to also use callback
function loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded) {
  console.log('Falling back to red car model');
  const loader = new GLTFLoader();
  
  loader.load(
    '/models/car_red.glb',
    (gltf) => {
      const carModel = gltf.scene;
      
      // Adjust model scale and position
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);
      
      // Make sure car casts shadows
      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });
      
      // Process wheel meshes (same as in loadCarModel)
      let wheelMeshFL = carModel.getObjectByName('wheel-fr');
      let wheelMeshFR = carModel.getObjectByName('wheel-fl');
      let wheelMeshBL = carModel.getObjectByName('wheel-br');
      let wheelMeshBR = carModel.getObjectByName('wheel-bl');
      
      const wheelModelMeshes = [wheelMeshFL, wheelMeshFR, wheelMeshBL, wheelMeshBR];
      
      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          wheelModelMeshes[i].updateMatrixWorld(true);
          carModel.remove(wheelModelMeshes[i]);
          scene.add(wheelModelMeshes[i]);
          wheelModelMeshes[i].scale.set(4, 4, 4);
          carComponents.wheelMeshes[i] = wheelModelMeshes[i];
        } else {
          // Create default wheel
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI/2);
          
          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          scene.add(wheelMesh);
          
          wheelMesh.scale.set(4, 4, 4);
          carComponents.wheelMeshes[i] = wheelMesh;
        }
      }
      
      scene.add(carModel);
      carComponents.carModel = carModel;
      
      console.log('Fallback car model loaded successfully');
      
      // Call the callback when complete
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    (error) => {
      console.error('Error loading fallback red car model:', error);
    }
  );
}

// Update steering based on key state
export function updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle) {
  // Calculate target steering angle based on key state
  let targetSteeringAngle = 0;
  
  if (keyState.a) {
    targetSteeringAngle = MAX_STEERING_ANGLE; // Left
  } else if (keyState.d) {
    targetSteeringAngle = -MAX_STEERING_ANGLE; // Right
  }
  
  // Determine appropriate steering speed
  const steeringSpeed = (targetSteeringAngle === 0 || 
                         (currentSteeringAngle > 0 && targetSteeringAngle < 0) || 
                         (currentSteeringAngle < 0 && targetSteeringAngle > 0)) ? 
    STEERING_RETURN_SPEED : // Return to center faster
    STEERING_SPEED;         // Turn at normal speed
  
  // Smoothly interpolate current steering angle towards target
  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;
  
  let newSteeringAngle = currentSteeringAngle;
  
  // Limit the steering change per frame
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    newSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    newSteeringAngle = targetSteeringAngle;
  }
  
  // Apply steering to front wheels
  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(newSteeringAngle, i);
  }
  
  return newSteeringAngle;
}

// Reset car position 
export function resetCarPosition(ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion) {
  // Cancel all movement
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);
  
  // Reset position transform
  const resetTransform = new ammo.btTransform();
  resetTransform.setIdentity();
  resetTransform.setOrigin(new ammo.btVector3(
    currentGatePosition.x, 
    currentGatePosition.y + 2, 
    currentGatePosition.z
  )); 
  
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
  let newSteeringAngle = 0;
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i < 2) { // Front wheels only
      vehicle.setSteeringValue(0, i);
    }
    
    // Reset wheel rotation and position
    vehicle.updateWheelTransform(i, true);
  }
  
  // Clean up
  ammo.destroy(zero);
  ammo.destroy(rotQuat);
  ammo.destroy(resetTransform);
  
  return newSteeringAngle;
}

// Update car and wheel positions from physics
export function updateCarPosition(ammo, vehicle, carModel, wheelMeshes) {
  if (!vehicle || !carModel) return;
  
  // Update chassis transform
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();

  // Update car model position
  carModel.position.set(position.x(), position.y(), position.z());
  carModel.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());
  
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
}