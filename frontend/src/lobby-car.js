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
    
    const pointLight = new THREE.PointLight(0xff0080, 2, 50);
    pointLight.position.set(0, 10, 5);
    this.scene.add(pointLight);
    
    // Set up camera
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 2, 10);
    
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
      
      // Position and scale the car
      this.car.position.set(0, 0, 0);
      this.car.rotation.y = Math.PI;
      this.car.scale.set(4, 4, 4);
      
      // Add car to scene
      this.scene.add(this.car);
      this.isInitialized = true;
    }, 
    undefined, 
    (error) => {
      console.error('Error loading car model:', error);
      // If there's an error, create a placeholder car
      this.createPlaceholderCar();
    });
  }
  
  createPlaceholderCar() {
    // Create a simple car shape as placeholder
    const carGroup = new THREE.Group();
    
    // Car body
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0080 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    carGroup.add(body);
    
    // Car top
    const topGeometry = new THREE.BoxGeometry(1.5, 0.5, 2);
    const topMaterial = new THREE.MeshStandardMaterial({ color: 0xff0080 });
    const top = new THREE.Mesh(topGeometry, topMaterial);
    top.position.y = 1.15;
    top.position.z = -0.5;
    carGroup.add(top);
    
    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    
    const wheels = [
      { x: -1, y: 0.4, z: -1.2 },
      { x: 1, y: 0.4, z: -1.2 },
      { x: -1, y: 0.4, z: 1.2 },
      { x: 1, y: 0.4, z: 1.2 }
    ];
    
    wheels.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos.x, pos.y, pos.z);
      carGroup.add(wheel);
    });
    
    // Add to scene
    this.car = carGroup;
    this.scene.add(this.car);
    this.isInitialized = true;
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