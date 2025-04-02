import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import "./style.css";
import Ammo from './lib/ammo.js';

// Set up basic Three.js scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Add orbit controls for debugging
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 0, 0);
orbitControls.update();

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 15, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -20;
directionalLight.shadow.camera.right = 20;
directionalLight.shadow.camera.top = 20;
directionalLight.shadow.camera.bottom = -20;
scene.add(directionalLight);

// Clock for animation timing
const clock = new THREE.Clock();

// Physics variables
let physicsWorld;
let tmpTrans;
let rigidBodies = [];

// Car variables
let car;
let carBody;
const keyState = { w: false, a: false, s: false, d: false };

// Debug helpers - container for debug meshes
const debugObjects = new THREE.Group();
scene.add(debugObjects);

// Show loading message
const loadingEl = document.createElement('div');
loadingEl.style.position = 'absolute';
loadingEl.style.top = '50%';
loadingEl.style.left = '50%';
loadingEl.style.transform = 'translate(-50%, -50%)';
loadingEl.style.fontSize = '24px';
loadingEl.style.color = 'white';
loadingEl.textContent = 'Loading Game...';
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

// Create race track ground
function createTrack(ammoInstance) {
  // Create visual track
  const trackGeometry = new THREE.BoxGeometry(100, 1, 100);
  const trackMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x404040, 
    roughness: 0.7,
    metalness: 0.1
  });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.position.y = -0.5;
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);
  
  // Create physics track
  const trackShape = new ammoInstance.btBoxShape(new ammoInstance.btVector3(50, 0.5, 50));
  const trackTransform = new ammoInstance.btTransform();
  trackTransform.setIdentity();
  trackTransform.setOrigin(new ammoInstance.btVector3(0, -0.5, 0));
  
  const mass = 0; // 0 mass = static object
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  
  const motionState = new ammoInstance.btDefaultMotionState(trackTransform);
  const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(
    mass, motionState, trackShape, localInertia
  );
  
  const trackBody = new ammoInstance.btRigidBody(rbInfo);
  trackBody.setFriction(0.8);
  physicsWorld.addRigidBody(trackBody);
  
  // Add debug visualization for track
  createDebugBox(trackMesh, 100, 1, 100, 0x404040);
}

// Create car with physics
function createCar(ammoInstance) {
  // Try loading a car model
  const loader = new GLTFLoader();
  loader.load('/models/car.glb', 
    (gltf) => {
      car = gltf.scene;
      car.scale.set(5, 5, 5); // Scale the car appropriately
      car.position.set(0, 0.5, 0);
      car.castShadow = true;
      scene.add(car);
      
      // Apply shadows to all car meshes
      car.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      console.log("Car model loaded successfully");
      
      // Create car physics body after the model is loaded
      createCarPhysics(ammoInstance);
    },
    undefined,
    (error) => {
      console.error("Error loading car model:", error);
      
      // Fallback to a simple car if model loading fails
      createFallbackCar(ammoInstance);
    }
  );
}

// Create fallback car if model loading fails
function createFallbackCar(ammoInstance) {
  // Simple car body
  const carGeometry = new THREE.BoxGeometry(2, 1, 4);
  const carMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  car = new THREE.Mesh(carGeometry, carMaterial);
  car.position.set(0, 0.5, 0);
  car.castShadow = true;
  scene.add(car);
  
  console.log("Using fallback car model");
  
  // Create car physics
  createCarPhysics(ammoInstance);
}

// Create car physics body
function createCarPhysics(ammoInstance) {
  // Car dimensions (adjust based on your model)
  const carWidth = 3;
  const carHeight = 1.5;
  const carLength = 4.5;
  
  // Create box shape for car
  const carShape = new ammoInstance.btBoxShape(
    new ammoInstance.btVector3(carWidth/2, carHeight/2, carLength/2)
  );
  carShape.setMargin(0.05);
  
  const carTransform = new ammoInstance.btTransform();
  carTransform.setIdentity();
  carTransform.setOrigin(new ammoInstance.btVector3(0, 0.5, 0));
  
  const mass = 800; // Car mass in kg
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  carShape.calculateLocalInertia(mass, localInertia);
  
  const motionState = new ammoInstance.btDefaultMotionState(carTransform);
  const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(mass, motionState, carShape, localInertia);
 


  carBody = new ammoInstance.btRigidBody(rbInfo);
  carBody.setFriction(0.5);
  carBody.setRestitution(0.2);
  
  // In createCarPhysics function, add these lines after setting friction:
  carBody.setDamping(0.5, 0.95); // Linear and angular damping (increase angular damping)

  // Allow car to rotate freely (important for racing)
  carBody.setAngularFactor(new ammoInstance.btVector3(0, 1, 0)); // Only allow Y-axis rotation
  carBody.setActivationState(4); // DISABLE_DEACTIVATION - Keep car active
  
  // Add car body to world
  physicsWorld.addRigidBody(carBody);
  
  // Store reference to car mesh and body
  rigidBodies.push({mesh: car, body: carBody});
  
  // Add debug visualization for car
  createDebugBox(car, carWidth, carHeight, carLength, 0xff0000);
  
  console.log("Car physics initialized");
}

// Create debug visualization box for colliders
function createDebugBox(targetMesh, width, height, depth, color) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshBasicMaterial({ 
    color: color,
    wireframe: true,
    opacity: 0.5,
    transparent: true
  });
  
  const debugMesh = new THREE.Mesh(geometry, material);
  debugMesh.position.copy(targetMesh.position);
  debugMesh.quaternion.copy(targetMesh.quaternion);
  debugObjects.add(debugMesh);
  
  // Link the debug mesh to the target
  targetMesh.userData.debugMesh = debugMesh;
  
  return debugMesh;
}

// Handle keyboard input for car control
function setupInput() {
  // Key down events
  document.addEventListener('keydown', (event) => {
    switch(event.key.toLowerCase()) {
      case 'w': keyState.w = true; break;
      case 'a': keyState.a = true; break;
      case 's': keyState.s = true; break;
      case 'd': keyState.d = true; break;
    }
  });
  
  // Key up events
  document.addEventListener('keyup', (event) => {
    switch(event.key.toLowerCase()) {
      case 'w': keyState.w = false; break;
      case 'a': keyState.a = false; break;
      case 's': keyState.s = false; break;
      case 'd': keyState.d = false; break;
    }
  });
  
  // Debugging controls
  document.addEventListener('keydown', (event) => {
    // Toggle debug visualization with 'B' key
    if (event.key.toLowerCase() === 'b') {
      debugObjects.visible = !debugObjects.visible;
      console.log(`Debug visualization: ${debugObjects.visible ? 'ON' : 'OFF'}`);
    }
  });
}

// Control the car physics with direct velocity control
function controlCar(ammoInstance) {
  if (!carBody) return;
  
  // Get car's forward direction vector (local Z axis)
  const tm = carBody.getWorldTransform();
  const forwardDir = new ammoInstance.btVector3(0, 0, 1);
  const carRotation = new ammoInstance.btQuaternion(0, 0, 0, 1);
  tm.getBasis().getRotation(carRotation);
  forwardDir.op_mul(carRotation);
  
  // Get current velocities
  const curVelocity = carBody.getLinearVelocity();
  const curAngularVel = carBody.getAngularVelocity();
  
  // Control parameters
  const maxSpeed = 20;        // Maximum speed
  const acceleration = 0.1;   // Speed increase per frame
  const deceleration = 0.05;  // Natural slowdown
  const steeringSpeed = 1.0;  // Base turning rate
  const speedDependentSteering = true; // Turn slower at high speed
  
  // Calculate speed and direction
  const speed = curVelocity.length();
  let targetSpeed = speed;
  
  // Handle acceleration/deceleration
  if (keyState.w) {
    targetSpeed = Math.min(speed + acceleration, maxSpeed);
  } else if (keyState.s) {
    targetSpeed = Math.max(speed - acceleration, -maxSpeed/2); // Slower reverse
  } else {
    // Natural deceleration when no keys pressed
    targetSpeed = speed > deceleration ? speed - deceleration : 0;
  }
  
  // Calculate new velocity vector (preserving direction)
  const newVelocity = new ammoInstance.btVector3(
    forwardDir.x() * targetSpeed,
    curVelocity.y(), // Preserve vertical velocity (for jumps/falls)
    forwardDir.z() * targetSpeed
  );
  
  // Set the new linear velocity
  carBody.setLinearVelocity(newVelocity);
  
  // Handle steering (angular velocity) - speed dependent
  let targetAngularVelocity = 0;
  const steeringFactor = speedDependentSteering ? 
    Math.max(0.5, 1 - (speed / maxSpeed)) : // Reduced steering at high speeds
    1.0; // Constant steering
    
  if (keyState.a && speed > 0.5) {
    targetAngularVelocity = steeringSpeed * steeringFactor;
  } else if (keyState.d && speed > 0.5) {
    targetAngularVelocity = -steeringSpeed * steeringFactor;
  }
  
  // Set angular velocity directly (only Y component, as restricted by angular factor)
  carBody.setAngularVelocity(new ammoInstance.btVector3(0, targetAngularVelocity, 0));
  
  // Clean up Ammo.js objects
  ammoInstance.destroy(forwardDir);
  ammoInstance.destroy(carRotation);
  ammoInstance.destroy(newVelocity);
}

// Update physics objects in animation loop
function updatePhysics(deltaTime, ammoInstance) {
  // Step physics world
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
      
      // Update debug mesh if it exists
      if (objThree.userData.debugMesh) {
        objThree.userData.debugMesh.position.copy(objThree.position);
        objThree.userData.debugMesh.quaternion.copy(objThree.quaternion);
      }
    }
  }
  
  // Update car controls - pass the ammoInstance
  controlCar(ammoInstance);
  
  // Update camera to follow car
  if (car) {
    // Only update if we're not using orbit controls for debugging
    if (!orbitControls.enabled) {
      // Position camera behind car
      const offset = new THREE.Vector3(0, 5, -10);
      offset.applyQuaternion(car.quaternion);
      camera.position.copy(car.position).add(offset);
      camera.lookAt(car.position);
    }
  }
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  if (physicsWorld) {
    updatePhysics(deltaTime, window.Ammo);
  }
  
  renderer.render(scene, camera);
}

// Add debug UI
function setupDebugUI() {
  const debugPanel = document.createElement('div');
  debugPanel.style.position = 'absolute';
  debugPanel.style.bottom = '10px';
  debugPanel.style.left = '10px';
  debugPanel.style.background = 'rgba(0, 0, 0, 0.5)';
  debugPanel.style.color = 'white';
  debugPanel.style.padding = '10px';
  debugPanel.style.fontFamily = 'monospace';
  debugPanel.style.borderRadius = '5px';
  debugPanel.style.fontSize = '14px';
  
  debugPanel.innerHTML = `
    <div>WASD - Drive car</div>
    <div>B - Toggle collision boxes</div>
    <div>Mouse Drag - Orbit camera (debug)</div>
    <div>ESC - Toggle camera mode</div>
  `;
  
  document.body.appendChild(debugPanel);
  
  // Add escape key handler to toggle between orbit and follow camera
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      orbitControls.enabled = !orbitControls.enabled;
      console.log(`Camera mode: ${orbitControls.enabled ? 'Orbit' : 'Follow'}`);
    }
  });
}

// Initialize everything
Ammo().then(ammoLib => {
  window.Ammo = ammoLib; // Store global reference
  console.log('Ammo.js initialized successfully');
  
  // Remove loading message
  document.body.removeChild(loadingEl);
  
  // Set up game
  initPhysics(ammoLib);
  createTrack(ammoLib);
  createCar(ammoLib);
  setupInput();
  setupDebugUI();
  
  // Start animation loop
  animate();
})
.catch(error => {
  console.error('Error initializing Ammo.js:', error);
  loadingEl.textContent = 'Error initializing physics: ' + error.message;
  loadingEl.style.color = 'red';
});

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});