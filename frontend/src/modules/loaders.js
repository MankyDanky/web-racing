// Shared GLTFLoader factory with Draco + Meshopt support (#23).
//
// The repo's GLBs are large and uncompressed (~32 MB). Running
// `npm run optimize:assets` (see scripts/optimize-assets.mjs) produces
// Draco-geometry + Meshopt-compressed GLBs that are 60-80% smaller. For those
// to load at runtime the GLTFLoader needs the Draco decoder + Meshopt decoder
// wired in, which this factory does once. Uncompressed GLBs still load fine, so
// the game works whether or not you've run the optimizer.

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let dracoLoader = null;

function getDracoLoader() {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    // Decoder files are copied into /draco/ by the optimize script / postinstall.
    // Falls back gracefully if not present (only needed for Draco-compressed GLBs).
    dracoLoader.setDecoderPath('/draco/');
  }
  return dracoLoader;
}

// Create a fully-configured GLTFLoader. Pass the shared LoadingManager so the
// loading screen tracks these assets.
export function createGLTFLoader(loadingManager) {
  const loader = new GLTFLoader(loadingManager);
  loader.setDRACOLoader(getDracoLoader());
  try {
    loader.setMeshoptDecoder(MeshoptDecoder);
  } catch (e) {
    // Older three builds may not expose setMeshoptDecoder; harmless.
  }
  return loader;
}
