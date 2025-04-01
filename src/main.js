import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';


// Create the scene
const scene = new THREE.Scene();

// Add ambient light
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Soft white light
scene.add(ambientLight);

// Add directional light
const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // Bright white light
directionalLight.position.set(5, 10, 7.5); // Position the light
scene.add(directionalLight);

// Create a camera
const camera = new THREE.PerspectiveCamera(
  75, // Field of view
  window.innerWidth / window.innerHeight, // Aspect ratio
  0.1, // Near clipping plane
  1000 // Far clipping plane
);
camera.position.z = 5; // Move the camera back so we can see the scene

// Create the renderer
const renderer = new THREE.WebGLRenderer();
const clock = new THREE.Clock();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const physicsWorld = new CANNON.World();
physicsWorld.gravity.set(0, -9.82, 0); // Set gravity

const cannonDebugger = new CannonDebugger(scene, physicsWorld, {
  color: 0x00ff00, // Green wireframe
  scale: 1,
});

// Track key states
const keyState = {
  w: false,
  a: false,
  s: false,
  d: false,
};

// Listen for keydown and keyup events
window.addEventListener('keydown', (event) => {
  if (event.key === 'w') keyState.w = true;
  if (event.key === 'a') keyState.a = true;
  if (event.key === 's') keyState.s = true;
  if (event.key === 'd') keyState.d = true;
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'w') keyState.w = false;
  if (event.key === 'a') keyState.a = false;
  if (event.key === 's') keyState.s = false;
  if (event.key === 'd') keyState.d = false;
});

// Variables for camera orbit
let cameraYaw = 0; // Horizontal angle (yaw)
let cameraPitch = Math.PI / 6; // Vertical angle (pitch), starting slightly above the car
let cameraDistance = 5; // Distance from the car
const minCameraDistance = 2; // Minimum zoom distance
const maxCameraDistance = 10; // Maximum zoom distance
const minCameraPitch = 0; // Minimum pitch (slightly above the car)
const maxCameraPitch = Math.PI / 2.5; // Maximum pitch (top-down view)

// Mouse control variables
let isMouseDown = false;
let previousMouseX = 0;
let previousMouseY = 0;
const mouseSensitivity = 0.005; // Adjust sensitivity for orbiting

// Listen for mouse down, move, and up events
window.addEventListener('mousedown', (event) => {
  isMouseDown = true;
  previousMouseX = event.clientX;
  previousMouseY = event.clientY;
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
});

window.addEventListener('mousemove', (event) => {
  if (isMouseDown) {
    const deltaX = event.clientX - previousMouseX; // Horizontal movement
    const deltaY = event.clientY - previousMouseY; // Vertical movement

    // Update yaw and pitch based on mouse movement
    cameraYaw -= deltaX * mouseSensitivity; // Horizontal orbit
    cameraPitch = Math.min(
      Math.max(cameraPitch - deltaY * mouseSensitivity, minCameraPitch),
      maxCameraPitch
    ); // Clamp pitch to prevent flipping

    previousMouseX = event.clientX;
    previousMouseY = event.clientY;
  }
});

// Listen for scroll events to zoom in and out
window.addEventListener('wheel', (event) => {
  cameraDistance = Math.min(
    Math.max(cameraDistance + event.deltaY * 0.01, minCameraDistance),
    maxCameraDistance
  );
});

let car;
let carBody;

// Load the car model
const loader = new GLTFLoader();
loader.load(
  '/models/car.glb',
  (gltf) => {
    car = gltf.scene;
    car.rotateY(Math.PI / 2);
    scene.add(car);

    const carShape = new CANNON.Box(new CANNON.Vec3(0.25, 0.17, 0.45));
    carBody = new CANNON.Body({
      mass: 1,
      position: new CANNON.Vec3(0, 5, 0), // Adjust position as needed
    });
    carBody.addShape(carShape, new CANNON.Vec3(0, 0.2, 0)); // Add the shape to the body
    physicsWorld.addBody(carBody);

    // Find the wheels
    const wheels = {};
    car.traverse((child) => {
      if (child.isMesh) {
        if (child.name === 'wheel-bl') wheels.bl = child;
        if (child.name === 'wheel-br') wheels.br = child;
        if (child.name === 'wheel-fl') wheels.fl = child;
        if (child.name === 'wheel-fr') wheels.fr = child;
      }
    });

    console.log('Wheels:', wheels); // Debug to ensure wheels are found
  },
  undefined,
  (error) => {
    console.error('An error occurred while loading the model:', error);
  }
);

// Create a GLTFLoader instance
const trackLoader = new GLTFLoader();

// Object to store loaded track pieces
const trackPieces = {};

const trackColliders = {
  'track-road-wide-straight': [
    {shape: "box", dimensionsion: [2, 0.1, 4], position: [0, -0.05, 0]},
    {shape: "box", dimensionsion: [0.1, 0.2, 4], position: [-0.95, 0.1, 0]},
    {shape: "box", dimensionsion: [0.1, 0.2, 4], position: [0.95, 0.1, 0]},
  ]
}

// List of track piece filenames (manually specify or automate this if possible)
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


// Function to load all track pieces
function loadTrackPieces() {
  return Promise.all(
    trackPieceFilenames.map((filename, index) => {
      return new Promise((resolve, reject) => {
        trackLoader.load(
          `/models/track/${filename}`, // Path to the track piece
          (gltf) => {
            // Store by filename without extension for easier reference
            const key = filename.replace('.glb', '');
            trackPieces[key] = gltf.scene;
            resolve();
          },
          undefined,
          (error) => {
            console.error(`Error loading ${filename}:`, error);
            reject(error);
          }
        );
      });
    })
  );
}

// Example JSON data (replace with actual JSON loading logic)
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
  ]
};

// Function to build the track
function buildTrack(trackData) {
  trackData.track.forEach((segment) => {
    const trackPiece = trackPieces[segment.type].clone(); // Use type instead of index
    trackPiece.position.set(...segment.position);
    trackPiece.rotation.set(...segment.rotation);
    scene.add(trackPiece); // Add the track piece to the scene
  });
}

function addTrackPhysics(trackData) {
  trackData.track.forEach((segment) => {
    const trackBody = new CANNON.Body({
      mass: 0, // Static object (mass = 0)
      position: new CANNON.Vec3(...segment.position),
    });

    trackColliders[segment.type].forEach((collider) => {
      let shape;
      if (collider.shape === "box") {
        shape = new CANNON.Box(new CANNON.Vec3(...collider.dimensionsion.map(d => d / 2)));
      }
      trackBody.addShape(shape, new CANNON.Vec3(...collider.position));
    }
    );

    physicsWorld.addBody(trackBody);
  });
}

// Call the function to load all track pieces
loadTrackPieces().then(() => {
  buildTrack(trackData);
  addTrackPhysics(trackData);
  console.log(trackPieces)
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  const deltaTime = clock.getDelta(); 
  physicsWorld.step(1/60, deltaTime, 3); // Step the physics world

  car.position.copy(carBody.position); // Update car position
  car.quaternion.copy(carBody.quaternion); // Update car rotation

  // Update the debugger to show collision boxes
  cannonDebugger.update();

  // Update the camera's position based on yaw, pitch, and distance
  const carPosition = new THREE.Vector3(0, 0, 0); // Replace with the car's position if needed
  camera.position.set(
    carPosition.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance, // X position
    carPosition.y + Math.sin(cameraPitch) * cameraDistance, // Y position (height)
    carPosition.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance // Z position
  );

  // Make the camera look at the car
  camera.lookAt(carPosition);

  renderer.render(scene, camera);
}
animate();

// Handle window resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});