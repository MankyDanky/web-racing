import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Store minimap state
const minimap = {
  canvas: null,
  ctx: null,
  size: 200,
  trackData: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  mapId: 'map1' // Default map ID
};

// Create the minimap canvas
export function createMinimap(mapId) {
  // Use provided mapId or default to map1
  if (mapId) {
    minimap.mapId = mapId;
  }
  
  // Create canvas element
  minimap.canvas = document.createElement('canvas');
  minimap.canvas.id = 'minimap';
  minimap.canvas.width = minimap.size;
  minimap.canvas.height = minimap.size;
  
  // Style the canvas
  minimap.canvas.style.position = 'absolute';
  minimap.canvas.style.top = '20px';
  minimap.canvas.style.right = '20px';
  minimap.canvas.style.width = `${minimap.size}px`;
  minimap.canvas.style.height = `${minimap.size}px`;
  minimap.canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  minimap.canvas.style.borderRadius = '10px';
  minimap.canvas.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
  minimap.canvas.style.zIndex = '1000';
  
  // Get drawing context
  minimap.ctx = minimap.canvas.getContext('2d');
  
  // Add to document
  document.body.appendChild(minimap.canvas);
  
  // Load the track curve for minimap
  loadTrackCurve(minimap.mapId);
  
  console.log(`Minimap created for map: ${minimap.mapId}`);
  return minimap;
}

// Load the Bezier curve model for the track
function loadTrackCurve(mapId) {
  const loader = new GLTFLoader();
  
  // Use the specified map's track outline
  const trackOutlinePath = `/models/maps/${mapId}/track-outline.glb`;
  console.log(`Loading track outline from: ${trackOutlinePath}`);
  
  // Load the model containing the Bezier curve
  loader.load(
    trackOutlinePath,
    (gltf) => {
      const curveModel = gltf.scene;
      console.log(`Track curve model loaded for minimap (${mapId})`);
      extractCurvePoints(curveModel);
    },
    (xhr) => {
      console.log(`Loading track curve: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
    },
    (error) => {
      console.error(`Error loading track curve for ${mapId}:`, error);
      // Fallback to the regular track model if curve can't be loaded
      console.log('Will use regular track model as fallback');
    }
  );
}

// Add a function to update the minimap if the map changes
export function updateMinimapTrack(mapId) {
  if (mapId && mapId !== minimap.mapId) {
    minimap.mapId = mapId;
    console.log(`Updating minimap for new map: ${mapId}`);
    
    // Clear existing track data
    minimap.trackData = null;
    
    // Load the new track outline
    loadTrackCurve(mapId);
  }
}

// Extract points from the Bezier curve model
function extractCurvePoints(curveModel) {
  if (!curveModel) {
    console.error('Curve model not available');
    return;
  }
  
  console.log('Extracting curve points for minimap...');
  
  // Array to store curve points
  const curvePoints = [];
  
  // Look for curve objects specifically
  curveModel.traverse(node => {
    // Look for a mesh that represents the curve
    if (node.isMesh && node.geometry) {
      // Get vertex positions from the curve mesh
      const positions = node.geometry.getAttribute('position');
      
      // Get points along the curve
      for (let i = 0; i < positions.count; i++) {
        const vertex = new THREE.Vector3();
        vertex.fromBufferAttribute(positions, i);
        
        // Transform vertex to world coordinates
        vertex.applyMatrix4(node.matrixWorld);
        
        // Store x and z coordinates (top-down view)
        curvePoints.push({ x: vertex.x, z: vertex.z });
      }
    }
  });
  
  if (curvePoints.length === 0) {
    console.error('No curve points found in the model');
    return;
  }
  
  console.log(`Extracted ${curvePoints.length} curve points for minimap`);
  
  // Process the curve points for the minimap
  processCurvePoints(curvePoints);
}

// Process curve points to display on minimap
function processCurvePoints(curvePoints) {
  // Find the bounds of the track curve
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  curvePoints.forEach(point => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  });
  
  // Calculate scale and offset to fit the minimap
  const trackWidth = maxX - minX;
  const trackHeight = maxZ - minZ;
  const availableSize = minimap.size - 20; // 10px padding on each side
  
  // Calculate scale to fit the track in the minimap
  const scaleX = availableSize / trackWidth;
  const scaleZ = availableSize / trackHeight;
  minimap.scale = Math.min(scaleX, scaleZ) * 0.9; // 90% of available space
  
  // Calculate offsets to center the track
  minimap.offsetX = (minimap.size / 2) - ((minX + maxX) / 2 * minimap.scale);
  minimap.offsetY = (minimap.size / 2) - ((minZ + maxZ) / 2 * minimap.scale);
  
  // Store track data
  minimap.trackData = curvePoints;
  
  console.log('Track curve data processed', {
    bounds: { minX, maxX, minZ, maxZ },
    scale: minimap.scale,
    offset: { x: minimap.offsetX, y: minimap.offsetY }
  });
  
  // Draw the track immediately
  drawTrack();
}

// Convert 3D world coordinates to minimap coordinates
function worldToMinimap(x, z) {
  return {
    x: x * minimap.scale + minimap.offsetX,
    y: z * minimap.scale + minimap.offsetY
  };
}

// Draw the track on the minimap with a gradient fill (simpler version)
function drawTrack() {
  if (!minimap.ctx || !minimap.trackData) return;
  
  // Clear the canvas
  minimap.ctx.clearRect(0, 0, minimap.size, minimap.size);
  // Shadow for glow effect
  minimap.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  minimap.ctx.shadowBlur = 5;
  // First draw a wider stroke for the track "body"
  minimap.ctx.beginPath();
  
  let started = false;
  minimap.trackData.forEach((point, index) => {
    const { x, y } = worldToMinimap(point.x, point.z);
    
    if (!started) {
      minimap.ctx.moveTo(x, y);
      started = true;
    } else {
      minimap.ctx.lineTo(x, y);
    }
  });
  
  // Close the path if it's a loop
  if (minimap.trackData.length > 2) {
    const firstPoint = minimap.trackData[0];
    const lastPoint = minimap.trackData[minimap.trackData.length - 1];
    
    // If the first and last points are close, connect them
    const dist = Math.hypot(firstPoint.x - lastPoint.x, firstPoint.z - lastPoint.z);
    if (dist < 5) {
      minimap.ctx.closePath();
    }
  }
  
  // Create a thick stroke with gradient
  minimap.ctx.lineWidth = 10;
  
  const gradient = minimap.ctx.createLinearGradient(0, 0, minimap.size, minimap.size);
  gradient.addColorStop(0, '#4dc9ff');     // Blue (speedometer start)
  gradient.addColorStop(1, '#ff0080');     // Pink (speedometer end)
  
  minimap.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  minimap.ctx.stroke();
  
  
  // Reset shadow
  minimap.ctx.shadowBlur = 0;
}

// Keep the original extractTrackData function as a fallback
export function extractTrackData(trackModel) {
  console.log(`Using dedicated track curve for minimap (${minimap.mapId}). Regular track model not needed.`);
  
  // If we already have track data, we don't need to extract it again
  if (minimap.trackData) {
    return minimap.trackData;
  }
  
  // If the curve model failed to load, fall back to extracting from the track model
  if (trackModel) {
    console.log("Falling back to track model for minimap extraction");
    // Existing extraction code...
    const trackPoints = [];
    
    trackModel.traverse(node => {
      if (node.isMesh && node.geometry) {
        const positions = node.geometry.getAttribute('position');
        
        // Take fewer points for performance
        for (let i = 0; i < positions.count; i += 20) {
          const vertex = new THREE.Vector3();
          vertex.fromBufferAttribute(positions, i);
          vertex.applyMatrix4(node.matrixWorld);
          
          // Only take points near the track surface
          if (Math.abs(vertex.y) < 0.5) {
            trackPoints.push({ x: vertex.x, z: vertex.z });
          }
        }
      }
    });
    
    // Process points
    processCurvePoints(trackPoints);
    return trackPoints;
  }
}

// Update player positions on the minimap
export function updateMinimapPlayers(localPlayer, opponents) {
  if (!minimap.ctx || !minimap.trackData) return;
  
  // Redraw the track first
  drawTrack();
  
  // Draw opponent players as white dots
  if (opponents) {
    Object.values(opponents).forEach(opponent => {
      // Only draw if the model exists and is visible
      if (opponent.model && opponent.model.visible) {
        const { x, y } = worldToMinimap(opponent.model.position.x/8, opponent.model.position.z/8);
        
        // Draw white circle for opponents
        minimap.ctx.beginPath();
        minimap.ctx.arc(x, y, 4, 0, Math.PI * 2);
        minimap.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        minimap.ctx.fill();
      }
    });
  }
  
  // Draw local player as a blue dot
  if (localPlayer) {
    const { x, y } = worldToMinimap(localPlayer.position.x/8, localPlayer.position.z/8);
    
    // Draw blue circle for local player
    minimap.ctx.beginPath();
    minimap.ctx.arc(x, y, 5, 0, Math.PI * 2);
    minimap.ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    minimap.ctx.fill();
    minimap.ctx.beginPath();
    minimap.ctx.arc(x, y, 4, 0, Math.PI * 2);
    minimap.ctx.fillStyle = 'rgba(43, 118, 199, 1)';
    minimap.ctx.fill();
  }
}