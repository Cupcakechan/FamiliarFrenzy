/* =========================================================================
   audio.js — all background music for Familiar Frenzy.

   Design (kept deliberately small):
   - ONE shared "normal" pool used by both the menus and regular gameplay.
     A random pool track plays; when it ends, another random one follows, so
     moving menu <-> gameplay never restarts the song (Option A).
   - A single "boss" track that interrupts the normal pool during boss fights
     (Wave 10 in Tutorial, and every 10th wave in Endless), then returns to
     the normal pool cleanly when the boss is gone.
   - Track changes CROSSFADE: the outgoing track fades down while the incoming
     one fades up over FADE_MS, so transitions are smooth (no abrupt cut).
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
     playFamiliarProjectileSfx() - one-shot sfx on familiar fire (autoplay-gated)

   Fails safe: a missing music file logs a console warning and the game keeps
   running with no music.
   ========================================================================= */

// --- Asset config (all easy to change) -----------------------------------
const MUSIC_EXT = "mp3";   // change to "ogg" if your files are .ogg
const POOL_COUNT = 3;      // familiar_theme_01..0N
const DEFAULT_VOLUME = 60; // 0..100
const FADE_MS = 700;       // crossfade length between tracks
const NORMAL_TRACK_MIN_PLAY_SECONDS = 240; // loop one normal track at least this long before rotating to a new random one
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
let audioEl = null;           // the incoming / active element (fades up)
let fadingEl = null;          // the outgoing element during a crossfade (fades down)
let currentSrc = null;        // active src (to avoid repeats / needless restarts)
let normalRotateTimer = null; // setTimeout handle for normal-track rotation

// Crossfade animation.
let fadeRAF = null;
let fadeStart = 0;

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
  // While a crossfade runs, its loop reapplies volumes each frame; otherwise
  // set the active track directly so the change is instant (0 = silent).
  if (!fadeRAF && audioEl) audioEl.volume = volume / 100;
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

// --- Crossfade ------------------------------------------------------------
function stopEl(el) {
  if (!el) return;
  el.onended = null;
  el.onerror = null;
  el.pause();
}

// Immediately finalize any in-progress fade (stops the outgoing element).
function cancelFade() {
  if (fadeRAF) {
    cancelAnimationFrame(fadeRAF);
    fadeRAF = null;
  }
  if (fadingEl) {
    stopEl(fadingEl);
    fadingEl = null;
  }
}

function stepFade(now) {
  const t = Math.min(1, (now - fadeStart) / FADE_MS);
  const target = volume / 100; // read live, so the slider works mid-fade
  if (audioEl) audioEl.volume = t * target;
  if (fadingEl) fadingEl.volume = (1 - t) * target;

  if (t >= 1) {
    if (fadingEl) { stopEl(fadingEl); fadingEl = null; }
    fadeRAF = null;
    return;
  }
  fadeRAF = requestAnimationFrame(stepFade);
}

function startFade() {
  fadeStart = performance.now();
  if (fadeRAF) cancelAnimationFrame(fadeRAF);
  fadeRAF = requestAnimationFrame(stepFade);
}

// Crossfade to a given src (fades the current one out, the new one in).
function playSrc(src, loop) {
  if (!src) return;

  // Any previous outgoing element is dropped immediately; the current active
  // element becomes the new outgoing one to fade down.
  cancelFade();
  fadingEl = audioEl;
  audioEl = null;

  const el = new Audio(src);
  el.loop = loop;
  el.volume = 0; // fade in from silence
  el.onerror = () => { console.warn(`[audio] could not load ${src}`); };

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

  startFade();
}

// --- Normal-track rotation ------------------------------------------------
// A selected normal track now LOOPS seamlessly; we only rotate to a different
// random track after NORMAL_TRACK_MIN_PLAY_SECONDS (instead of switching every
// time a ~1-minute song ends). Driven by a simple one-shot timer.
function clearNormalRotation() {
  if (normalRotateTimer) {
    clearTimeout(normalRotateTimer);
    normalRotateTimer = null;
  }
}

function scheduleNormalRotation() {
  clearNormalRotation();
  normalRotateTimer = setTimeout(rotateNormalTrack, NORMAL_TRACK_MIN_PLAY_SECONDS * 1000);
}

// Start a normal-pool track looping and (re)arm the rotation timer.
function startNormalTrack(src) {
  playSrc(src, true);
  scheduleNormalRotation();
}

// Timer fired: crossfade to a DIFFERENT random normal track (randomPoolSrc
// avoids repeating the current one) and re-arm. No-op if we're not in normal
// context anymore (e.g. a boss fight took over, or music was stopped).
function rotateNormalTrack() {
  if (currentContext !== "normal") return;
  startNormalTrack(randomPoolSrc());
}

// Realize the desired context. Cheap + idempotent: no-ops unless the context
// actually changed, so game.js can call setMusicContext() every frame.
function applyContext() {
  if (!unlocked) return;
  if (desiredContext === currentContext && audioEl) return;

  currentContext = desiredContext;
  if (desiredContext === "boss") {
    clearNormalRotation();      // boss interrupts the normal rotation
    playSrc(BOSS_SRC, true);
  } else if (desiredContext === "normal") {
    // Fresh normal rotation (also how we resume cleanly after a boss fight).
    startNormalTrack(randomPoolSrc());
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
  clearNormalRotation();
  cancelFade();
  stopEl(audioEl);
  audioEl = null;
  currentSrc = null;
  currentContext = null;
}

// --- Sound effects --------------------------------------------------------
// Short one-shots (currently just the familiar's projectile). Kept simple:
//   - Fixed volume, INDEPENDENT of the music slider (there is no SFX slider).
//   - Autoplay-gated on the same `unlocked` flag as the music.
//   - A tiny round-robin pool of reused Audio voices so rapid fire overlaps
//     cleanly instead of cutting itself off, plus a minimum interval so very
//     fast attack speeds (Spirit Imbued) can't spam/clip the sound.
//   - A missing file just fails silently — never throws.
const SFX_PROJECTILE_SRC = `assets/sfx/familiar_projectile.wav`;
const SFX_VOLUME = 0.18;       // modest; rapid fire shouldn't get loud
const SFX_MIN_INTERVAL = 0.06; // seconds between projectile sfx (throttle)
const SFX_VOICES = 4;          // reused Audio elements for overlap

let sfxVoices = [];
let sfxVoiceIndex = 0;
let lastProjectileSfx = 0;     // performance.now() ms of the last one played

function initSfx() {
  for (let i = 0; i < SFX_VOICES; i++) {
    const el = new Audio(SFX_PROJECTILE_SRC);
    el.volume = SFX_VOLUME;
    el.onerror = () => {}; // missing/blocked file — ignore, never crash
    sfxVoices.push(el);
  }
}

export function playFamiliarProjectileSfx() {
  if (!unlocked || sfxVoices.length === 0) return; // respect autoplay
  const now = performance.now();
  if (now - lastProjectileSfx < SFX_MIN_INTERVAL * 1000) return; // throttle
  lastProjectileSfx = now;

  const el = sfxVoices[sfxVoiceIndex];
  sfxVoiceIndex = (sfxVoiceIndex + 1) % sfxVoices.length;
  try {
    el.currentTime = 0;
    el.volume = SFX_VOLUME;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    /* ignore */
  }
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
  initSfx();
  window.addEventListener("keydown", onUserGesture);
  window.addEventListener("pointerdown", onUserGesture);
}
