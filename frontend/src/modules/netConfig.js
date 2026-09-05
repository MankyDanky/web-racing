// Environment-driven networking config (#5).
//
// The API base URL and PeerJS broker are configurable via Vite env vars
// (VITE_API_BASE_URL, VITE_PEER_HOST, VITE_PEER_PORT, VITE_PEER_PATH,
// VITE_PEER_SECURE) - see LAN_MULTIPLAYER.md / DEPLOY.md.
//
// Crucially for LAN play: when VITE_API_BASE_URL is NOT set we DERIVE the API
// host from the page's own address. That way a friend who opens
// http://192.168.1.20:5173 has their browser call http://192.168.1.20:8000 (your
// machine), instead of localhost (their own machine). One setup works for every
// device on the network with zero per-device config.

function env(key, fallback) {
  try {
    if (import.meta && import.meta.env && import.meta.env[key] != null && import.meta.env[key] !== '') {
      return import.meta.env[key];
    }
  } catch (e) { /* ignore */ }
  return fallback;
}

// Port the backend listens on. Override with VITE_API_PORT if you change it.
const API_PORT = env('VITE_API_PORT', '8000');

// Work out the API base URL.
function resolveApiBaseUrl() {
  // 0) Same-origin mode (single-service deploy, e.g. Render free tier): the API
  //    lives on the SAME origin that served the page, so use RELATIVE URLs
  //    (`/api/...`). Enabled by building with VITE_API_BASE_URL="same-origin"
  //    (or "/"), which is what run.py / the Render build set.
  const explicitRaw = env('VITE_API_BASE_URL', '');
  if (explicitRaw === 'same-origin' || explicitRaw === '/') return '';

  // 1) Explicit override always wins (this is what a split deploy sets).
  const explicit = explicitRaw;
  if (explicit) return explicit.replace(/\/$/, '');

  // 2) Otherwise derive from the current page. Same hostname the user typed
  //    (localhost, 127.0.0.1, or a LAN IP like 192.168.x.x), backend port.
  try {
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${proto}//${window.location.hostname}:${API_PORT}`;
    }
  } catch (e) { /* ignore */ }

  // 3) Last resort for non-browser contexts (tests).
  return `http://localhost:${API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

export function apiUrl(path) {
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

// PeerJS options. Behaviour:
//   - VITE_PEER_HOST unset            -> use PeerJS's public cloud broker
//                                        (works on a LAN as long as both
//                                        devices have internet for signalling;
//                                        the actual car data stays P2P).
//   - VITE_PEER_HOST="auto"           -> self-hosted broker on the SAME host the
//                                        page was loaded from (great for LAN:
//                                        run `npx peerjs` on your machine and
//                                        every device finds it automatically).
//   - VITE_PEER_HOST="1.2.3.4"        -> explicit self-hosted broker host.
export function getPeerOptions() {
  let host = env('VITE_PEER_HOST', '');
  if (!host) return undefined; // use PeerJS default cloud broker

  if (host === 'auto') {
    try {
      host = (typeof window !== 'undefined' && window.location && window.location.hostname)
        ? window.location.hostname : 'localhost';
    } catch (e) { host = 'localhost'; }
  }

  const options = {
    host,
    path: env('VITE_PEER_PATH', '/myapp'),
    secure: String(env('VITE_PEER_SECURE', 'false')) === 'true',
  };
  const port = env('VITE_PEER_PORT', '9000');
  if (port) options.port = parseInt(port, 10);
  const key = env('VITE_PEER_KEY', '');
  if (key) options.key = key;
  return options;
}

// Guessable-id fix (#12): use a cryptographically-random UUID for the PeerJS
// id instead of a short/sequential value.
export function generatePeerId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `racez-${crypto.randomUUID()}`;
    }
  } catch (e) { /* ignore */ }
  // Fallback for very old browsers.
  return `racez-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
