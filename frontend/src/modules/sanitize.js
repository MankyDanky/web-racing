// Shared sanitizers for every value that crosses a trust boundary:
// user input, peer messages, and backend responses.

export const MAX_PLAYER_NAME_LENGTH = 15;

export const VALID_PLAYER_COLORS = [
  'red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'
];

// Only these tracks ship with the game; anything else would end up as a
// path-traversal payload inside /models/maps/${trackId}/... URLs.
export const VALID_TRACK_IDS = ['map1', 'map2'];

// PeerJS IDs are alphanumeric with dashes/underscores.
const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{4,100}$/;
const FINISH_TIME_PATTERN = /^\d{1,3}:[0-5]\d$/;

/**
 * Returns a safe display name: control characters removed, trimmed,
 * capped at MAX_PLAYER_NAME_LENGTH. Falls back to `fallback` when
 * nothing usable remains.
 */
export function sanitizePlayerName(name, fallback = 'Player') {
  if (typeof name !== 'string') return fallback;
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, MAX_PLAYER_NAME_LENGTH);
}

/** Returns the color only if it is part of the fixed palette. */
export function sanitizePlayerColor(color) {
  return VALID_PLAYER_COLORS.includes(color) ? color : 'red';
}

/** Returns the track id only if it is one of the shipped maps. */
export function sanitizeTrackId(trackId) {
  return VALID_TRACK_IDS.includes(trackId) ? trackId : 'map1';
}

/** Returns a well-formed MM:SS string, or null for anything else. */
export function sanitizeFinishTime(value) {
  if (typeof value !== 'string') return null;
  return FINISH_TIME_PATTERN.test(value) ? value : null;
}

/** Returns the peer id only if it matches the expected shape. */
export function sanitizePeerId(id) {
  if (typeof id !== 'string') return null;
  return PEER_ID_PATTERN.test(id) ? id : null;
}
