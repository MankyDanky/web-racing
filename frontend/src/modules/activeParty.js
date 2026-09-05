// Persist just enough state to auto-rejoin a party after an accidental page
// refresh in the lobby (#46). This is deliberately tiny and versioned: we only
// remember the short party code + our chosen name/color, never peer ids (those
// are regenerated each session) or authoritative game state.
//
// A short TTL prevents a day-old tab from silently reconnecting to a party that
// has long since ended.

const STORAGE_KEY = 'activeParty';
const SCHEMA_VERSION = 1;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

const PARTY_CODE_PATTERN = /^[A-Z2-9]{6}$/;

export function saveActiveParty({ code, playerName, role }) {
  if (!PARTY_CODE_PATTERN.test(code || '')) return false;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        code,
        playerName: typeof playerName === 'string' ? playerName.slice(0, 40) : '',
        role: role === 'host' ? 'host' : 'guest',
        savedAt: Date.now(),
      })
    );
    return true;
  } catch (e) {
    return false;
  }
}

export function clearActiveParty() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

// Returns a validated record, or null when absent / stale / malformed.
export function loadActiveParty() {
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
    clearActiveParty();
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || parsed.version !== SCHEMA_VERSION) {
    clearActiveParty();
    return null;
  }
  if (!PARTY_CODE_PATTERN.test(parsed.code || '')) {
    clearActiveParty();
    return null;
  }
  if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > TTL_MS) {
    clearActiveParty();
    return null;
  }

  return {
    code: parsed.code,
    playerName: typeof parsed.playerName === 'string' ? parsed.playerName : '',
    role: parsed.role === 'host' ? 'host' : 'guest',
  };
}
