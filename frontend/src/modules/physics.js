import * as THREE from 'three';
import { log } from './debug.js';
import { getTuning } from './tuning.js';
import { threePool, initAmmoPool, getAmmoPool } from './pool.js';

// Initialize physics world
export function initPhysics(ammo, trackId = 'map1') {
  // Create physics configuration
  const collisionConfig = new ammo.btDefaultCollisionConfiguration();
  const dispatcher = new ammo.btCollisionDispatcher(collisionConfig);
  const broadphase = new ammo.btDbvtBroadphase();
  const solver = new ammo.btSequentialImpulseConstraintSolver();

  // Create physics world
  const physicsWorld = new ammo.btDiscreteDynamicsWorld(
    dispatcher, broadphase, solver, collisionConfig
  );

  const tuning = getTuning(trackId);

  // Set gravity (from central tuning #18)
  physicsWorld.setGravity(new ammo.btVector3(0, tuning.gravity, 0));

  // Create temporary transform for reuse
  const tmpTrans = new ammo.btTransform();

  // Initialise the shared Ammo temporaries pool (#17)
  initAmmoPool(ammo);

  log('Physics world initialized');

  return { physicsWorld, tmpTrans };
}

// Update physics simulation.
//
// This is the player's per-tick call: it applies the driver's control forces to
// the vehicle AND steps the world once. AI cars use `applyVehicleControls` +
// `stepPhysicsWorld` directly so that every vehicle's forces are applied before
// a SINGLE shared world step (see main.js) - stepping once per car would run the
// simulation N times too fast.
export function updatePhysics(deltaTime, ammo, physicsState, carState, debugObjects, raceState) {
  const { physicsWorld, tmpTrans } = physicsState;

  const result = applyVehicleControls(deltaTime, ammo, carState, raceState);
  if (result.aborted) return { currentSpeed: 0, slip: 0, engineOn: false };

  // Step physics simulation
  physicsWorld.stepSimulation(deltaTime, 10);

  // Update debug objects if any
  if (debugObjects && debugObjects.length > 0) {
    updateDebugObjects(carState.vehicle, debugObjects, tmpTrans);
  }

  return result;
}

// Apply a driver's controls (engine / brake / steer) to one raycast vehicle.
// Does NOT step the world - the caller is responsible for stepping once after
// all vehicles (player + AI) have had their forces applied. Returns the same
// telemetry updatePhysics used to.
export function applyVehicleControls(deltaTime, ammo, carState, raceState) {
  const {
    carBody, vehicle, carModel,
    keyState, currentSteeringAngle, updateSteering, trackId,
  } = carState;

  if (!vehicle || !carModel) return { currentSpeed: 0, slip: 0, engineOn: false, aborted: true };

  const tuning = getTuning(trackId || 'map1');

  // Get current velocity to determine if we're moving forward or backward
  const velocity = carBody.getLinearVelocity();

  // Get forward direction using Three.js (pooled - #17)
  const carForward = threePool.v0;
  carModel.getWorldDirection(carForward);

  // Convert Ammo velocity to a pooled Three.js vector (#17)
  const velocityThree = threePool.v1.set(velocity.x(), velocity.y(), velocity.z());

  // Calculate dot product using Three.js
  const dotForward = carForward.dot(velocityThree);

  // Calculate car speed in km/h
  const speedKPH = velocityThree.length() * 3.6;

  // Engine-force curve vs speed (#14): taper engine force toward top speed.
  const speedFactor = Math.max(0, 1 - speedKPH / tuning.engineForceTopSpeedKPH);
  const availableEngineForce = tuning.maxEngineForce * (0.35 + 0.65 * speedFactor);

  // Check if the race has started before allowing engine forces
  let engineForce = 0;
  let brakingForce = 0;
  let engineOn = false;

  // Only allow movement if race has started and not finished
  if (raceState.raceStarted && !raceState.raceFinished) {
    if (keyState.w) {
      engineForce = availableEngineForce;
      brakingForce = 0;
      engineOn = true;
    } else if (keyState.s) {
      if (dotForward > 0.1) {
        // Moving forward - apply strong brakes (#14 rebalanced)
        engineForce = 0;
        brakingForce = tuning.maxBrakingForce;
      } else {
        // Stopped or moving backward - apply reverse
        engineForce = -tuning.reverseEngineForce;
        brakingForce = 0;
        engineOn = true;
      }
    } else {
      // No key pressed - engine off, light braking coast (#14)
      engineForce = 0;
      brakingForce = tuning.coastBrakingForce;
    }

    // Handbrake (space) - locks rear wheels for slides
    if (keyState.space) {
      brakingForce = tuning.handbrakeForce;
    }
  } else {
    // Either countdown not over or race is finished - hold with brakes
    brakingForce = tuning.maxBrakingForce;
  }

  // Traction control assist (#19): if the car is at speed and the drive wheels
  // are slipping (large lateral velocity relative to forward), ease off engine.
  let slip = 0;
  if (speedKPH > 5) {
    const lateral = velocityThree.clone().projectOnPlane(carForward).length();
    slip = Math.min(1, lateral / (velocityThree.length() + 0.001));
    if (tuning.assists.tractionControl && engineOn && slip > 0.35 && speedKPH > 30) {
      engineForce *= 0.6;
    }
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

  let newSteeringAngle = currentSteeringAngle;

  // Call updateSteering to update the steering angle, passing the current speed
  if (!raceState.raceFinished) {
    newSteeringAngle = updateSteering(
      deltaTime, vehicle, keyState, currentSteeringAngle, speedKPH, trackId, carModel, velocityThree
    );
  }

  // Clean up Ammo.js objects to prevent memory leaks
  ammo.destroy(velocity);

  return {
    currentSpeed: speedKPH,
    currentSteeringAngle: newSteeringAngle,
    slip,
    engineOn,
  };
}

// Step the shared physics world once. Call after every vehicle's controls have
// been applied for this tick.
export function stepPhysicsWorld(physicsWorld, deltaTime) {
  physicsWorld.stepSimulation(deltaTime, 10);
}


// Update debug objects
function updateDebugObjects(vehicle, debugObjects, tmpTrans) {
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
}

// Physics time step constants
export const FIXED_PHYSICS_STEP = 1 / 60; // 60Hz physics

// Add a rigid body to the physics world
export function addRigidBody(
  ammo, physicsWorld, shape, mass, position, quaternion,
  friction = 0.5, restitution = 0.2
) {
  const transform = new ammo.btTransform();
  transform.setIdentity();

  // Set position
  transform.setOrigin(
    new ammo.btVector3(position.x, position.y, position.z)
  );

  // Set rotation
  if (quaternion) {
    transform.setRotation(
      new ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    );
  }

  const motionState = new ammo.btDefaultMotionState(transform);
  const localInertia = new ammo.btVector3(0, 0, 0);

  // Calculate inertia for dynamic bodies
  if (mass > 0) {
    shape.calculateLocalInertia(mass, localInertia);
  }

  // Create rigid body info
  const rbInfo = new ammo.btRigidBodyConstructionInfo(
    mass, motionState, shape, localInertia
  );

  // Create rigid body
  const body = new ammo.btRigidBody(rbInfo);

  // Set friction and restitution
  body.setFriction(friction);
  body.setRestitution(restitution);

  // Add to physics world
  physicsWorld.addRigidBody(body);

  // Clean up temporary Ammo objects
  ammo.destroy(transform);
  ammo.destroy(localInertia);
  ammo.destroy(rbInfo);

  return body;
}
