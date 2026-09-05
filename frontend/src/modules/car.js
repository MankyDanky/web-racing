import * as THREE from 'three';
import { createGLTFLoader } from './loaders.js';
import { sanitizePlayerColor } from './sanitize.js';
import { log, warn, error } from './debug.js';
import { getTuning } from './tuning.js';

// Hex tints for the runtime-tinted single car model (#22).
const CAR_TINT = {
  red: 0xff5a5a, orange: 0xffa54d, yellow: 0xffe14d, green: 0x3fae4a,
  blue: 0x4a8bd6, indigo: 0xb35ad0, violet: 0x8a4fc0,
};


// Vehicle parameters now come from central tuning (#18)
const T = getTuning('map1');
const VEHICLE_WIDTH = T.vehicleWidth;
const VEHICLE_HEIGHT = T.vehicleHeight;
const VEHICLE_LENGTH = T.vehicleLength;
const WHEEL_RADIUS = T.wheelRadius;
const WHEEL_WIDTH = T.wheelWidth;
const SUSPENSION_REST_LENGTH = T.suspensionRestLength;
const WHEEL_X_OFFSET = T.wheelXOffset;
const WHEEL_Z_OFFSET = T.wheelZOffset;

// Wheel connection layout, shared by player and AI vehicles.
const WHEEL_LAYOUT = [
  { x: -WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fl' },
  { x: WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fr' },
  { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' },
  { x: WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' },
];

// Build the REAL Ammo raycast-vehicle physics (chassis btBoxShape +
// btRaycastVehicle + 4 wheels) and add it to the shared physicsWorld. This is
// the single source of truth for vehicle physics: both the human player and
// every AI opponent go through here, so AI cars obey the exact same rules,
// gravity, suspension and wheel raycasts against the track (fixes the old
// fake/floating bots). `spawn` optionally sets the initial world transform.
function buildVehiclePhysics(ammo, physicsWorld, tuning, spawn = null) {
  const carComponents = {
    carBody: null,
    vehicle: null,
    wheelMeshes: [],
    carModel: null,
    currentSteeringAngle: 0,
    // Render-interpolation state (#16): previous & current physics transforms
    renderState: {
      prevPos: new THREE.Vector3(),
      curPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      curQuat: new THREE.Quaternion(),
      wheels: [], // { prevPos, curPos, prevQuat, curQuat }
      hasPrev: false,
    },
  };

  // Create chassis physics body with modified dimensions
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH / 2, VEHICLE_HEIGHT / 2 * 0.8, VEHICLE_LENGTH / 2 * 0.9)
  );

  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  if (spawn && spawn.position) {
    chassisTransform.setOrigin(new ammo.btVector3(
      spawn.position.x, spawn.position.y, spawn.position.z
    ));
    if (spawn.quaternion) {
      chassisTransform.setRotation(new ammo.btQuaternion(
        spawn.quaternion.x, spawn.quaternion.y, spawn.quaternion.z, spawn.quaternion.w
      ));
    }
  } else {
    chassisTransform.setOrigin(new ammo.btVector3(0, 5.2, 0));
  }

  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = tuning.mass;
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);

  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );

  carComponents.carBody = new ammo.btRigidBody(chassisRbInfo);
  carComponents.carBody.setActivationState(4);
  carComponents.carBody.setFriction(tuning.chassisFriction);
  physicsWorld.addRigidBody(carComponents.carBody);

  // Create vehicle raycaster
  const vTuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  carComponents.vehicle = new ammo.btRaycastVehicle(vTuning, carComponents.carBody, vehicleRaycaster);

  carComponents.vehicle.setCoordinateSystem(0, 1, 2);
  physicsWorld.addAction(carComponents.vehicle);

  const wheelDirCS = new ammo.btVector3(0, -1, 0);
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0);

  for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
    const pos = WHEEL_LAYOUT[i];
    const isFront = i < 2;

    const connectionPoint = new ammo.btVector3(pos.x, pos.y, pos.z);
    carComponents.vehicle.addWheel(
      connectionPoint, wheelDirCS, wheelAxleCS,
      SUSPENSION_REST_LENGTH, WHEEL_RADIUS, vTuning, isFront
    );

    const wheelInfo = carComponents.vehicle.getWheelInfo(i);
    wheelInfo.set_m_suspensionStiffness(tuning.suspensionStiffness);
    wheelInfo.set_m_wheelsDampingRelaxation(tuning.suspensionDamping);
    wheelInfo.set_m_wheelsDampingCompression(tuning.suspensionCompression);
    wheelInfo.set_m_frictionSlip(tuning.assists.driftMode ? tuning.assists.driftFrictionSlip : tuning.frictionSlip);
    wheelInfo.set_m_rollInfluence(tuning.rollInfluence);
    // Clamp travel to ~= rest length so wheels can't punch into the chassis (#15)
    wheelInfo.set_m_maxSuspensionTravelCm(tuning.maxSuspensionTravelCm);

    carComponents.wheelMeshes.push(null);
    carComponents.renderState.wheels.push({
      prevPos: new THREE.Vector3(),
      curPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      curQuat: new THREE.Quaternion(),
    });
  }

  return carComponents;
}

// Modify createVehicle to accept a callback for when the car is fully loaded
export function createVehicle(ammo, scene, physicsWorld, debugObjects, onCarLoaded, trackId = 'map1') {
  log('Starting vehicle creation');
  const tuning = getTuning(trackId);

  const carComponents = buildVehiclePhysics(ammo, physicsWorld, tuning);

  loadCarModel(ammo, scene, carComponents, WHEEL_LAYOUT, (updatedComponents) => {
    log('Car model fully loaded, calling onCarLoaded callback');
    if (onCarLoaded) onCarLoaded(updatedComponents);
  });

  return carComponents;
}

// Create a REAL Ammo raycast-vehicle for an AI opponent (#42). Identical physics
// to the player's car; only the spawn transform and body tint differ. The bot's
// "brain" (ai.js) drives it purely by setting W/A/S/D key booleans, which are
// fed through the same applyVehicleControls/updateSteering force model - so bots
// obey the same rules and ride the real track surface, never floating.
export function createAIVehicle(ammo, scene, physicsWorld, colorName, spawn, onCarLoaded, trackId = 'map1') {
  const tuning = getTuning(trackId);
  const carComponents = buildVehiclePhysics(ammo, physicsWorld, tuning, spawn);

  loadAICarModel(ammo, scene, carComponents, WHEEL_LAYOUT, colorName, (updated) => {
    if (onCarLoaded) onCarLoaded(updated);
  });

  return carComponents;
}

// Load the shared base car model and tint it to an explicit AI color (does NOT
// read player color from session, unlike loadCarModel).
function loadAICarModel(ammo, scene, carComponents, wheelPositions, colorName, onModelLoaded) {
  const loader = createGLTFLoader(window.loadingManager);
  loader.load(
    '/models/car.glb',
    (gltf) => {
      const carModel = gltf.scene;
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);
      carModel.traverse((node) => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = false; }
      });
      tintCarModel(carModel, colorName);
      setupWheels(scene, carModel, carComponents, wheelPositions);
      scene.add(carModel);
      carComponents.carModel = carModel;
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    () => {
      warn('Base car.glb unavailable for AI, falling back to colored model');
      loadColoredCarModel(scene, carComponents, wheelPositions, sanitizePlayerColor(colorName), onModelLoaded);
    }
  );
}

// Tint a car model's body materials to the target color while keeping wheels
// dark. Used by the single-model runtime-tint path (#22).
function tintCarModel(model, colorName) {
  const hex = CAR_TINT[colorName] || CAR_TINT.red;
  const color = new THREE.Color(hex);
  model.traverse((node) => {
    if (node.isMesh && node.material) {
      const name = (node.name || '').toLowerCase();
      const isWheel = name.includes('wheel') || name.includes('tire') || name.includes('tyre');
      node.material = node.material.clone();
      if (!isWheel) {
        // Only tint reasonably bright/body-like materials.
        if (node.material.color) node.material.color.copy(color);
      }
    }
  });
}

function setupWheels(scene, carModel, carComponents, wheelPositions) {
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
      const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24);
      wheelGeometry.rotateZ(Math.PI / 2);
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
      const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheelMesh.castShadow = true;
      scene.add(wheelMesh);
      wheelMesh.scale.set(4, 4, 4);
      carComponents.wheelMeshes[i] = wheelMesh;
    }
  }
}

// Resolve the desired car color from config/session.
function resolveCarColor() {
  const myPlayerId = localStorage.getItem('myPlayerId');
  let carColor = 'red';
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gameConfig = JSON.parse(savedConfig);
      if (gameConfig && gameConfig.players) {
        const playerInfo = gameConfig.players.find((p) => p.id === myPlayerId);
        if (playerInfo && playerInfo.playerColor) carColor = playerInfo.playerColor;
      }
    }
  } catch (e) {
    error('Error getting car color from game config:', e);
  }
  if (carColor === 'red') {
    const storedColor = sessionStorage.getItem('carColor');
    if (storedColor) carColor = storedColor;
  }
  return sanitizePlayerColor(carColor);
}

// Load the car using a SINGLE base model + runtime tint (#22), falling back to
// the per-color GLBs if the base model isn't available.
function loadCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded) {
  const loader = createGLTFLoader(window.loadingManager);
  const carColor = resolveCarColor();

  loader.load(
    '/models/car.glb',
    (gltf) => {
      const carModel = gltf.scene;
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);
      carModel.traverse((node) => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = false; }
      });
      tintCarModel(carModel, carColor);
      setupWheels(scene, carModel, carComponents, wheelPositions);
      scene.add(carModel);
      carComponents.carModel = carModel;
      log('Base car model loaded and tinted:', carColor);
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    () => {
      warn('Base car.glb unavailable, falling back to colored model');
      loadColoredCarModel(scene, carComponents, wheelPositions, carColor, onModelLoaded);
    }
  );
}

function loadColoredCarModel(scene, carComponents, wheelPositions, carColor, onModelLoaded) {
  const loader = createGLTFLoader(window.loadingManager);
  loader.load(
    `/models/car_${carColor}.glb`,
    (gltf) => {
      const carModel = gltf.scene;
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);
      carModel.traverse((node) => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = false; }
      });
      setupWheels(scene, carModel, carComponents, wheelPositions);
      scene.add(carModel);
      carComponents.carModel = carModel;
      log('Colored car model loaded:', carColor);
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    (err) => {
      error(`Error loading ${carColor} car model:`, err);
      if (carColor !== 'red') {
        loadColoredCarModel(scene, carComponents, wheelPositions, 'red', onModelLoaded);
      }
    }
  );
}

// Update steering based on key state, now with counter-steer assist (#19) and
// sensitivity from settings (#49).
export function updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle, currentSpeed = 0, trackId = 'map1', carModel = null, velocity = null) {
  const tuning = getTuning(trackId);
  const sensitivity = keyState.sensitivity || 1.0;
  const maxSteeringAngle = calculateMaxSteeringAngle(currentSpeed, tuning) * sensitivity;

  let targetSteeringAngle = 0;
  if (keyState.a) targetSteeringAngle = maxSteeringAngle;
  else if (keyState.d) targetSteeringAngle = -maxSteeringAngle;

  const steeringSpeed = (targetSteeringAngle === 0 ||
    (currentSteeringAngle > 0 && targetSteeringAngle < 0) ||
    (currentSteeringAngle < 0 && targetSteeringAngle > 0))
    ? tuning.steeringReturnSpeed : tuning.steeringSpeed;

  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;

  let newSteeringAngle = currentSteeringAngle;
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    newSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    newSteeringAngle = targetSteeringAngle;
  }

  // Counter-steer assist (#19): when no steering input and the car is sliding
  // sideways at speed, nudge the wheels to oppose the slide to tame spins.
  if (tuning.assists.counterSteer && targetSteeringAngle === 0 && carModel && velocity && currentSpeed > 25) {
    const forward = new THREE.Vector3();
    carModel.getWorldDirection(forward);
    const lateral = velocity.clone().projectOnPlane(forward);
    // Sign of lateral relative to car's right vector.
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const lateralSign = Math.sign(lateral.dot(right));
    const lateralMag = Math.min(1, lateral.length() / 20);
    newSteeringAngle += lateralSign * lateralMag * tuning.assists.counterSteerGain * maxSteeringAngle;
    newSteeringAngle = Math.max(-maxSteeringAngle, Math.min(maxSteeringAngle, newSteeringAngle));
  }

  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(newSteeringAngle, i);
  }

  return newSteeringAngle;
}

function calculateMaxSteeringAngle(speedKPH, tuning) {
  const MIN_SPEED = 0;
  const MAX_SPEED = tuning.steerSpeedRefKPH;
  const MIN_ANGLE = tuning.minSteeringAngle;
  const MAX_ANGLE = tuning.maxSteeringAngle;
  const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speedKPH));
  const speedFactor = (clampedSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  return MAX_ANGLE - speedFactor * (MAX_ANGLE - MIN_ANGLE);
}

// Reset car position
export function resetCarPosition(ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion) {
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);

  const resetTransform = new ammo.btTransform();
  resetTransform.setIdentity();
  resetTransform.setOrigin(new ammo.btVector3(
    currentGatePosition.x, currentGatePosition.y + 2, currentGatePosition.z
  ));

  const rotQuat = new ammo.btQuaternion(
    currentGateQuaternion.x, currentGateQuaternion.y,
    currentGateQuaternion.z, currentGateQuaternion.w
  );
  resetTransform.setRotation(rotQuat);

  carBody.setWorldTransform(resetTransform);
  carBody.getMotionState().setWorldTransform(resetTransform);

  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i < 2) vehicle.setSteeringValue(0, i);
    vehicle.updateWheelTransform(i, true);
  }

  ammo.destroy(zero);
  ammo.destroy(rotQuat);
  ammo.destroy(resetTransform);

  return 0;
}

// Record the latest physics transform into the render-interpolation buffer (#16).
// Call this once per physics tick.
export function recordCarPhysicsState(vehicle, renderState) {
  if (!vehicle || !renderState) return;
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const p = chassisWorldTrans.getOrigin();
  const q = chassisWorldTrans.getRotation();

  renderState.prevPos.copy(renderState.curPos);
  renderState.prevQuat.copy(renderState.curQuat);
  renderState.curPos.set(p.x(), p.y(), p.z());
  renderState.curQuat.set(q.x(), q.y(), q.z(), q.w());

  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    vehicle.updateWheelTransform(i, true);
    const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
    const wp = transform.getOrigin();
    const wq = transform.getRotation();
    const w = renderState.wheels[i];
    if (!w) continue;
    w.prevPos.copy(w.curPos);
    w.prevQuat.copy(w.curQuat);
    w.curPos.set(wp.x(), wp.y(), wp.z());
    w.curQuat.set(wq.x(), wq.y(), wq.z(), wq.w());
  }

  if (!renderState.hasPrev) {
    // Seed prev == cur on first tick to avoid a jump from origin.
    renderState.prevPos.copy(renderState.curPos);
    renderState.prevQuat.copy(renderState.curQuat);
    renderState.wheels.forEach((w) => { w.prevPos.copy(w.curPos); w.prevQuat.copy(w.curQuat); });
    renderState.hasPrev = true;
  }
}

// Interpolate the render transform between the last two physics states (#16).
// alpha is accumulator/step in [0,1]. Call once per rendered frame.
export function renderCarInterpolated(carModel, wheelMeshes, renderState, alpha) {
  if (!carModel || !renderState || !renderState.hasPrev) return;
  const a = Math.max(0, Math.min(1, alpha));
  carModel.position.lerpVectors(renderState.prevPos, renderState.curPos, a);
  carModel.quaternion.copy(renderState.prevQuat).slerp(renderState.curQuat, a);

  for (let i = 0; i < wheelMeshes.length; i++) {
    const w = renderState.wheels[i];
    const mesh = wheelMeshes[i];
    if (!w || !mesh) continue;
    mesh.position.lerpVectors(w.prevPos, w.curPos, a);
    mesh.quaternion.copy(w.prevQuat).slerp(w.curQuat, a);
  }
}

// Legacy snap update (kept for compatibility / non-interpolated paths).
export function updateCarPosition(ammo, vehicle, carModel, wheelMeshes) {
  if (!vehicle || !carModel) return;
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();
  carModel.position.set(position.x(), position.y(), position.z());
  carModel.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());

  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    vehicle.updateWheelTransform(i, true);
    const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
    const wheelPosition = transform.getOrigin();
    const wheelQuaternion = transform.getRotation();
    if (!wheelMeshes[i]) continue;
    wheelMeshes[i].position.set(wheelPosition.x(), wheelPosition.y(), wheelPosition.z());
    wheelMeshes[i].quaternion.set(wheelQuaternion.x(), wheelQuaternion.y(), wheelQuaternion.z(), wheelQuaternion.w());
  }
}
