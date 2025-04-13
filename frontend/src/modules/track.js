import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Function to load the track model and add to scene
export function loadTrackModel(ammo, mapId = "map1", scene, physicsWorld, callback) {
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/track.glb`,
    (gltf) => {
      const track = gltf.scene;
      
      // Scale to match the world scale
      track.scale.set(8, 8, 8);
      
      // Position at origin
      track.position.set(0, 0, 0);
      track.rotation.set(0, 0, 0);
      
      // Make sure track casts and receives shadows
      track.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true; // Enable for better lighting
          
          // Enhance track materials
          if (node.material) {
            node.material.roughness = 0.7;
            node.material.metalness = 0.3;
          }
        }
      });
      
      // Add to scene
      scene.add(track);
      console.log(`Map ${mapId} track loaded successfully`);
      
      // Add physics collider for the track
      addTrackCollider(track, ammo, physicsWorld);
      
      // Call the callback with the track model if provided
      if (callback && typeof callback === 'function') {
        callback(track);
      }
    },
    (xhr) => {
      console.log(`Loading track: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
    },
    (error) => {
      console.error(`Error loading track for ${mapId}:`, error);
    }
  );
}

// Function to create a physics collider for the entire track
function addTrackCollider(trackModel, ammo, physicsWorld) {
  // Extract all mesh geometries from the track
  let vertices = [];
  let indices = [];
  let indexOffset = 0;
  
  // Update world matrix to apply all transformations
  trackModel.updateMatrixWorld(true);
  
  // Traverse all meshes in the track model
  trackModel.traverse(child => {
    if (child.isMesh && child.geometry) {
      // Get vertices
      const positionAttr = child.geometry.getAttribute('position');
      const vertexCount = positionAttr.count;
      
      // Apply mesh's transform to vertices
      const worldMatrix = child.matrixWorld;
      
      // Extract vertices with transformation
      for (let i = 0; i < vertexCount; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
        vertex.applyMatrix4(worldMatrix);
        
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
  const triangleMesh = new ammo.btTriangleMesh();
  
  // Add all triangles to the mesh
  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i] * 3;
    const i2 = indices[i+1] * 3;
    const i3 = indices[i+2] * 3;
    
    const v1 = new ammo.btVector3(vertices[i1], vertices[i1+1], vertices[i1+2]);
    const v2 = new ammo.btVector3(vertices[i2], vertices[i2+1], vertices[i2+2]);
    const v3 = new ammo.btVector3(vertices[i3], vertices[i3+1], vertices[i3+2]);
    
    triangleMesh.addTriangle(v1, v2, v3, false);
    
    // Clean up Ammo vectors
    ammo.destroy(v1);
    ammo.destroy(v2);
    ammo.destroy(v3);
  }
  
  // Create track collision shape using triangle mesh
  const trackShape = new ammo.btBvhTriangleMeshShape(triangleMesh, true, true);

  // Add a slight margin to the track collision shape to smooth transitions
  trackShape.setMargin(0.05); // 5cm margin helps smooth over minor gaps
  
  // The rigid body uses identity transform since all transformations are in the vertices
  const trackTransform = new ammo.btTransform();
  trackTransform.setIdentity();
  
  // Create motion state
  const motionState = new ammo.btDefaultMotionState(trackTransform);
  
  // Set up track rigid body (static - mass = 0)
  const mass = 0;
  const localInertia = new ammo.btVector3(0, 0, 0);
  
  // Create rigid body
  const rbInfo = new ammo.btRigidBodyConstructionInfo(
    mass, motionState, trackShape, localInertia
  );
  
  const trackBody = new ammo.btRigidBody(rbInfo);
  trackBody.setFriction(1.0); // Increase from 0.8 for better grip on ramps
  
  // Add to physics world
  physicsWorld.addRigidBody(trackBody);
  
  console.log("Track physics collider created successfully");
}

// Function to load map decorations
export function loadMapDecorations(mapId = "map1", scene, renderer, camera) {
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/decorations.glb`,
    (gltf) => {
      const decorations = gltf.scene;
      
      // Scale to match track scale
      decorations.scale.set(8, 8, 8);
      decorations.position.set(0, 0, 0);
      
      // Important: Process all materials in the decoration model
      const materials = new Set();
      
      decorations.traverse((node) => {
        if (node.isMesh) {
          // Critical: Clone materials to ensure unique instances
          if (node.material) {
            // Add to set to track unique materials
            materials.add(node.material);
            
            // Create a new instance of the material
            node.material = node.material.clone();
            
            // Enhance material properties
            node.material.roughness = 0.7;
            node.material.metalness = 0.2;
            node.material.needsUpdate = true;
            
            // Enable shadows
            node.castShadow = true;
            node.receiveShadow = true;
          }
        }
      });
      
      console.log(`Processed ${materials.size} unique materials in decorations`);
      
      // Add to scene
      scene.add(decorations);
      
      // Force a renderer update to ensure materials are processed
      if (renderer && camera) {
        renderer.renderLists.dispose();
        renderer.render(scene, camera);
      }
      
      console.log(`Map ${mapId} decorations loaded successfully`);
    },
    undefined,
    (error) => {
      console.error(`Error loading map decorations for ${mapId}:`, error);
    }
  );
}

// Export checkGroundCollision to be used from main.js
export function checkGroundCollision(ammo, carBody, resetFunction) {
  // Get the car's position
  if (!carBody) return;
  
  const transform = new ammo.btTransform();
  const motionState = carBody.getMotionState();
  motionState.getWorldTransform(transform);
  const position = transform.getOrigin();
  
  // If car is below certain height, reset it
  if (position.y() < 0) {
    console.log("Car fell off track - resetting position");
    if (resetFunction) resetFunction(ammo);
  }
  
  // Clean up
  ammo.destroy(transform);
}