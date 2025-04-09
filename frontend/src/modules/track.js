// track.js - Track and decoration loading
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Load track model and add physics
export function loadTrackModel(ammo, mapId, gameState) {
  const { scene, physicsWorld } = gameState;
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/track.glb`,
    (gltf) => {
      const track = gltf.scene;
      
      // Apply scale and position
      track.scale.set(8, 8, 8);
      track.position.set(0, 0, 0);
      track.rotation.set(0, 0, 0);
      
      // Configure materials and shadows
      track.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          
          if (node.material) {
            node.material.roughness = 0.7;
            node.material.metalness = 0.3;
          }
        }
      });
      
      // Add to scene
      scene.add(track);
      console.log(`Map ${mapId} track loaded successfully`);
      
      // Add track collider
      addTrackCollider(track, ammo, physicsWorld);
    },
    (xhr) => {
      console.log(`Loading track: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
    },
    (error) => {
      console.error(`Error loading track for ${mapId}:`, error);
    }
  );
}

// Create physics collider for track
function addTrackCollider(trackModel, ammo, physicsWorld) {
  // Extract mesh geometries
  let vertices = [];
  let indices = [];
  let indexOffset = 0;
  
  // Apply all transformations
  trackModel.updateMatrixWorld(true);
  
  // Traverse meshes
  trackModel.traverse(child => {
    if (child.isMesh && child.geometry) {
      // Get vertices
      const positionAttr = child.geometry.getAttribute('position');
      const vertexCount = positionAttr.count;
      
      // Apply mesh's transform
      const worldMatrix = child.matrixWorld;
      
      // Process vertices with transformation
      for (let i = 0; i < vertexCount; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
        vertex.applyMatrix4(worldMatrix);
        
        vertices.push(vertex.x, vertex.y, vertex.z);
      }
      
      // Process indices
      if (child.geometry.index) {
        const indices32 = child.geometry.index.array;
        for (let i = 0; i < indices32.length; i++) {
          indices.push(indices32[i] + indexOffset);
        }
      } else {
        // No indices - use vertices directly
        for (let i = 0; i < vertexCount; i++) {
          indices.push(i + indexOffset);
        }
      }
      
      indexOffset += vertexCount;
    }
  });
  
  // Create Ammo triangle mesh
  const triangleMesh = new ammo.btTriangleMesh();
  
  // Add triangles to mesh
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
  
  // Create track shape
  const trackShape = new ammo.btBvhTriangleMeshShape(triangleMesh, true, true);
  
  // Create rigid body (static - mass = 0)
  const trackTransform = new ammo.btTransform();
  trackTransform.setIdentity();
  
  const motionState = new ammo.btDefaultMotionState(trackTransform);
  const mass = 0;
  const localInertia = new ammo.btVector3(0, 0, 0);
  
  const rbInfo = new ammo.btRigidBodyConstructionInfo(
    mass, motionState, trackShape, localInertia
  );
  
  const trackBody = new ammo.btRigidBody(rbInfo);
  trackBody.setFriction(0.8);
  
  // Add to physics world
  physicsWorld.addRigidBody(trackBody);
  
  // Add ground respawn plane at y = -10
  addGroundRespawnPlane(ammo, physicsWorld);
  
  console.log("Track physics collider created successfully");
}

// Add invisible plane to detect when car falls off track
function addGroundRespawnPlane(ammo, physicsWorld) {
  // Create a large ground plane below the track
  const groundShape = new ammo.btStaticPlaneShape(
    new ammo.btVector3(0, 1, 0), // Normal pointing up
    -10 // Distance from origin along normal (y = -10)
  );
  
  // Create transform
  const groundTransform = new ammo.btTransform();
  groundTransform.setIdentity();
  
  // Create motion state
  const groundMotionState = new ammo.btDefaultMotionState(groundTransform);
  
  // Create rigid body (static - mass = 0)
  const groundInfo = new ammo.btRigidBodyConstructionInfo(
    0, groundMotionState, groundShape, new ammo.btVector3(0, 0, 0)
  );
  
  const groundBody = new ammo.btRigidBody(groundInfo);
  groundBody.setUserIndex(999); // Special ID for identification
  
  // Add to physics world
  physicsWorld.addRigidBody(groundBody);
  console.log("Ground respawn plane created at y = -10");
  
  return groundBody;
}

// Load map decorations
export function loadMapDecorations(mapId, gameState) {
  const { scene, renderer, camera } = gameState;
  const loader = new GLTFLoader();
  
  loader.load(
    `/models/maps/${mapId}/decorations.glb`,
    (gltf) => {
      const decorations = gltf.scene;
      
      // Scale to match track
      decorations.scale.set(8, 8, 8);
      decorations.position.set(0, 0, 0);
      
      // Process materials for lighting
      const materials = new Set();
      
      decorations.traverse((node) => {
        if (node.isMesh) {
          if (node.material) {
            materials.add(node.material);
            
            // Clone material to ensure unique instance
            node.material = node.material.clone();
            
            // Enhance properties
            node.material.roughness = 0.7;
            node.material.metalness = 0.2;
            node.material.needsUpdate = true;
            
            // Enable shadows
            node.castShadow = true;
            node.receiveShadow = true;
          }
        }
      });
      
      // Add to scene
      scene.add(decorations);
      
      // Force renderer update
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