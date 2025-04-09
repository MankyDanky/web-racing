// physics.js - Physics initialization and simulation
import { updateSteering } from './car.js';
import { updateSpeedometer } from './ui.js';
import * as THREE from 'three';

// Initialize physics engine
export function initPhysics(ammo) {
  const collisionConfig = new ammo.btDefaultCollisionConfiguration();
  const dispatcher = new ammo.btCollisionDispatcher(collisionConfig);
  const broadphase = new ammo.btDbvtBroadphase();
  const solver = new ammo.btSequentialImpulseConstraintSolver();
  
  const physicsWorld = new ammo.btDiscreteDynamicsWorld(
    dispatcher, broadphase, solver, collisionConfig
  );
  physicsWorld.setGravity(new ammo.btVector3(0, -20, 0));
  
  return physicsWorld;
}

// Update physics simulation
export function updatePhysics(deltaTime, ammo, gameState) {
  const { physicsWorld, vehicle, carBody, carModel, wheelMeshes, keyState } = gameState;
  
  if (!vehicle || !carModel) return;
  
  // Update steering 
  updateSteering(deltaTime, gameState);
  
  // Get current velocity
  const velocity = carBody.getLinearVelocity();
  
  // Get car forward direction
  const carForward = new THREE.Vector3();
  carModel.getWorldDirection(carForward);
  
  // Convert Ammo velocity to Three.js vector
  const velocityThree = new THREE.Vector3(
    velocity.x(), velocity.y(), velocity.z()
  );
  
  // Calculate dot product for direction
  const dotForward = carForward.dot(velocityThree);
  
  // Apply appropriate forces based on key input
  const maxEngineForce = 4000;
  const maxBrakingForce = 50;
  let engineForce = 0;
  let brakingForce = 0;
  
  if (keyState.w) {
    engineForce = maxEngineForce;
    brakingForce = 0;
  } else if (keyState.s) {
    if (dotForward > 0.1) {
      // Braking
      engineForce = 0;
      brakingForce = maxBrakingForce;
    } else {
      // Reverse
      engineForce = -maxEngineForce / 2;
      brakingForce = 0;
    }
  } else {
    // Coast with light braking
    engineForce = 0;
    brakingForce = 20;
  }
  
  // Apply forces to wheels
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i >= 2) { // Engine force to rear wheels only
      vehicle.applyEngineForce(engineForce, i);
    }
    vehicle.setBrake(brakingForce, i);
  }
  
  // Calculate car speed in km/h
  const speedKPH = velocityThree.length() * 3.6;
  
  // Update speedometer
  updateSpeedometer(speedKPH);
  
  // Clean up Ammo.js objects
  ammo.destroy(velocity);
  
  // Step physics simulation
  physicsWorld.stepSimulation(deltaTime, 10);
  
  // Update car visual position
  updateCarPosition(ammo, gameState);
  
  // Check if car fell off track
  checkGroundCollision(ammo, gameState);
}

// Update car visual position from physics
function updateCarPosition(ammo, gameState) {
  const { vehicle, carModel, wheelMeshes } = gameState;
  
  // Update chassis transform
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();
  
  carModel.position.set(position.x(), position.y(), position.z());
  carModel.quaternion.set(
    quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w()
  );
  
  // Update wheel transforms with quaternion normalization
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    vehicle.updateWheelTransform(i, true);
    const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
    const wheelPosition = transform.getOrigin();
    const wheelQuaternion = transform.getRotation();
    
    // Create THREE quaternion and normalize it
    const quat = new THREE.Quaternion(
      wheelQuaternion.x(),
      wheelQuaternion.y(),
      wheelQuaternion.z(),
      wheelQuaternion.w()
    ).normalize();
    
    wheelMeshes[i].position.set(
      wheelPosition.x(), wheelPosition.y(), wheelPosition.z()
    );
    wheelMeshes[i].quaternion.copy(quat);
  }
}

// Check if car fell below ground level
export function checkGroundCollision(ammo, gameState) {
  const { carBody } = gameState;
  if (!carBody) return;
  
  const transform = new ammo.btTransform();
  const motionState = carBody.getMotionState();
  motionState.getWorldTransform(transform);
  const position = transform.getOrigin();
  
  if (position.y() < -8) {
    console.log("Car fell off track - resetting position");
    resetCarPosition(ammo, gameState);
  }
  
  ammo.destroy(transform);
}

// Reset car position (to last gate or start)
export function resetCarPosition(ammo, gameState) {
  const { carBody, vehicle, currentGatePosition, currentGateQuaternion } = gameState;
  
  // Cancel all movement
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);
  
  // Set position and rotation to match gate
  const resetTransform = new ammo.btTransform();
  resetTransform.setIdentity();
  
  // Set position (slightly above gate)
  resetTransform.setOrigin(new ammo.btVector3(
    currentGatePosition.x,
    currentGatePosition.y + 2,
    currentGatePosition.z
  ));
  
  // Set rotation to match gate
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
  gameState.currentSteeringAngle = 0;
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i < 2) { // Front wheels only
      vehicle.setSteeringValue(0, i);
    }
    vehicle.updateWheelTransform(i, true);
  }
  
  // Clean up
  ammo.destroy(zero);
  ammo.destroy(rotQuat);
  ammo.destroy(resetTransform);
}