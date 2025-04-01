import * as THREE from 'three';
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

// Create the ground
const groundGeometry = new THREE.PlaneGeometry(100, 100); // Large plane
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White material
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate the plane to make it horizontal
ground.position.y = -0.5; // Position it slightly below the car
scene.add(ground);

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

// Load the car model
const loader = new GLTFLoader();
loader.load(
  '/models/car.glb',
  (gltf) => {
    const car = gltf.scene;
    car.scale.set(2, 2, 2);
    car.rotateY(Math.PI / 2);
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

    console.log('Wheels:', wheels); // Debug to ensure wheels are found

    // Variables for steering
    const maxSteeringAngle = Math.PI / 6; // Maximum steering angle (30 degrees)
    let steeringAngle = 0; // Current steering angle
    let wheelRotation = 0; // Current wheel rotation
    let velocity = 0;
    const acceleration = 2; // Acceleration factor
    const maxSpeed = 1; // Maximum speed

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);


      // Rotate front wheels for steering
      if (keyState.a) {
        steeringAngle = Math.min(steeringAngle + 0.02, maxSteeringAngle); // Turn left
      } else if (keyState.d) {
        steeringAngle = Math.max(steeringAngle - 0.02, -maxSteeringAngle); // Turn right
      } else {
        // Gradually return wheels to neutral position
        if (steeringAngle > 0) {
          steeringAngle = Math.max(steeringAngle - 0.02, 0);
        } else if (steeringAngle < 0) {
          steeringAngle = Math.min(steeringAngle + 0.02, 0);
        }
      }

      let direction = 0;
      if (keyState.w ^ keyState.s) {
        direction = keyState.w ? 1 : -1; // Forward or backward
        velocity = Math.min(Math.max(velocity + acceleration * clock.getDelta() * direction, -maxSpeed), maxSpeed) // Set velocity based on movement
      } else {
        if (velocity > 0) {
          velocity = Math.max(0, velocity - clock.getDelta())
        } else {
          velocity = Math.min(0, velocity + clock.getDelta())
        }
      }

      // Calculate movement direction based on front wheel angle
      const frontWheelAngle = steeringAngle
      car.rotation.y += frontWheelAngle * 0.05 * velocity;
      const moveX = Math.sin(car.rotation.y + frontWheelAngle) * velocity;
      const moveZ = Math.cos(car.rotation.y + frontWheelAngle) * velocity;
      car.position.x += moveX;
      car.position.z += moveZ;
      console.log(velocity)

      // Rotate the wheels based on velocity and steering
      wheelRotation += velocity ; // Adjust rotation speed as needed

      // Apply combined rotation to front wheels
      const steeringQuaternion = new THREE.Quaternion();
      const rollingQuaternion = new THREE.Quaternion();

      wheels.fl.rotation.set(0, 0, 0); // Reset rotation before applying quaternions
      wheels.fr.rotation.set(0, 0, 0); // Reset rotation before applying quaternions

      // Steering rotation (y-axis)
      steeringQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), steeringAngle);

      // Rolling rotation (x-axis)
      rollingQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -wheelRotation);

      // Combine the rotations
      wheels.bl.quaternion.copy(steeringQuaternion).multiply(rollingQuaternion);
      wheels.br.quaternion.copy(steeringQuaternion).multiply(rollingQuaternion);

      // Apply rolling rotation to rear wheels (no steering)
      wheels.fl.rotation.x -= wheelRotation;
      wheels.fr.rotation.x -= wheelRotation;

      // Anchor the camera to the car
      const carPosition = car.position;
      camera.position.set(carPosition.x + Math.sin(car.rotation.y) * -5, carPosition.y + 2, carPosition.z + Math.cos(car.rotation.y) * -5); // Adjust camera position
      camera.lookAt(new THREE.Vector3(carPosition.x, carPosition.y + 1, carPosition.z)); // Make the camera look at the car


      renderer.render(scene, camera);
    }
    animate();
  },
  undefined,
  (error) => {
    console.error('An error occurred while loading the model:', error);
  }
);

// Handle window resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});