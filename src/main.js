import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import "./style.css"

// Create the scene
const scene = new THREE.Scene();

// Add ambient light
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Soft white light
scene.add(ambientLight);

// Add directional light
const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // Bright white light
directionalLight.position.set(5, 10, 7.5); // Position the light
scene.add(directionalLight);


const groundMaterial = new CANNON.Material('ground');
const carMaterial = new CANNON.Material('car');

// Completely replace the wheel contact material
const wheelContactMaterial = new CANNON.ContactMaterial(groundMaterial, carMaterial, {
  friction: 0.000,           
  restitution: 0.0,        
  contactEquationStiffness: 1e6, 
  contactEquationRelaxation: 3
});


// Create a camera
const camera = new THREE.PerspectiveCamera(
  75, 
  window.innerWidth / window.innerHeight, 
  0.1, 
  1000 
);

const renderer = new THREE.WebGLRenderer();
const clock = new THREE.Clock();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const physicsWorld = new CANNON.World();
physicsWorld.gravity.set(0, -9.82, 0); 
physicsWorld.addContactMaterial(wheelContactMaterial);

// Also update default materials
physicsWorld.defaultContactMaterial.friction = 0.3;
physicsWorld.defaultContactMaterial.restitution = 0.0;
const cannonDebugger = new CannonDebugger(scene, physicsWorld, {
  color: 0x00ff00, 
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

// Car physics parameters
const CAR_MASS = 400;
const MAX_STEERING = 0.5;
const STEERING_SPEED = 0.05;
const WHEEL_RADIUS = 0.3;

// Load the car model
const loader = new GLTFLoader();
loader.load(
  '/models/car.glb',
  (gltf) => {
    car = gltf.scene;
    scene.add(car);

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
    
    // Store wheel references globally
    window.carWheels = wheels;
    
    // Create a more accurate car body shape - lower and flatter
    const carShape = new CANNON.Box(new CANNON.Vec3(0.25, 0.18, 0.45));
    carBody = new CANNON.Body({
      mass: CAR_MASS,
      material: carMaterial,
      position: new CANNON.Vec3(0, 1, 0), 
      linearDamping: 0.1, 
      angularDamping: 0.01, 
    });
    
    // Add the shape offset slightly up to position chassis correctly
    carBody.addShape(carShape, new CANNON.Vec3(0, 0.2, 0));
    physicsWorld.addBody(carBody);
    
    // Add these vehicle state properties to the carBody
    carBody.steering = 0; 
    carBody.wheelRotation = 0; 
    carBody.currentSpeed = 0;

    // At car initialization, after creating carBody:
    const startRotation = new CANNON.Quaternion().setFromAxisAngle(
      new CANNON.Vec3(0, 1, 0), 
      Math.PI
    );
    carBody.quaternion.copy(startRotation);
   
    car.rotateY(Math.PI);

    console.log('Car loaded with wheels:', wheels);
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

const trackRoadWideCornerSmallScalar = 0.9;
// Modified trackColliders without the ground pieces
const trackColliders = {
  'track-road-wide-straight': [
    {shape: "box", dimensionsion: [0.1, 1, 4], position: [-0.95, 0.1, 0], rotation: [0, 0, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 4], position: [0.95, 0.1, 0], rotation: [0, 0, 0]},
  ],
  'track-road-wide-curve': [
    {shape: "box", dimensionsion: [0.1, 1, 2], position: [-0.65, 0.1, -0.65], rotation: [0, -Math.PI/(4.3), 0]},
    {shape: "box", dimensionsion: [0.1, 1, 2], position: [0.65, 0.1, 0.65], rotation: [0, -Math.PI/(4.3), 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.7], position: [-0.05, 0.1, 1.7], rotation: [0, -Math.PI/30, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.7], position: [0.02, 0.1, -1.7], rotation: [0, -Math.PI/70, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 2.2], position: [1.6, 0.1, -1], rotation: [0, -Math.PI/9, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 2.2], position: [-1.6, 0.1, 1], rotation: [0, -Math.PI/9, 0]},
  ],
  'track-road-wide-corner-small': [
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-1.2*trackRoadWideCornerSmallScalar,0.1,0.097296*trackRoadWideCornerSmallScalar], rotation: [0, Math.PI/2, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-0.915*trackRoadWideCornerSmallScalar,0.1,0.13487*trackRoadWideCornerSmallScalar], rotation: [0, 5*Math.PI/12, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-0.648648*trackRoadWideCornerSmallScalar,0.1,0.24503*trackRoadWideCornerSmallScalar], rotation: [0, 4*Math.PI/12, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-0.420271*trackRoadWideCornerSmallScalar,0.1,0.420*trackRoadWideCornerSmallScalar], rotation: [0, 3*Math.PI/12, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-0.24503*trackRoadWideCornerSmallScalar,0.1,0.648648*trackRoadWideCornerSmallScalar], rotation: [0, 2*Math.PI/12, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-0.13487*trackRoadWideCornerSmallScalar,0.1,0.914599*trackRoadWideCornerSmallScalar], rotation: [0, 1*Math.PI/12, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.3], position: [-0.0973*trackRoadWideCornerSmallScalar,0.1,1.2*trackRoadWideCornerSmallScalar], rotation: [0, 0, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [2.05*trackRoadWideCornerSmallScalar,0.1,1.2*trackRoadWideCornerSmallScalar], rotation: [0, 0, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [2.0*trackRoadWideCornerSmallScalar,0.1,0.635*trackRoadWideCornerSmallScalar], rotation: [0, Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [1.86*trackRoadWideCornerSmallScalar,0.1,0.0875*trackRoadWideCornerSmallScalar], rotation: [0, 2*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [1.62*trackRoadWideCornerSmallScalar,0.1,-0.426*trackRoadWideCornerSmallScalar], rotation: [0, 3*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [1.29*trackRoadWideCornerSmallScalar,0.1,-0.891*trackRoadWideCornerSmallScalar], rotation: [0, 4*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [0.891*trackRoadWideCornerSmallScalar,0.1,-1.29*trackRoadWideCornerSmallScalar], rotation: [0, 5*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [0.426*trackRoadWideCornerSmallScalar,0.1,-1.62*trackRoadWideCornerSmallScalar], rotation: [0, 6*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [-0.0875*trackRoadWideCornerSmallScalar,0.1,-1.86*trackRoadWideCornerSmallScalar], rotation: [0, 7*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [-0.635*trackRoadWideCornerSmallScalar,0.1,-2*trackRoadWideCornerSmallScalar], rotation: [0, 8*Math.PI/18, 0]},
    {shape: "box", dimensionsion: [0.1, 1, 0.6], position: [-1.2*trackRoadWideCornerSmallScalar,0.1,-2.05*trackRoadWideCornerSmallScalar], rotation: [0, 9*Math.PI/18, 0]},
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
          `/models/track/${filename}`, 
          (gltf) => {
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
    }
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

// Add this function to your code
function loadColliderMeshForTrackPiece(trackType) {
  return new Promise((resolve, reject) => {
    const colliderLoader = new GLTFLoader();
    colliderLoader.load(
      `/models/track/colliders/${trackType}.glb`, 
      (gltf) => {
        const colliderData = [];
        
        // Process all meshes in the collider file
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            // Create a bounding box for the mesh
            child.geometry.computeBoundingBox();
            const box = child.geometry.boundingBox;
            
            // Calculate dimensions (size) from bounding box
            const size = new THREE.Vector3();
            box.getSize(size);
            
            // Get world position and rotation
            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            
            const worldQuat = new THREE.Quaternion();
            child.getWorldQuaternion(worldQuat);
            
            // Store collider info
            colliderData.push({
              size: [size.x, size.y, size.z],
              position: [worldPos.x, worldPos.y, worldPos.z],
              quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w]
            });
          }
        });
        
        resolve(colliderData);
      },
      undefined,
      (error) => {
        console.error(`Error loading collider for ${trackType}:`, error);
        reject(error);
      }
    );
  });
}

// Modify your addTrackPhysics function
function addTrackPhysics(trackData) {
  // Load all collider meshes first
  const colliderPromises = trackData.track.map(segment => {
    return loadColliderMeshForTrackPiece(segment.type)
      .catch(error => {
        console.warn(`Using fallback colliders for ${segment.type}`);
        // Return null if loading fails, we'll use fallback colliders
        return null;
      });
  });
  
  // After all colliders are loaded (or failed)
  Promise.all(colliderPromises).then(colliderResults => {
    // Now create physics bodies with the collider data
    trackData.track.forEach((segment, index) => {
      const trackBody = new CANNON.Body({
        mass: 0,
        material: groundMaterial,
        position: new CANNON.Vec3(...segment.position),
      });
      
      // Apply rotation from track data
      const rotationQuat = new CANNON.Quaternion();
      rotationQuat.setFromAxisAngle(
        new CANNON.Vec3(0, 1, 0), 
        segment.rotation[1]
      );
      trackBody.quaternion = rotationQuat;
      
      // If we have loaded colliders, use those
      const colliderData = colliderResults[index];
      if (colliderData) {
        // Create box shapes from the loaded collider data
        colliderData.forEach(collider => {
          const shape = new CANNON.Box(
            new CANNON.Vec3(collider.size[0]/2, collider.size[1]/2, collider.size[2]/2)
          );
          
          // Create quaternion from the collider's rotation
          const colliderQuat = new CANNON.Quaternion(
            collider.quaternion[0],
            collider.quaternion[1],
            collider.quaternion[2],
            collider.quaternion[3]
          );
          
          // Add the shape to the body with position and rotation
          trackBody.addShape(
            shape, 
            new CANNON.Vec3(...collider.position),
            colliderQuat
          );
        });
      } else {
        // Use fallback colliders if loading failed
        if (trackColliders[segment.type]) {
          trackColliders[segment.type].forEach(collider => {
            const shape = new CANNON.Box(
              new CANNON.Vec3(...collider.dimensionsion.map(d => d / 2))
            );
            
            let rotation = new CANNON.Quaternion();
            rotation.setFromAxisAngle(
              new CANNON.Vec3(0, 1, 0), 
              collider.rotation[1]
            );
            
            trackBody.addShape(
              shape, 
              new CANNON.Vec3(...collider.position), 
              rotation
            );
          });
        }
      }
      
      physicsWorld.addBody(trackBody);
    });
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
  const deltaTime = Math.min(clock.getDelta(), 0.1); // Cap deltaTime to avoid lge jumps
  
  // Only update physics if car is loaded
  if (carBody && car) {
    // Reset forces from previous frame
    carBody.force.setZero();
    carBody.torque.setZero();
    
    // Lock rotation to Y axis only - add this new code
    carBody.angularVelocity.x = 0;
    carBody.angularVelocity.z = 0;
    
    // Keep car upright by adjusting quaternion
    const carQuaternion = carBody.quaternion;
    const upVector = new CANNON.Vec3(0, 1, 0);
    
    // Create a quaternion that only preserves Y rotation
    const yRotation = new CANNON.Quaternion();
    const euler = new CANNON.Vec3();
    carQuaternion.toEuler(euler);
    yRotation.setFromEuler(0, euler.y, 0);
    
    // Smoothly adjust toward upright orientation
    carBody.quaternion = carQuaternion.slerp(yRotation, 0.1);
    
    // Get the current vehicle orientation
    const carRotation = new THREE.Euler().setFromQuaternion(car.quaternion);
    const forwardDirection = new THREE.Vector3(0, 0, -1).applyEuler(carRotation); // The car's forward
    const rightDirection = new THREE.Vector3(1, 0, 0).applyEuler(carRotation); // The car's right
    
    // Calculate the car's current velocity in forward direction
    const velocity = carBody.velocity;
    const forwardVelocity = forwardDirection.clone().multiplyScalar(
      forwardDirection.dot(new THREE.Vector3(velocity.x, velocity.y, velocity.z))
    );
    const currentSpeed = forwardVelocity.length() * (forwardVelocity.dot(forwardDirection) < 0 ? -1 : 1);
    carBody.currentSpeed = currentSpeed;
    
    // Handle steering input
    const targetSteering = keyState.a ? MAX_STEERING : keyState.d ? -MAX_STEERING : 0;
    carBody.steering = THREE.MathUtils.lerp(carBody.steering, targetSteering, STEERING_SPEED);
    
    // Handle acceleration and braking by directly modifying velocity
    const maxSpeed = 20;
    const acceleration = 0.2; 
    const deceleration = 0.3; 
    const naturalDeceleration = 0.05; 

    // Calculate target speed based on input
    let targetSpeed = 0;
    if (keyState.s) targetSpeed = maxSpeed;
    if (keyState.w) targetSpeed = -maxSpeed * 0.7;

    // Calculate new speed based on target and current speed
    let newSpeed = currentSpeed;
    if (Math.abs(targetSpeed) > Math.abs(currentSpeed)) {
      // Accelerating
      newSpeed += Math.sign(targetSpeed) * acceleration;
      if (Math.sign(targetSpeed) > 0 && newSpeed > targetSpeed) newSpeed = targetSpeed;
      if (Math.sign(targetSpeed) < 0 && newSpeed < targetSpeed) newSpeed = targetSpeed;
    } else if (targetSpeed === 0) {
      // Natural deceleration when no input
      newSpeed -= Math.sign(newSpeed) * naturalDeceleration;
      if (Math.abs(newSpeed) < naturalDeceleration) newSpeed = 0;
    } else if (Math.sign(targetSpeed) !== Math.sign(currentSpeed)) {
      // Braking (going in opposite direction)
      newSpeed += Math.sign(targetSpeed) * deceleration;
    }

    // Set the new velocity directly
    if (newSpeed !== 0) {
      const newVelocity = forwardDirection.clone().multiplyScalar(newSpeed);
      
      // Keep the Y component of velocity (for gravity/jumps)
      carBody.velocity.x = newVelocity.x;
      carBody.velocity.z = newVelocity.z;
      
      // Only modify Y velocity if on a ramp or in air - keep gravity working
      if (Math.abs(forwardDirection.y) > 0.1) {
        carBody.velocity.y = newVelocity.y;
      }
    } else if (Math.abs(currentSpeed) < 0.1) {
      // If almost stopped, just zero out the horizontal velocity
      carBody.velocity.x = 0;
      carBody.velocity.z = 0;
    }
    
    // Replace the current steering code with this:
    if (Math.abs(currentSpeed) > 0.1) { // Only steer when moving
      // Calculate how much to rotate based on steering, speed, and time
      let rotationAmount = carBody.steering * Math.min(Math.abs(currentSpeed) * 10, 10) * 0.05;
      
      // Flip steering direction when in reverse
      if (currentSpeed > 0) {
        rotationAmount = -rotationAmount;
      }
      
      // Directly modify angular velocity instead of applying torque
      carBody.angularVelocity.set(
        0,
        rotationAmount * 10,  // Set Y angular velocity directly based on steering
        0
      );
      
    }
    
    // Update wheel rotation based on speed
    carBody.wheelRotation -= currentSpeed * deltaTime * 3 / WHEEL_RADIUS;
    
    // Update visual wheel rotation
    if (window.carWheels) {
      // Rotate wheels around X axis (rolling)
      const wheels = window.carWheels;
      Object.keys(wheels).forEach(key => {
        const wheel = wheels[key];
        // Reset rotation and then apply new rotation
        wheel.rotation.set(0, 0, 0);
        
        // Apply steering to front wheels
        if (key === 'bl' || key === 'br') {
          wheel.rotation.y = carBody.steering;
        }
        
        // Apply rolling rotation to all wheels
        wheel.rotateX(carBody.wheelRotation);
      });
    }
    
    // Step the physics world
    physicsWorld.step(1/120, deltaTime, 4);
    
    // Update car position
    car.position.copy(carBody.position);
    car.quaternion.copy(carBody.quaternion);
  }

  // Update the debugger to show collision boxes
  cannonDebugger.update();

  // Update camera position
  if (car) {
    const carPosition = car.position;
    camera.position.set(
      carPosition.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
      carPosition.y + Math.sin(cameraPitch) * cameraDistance,
      carPosition.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance
    );
    camera.lookAt(carPosition);
  }

  renderer.render(scene, camera);
}
animate();

// Handle window resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});