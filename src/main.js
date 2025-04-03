import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import "./style.css";
import Ammo from './lib/ammo.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
let box;
let carModel;

// Add at the top with other global variables
let carWheels = {
  fl: null, // Front left
  fr: null, // Front right
  bl: null, // Back left
  br: null  // Back right
};
let steeringAngle = 0;
const MAX_STEER_ANGLE = 0.5; // Maximum steering angle in radians (about 30 degrees)
const STEERING_SPEED = 0.2; // How quickly steering changes

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Camera controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.update();

// Lights
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.1;
directionalLight.shadow.camera.far = 50;
scene.add(directionalLight);

// Physics variables
let physicsWorld;
let rigidBodies = [];
let tmpTrans;

// Debug visuals
let debugObjects = [];

// Keyboard state
const keyState = { w: false };

// Loading indicator
const loadingEl = document.createElement('div');
loadingEl.style.position = 'absolute';
loadingEl.style.top = '50%';
loadingEl.style.left = '50%';
loadingEl.style.transform = 'translate(-50%, -50%)';
loadingEl.style.color = 'white';
loadingEl.textContent = 'Loading Physics...';
document.body.appendChild(loadingEl);

// Initialize physics
function initPhysics(ammoInstance) {
  // Configure physics world
  const collisionConfiguration = new ammoInstance.btDefaultCollisionConfiguration();
  const dispatcher = new ammoInstance.btCollisionDispatcher(collisionConfiguration);
  const broadphase = new ammoInstance.btDbvtBroadphase();
  const solver = new ammoInstance.btSequentialImpulseConstraintSolver();
  
  // Create physics world
  physicsWorld = new ammoInstance.btDiscreteDynamicsWorld(
    dispatcher, broadphase, solver, collisionConfiguration
  );
  
  // Set gravity
  physicsWorld.setGravity(new ammoInstance.btVector3(0, -9.8, 0));
  
  // Create temp transform variable
  tmpTrans = new ammoInstance.btTransform();
  
  console.log('Physics world initialized');
}

// Create a plane for the ground
function createGround(ammoInstance) {
  // Visual plane
  const groundGeometry = new THREE.PlaneGeometry(20, 20);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x999999, 
    roughness: 0.8,
    metalness: 0.2
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2; // Rotate to be horizontal
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  
  // Physics plane
  const groundShape = new ammoInstance.btStaticPlaneShape(new ammoInstance.btVector3(0, 1, 0), 0);
  const groundTransform = new ammoInstance.btTransform();
  groundTransform.setIdentity();
  
  const mass = 0; // 0 = static object
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  
  const groundMotionState = new ammoInstance.btDefaultMotionState(groundTransform);
  const groundRbInfo = new ammoInstance.btRigidBodyConstructionInfo(
    mass, groundMotionState, groundShape, localInertia
  );
  
  const groundBody = new ammoInstance.btRigidBody(groundRbInfo);
  groundBody.setFriction(0.5);
  physicsWorld.addRigidBody(groundBody);
}

// Create a car instead of a box
function createCar(ammoInstance) {
  // Car physics parameters
  const carWidth = 2.4;
  const carHeight = 1.2;
  const carLength = 3.6;
  const carMass = 10;
  
  // Create physics shape for car (box shape approximation)
  const carShape = new ammoInstance.btBoxShape(
    new ammoInstance.btVector3(carWidth/2, carHeight/2, carLength/2)
  );
  
  const carTransform = new ammoInstance.btTransform();
  carTransform.setIdentity();
  carTransform.setOrigin(new ammoInstance.btVector3(0, 1, 0)); // Start above ground
  
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  carShape.calculateLocalInertia(carMass, localInertia);
  
  const carMotionState = new ammoInstance.btDefaultMotionState(carTransform);
  const carRbInfo = new ammoInstance.btRigidBodyConstructionInfo(
    carMass, carMotionState, carShape, localInertia
  );
  
  const carBody = new ammoInstance.btRigidBody(carRbInfo);
  carBody.setFriction(0.0);
  carBody.setRollingFriction(0.0);
  carBody.setDamping(0.5, 0.5); // Linear and angular damping
  
  // Add to physics world
  physicsWorld.addRigidBody(carBody);
  
  // Load car model
  const loader = new GLTFLoader();
  loader.load(
    '/models/car.glb',
    (gltf) => {
      carModel = gltf.scene;
      
      // Adjust model scale and position if needed
      carModel.scale.set(4, 4, 4); // Adjust scale as needed
      carModel.position.set(0, 0, 0); // Position will be updated by physics
      
      // Make sure car casts shadows and find wheels
      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
          
          // Find wheels by name
          if (node.name === 'wheel-fl' || node.name === 'wheel_fl') carWheels.fl = node;
          if (node.name === 'wheel-fr' || node.name === 'wheel_fr') carWheels.fr = node;
          if (node.name === 'wheel-bl' || node.name === 'wheel_bl') carWheels.bl = node;
          if (node.name === 'wheel-br' || node.name === 'wheel_br') carWheels.br = node;
        }
      });
      
      console.log('Found wheels:', carWheels);
      
      // Add to scene
      scene.add(carModel);
      
      // Set global reference
      box = carModel;
      
      // Store reference to update visual position
      rigidBodies.push({ mesh: carModel, body: carBody });
      
      // Create debug visuals for the car immediately after adding it
      createCarDebugVisuals(carBody);
      
      console.log('Car model loaded successfully');
    },
    (xhr) => {
      console.log('Car loading: ' + (xhr.loaded / xhr.total * 100) + '% loaded');
    },
    (error) => {
      console.error('Error loading car model:', error);
      // Fallback to simple box if car model fails to load
    }
  );
}

// Create debug visuals
function createDebugVisuals(ammoInstance) {
  console.log('Creating debug visuals for collision shapes');
  
  // For the ground plane
  const planeGeom = new THREE.PlaneGeometry(20, 20);
  const planeMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x00ff00, 
    wireframe: true,
    opacity: 0.5,
    transparent: true,
    side: THREE.DoubleSide
  });
  const planeDebug = new THREE.Mesh(planeGeom, planeMaterial);
  planeDebug.rotation.x = -Math.PI / 2; // Match ground orientation
  planeDebug.position.y = 0.01; // Slight offset to avoid z-fighting
  scene.add(planeDebug);
  debugObjects.push({ mesh: planeDebug, isStatic: true });
  
  // Don't try to create car debug visual here
  // It will be created after car model loads
}

// Create car debug visuals
function createCarDebugVisuals(carBody) {
  // Get the car dimensions
  const carWidth = 2.4;
  const carHeight = 1.2;
  const carLength = 3.6;
   
  // Create wireframe box with more visible settings
  const boxGeom = new THREE.BoxGeometry(carWidth, carHeight, carLength);
  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    wireframe: true,
    opacity: 1,
    side: THREE.DoubleSide
  });
  const carDebug = new THREE.Mesh(boxGeom, boxMaterial);
  
  carDebug.position.set(0, 1, 0); // Match car position
  
  scene.add(carDebug);
  
  // Log detailed information for debugging
  console.log('Car debug visual created at position:', 
              carDebug.position.x, carDebug.position.y, carDebug.position.z);
  
  // Link to the physics body
  debugObjects.push({ mesh: carDebug, body: carBody, isStatic: false });
}

// Set up keyboard input
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
  
  
  console.log('Keyboard controls set up - Press W to apply force');
}

// Update physics
function updatePhysics(deltaTime, ammoInstance) {
  const forwardForce = 100; // Force to apply when 'W' is pressed
  const backwardForce = -100; // Force to apply when 'S' is pressed
  

  // Apply forces based on key presses
  if (keyState.w && rigidBodies.length > 0) {
    const direction = new THREE.Vector3();
    box.getWorldDirection(direction);
    const boxBody = rigidBodies[0].body;
    

    // Apply force in positive z direction (forward)
    const force = new ammoInstance.btVector3(direction.x*forwardForce, direction.y*forwardForce, direction.z*forwardForce); // 10 Newton force
    boxBody.applyCentralForce(force);
    
    
    // Clean up to prevent memory leaks
    ammoInstance.destroy(force);
  }

  if (keyState.s && rigidBodies.length > 0) {
    const direction = new THREE.Vector3();
    box.getWorldDirection(direction);
    const boxBody = rigidBodies[0].body;
    // Apply force in negative z direction (backward)
    const force = new ammoInstance.btVector3(direction.x*backwardForce, direction.y*backwardForce, direction.z*backwardForce); // 5 Newton force
    boxBody.applyCentralForce(force);
    
    // Clean up to prevent memory leaks
    ammoInstance.destroy(force);
  }

  // Step simulation
  physicsWorld.stepSimulation(deltaTime, 10);
  
  // Update objects
  for (let i = 0; i < rigidBodies.length; i++) {
    const objThree = rigidBodies[i].mesh;
    const objPhys = rigidBodies[i].body;
    const ms = objPhys.getMotionState();
    
    if (ms) {
      ms.getWorldTransform(tmpTrans);
      const p = tmpTrans.getOrigin();
      const q = tmpTrans.getRotation();
      
      objThree.position.set(p.x(), p.y(), p.z());
      objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
  }
}

// Add this function to update wheel steering
function updateWheelSteering() {
  // Calculate target steering angle
  let targetSteerAngle = 0;
  
  if (keyState.a) targetSteerAngle = MAX_STEER_ANGLE;
  else if (keyState.d) targetSteerAngle = -MAX_STEER_ANGLE;
  
  // Smoothly interpolate current steering angle toward target
  steeringAngle = steeringAngle + (targetSteerAngle - steeringAngle) * STEERING_SPEED;
  
  // Apply rotation to the wheels if they exist
  if (carWheels.bl) carWheels.bl.rotation.y = steeringAngle;
  if (carWheels.br) carWheels.br.rotation.y = steeringAngle;
  
  // Log the steering angle for debugging
  if (keyState.a || keyState.d) {
    console.log('Steering angle:', THREE.MathUtils.radToDeg(steeringAngle) + '°');
  }
}

// Animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  
  if (physicsWorld) {
    updatePhysics(deltaTime, window.Ammo);
    
    // Update wheel steering
    updateWheelSteering();
    
    // Update debug visuals positions
    for (let i = 0; i < debugObjects.length; i++) {
      const debugObj = debugObjects[i];
      // Skip static objects like the ground
      if (debugObj.isStatic) continue;
      
      // Update from physics body
      if (debugObj.body) {
        const ms = debugObj.body.getMotionState();
        if (ms) {
          ms.getWorldTransform(tmpTrans);
          const p = tmpTrans.getOrigin();
          const q = tmpTrans.getRotation();
          
          debugObj.mesh.position.set(p.x(), p.y(), p.z());
          debugObj.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
        }
      }
    }
  }
  
  controls.update();
  renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize everything
Ammo().then(ammoLib => {
  // Store Ammo globally for use in updatePhysics
  window.Ammo = ammoLib;
  
  // Remove loading message
  document.body.removeChild(loadingEl);
  
  // Set up world
  initPhysics(ammoLib);
  createGround(ammoLib);
  createCar(ammoLib); // Replace createBox with createCar
  setupKeyControls();
  
  // Create debug visuals after physics objects are set up
  setTimeout(() => createDebugVisuals(ammoLib), 500); // Short delay to ensure car is loaded
  
  // Start animation loop
  animate();
}).catch(error => {
  console.error('Error initializing Ammo.js:', error);
  loadingEl.textContent = 'Error initializing physics: ' + error.message;
  loadingEl.style.color = 'red';
});