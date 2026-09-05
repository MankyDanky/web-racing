// Tiny event-emitter + shared store to replace the `window.*` service bus (#29).
//
// The old code coordinated modules through globals like window.raceState,
// window.gateData, window.startCountdown, window.updateLeaderboard,
// window.playerFinishTimes - multiplayer.js even logged an error when
// window.startCountdown "wasn't available". This store is created once in
// main.js and passed into module init functions, giving a single typed surface
// with an on/emit event bus instead of scattered globals.

export function createStore() {
  const listeners = new Map(); // event -> Set<fn>

  const store = {
    // Shared state (read/written by whoever owns it).
    raceState: null,
    gateData: null,
    playerFinishTimes: {},

    // Event bus.
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (set) {
        set.forEach((fn) => {
          try { fn(payload); } catch (e) { /* isolate listener errors */ }
        });
      }
    },
  };

  return store;
}

// Known event names (documentation + typo-avoidance).
export const EVENTS = {
  COUNTDOWN_AT: 'countdownAt',      // { startAt }
  RACE_START: 'raceStart',
  LEADERBOARD_DIRTY: 'leaderboardDirty',
  ENTER_SPECTATOR: 'enterSpectator',
  FINISH_RECORDED: 'finishRecorded', // { peerId, time }
};
