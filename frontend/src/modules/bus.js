// Minimal event bus. New cross-module signals go through this instead of
// hanging more functions on `window` (the legacy global service bus).

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      // One bad listener must not break the emitter.
      if (typeof console !== 'undefined') console.error(`bus:${event} handler failed`, err);
    }
  }
}
