import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import "./style.css";
// Import Ammo from our local file (as a module)
import Ammo from './lib/ammo.js';

// Set up basic Three.js scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// Clock for animation timing
const clock = new THREE.Clock();

// Physics variables
let physicsWorld;
let tmpTrans;
let rigidBodies = [];

// Show loading message
const loadingEl = document.createElement('div');
loadingEl.style.position = 'absolute';
loadingEl.style.top = '50%';
loadingEl.style.left = '50%';
loadingEl.style.transform = 'translate(-50%, -50%)';
loadingEl.style.fontSize = '24px';
loadingEl.style.color = 'white';
loadingEl.textContent = 'Initializing Physics...';
document.body.appendChild(loadingEl);

// Initialize physics
function initPhysics(ammoInstance) {
  // Use the passed instance instead of the global Ammo
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

// Create ground
function createGround(ammoInstance) {
  // Create visual ground
  const groundGeometry = new THREE.PlaneGeometry(20, 20);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x404040, 
    roughness: 0.7,
    metalness: 0.1
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  
  // Create physics ground
  const groundShape = new ammoInstance.btStaticPlaneShape(new ammoInstance.btVector3(0, 1, 0), 0);
  const groundTransform = new ammoInstance.btTransform();
  groundTransform.setIdentity();
  
  const mass = 0; // 0 mass = static object
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  
  const motionState = new ammoInstance.btDefaultMotionState(groundTransform);
  const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(
    mass, motionState, groundShape, localInertia
  );
  
  const groundBody = new ammoInstance.btRigidBody(rbInfo);
  groundBody.setFriction(0.8);
  physicsWorld.addRigidBody(groundBody);
}

// Create a box with physics
function createBox(position = { x: 0, y: 5, z: 0 }, size = 1, color = 0xff0000, ammoInstance) {
  // Create Three.js visual box
  const boxGeometry = new THREE.BoxGeometry(size, size, size);
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,
    metalness: 0.3
  });
  
  const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
  boxMesh.position.set(position.x, position.y, position.z);
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  scene.add(boxMesh);
  
  // Create Ammo.js physics box
  const boxShape = new ammoInstance.btBoxShape(new ammoInstance.btVector3(size/2, size/2, size/2));
  boxShape.setMargin(0.05);
  
  const boxTransform = new ammoInstance.btTransform();
  boxTransform.setIdentity();
  boxTransform.setOrigin(new ammoInstance.btVector3(position.x, position.y, position.z));
  
  const mass = 1;
  const localInertia = new ammoInstance.btVector3(0, 0, 0);
  boxShape.calculateLocalInertia(mass, localInertia);
  
  const motionState = new ammoInstance.btDefaultMotionState(boxTransform);
  const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(mass, motionState, boxShape, localInertia);
  
  const boxBody = new ammoInstance.btRigidBody(rbInfo);
  boxBody.setFriction(0.5);
  boxBody.setRestitution(0.7); // Bouncy!
  
  // Add to world
  physicsWorld.addRigidBody(boxBody);
  
  // Store reference to mesh and body
  rigidBodies.push({mesh: boxMesh, body: boxBody});
  
  return {mesh: boxMesh, body: boxBody};
}

// Update physics objects in animation loop
function updatePhysics(deltaTime) {
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
    }
  }
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  if (physicsWorld) {
    updatePhysics(deltaTime);
  }
  
  renderer.render(scene, camera);
}

// Add UI elements
function addControls(ammoInstance) {
  const addBoxBtn = document.createElement('button');
  addBoxBtn.textContent = 'Add Box';
  addBoxBtn.style.position = 'absolute';
  addBoxBtn.style.top = '20px';
  addBoxBtn.style.left = '20px';
  addBoxBtn.style.padding = '8px 16px';
  addBoxBtn.style.fontSize = '16px';
  addBoxBtn.style.borderRadius = '4px';
  addBoxBtn.style.cursor = 'pointer';
  
  addBoxBtn.addEventListener('click', () => {
    // Random position and color
    const x = (Math.random() - 0.5) * 8;
    const y = 5 + Math.random() * 5;
    const z = (Math.random() - 0.5) * 8;
    const color = Math.random() * 0xffffff;
    const size = 0.5 + Math.random();
    
    createBox({x, y, z}, size, color, ammoInstance);
  });
  
  document.body.appendChild(addBoxBtn);
}

// Initialize everything
Ammo().then(ammoLib => {
  window.Ammo = ammoLib; // Store global reference
  console.log('Ammo.js initialized successfully');
  
  // Remove loading message
  document.body.removeChild(loadingEl);
  
  // Pass ammoLib to the functions that need it
  initPhysics(ammoLib);
  createGround(ammoLib);
  
  // Create initial boxes
  createBox({x: 0, y: 5, z: 0}, 1, 0xff0000, ammoLib);
  createBox({x: 2, y: 7, z: 1}, 0.7, 0x00ff00, ammoLib);
  createBox({x: -2, y: 9, z: -1}, 1.3, 0x0000ff, ammoLib);
  
  // Update addControls to use ammoLib
  addControls(ammoLib);
  
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