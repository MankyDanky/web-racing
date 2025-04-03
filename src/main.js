import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import "./style.css";
import Ammo from './lib/ammo.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue

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

// Create a simple box
function createBox(ammoInstance) {
  // Visual box
  const boxSize = 1;
  const boxGeometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 });
  const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
  boxMesh.position.set(0, 5, 0); // Start 5 units above ground
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  scene.add(boxMesh);
  
  // Physics box
  const boxShape = new ammoInstance.btBoxShape(new ammoInstance.btVector3(boxSize/2, boxSize/2, boxSize/2));
  boxShape.setMargin(0.05);
  
  const boxTransform = new ammoInstance.btTransform();
  boxTransform.setIdentity();
  boxTransform.setOrigin(new ammoInstance.btVector3(0, 5, 0)); // Same position as visual
  
  const mass = 1;
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  boxShape.calculateLocalInertia(mass, localInertia);
  
  const boxMotionState = new ammoInstance.btDefaultMotionState(boxTransform);
  const boxRbInfo = new ammoInstance.btRigidBodyConstructionInfo(
    mass, boxMotionState, boxShape, localInertia
  );
  
  const boxBody = new ammoInstance.btRigidBody(boxRbInfo);
  boxBody.setFriction(0.5);
  physicsWorld.addRigidBody(boxBody);
  
  // Store reference to update visual position
  rigidBodies.push({ mesh: boxMesh, body: boxBody });
}

// Set up keyboard input
function setupKeyControls() {
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = true;
  });
  
  document.addEventListener('keyup', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = false;
  });
  
  console.log('Keyboard controls set up - Press W to apply force');
}

// Update physics
function updatePhysics(deltaTime, ammoInstance) {
  // Apply forces based on key presses
  if (keyState.w && rigidBodies.length > 0) {
    const boxBody = rigidBodies[0].body;
    
    // Apply force in positive z direction (forward)
    const force = new ammoInstance.btVector3(0, 0, 10); // 10 Newton force
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

// Animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  
  if (physicsWorld) {
    updatePhysics(deltaTime, window.Ammo);
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
  createBox(ammoLib);
  setupKeyControls(); // Add this line
  
  // Start animation loop
  animate();
}).catch(error => {
  console.error('Error initializing Ammo.js:', error);
  loadingEl.textContent = 'Error initializing physics: ' + error.message;
  loadingEl.style.color = 'red';
});