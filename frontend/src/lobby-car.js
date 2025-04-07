class CarPreview {
  constructor() {
    this.container = document.getElementById('car-model-container');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.car = null;
    this.isInitialized = false;

    this.init();
  }

  init() {
    if (!this.container) return;

    // Create scene
    this.scene = new THREE.Scene();
    
    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 2, 50);
    pointLight.position.set(0, 10, 5);
    this.scene.add(pointLight);
    
    // Set up camera with adjusted position
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.set(0, 3, 12); // Moved back to show bigger car
    
    // Set up renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    
    // Load car model
    this.loadCarModel();
    
    // Add resize listener
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Start animation
    this.animate();
  }
  
  loadCarModel() {
    const loader = new THREE.GLTFLoader();
    
    // Try to load the car model from your game
    loader.load('/models/car.glb', (gltf) => {
      this.car = gltf.scene;
      
      // Position and scale the car - raised position and increased scale
      this.car.position.set(0, 2, 0); // Raised position by moving Y coordinate up
      this.car.rotation.y = Math.PI;
      this.car.scale.set(8, 8, 8); // Increased scale for better visibility
      
      // Add car to scene
      this.scene.add(this.car);
      this.isInitialized = true;
    }, 
    undefined, 
    (error) => {
      console.error('Error loading car model:', error);
    });
  }
  
  onWindowResize() {
    if (!this.camera || !this.renderer || !this.container) return;
    
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  
  animate() {
    requestAnimationFrame(this.animate.bind(this));
    
    if (this.car && this.isInitialized) {
      // Rotate the car slowly
      this.car.rotation.y += 0.01;
    }
    
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Initialize car preview when the page loads
document.addEventListener('DOMContentLoaded', () => {
  const carPreview = new CarPreview();
});