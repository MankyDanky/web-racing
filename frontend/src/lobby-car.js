class CarPreview {
  constructor() {
    this.container = document.getElementById('car-model-container');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.car = null;
    this.isInitialized = false;
    this.currentColor = sessionStorage.getItem('carColor') || 'red';
    this.carRotation = 0;
    this.carRotationSpeed = 0.01;

    this.init();
    this.setupColorChangeListener();
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
    
    // Load car model with current color
    this.loadCarModel(this.currentColor);
    
    // Add resize listener
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Start animation
    this.animate();
  }
  
  loadCarModel(color = 'red') {
    const loader = new THREE.GLTFLoader();
    
    // Remove existing car if there is one
    if (this.car) {
      this.scene.remove(this.car);
      this.car = null;
    }
    
    // Load the colored car model
    loader.load(`/models/car_${color}.glb`, (gltf) => {
      this.car = gltf.scene;
      
      // Position and scale the car
      this.car.position.set(0, 2, 0);
      this.car.rotation.y = this.carRotation;
      this.car.scale.set(8, 8, 8);
      
      // Add car to scene
      this.scene.add(this.car);
      this.isInitialized = true;
      
      console.log(`Loaded lobby preview car: ${color}`);
    }, 
    undefined, 
    (error) => {
      console.error(`Error loading car_${color}.glb:`, error);
      
      // If color-specific model fails to load, fall back to red
      if (color !== 'red') {
        console.log('Falling back to red car model');
        this.loadCarModel('red');
      }
    });
  }
  
  // Listen for color changes from the carousel
  setupColorChangeListener() {
    const colorOptions = document.querySelectorAll('.color-option');
    
    if (!colorOptions.length) {
      console.warn('No color options found in the DOM');
      return;
    }
    
    colorOptions.forEach(option => {
      option.addEventListener('click', () => {
        const newColor = option.getAttribute('data-color');
        
        if (newColor && newColor !== this.currentColor) {
          console.log(`Changing car preview color to: ${newColor}`);
          this.currentColor = newColor;
          this.loadCarModel(newColor);
        }
      });
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
      this.carRotation += this.carRotationSpeed;
      this.car.rotation.y = this.carRotation;
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