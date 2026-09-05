// Race timing + formatting helpers (#44).
//
// The old game only ever showed MM:SS, but races are decided in hundredths.
// These helpers format/parse SS.mmm-style millisecond-accurate times and are
// unit-tested (see tests/).

// Format milliseconds as M:SS.mmm (e.g. 72345 -> "1:12.345").
export function formatTime(ms) {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalMs = Math.floor(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// Legacy MM:SS formatting (still used by some peers / final leaderboard fallback).
export function formatTimeMMSS(ms) {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Parse either "M:SS.mmm" or "MM:SS" back to milliseconds. Returns null for junk.
export function parseTime(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const minutes = parseInt(m[1], 10);
  const seconds = parseInt(m[2], 10);
  const millis = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
  return (minutes * 60 + seconds) * 1000 + millis;
}

// Millisecond-precision finish-time validator (peer-supplied values).
const PRECISE_PATTERN = /^\d{1,3}:[0-5]\d\.\d{3}$/;
export function sanitizePreciseTime(value) {
  if (typeof value !== 'string') return null;
  if (PRECISE_PATTERN.test(value)) return value;
  // Accept legacy MM:SS too, normalising to .000.
  const legacy = value.match(/^(\d{1,3}):([0-5]\d)$/);
  if (legacy) return `${parseInt(legacy[1], 10)}:${legacy[2]}.000`;
  return null;
}
