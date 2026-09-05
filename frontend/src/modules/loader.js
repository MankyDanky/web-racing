import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Single loader factory: adds Draco decoding so compressed models produced
// by `npm run optimize:assets` load transparently. Uncompressed models are
// unaffected (the decoder is only fetched when a model actually uses Draco).
let draco = null;

export function makeGLTFLoader(manager) {
  const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  }
  loader.setDRACOLoader(draco);
  return loader;
}
