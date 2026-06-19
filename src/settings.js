/* =========================================================================
   settings.js — Display & Accessibility toggles (visual-only, persisted).

   These NEVER touch hitboxes, damage, timing, or balance — only how things are
   drawn. State lives here as module-level booleans with get/set accessors
   (mirroring audio.js's volume pattern), so the draw code in enemies.js, game.js,
   and ui.js can read ONE source instead of threading flags through every draw().

   Persisted to localStorage under ff_* keys (matching the project's convention).
   Reads/writes are wrapped so a storage-less context just falls back to defaults.
   ========================================================================= */

const KEY_REDUCED_FLASH = "ff_reducedFlash";
const KEY_HIGH_VIS = "ff_highVisWarnings";

function load(key) {
  try { return localStorage.getItem(key) === "1"; } catch (e) { return false; } // default OFF
}
function save(key, on) {
  try { localStorage.setItem(key, on ? "1" : "0"); } catch (e) { /* storage unavailable — runtime only */ }
}

// Loaded once at module init (both default OFF — accessibility is opt-in).
let reducedFlash = load(KEY_REDUCED_FLASH);
let highVisWarnings = load(KEY_HIGH_VIS);

export function getReducedFlash() { return reducedFlash; }
export function setReducedFlash(on) { reducedFlash = !!on; save(KEY_REDUCED_FLASH, reducedFlash); }

export function getHighVisWarnings() { return highVisWarnings; }
export function setHighVisWarnings(on) { highVisWarnings = !!on; save(KEY_HIGH_VIS, highVisWarnings); }
