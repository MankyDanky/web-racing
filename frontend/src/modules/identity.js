// Per-tab player identity.
//
// localStorage is shared by EVERY tab of an origin. Minting peer IDs there
// meant that opening a second tab on localhost (the normal way to test
// multiplayer) overwrote the first tab's ID, and the game then failed with
// "player ID is stuck in use". sessionStorage is per-tab: each tab becomes
// its own racer, while a refresh of the same tab keeps the same ID, which
// the rejoin-after-refresh flow relies on.
const KEY = 'racez.pid';

export function getMyPlayerId() {
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'p-' + Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    return 'p-' + Math.random().toString(36).slice(2, 12);
  }
}
