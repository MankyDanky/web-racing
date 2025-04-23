import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

class LobbyBackground {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.availableMaps = ['map1', 'map2']; // Define all available maps
    this.mapModels = {}; // Store models for each map
    this.currentMap = 'map1'; // Default active map
    this.clock = new THREE.Clock();
    this.loadingManager = new THREE.LoadingManager();
    this.totalAssetsToLoad = this.availableMaps.length * 3; // 3 files per map (track, gates, decorations)
    this.loadedAssets = 0;
    
    this.setupLoadingManager();
    this.init();
  }
  
  setupLoadingManager() {
    // Setup loading manager events
    this.loadingManager.onLoad = () => {
      console.log('All map assets loaded successfully');
      this.hideLoadingScreen();
    };
    
    this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
      console.log(`Loaded ${itemsLoaded} of ${itemsTotal} files`);
      // Update loading progress if needed
    };
    
    this.loadingManager.onError = (url) => {
      console.error('Error loading', url);
    };
  }
  
  hideLoadingScreen() {
    setTimeout(() => {
      const loadingScreen = document.getElementById('loading-screen');
      if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        
        // Remove from DOM after fade out
        setTimeout(() => {
          loadingScreen.style.display = 'none';
        }, 500);
      }
    }, 500);
  }
  
  init() {
    // Create scene
    this.scene = new THREE.Scene();
    setupCartoonySkybox(this.scene); 
    
    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      60, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      1500
    );
    this.camera.position.set(0, 10, 40);
    this.camera.lookAt(0, 0, 0);
    
    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.physicallyCorrectLights = true;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Add canvas to page as background
    const canvas = this.renderer.domElement;
    canvas.id = 'background-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '-1';
    document.body.insertBefore(canvas, document.body.firstChild);
    
    // Add orbit controls for smooth camera movement
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    
    this.setupLights();
    
    // Load all available maps at once
    this.preloadAllMaps();

    // Handle window resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Start animation loop
    this.animate();
  }
  
  setupLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    this.scene.add(ambientLight);
    
    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3.5);
    directionalLight.position.set(50, 100, 50);
    
    this.scene.add(directionalLight);
  }
  
  // Preload all available maps
  preloadAllMaps() {
    console.log('Preloading all map assets...');
    
    // Create a group for each map to hold its models
    this.availableMaps.forEach(mapId => {
      this.mapModels[mapId] = {
        group: new THREE.Group(),
        loaded: false
      };
      
      // Add the group to the scene but hide it initially
      this.scene.add(this.mapModels[mapId].group);
      this.mapModels[mapId].group.visible = mapId === this.currentMap;
      
      // Load the map's assets
      this.loadMapAssets(mapId);
    });
  }
  
  // Load assets for a specific map
  loadMapAssets(mapId) {
    console.log(`Loading assets for ${mapId}`);
    const loader = new GLTFLoader(this.loadingManager);
    const mapGroup = this.mapModels[mapId].group;
    
    // Load track
    loader.load(`/models/maps/${mapId}/track.glb`, (gltf) => {
      const track = gltf.scene;
      track.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = true;
        }
      });
      mapGroup.add(track);
      this.mapModels[mapId].track = track;
    });
    
    // Load gates
    loader.load(`/models/maps/${mapId}/gates.glb`, (gltf) => {
      const gates = gltf.scene;
      gates.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      mapGroup.add(gates);
      this.mapModels[mapId].gates = gates;
    });
    
    // Load decorations
    loader.load(`/models/maps/${mapId}/decorations.glb`, (gltf) => {
      const decorations = gltf.scene;
      
      decorations.traverse((child) => {
        if (child.isMesh) {
          // Force material to be MeshStandardMaterial
          if (child.material) {
            // Clone current material properties
            const oldMat = child.material;
            const color = oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff);
            const map = oldMat.map;
            
            // Create new standard material
            const newMat = new THREE.MeshStandardMaterial({
              color: color,
              map: map,
              metalness: 0.1,
              roughness: 0.8
            });
            
            // Replace the material
            child.material = newMat;
            child.material.needsUpdate = true;
          }
          
          // Set shadow properties
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      mapGroup.add(decorations);
      this.mapModels[mapId].decorations = decorations;
      
      // Mark this map as fully loaded
      this.mapModels[mapId].loaded = true;
      
      // Force a couple of renders to update materials
      if (mapId === this.currentMap) {
        setTimeout(() => {
          for (let i = 0; i < 3; i++) {
            this.renderer.render(this.scene, this.camera);
          }
        }, 100);
      }
    });
  }
  
  // Switch to a different map - instantly, since all maps are preloaded
  updateMap(mapId) {
    if (this.currentMap === mapId || !this.mapModels[mapId]) return;
    
    // Hide current map
    if (this.mapModels[this.currentMap]) {
      this.mapModels[this.currentMap].group.visible = false;
    }
    
    // Show selected map
    this.mapModels[mapId].group.visible = true;
    this.currentMap = mapId;
    
    console.log(`Switched to ${mapId}`);
  }
  
  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  animate() {
    requestAnimationFrame(this.animate.bind(this));
    
    // Update controls
    this.controls.update();
    
    // Render scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Add this function to your code, before or after setupEnhancedLighting()
function setupCartoonySkybox(scene) {
  // Create shader materials for gradient skybox
  const skyGeo = new THREE.SphereGeometry(1000, 32, 32); // Large sphere to contain the scene
  
  // Shader material for gradient
  const uniforms = {
    topColor: { value: new THREE.Color(0x88ccff) },  // Light blue at top
    bottomColor: { value: new THREE.Color(0xbbe2ff) }, // White/light color at horizon
    offset: { value: 0 },
    exponent: { value: 0.6 }
  };
  
  const skyMat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }
    `,
    side: THREE.BackSide // Render the inside of the sphere
  });
  
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
}

// Export the background class and make it available globally
window.LobbyBackground = LobbyBackground;
export default LobbyBackground;