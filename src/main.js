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
const STEERING_FORCE = 50; // Base steering torque force multiplier

// Track model library
let trackPieces = {};

// Track data
const trackData = {
  track: [
    { 
      type: "track-road-wide-straight", 
      position: [0, 0, 0], 
      rotation: [0, 0, 0] 
    },
    { 
      type: "track-road-wide-straight", 
      position: [0, 0, -4], 
      rotation: [0, 0, 0] 
    },
    {
      type: "track-road-wide-curve",
      position: [1.02, 0, -8],
      rotation: [0, 0, 0],
    },
    {
      type: "track-road-wide-straight",
      position: [2, 0, -11.9],
      rotation: [0, 0, 0],
    }, 
    {
      type: "track-road-wide-corner-small",
      position: [1.10, 0, -15],
      rotation: [0, Math.PI/2, 0],
    },
    {
      type: "track-road-wide-corner-large",
      position: [-2.2, 0, -17.6],
      rotation: [0, 3*Math.PI/2, 0],
    },
    {
      type: "track-road-wide-straight-bend",
      position: [-3.8, 0.85, -20.95],
      rotation: [0, Math.PI, 0],
    }
  ]
};

// List of track piece filenames to load
const trackPieceFilenames = [
  'track-road-wide-cap-back.glb',
  'track-road-wide-cap-front.glb',
  'track-road-wide-corner-large-ramp.glb',
  'track-road-wide-corner-large.glb',
  'track-road-wide-corner-small-ramp.glb',
  'track-road-wide-corner-small.glb',
  'track-road-wide-curve.glb',
  'track-road-wide-straight-bend-large.glb',
  'track-road-wide-straight-bend.glb',
  'track-road-wide-straight-bump-down.glb',
  'track-road-wide-straight-bump-up.glb',
  'track-road-wide-straight-hill-beginning.glb',
  'track-road-wide-straight-hill-complete-half.glb',
  'track-road-wide-straight-hill-complete.glb',
  'track-road-wide-straight-hill-end.glb',
  'track-road-wide-straight-skew-left-side.glb',
  'track-road-wide-straight-skew-left.glb',
  'track-road-wide-straight-skew-right-side.glb',
  'track-road-wide-straight-skew-right.glb',
  'track-road-wide-straight.glb',
  'track-road-wide.glb',
];

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
  groundBody.setFriction(0.9);
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
  carBody.setFriction(0.5);
  carBody.setRollingFriction(0.5);
  carBody.setDamping(0.1, 0.1); // Linear and angular damping
  
  // Add this line in your createCar function after creating the carBody:
  carBody.setCcdMotionThreshold(1);
  carBody.setCcdSweptSphereRadius(0.5);
  
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

  // Apply steering torque when car is moving
  if (rigidBodies.length > 0 && carModel) {
    const carBody = rigidBodies[0].body;
    
    // Only apply steering torque if we have some steering angle
    if (steeringAngle !== 0) {
        // Get current velocity
        const velocity = carBody.getLinearVelocity();
        const speed = Math.sqrt(velocity.x() * velocity.x() + velocity.z() * velocity.z());
        
        // Only apply steering when moving at some speed
        if (speed > 0) {
          const direction = new THREE.Vector3();
        box.getWorldDirection(direction);
        
        // Create a velocity vector in THREE.js format for dot product
        const velocityVec = new THREE.Vector3(velocity.x(), velocity.y(), velocity.z());
        
        // Calculate dot product to determine if moving forward or backward
        // Positive = forward, Negative = backward
        const dotProduct = direction.dot(velocityVec);
        
        // Reverse steering direction when moving backward
        const directionMultiplier = Math.sign(dotProduct);
        // Calculate torque value (negative steeringAngle = right turn)
        const torqueAmount = steeringAngle * STEERING_FORCE * speed/2 * directionMultiplier;
        
        // Apply torque around Y-axis (up direction)
        const steeringTorque = new ammoInstance.btVector3(0, torqueAmount, 0);
        carBody.applyTorque(steeringTorque);
        
        // Clean up to prevent memory leaks
        ammoInstance.destroy(steeringTorque);
      }
      ammoInstance.destroy(velocity);
    }
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

// Function to load all track piece models
function loadTrackPieces() {
  const loader = new GLTFLoader();
  const loadingPromises = [];

  // Update loading message
  loadingEl.textContent = 'Loading track pieces...';
  
  // Create a promise for each track piece
  trackPieceFilenames.forEach(filename => {
    const pieceType = filename.replace('.glb', '');
    const loadPromise = new Promise((resolve, reject) => {
      loader.load(
        `/models/track/${filename}`,
        (gltf) => {
          // Store the loaded model in our library
          const trackModel = gltf.scene.clone();
          trackModel.scale.set(1, 1, 1); // Adjust scale if needed
          trackPieces[pieceType] = trackModel; 
          console.log(`Loaded track piece: ${pieceType}`);
          resolve();
        },
        (xhr) => {
          // Optional: Show loading progress
          const progress = Math.floor((xhr.loaded / xhr.total) * 100);
          if (progress % 10 === 0) {
            console.log(`Loading ${pieceType}: ${progress}%`);
          }
        },
        (error) => {
          console.error(`Error loading track piece ${filename}:`, error);
          reject(error);
        }
      );
    });
    loadingPromises.push(loadPromise);
  });

  // Return a promise that resolves when all pieces are loaded
  return Promise.all(loadingPromises);
}

// Function to build a track from JSON data - update this function
function buildTrack(trackData) {
  const track = new THREE.Group();
  
  trackData.track.forEach((piece, index) => {
    const pieceModel = trackPieces[piece.type];
    
    if (!pieceModel) {
      console.error(`Track piece type not found: ${piece.type}`);
      return;
    }
    
    // Clone the model so we can use it multiple times
    const trackPiece = pieceModel.clone();
    
    // Add scaling - 4x bigger
    trackPiece.scale.set(4, 4, 4);
    
    // Position the track piece - also scaled by 4
    trackPiece.position.set(
      piece.position[0] * 4,
      piece.position[1] * 4,
      piece.position[2] * 4
    );
    
    // Rotate the track piece
    trackPiece.rotation.set(
      piece.rotation[0],
      piece.rotation[1],
      piece.rotation[2]
    );
    
    // Add to track group
    track.add(trackPiece);
    
    // Optional: Add shadows to track pieces
    trackPiece.traverse(node => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    
    console.log(`Added track piece ${index}: ${piece.type}`);
  });
  
  // Add the entire track to the scene
  scene.add(track);
  console.log('Track built successfully with', trackData.track.length, 'pieces');
  
  return track;
}

// Update the physics function to also scale vertices
function addTrackPhysics(trackData, ammoInstance) {
  // For each track piece, create a corresponding physics object
  trackData.track.forEach((piece, index) => {
    const pieceModel = trackPieces[piece.type];
    
    if (!pieceModel) {
      console.error(`Track piece type not found for physics: ${piece.type}`);
      return;
    }
    
    // Extract all mesh geometries from the track piece
    let vertices = [];
    let indices = [];
    let indexOffset = 0;
    
    // Combine all meshes into one geometry
    pieceModel.traverse(child => {
      if (child.isMesh && child.geometry) {
        // Get vertices
        const positionAttr = child.geometry.getAttribute('position');
        const vertexCount = positionAttr.count;
        
        // Apply mesh's transform to vertices
        const worldMatrix = new THREE.Matrix4();
        child.updateMatrixWorld(true);
        worldMatrix.copy(child.matrixWorld);
        
        // Create scaling matrix - 4x scaling
        const scaleMatrix = new THREE.Matrix4().makeScale(4, 4, 4);
        
        // Extract vertices with transformation and scaling
        for (let i = 0; i < vertexCount; i++) {
          const vertex = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
          vertex.applyMatrix4(worldMatrix);
          vertex.applyMatrix4(scaleMatrix); // Apply scaling
          vertices.push(vertex.x, vertex.y, vertex.z);
        }
        
        // Get indices - if they exist
        if (child.geometry.index) {
          const indices32 = child.geometry.index.array;
          for (let i = 0; i < indices32.length; i++) {
            indices.push(indices32[i] + indexOffset);
          }
        } else {
          // No indices - assume vertices are already arranged as triangles
          for (let i = 0; i < vertexCount; i++) {
            indices.push(i + indexOffset);
          }
        }
        
        indexOffset += vertexCount;
      }
    });
    
    // Create Ammo triangle mesh
    const triangleMesh = new ammoInstance.btTriangleMesh();
    
    // Add all triangles to the mesh
    for (let i = 0; i < indices.length; i += 3) {
      const i1 = indices[i] * 3;
      const i2 = indices[i+1] * 3;
      const i3 = indices[i+2] * 3;
      
      const v1 = new ammoInstance.btVector3(vertices[i1], vertices[i1+1], vertices[i1+2]);
      const v2 = new ammoInstance.btVector3(vertices[i2], vertices[i2+1], vertices[i2+2]);
      const v3 = new ammoInstance.btVector3(vertices[i3], vertices[i3+1], vertices[i3+2]);
      
      triangleMesh.addTriangle(v1, v2, v3, false);
      
      // Clean up Ammo vectors
      ammoInstance.destroy(v1);
      ammoInstance.destroy(v2);
      ammoInstance.destroy(v3);
    }
    
    // Create track collision shape using triangle mesh
    const trackShape = new ammoInstance.btBvhTriangleMeshShape(triangleMesh, true, true);
    
    // Set up track transform
    const trackTransform = new ammoInstance.btTransform();
    trackTransform.setIdentity();
    
    // Apply position from track data - also scaled by 4
    trackTransform.setOrigin(
      new ammoInstance.btVector3(
        piece.position[0] * 4, 
        piece.position[1] * 4, 
        piece.position[2] * 4
      )
    );
    
    // Apply rotation from track data
    const quat = new ammoInstance.btQuaternion();
    quat.setEulerZYX(piece.rotation[2], piece.rotation[1], piece.rotation[0]);
    trackTransform.setRotation(quat);
    
    // Set up track rigid body (static - mass = 0)
    const mass = 0;
    const localInertia = new ammoInstance.btVector3(0, 0, 0);
    
    // Create motion state
    const motionState = new ammoInstance.btDefaultMotionState(trackTransform);
    
    // Create rigid body
    const rbInfo = new ammoInstance.btRigidBodyConstructionInfo(
      mass, motionState, trackShape, localInertia
    );
    
    const trackBody = new ammoInstance.btRigidBody(rbInfo);
    trackBody.setFriction(0.6); // Lower friction
    trackBody.setRestitution(0.2); // Add some bounce
    trackBody.setContactProcessingThreshold(0.025); // Improve contact processing
    
    // Add to physics world
    physicsWorld.addRigidBody(trackBody);
    
    console.log(`Added mesh-based physics for track piece ${index}: ${piece.type}`);
  });
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

// Modify the initialization code to include track loading
Ammo().then(ammoLib => {
  // Store Ammo globally
  window.Ammo = ammoLib;
  
  // Init physics
  initPhysics(ammoLib);
  createGround(ammoLib);
  
  // Load track pieces, then build track
  loadTrackPieces()
    .then(() => {
      console.log('All track pieces loaded successfully');
      
      // Build the track from JSON data
      const track = buildTrack(trackData);
      
      // Add physics to track
      addTrackPhysics(trackData, ammoLib);
      
      // Continue with car creation after track is loaded
      createCar(ammoLib);
      setupKeyControls();
      
      // Create debug visuals
      setTimeout(() => createDebugVisuals(ammoLib), 500);
      
      // Remove loading message
      document.body.removeChild(loadingEl);
      
      // Start animation
      animate();
    })
    .catch(error => {
      console.error('Error loading track pieces:', error);
      loadingEl.textContent = 'Error loading track: ' + error.message;
      loadingEl.style.color = 'red';
    });
}).catch(error => {
  console.error('Error initializing Ammo.js:', error);
  loadingEl.textContent = 'Error initializing physics: ' + error.message;
  loadingEl.style.color = 'red';
});