// Track manifest loader + registry (#43).
//
// Adds support for multiple tracks and reverse mode via a JSON manifest instead
// of the old hard-coded single `map1`. A reverse variant reuses a base map's
// GLBs but flips gate ordering.

import { log, warn } from './debug.js';

// Baked-in manifest (also shipped as public/models/maps/tracks.json for tools).
const DEFAULT_MANIFEST = [
  { id: 'map1', name: 'Forest Freeway', totalGates: 8, reverse: false },
  { id: 'map2', name: 'Snowy Speedway', totalGates: 8, reverse: false },
  { id: 'map1-reverse', name: 'Forest Freeway (Reverse)', baseMap: 'map1', totalGates: 8, reverse: true },
  { id: 'map2-reverse', name: 'Snowy Speedway (Reverse)', baseMap: 'map2', totalGates: 8, reverse: true },
];

let manifest = DEFAULT_MANIFEST.slice();

export function getTracks() {
  return manifest;
}

export function getTrack(id) {
  return manifest.find((t) => t.id === id) || manifest[0];
}

// The folder of GLB assets to load for a given track id (reverse variants share
// their base map's assets).
export function getAssetMap(id) {
  const t = getTrack(id);
  return t.baseMap || t.id;
}

export function isReverse(id) {
  const t = getTrack(id);
  return !!t.reverse;
}

// Optionally refresh the manifest from the shipped JSON (progressive enhancement).
export async function loadManifest() {
  try {
    const res = await fetch('/models/maps/tracks.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tracks) && data.tracks.length) {
        manifest = data.tracks;
        log('Track manifest loaded:', manifest.map((t) => t.id).join(', '));
      }
    }
  } catch (e) {
    warn('Falling back to built-in track manifest');
  }
  return manifest;
}
