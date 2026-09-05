// Centralized debug logging (#10).
//
// All dev chatter goes through this module instead of calling console.* directly.
// A production build sets `import.meta.env.PROD`, which flips DEBUG off so the
// ~75 console.log calls that used to run every session are silenced. You can
// also force logging on at runtime with `localStorage.setItem('racezDebug','1')`.

let DEBUG = false;
try {
  // Vite injects import.meta.env; default to logging only in dev.
  DEBUG = !import.meta.env || import.meta.env.DEV === true;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('racezDebug') === '1') {
    DEBUG = true;
  }
  if (typeof localStorage !== 'undefined' && localStorage.getItem('racezDebug') === '0') {
    DEBUG = false;
  }
} catch (e) {
  DEBUG = false;
}

export const isDebug = () => DEBUG;

export function setDebug(value) {
  DEBUG = !!value;
}

export const log = (...args) => {
  if (DEBUG) console.log(...args);
};

export const warn = (...args) => {
  if (DEBUG) console.warn(...args);
};

// Errors are always surfaced - they are not "chatter".
export const error = (...args) => {
  console.error(...args);
};
