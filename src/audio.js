/* =========================================================================
   audio.js — all background music for Familiar Frenzy.

   Design (kept deliberately small):
   - ONE shared "normal" pool used by both the menus and regular gameplay.
     A random pool track plays; when it ends, another random one follows, so
     moving menu <-> gameplay never restarts the song (Option A).
   - A single "boss" track that interrupts the normal pool during boss fights
     (Wave 10 in Tutorial, and every 10th wave in Endless), then returns to
     the normal pool cleanly when the boss is gone.
   - Clean hard switches between tracks (no crossfade for now).
   - Browser autoplay: nothing plays until the first user gesture. game.js can
     call setMusicContext() any time (even before the gesture); the module just
     remembers the desired context and starts it the moment audio is unlocked.
   - Music volume (0..100) persists in localStorage and applies live.

   Public API:
     initAudio()            - load saved volume + arm the unlock-on-gesture
     setMusicContext(ctx)   - ctx = "normal" | "boss" | null  (call freely; it
                              no-ops unless the context actually changed)
     setMusicVolume(v)      - 0..100, applies immediately + saves
     getMusicVolume()       - current 0..100
     stopMusic()            - stop everything

   Fails safe: a missing music file logs a console warning and the game keeps
   running with no music.
   ========================================================================= */

// --- Asset config (all easy to change) -----------------------------------
const MUSIC_EXT = "mp3";   // change to "ogg" if your files are .ogg
const POOL_COUNT = 3;      // familiar_theme_01..0N
const DEFAULT_VOLUME = 60; // 0..100
const STORAGE_KEY = "ff_musicVolume";

const POOL_SRCS = [];
for (let i = 1; i <= POOL_COUNT; i++) {
  POOL_SRCS.push(`assets/music/familiar_theme_${String(i).padStart(2, "0")}.${MUSIC_EXT}`);
}
const BOSS_SRC = `assets/music/boss_theme.${MUSIC_EXT}`;

// --- State ---------------------------------------------------------------
let volume = DEFAULT_VOLUME;  // 0..100
let unlocked = false;         // true after the first user gesture
let desiredContext = null;    // what game.js wants: "normal" | "boss" | null
let currentContext = null;    // what is actually playing
let audioEl = null;           // the live HTMLAudioElement
let currentSrc = null;        // its src (to avoid repeats / needless restarts)

// --- Volume persistence ---------------------------------------------------
function loadVolume() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (!Number.isNaN(v)) volume = Math.max(0, Math.min(100, v));
  } catch (e) { /* storage blocked — keep default */ }
}

function saveVolume() {
  try { localStorage.setItem(STORAGE_KEY, String(volume)); } catch (e) { /* ignore */ }
}

export function getMusicVolume() {
  return volume;
}

export function setMusicVolume(v) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  if (audioEl) audioEl.volume = volume / 100; // applies live (0 = silent)
  saveVolume();
}

// --- Track selection ------------------------------------------------------
// Random pool track, avoiding an immediate repeat of the current one.
function randomPoolSrc() {
  const n = POOL_SRCS.length;
  if (n === 0) return null;
  if (n === 1) return POOL_SRCS[0];
  let pick;
  do {
    pick = POOL_SRCS[Math.floor(Math.random() * n)];
  } while (pick === currentSrc);
  return pick;
}

// Clean hard switch to a given src.
function playSrc(src, loop) {
  if (!src) return;

  // Stop/clear the previous element.
  if (audioEl) {
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.pause();
    audioEl = null;
  }

  const el = new Audio(src);
  el.volume = volume / 100;
  el.loop = loop;
  el.onerror = () => { console.warn(`[audio] could not load ${src}`); };

  // Normal tracks don't loop a single song — when one ends, chain to another
  // random pool track for variety (boss track loops instead).
  if (!loop) {
    el.onended = () => {
      if (currentContext === "normal") {
        const next = randomPoolSrc();
        currentSrc = next;
        playSrc(next, false);
      }
    };
  }

  audioEl = el;
  currentSrc = src;

  const p = el.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {
      // Autoplay blocked (or load failed). Roll back so the next user gesture
      // re-attempts cleanly instead of thinking music is already playing.
      unlocked = false;
      if (audioEl === el) audioEl = null;
      currentContext = null;
      currentSrc = null;
    });
  }
}

// Realize the desired context. Cheap + idempotent: no-ops unless the context
// actually changed, so game.js can call setMusicContext() every frame.
function applyContext() {
  if (!unlocked) return;
  if (desiredContext === currentContext && audioEl) return;

  currentContext = desiredContext;
  if (desiredContext === "boss") {
    playSrc(BOSS_SRC, true);
  } else if (desiredContext === "normal") {
    playSrc(randomPoolSrc(), false);
  } else {
    stopMusic();
  }
}

// --- Public controls ------------------------------------------------------
export function setMusicContext(ctx) {
  desiredContext = ctx;
  applyContext();
}

export function stopMusic() {
  if (audioEl) {
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.pause();
    audioEl = null;
  }
  currentSrc = null;
  currentContext = null;
}

// First user gesture unlocks audio (browsers block it until then). Stays
// attached so a still-blocked browser retries on the next gesture.
function onUserGesture() {
  if (!unlocked) {
    unlocked = true;
    applyContext();
  }
}

export function initAudio() {
  loadVolume();
  window.addEventListener("keydown", onUserGesture);
  window.addEventListener("pointerdown", onUserGesture);
}
