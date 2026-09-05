// Versioned, validated contract for the sessionStorage handoff between the
// lobby (index.html) and the game page (game.html) (#35).
//
// Previously index.html stashed an arbitrary `gameConfig` object and game.html
// trusted it blindly - a stale lobby tab could crash the game page. Now every
// config carries a schema version and is validated on read.

import {
  sanitizePlayerName,
  sanitizePlayerColor,
  sanitizeTrackId,
  sanitizePeerId,
} from './sanitize.js';

export const GAME_CONFIG_VERSION = 2;
const STORAGE_KEY = 'gameConfig';

function sanitizePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const id = sanitizePeerId(p.id) || (typeof p.id === 'string' ? p.id.slice(0, 100) : null);
      if (!id) return null;
      return {
        id,
        name: sanitizePlayerName(p.name),
        isHost: p.isHost === true,
        isReady: p.isReady === true,
        playerColor: sanitizePlayerColor(p.playerColor),
      };
    })
    .filter(Boolean);
}

// Build a fully-formed, versioned config object ready for sessionStorage.
export function buildGameConfig({ trackId, players, multiplayer, isSinglePlayer }) {
  return {
    version: GAME_CONFIG_VERSION,
    type: 'startGame',
    trackId: sanitizeTrackId(trackId),
    players: sanitizePlayers(players),
    multiplayer: multiplayer === true,
    isSinglePlayer: isSinglePlayer === true,
    createdAt: Date.now(),
  };
}

export function saveGameConfig(config) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch (e) {
    return false;
  }
}

// Read + validate. Returns null (instead of throwing) for stale/invalid data.
export function loadGameConfig() {
  let raw;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  // Tolerate configs written by an older lobby tab (no version field) by
  // upgrading them, but reject anything newer than we understand.
  const version = typeof parsed.version === 'number' ? parsed.version : 1;
  if (version > GAME_CONFIG_VERSION) return null;

  const players = sanitizePlayers(parsed.players);
  if (players.length === 0) return null;

  return {
    version: GAME_CONFIG_VERSION,
    type: 'startGame',
    trackId: sanitizeTrackId(parsed.trackId),
    players,
    multiplayer: parsed.multiplayer === true || players.length > 1,
    isSinglePlayer: parsed.isSinglePlayer === true,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
  };
}
