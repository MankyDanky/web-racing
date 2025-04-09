// utils.js - Utility functions
import * as THREE from 'three';

// Create enhanced lighting for the scene
export function setupEnhancedLighting(scene) {
  // Remove existing lights
  scene.children.forEach(child => {
    if (child.isLight) {
      // Dispose shadow maps if they exist
      if (child.shadow && child.shadow.map) {
        child.shadow.map.dispose();
      }
      scene.remove(child);
    }
  });
  
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xcccccc, 0.6);
  scene.add(ambientLight);
  
  // Primary directional light (sun)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
  directionalLight.position.set(50, 100, 40);
  directionalLight.castShadow = true;
  
  // Configure shadows
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 500;
  directionalLight.shadow.bias = -0.0003;
  
  // Set shadow camera frustum
  directionalLight.shadow.camera.left = -100;
  directionalLight.shadow.camera.right = 100;
  directionalLight.shadow.camera.top = 100;
  directionalLight.shadow.camera.bottom = -100;
  
  scene.add(directionalLight);
  
  // Secondary light from different angle
  const secondaryLight = new THREE.DirectionalLight(0xffffcc, 1.0);
  secondaryLight.position.set(-30, 70, -50);
  secondaryLight.castShadow = true;
  
  // Configure secondary shadows
  secondaryLight.shadow.mapSize.width = 1024;
  secondaryLight.shadow.mapSize.height = 1024;
  secondaryLight.shadow.camera.near = 1;
  secondaryLight.shadow.camera.far = 400;
  secondaryLight.shadow.bias = -0.0003;
  
  // Smaller frustum for this light
  secondaryLight.shadow.camera.left = -50;
  secondaryLight.shadow.camera.right = 50;
  secondaryLight.shadow.camera.top = 50;
  secondaryLight.shadow.camera.bottom = -50;
  
  scene.add(secondaryLight);
  
  // Hemisphere light for ambient environment
  const hemisphereLight = new THREE.HemisphereLight(0xaaccff, 0x70a070, 0.8);
  scene.add(hemisphereLight);
  
  console.log("Enhanced lighting setup completed with shadow maps");
}