import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import "./style.css";
import Ammo from './lib/ammo.js';

// Global variables
let camera, scene, renderer, controls;
let physicsWorld, tmpTrans;
const rigidBodies = [];
let debugObjects = [];
const clock = new THREE.Clock();

// Car components
let carBody, carChassis;
let vehicle; // Ammo.js vehicle instance
let wheelMeshes = [];
let carModel;

// Vehicle parameters
const VEHICLE_WIDTH = 2.0;
const VEHICLE_HEIGHT = 0.6;
const VEHICLE_LENGTH = 4.0;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.25;
const SUSPENSION_REST_LENGTH = 0.3;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 60;
const SUSPENSION_DAMPING = 4.5;
const SUSPENSION_COMPRESSION = 4.4;
const ROLL_INFLUENCE = 0.1;
const WHEEL_FRICTION = 1500;

// Control state
const keyState = {
  w: false, s: false, a: false, d: false
};

// Initialize everything
function init() {
  const loadingEl = document.createElement('div');
  loadingEl.style.position = 'absolute';
  loadingEl.style.width = '100%';
  loadingEl.style.height = '100%';
  loadingEl.style.top = '0';
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
  scene.background = new THREE.Color(0x87ceeb);
  
  // Setup lighting
  const ambientLight = new THREE.AmbientLight(0x707070);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(10, 20, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -20;
  directionalLight.shadow.camera.right = 20;
  directionalLight.shadow.camera.top = 20;
  directionalLight.shadow.camera.bottom = -20;
  scene.add(directionalLight);
  
  // Setup camera
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 10, 20);
  
  // Setup renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);
  
  // Setup controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 5, 0);
  controls.update();
  
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
    createGround(ammo);
    createVehicle(ammo);
    setupKeyControls();
    
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

// Create ground plane
function createGround(ammo) {
  // Visual ground
  const groundGeometry = new THREE.PlaneGeometry(100, 100);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x808080,
    roughness: 0.7
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  
  // Physics ground
  const groundShape = new ammo.btStaticPlaneShape(new ammo.btVector3(0, 1, 0), 0);
  const groundTransform = new ammo.btTransform();
  groundTransform.setIdentity();
  
  const groundMotionState = new ammo.btDefaultMotionState(groundTransform);
  const groundRbInfo = new ammo.btRigidBodyConstructionInfo(
    0, groundMotionState, groundShape, new ammo.btVector3(0, 0, 0)
  );
  
  const groundBody = new ammo.btRigidBody(groundRbInfo);
  groundBody.setFriction(0.8);
  physicsWorld.addRigidBody(groundBody);
}

// Create vehicle with wheel physics
function createVehicle(ammo) {
  // Create chassis visual
  const chassisGeometry = new THREE.BoxGeometry(VEHICLE_WIDTH, VEHICLE_HEIGHT, VEHICLE_LENGTH);
  const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x2222dd });
  carChassis = new THREE.Mesh(chassisGeometry, chassisMaterial);
  carChassis.position.set(0, 1, 0);
  carChassis.castShadow = true;
  carChassis.receiveShadow = true;
  scene.add(carChassis);
  
  // Create chassis physics body
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH/2, VEHICLE_HEIGHT/2, VEHICLE_LENGTH/2)
  );
  
  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  chassisTransform.setOrigin(new ammo.btVector3(0, 1, 0));
  
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
    { x: -WHEEL_X_OFFSET, y: 0.3, z: WHEEL_Z_OFFSET }, // Front left
    { x: WHEEL_X_OFFSET, y: 0.3, z: WHEEL_Z_OFFSET },  // Front right
    { x: -WHEEL_X_OFFSET, y: 0.3, z: -WHEEL_Z_OFFSET }, // Rear left
    { x: WHEEL_X_OFFSET, y: 0.3, z: -WHEEL_Z_OFFSET }  // Rear right
  ];
  
  // Create wheels with visual and physics
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
    
    // Create wheel visual
    const wheelGeometry = new THREE.CylinderGeometry(
      WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
    );
    wheelGeometry.rotateZ(Math.PI/2); // Align with X axis
    
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheelMesh.castShadow = true;
    scene.add(wheelMesh);
    wheelMeshes.push(wheelMesh);
    
    // Create wheel debug visualization
    createWheelDebugVisual(pos, ammo);
  }
  
  // Create debug visualization for chassis
  createChassisDebugVisual(ammo);
  
  // Remember car reference for updating
  rigidBodies.push({ mesh: carChassis, body: carBody });
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

// Create debug visualization for wheels
function createWheelDebugVisual(position, ammo) {
  const cylGeometry = new THREE.CylinderGeometry(
    WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 16
  );
  cylGeometry.rotateZ(Math.PI/2);
  
  const cylMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    wireframe: true,
    opacity: 0.7,
    transparent: true
  });
  
  const cylMesh = new THREE.Mesh(cylGeometry, cylMaterial);
  cylMesh.position.set(position.x, position.y + 0.3, position.z);
  scene.add(cylMesh);
  
  debugObjects.push({ 
    mesh: cylMesh, 
    isWheel: true,
    wheelIndex: debugObjects.length 
  });
}

// Setup key controls for vehicle
function setupKeyControls() {
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = true;
    if (event.key.toLowerCase() === 's') keyState.s = true;
    if (event.key.toLowerCase() === 'a') keyState.a = true;
    if (event.key.toLowerCase() === 'd') keyState.d = true;
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
  if (!vehicle) return;
  
  // Apply steering based on keyboard input
  const steeringIncrement = 0.04;
  const steeringClamp = 10;
  let steeringValue = 0;
  
  if (keyState.a) steeringValue += steeringIncrement;
  if (keyState.d) steeringValue -= steeringIncrement;
  
  // Apply steering to front wheels
  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(steeringValue * steeringClamp, i);
  }
  
  // Get current velocity to determine if we're moving forward or backward
  const velocity = carBody.getLinearVelocity();
    // FIXED SECTION: Use Three.js for vector math instead of Ammo.js
  // Get forward direction using Three.js
  const carForward = new THREE.Vector3();
  carChassis.getWorldDirection(carForward);
  
  // Convert Ammo velocity to Three.js vector
  const velocityThree = new THREE.Vector3(
    velocity.x(), 
    velocity.y(), 
    velocity.z()
  );
  
  // Calculate dot product using Three.js
  const dotForward = carForward.dot(velocityThree);
  
  const maxEngineForce = 2000;
  const maxBrakingForce = 300;
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
  
  // Clean up Ammo.js objects to prevent memory leaks
  ammo.destroy(velocity);
  
  // Continue with physics step and updates...
  physicsWorld.stepSimulation(deltaTime, 10);
  
  // Update chassis transform
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();
  
  carChassis.position.set(position.x(), position.y(), position.z());
  carChassis.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());
  
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
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  
  if (physicsWorld) {
    updatePhysics(deltaTime, window.Ammo);
  }
  
  controls.update();
  renderer.render(scene, camera);
}

// Start initialization
init();