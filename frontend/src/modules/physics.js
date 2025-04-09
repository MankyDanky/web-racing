import * as THREE from 'three';

// Initialize physics world
export function initPhysics(ammo) {
  // Create physics configuration
  const collisionConfig = new ammo.btDefaultCollisionConfiguration();
  const dispatcher = new ammo.btCollisionDispatcher(collisionConfig);
  const broadphase = new ammo.btDbvtBroadphase();
  const solver = new ammo.btSequentialImpulseConstraintSolver();
  
  // Create physics world
  const physicsWorld = new ammo.btDiscreteDynamicsWorld(
    dispatcher, broadphase, solver, collisionConfig
  );
  
  // Set gravity
  physicsWorld.setGravity(new ammo.btVector3(0, -20, 0));
  
  // Create temporary transform for reuse
  const tmpTrans = new ammo.btTransform();
  
  console.log("Physics world initialized");
  
  return { physicsWorld, tmpTrans };
}

// Update physics simulation
export function updatePhysics(deltaTime, ammo, physicsState, carState, debugObjects) {
  const { physicsWorld, tmpTrans } = physicsState;
  const { 
    carBody, vehicle, carModel, wheelMeshes, 
    keyState, currentSteeringAngle, updateSteering
  } = carState;
  
  if (!vehicle || !carModel) return { currentSpeed: 0 };
  
  // Get current velocity to determine if we're moving forward or backward
  const velocity = carBody.getLinearVelocity();
  
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
  
  // Call updateSteering to update the steering angle
  const newSteeringAngle = updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle);
  
  // Calculate car speed in km/h (assuming your units are meters)
  const speedKPH = velocityThree.length() * 3.6; // Convert m/s to km/h
  
  // Clean up Ammo.js objects to prevent memory leaks
  ammo.destroy(velocity);
  
  // Step physics simulation
  physicsWorld.stepSimulation(deltaTime, 10);
  
  // Update debug objects if any
  if (debugObjects && debugObjects.length > 0) {
    updateDebugObjects(vehicle, debugObjects, tmpTrans);
  }
  
  // Return both speed and the new steering angle
  return { 
    currentSpeed: speedKPH,
    currentSteeringAngle: newSteeringAngle 
  };
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
export const FIXED_PHYSICS_STEP = 1/60; // 60Hz physics

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