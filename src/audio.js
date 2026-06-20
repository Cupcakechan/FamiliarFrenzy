/* =========================================================================
   audio.js — all background music for Familiar Frenzy.

   REBUILT around two persistent "decks" (like DJ decks) to eliminate the
   AbortError failure mode of the old design. The old version created a new
   Audio element per track and pause()d outgoing ones; if a pause landed while
   an element's play() promise was still pending (slow mp3 load), the browser
   rejected with AbortError — and the old handler treated EVERY rejection as
   an autoplay block, poisoning the state and silencing the music.

   New design rules (the whole fix):
   1. TWO persistent Audio elements, reused forever. A transition swaps which
      deck is "active": the incoming deck gets the new src + play(), the
      outgoing deck fades down.
   2. Every transition gets a GENERATION number. All async callbacks (play
      promises, fade frames, deferred pauses) capture their gen and self-
      discard if a newer transition has started. No stale callback can ever
      mutate current state.
   3. pause() on a deck only happens AFTER its play() promise settles, and
      only if the deck wasn't reactivated meanwhile. We never interrupt our
      own pending play() with a pause().
   4. Error triage: only a genuine NotAllowedError (real autoplay block) arms
      retry-on-gesture. Anything else (AbortError, load hiccups) is logged
      and otherwise ignored — the generation system already guarantees the
      newest requested track wins.

   Behavior kept from before:
   - SEPARATE menu + gameplay pools (a crossfade swaps tracks when a run begins
     / ends), a single boss track that interrupts and returns cleanly.
   - Crossfades over FADE_MS; a track loops and rotates to a different random
     one (from the same pool) after NORMAL_TRACK_MIN_PLAY_SECONDS.
   - Nothing plays until the first user gesture; setMusicContext() can be
     called any time (even per-frame) and is cheap + idempotent.
   - Music volume (0..100) persists in localStorage and applies live.

   Public API (unchanged):
     initAudio(), setMusicContext(ctx), setMusicVolume(v), getMusicVolume(),
     stopMusic(), playFamiliarProjectileSfx()

   Fails safe: a missing music file logs a console warning and the game keeps
   running with no music.
   ========================================================================= */

// --- Asset config (all easy to change) -----------------------------------
const MUSIC_EXT = "mp3";   // change to "ogg" if your files are .ogg
const POOL_COUNT = 9;      // familiar_theme_01..0N
const MENU_POOL_COUNT = 3; // the FIRST N themes are the MENU pool; the rest are gameplay
const DEFAULT_VOLUME = 60; // 0..100
const FADE_MS = 700;       // crossfade length between tracks
const NORMAL_TRACK_MIN_PLAY_SECONDS = 240; // loop one track at least this long before rotating to a new random one
const STORAGE_KEY = "ff_musicVolume";

const POOL_SRCS = [];
for (let i = 1; i <= POOL_COUNT; i++) {
  POOL_SRCS.push(`assets/music/familiar_theme_${String(i).padStart(2, "0")}.${MUSIC_EXT}`);
}
// Menus and gameplay now draw from SEPARATE pools so the music changes when a
// run begins. To rebalance which themes go where, change MENU_POOL_COUNT above
// (or reorder POOL_SRCS): menus get themes 1..N, gameplay gets the remainder.
const MENU_SRCS = POOL_SRCS.slice(0, MENU_POOL_COUNT);
const GAMEPLAY_SRCS = POOL_SRCS.slice(MENU_POOL_COUNT);
const BOSS_SRC = `assets/music/boss_theme.${MUSIC_EXT}`;

// --- State ---------------------------------------------------------------
let volume = DEFAULT_VOLUME;  // 0..100
let unlocked = false;         // true after the first user gesture
let desiredContext = null;    // what game.js wants: "menu" | "gameplay" | "boss" | null
let currentContext = null;    // what is actually playing
let currentSrc = null;        // active src (to avoid repeats / needless restarts)
let retryOnGesture = false;   // a play() hit a REAL autoplay block; retry on next gesture
let poolRotateTimer = null;   // setTimeout handle for menu/gameplay track rotation

// --- The two persistent decks ----------------------------------------------
// decks[active] is the incoming/playing deck; decks[1 - active] is outgoing.
function makeDeck() {
  const el = new Audio();
  el.preload = "auto";
  el.onerror = () => { console.warn(`[audio] could not load ${el.src}`); };
  return { el, playPromise: null };
}
const decks = [makeDeck(), makeDeck()];
let active = 0;

// Generation counter: bumped by every transition (playSrc / stopMusic). Any
// async callback that captured an older gen discards itself.
let transitionGen = 0;

// Crossfade animation.
let fadeRAF = null;
let fadeStart = 0;
let fadeGen = 0; // which transition this fade belongs to

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
  // set the active deck directly so the change is instant (0 = silent).
  if (!fadeRAF) decks[active].el.volume = volume / 100;
  saveVolume();
}

// --- Track selection ------------------------------------------------------
// Random track from a given pool, avoiding an immediate repeat of the current.
function randomPoolSrc(pool) {
  const n = pool.length;
  if (n === 0) return null;
  if (n === 1) return pool[0];
  let pick;
  do {
    pick = pool[Math.floor(Math.random() * n)];
  } while (pick === currentSrc);
  return pick;
}

// Which rotating pool a context draws from.
function poolForContext(ctx) {
  if (ctx === "menu") return MENU_SRCS;
  if (ctx === "gameplay") return GAMEPLAY_SRCS;
  return POOL_SRCS; // safety fallback
}

// --- Deferred, ownership-checked pause -------------------------------------
// Pause a deck WITHOUT ever interrupting a pending play(): wait for its play
// promise to settle first, and skip entirely if the deck has been reactivated
// (became the active deck again) in the meantime.
function safePause(deck) {
  const doPause = () => {
    if (decks[active] === deck && currentSrc) return; // reactivated — leave it alone
    deck.el.pause();
  };
  const p = deck.playPromise;
  if (p && typeof p.finally === "function") {
    p.catch(() => {}).finally(doPause);
  } else {
    doPause();
  }
}

// --- Crossfade ------------------------------------------------------------
function stepFade(now) {
  // A newer transition owns the fade now — this frame is stale.
  if (fadeGen !== transitionGen) { fadeRAF = null; return; }

  const t = Math.min(1, (now - fadeStart) / FADE_MS);
  const target = volume / 100; // read live, so the slider works mid-fade
  decks[active].el.volume = t * target;
  decks[1 - active].el.volume = (1 - t) * target;

  if (t >= 1) {
    safePause(decks[1 - active]); // outgoing deck done fading — stop it safely
    fadeRAF = null;
    return;
  }
  fadeRAF = requestAnimationFrame(stepFade);
}

function startFade(gen) {
  fadeGen = gen;
  fadeStart = performance.now();
  if (fadeRAF) cancelAnimationFrame(fadeRAF);
  fadeRAF = requestAnimationFrame(stepFade);
}

// Crossfade to a given src: swap decks, start the incoming one, fade.
function playSrc(src, loop) {
  if (!src) return;
  const gen = ++transitionGen;

  // Swap roles: current active becomes outgoing, the other becomes incoming.
  active = 1 - active;
  const inc = decks[active];

  const el = inc.el;
  el.loop = loop;
  el.volume = 0; // fade in from silence
  el.src = src;  // implicitly aborts any stale pending play on this element
                 // (its rejection is gen-guarded below, so it's harmless)
  currentSrc = src;

  const p = el.play();
  inc.playPromise = p;
  if (p && typeof p.then === "function") {
    p.then(() => {
      if (gen !== transitionGen) return; // superseded — ignore
      console.log(`[audio] now playing ${src}`);
    }).catch((err) => {
      if (gen !== transitionGen) return; // we superseded it ourselves — benign
      const name = err && err.name ? err.name : String(err);
      if (name === "NotAllowedError") {
        // GENUINE autoplay block: arm a retry on the next user gesture.
        // desiredContext stays set, so applyContext() will replay then.
        console.warn(`[audio] play() blocked for ${src} (autoplay) — retrying on next gesture`);
        retryOnGesture = true;
        currentContext = null;
        currentSrc = null;
      } else {
        // AbortError / load hiccup on the CURRENT transition: log only. The
        // generation system guarantees the newest request wins, and treating
        // this as an autoplay block is exactly what used to poison the music.
        console.warn(`[audio] play() interrupted for ${src}: ${name}`);
      }
    });
  }

  startFade(gen);
}

// --- Pool-track rotation --------------------------------------------------
// A selected track LOOPS seamlessly; we only rotate to a different random one
// (from the SAME pool as the current context) after NORMAL_TRACK_MIN_PLAY_SECONDS.
function clearPoolRotation() {
  if (poolRotateTimer) {
    clearTimeout(poolRotateTimer);
    poolRotateTimer = null;
  }
}

function schedulePoolRotation() {
  clearPoolRotation();
  poolRotateTimer = setTimeout(rotatePoolTrack, NORMAL_TRACK_MIN_PLAY_SECONDS * 1000);
}

// Start a pool track looping and (re)arm the rotation timer.
function startPoolTrack(src) {
  playSrc(src, true);
  schedulePoolRotation();
}

// Timer fired: crossfade to a DIFFERENT random track in the current pool and
// re-arm. No-op if we're no longer in a rotating context (boss/stopped).
function rotatePoolTrack() {
  if (currentContext !== "menu" && currentContext !== "gameplay") return;
  startPoolTrack(randomPoolSrc(poolForContext(currentContext)));
}

// Realize the desired context. Cheap + idempotent: no-ops unless the context
// actually changed, so game.js can call setMusicContext() every frame.
function applyContext() {
  if (!unlocked || retryOnGesture) return;
  if (desiredContext === currentContext && currentSrc) return;

  currentContext = desiredContext;
  if (desiredContext === "boss") {
    clearPoolRotation();        // boss interrupts the pool rotation
    playSrc(BOSS_SRC, true);
  } else if (desiredContext === "menu" || desiredContext === "gameplay") {
    // Fresh rotation in this context's pool (also how we resume after a boss).
    startPoolTrack(randomPoolSrc(poolForContext(desiredContext)));
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
  clearPoolRotation();
  const gen = ++transitionGen; // invalidates all pending callbacks + fades
  if (fadeRAF) { cancelAnimationFrame(fadeRAF); fadeRAF = null; }
  currentSrc = null;
  currentContext = null;
  for (const deck of decks) {
    const el = deck.el;
    const doPause = () => {
      if (transitionGen !== gen) return; // a new track started since — leave it
      el.pause();
    };
    const p = deck.playPromise;
    if (p && typeof p.finally === "function") p.catch(() => {}).finally(doPause);
    else doPause();
  }
}

// --- Sound effects ---------------------------------------------------------
// Data-driven one-shot registry. Each entry defines its file, base volume,
// voice-pool size (for overlapping plays), and a minimum interval throttle.
// All are autoplay-gated on the same `unlocked` flag as the music, and a
// missing file just fails silently — never throws.
//
// There is now also a MASTER SFX volume (0..100, Settings slider, persisted in
// localStorage) — the per-sound `volume` below is each sound's level in the
// mix, scaled by the master at play time. Tune the mix here.
const SFX_DEFS = {
  projectile: { src: "assets/sfx/familiar_projectile.wav", volume: 0.18, voices: 4, minInterval: 0.06 },
  level_up:   { src: "assets/sfx/level_up.mp3",   volume: 0.50, voices: 1, minInterval: 0.10 },
  heal:       { src: "assets/sfx/heal.mp3",       volume: 0.45, voices: 2, minInterval: 0.05 },
  magnet:     { src: "assets/sfx/magnet.mp3",     volume: 0.50, voices: 1, minInterval: 0.10 },
  wisp:       { src: "assets/sfx/wisp_noise.mp3", volume: 0.30, voices: 3, minInterval: 0.25 },
  hint:       { src: "assets/sfx/hint.mp3",       volume: 0.40, voices: 1, minInterval: 0.20 },
  hand_slam:  { src: "assets/sfx/hand_slam.mp3",  volume: 0.55, voices: 2, minInterval: 0.10 },
  mage_cast:  { src: "assets/sfx/mage_cast.mp3",  volume: 0.40, voices: 2, minInterval: 0.10 },
  mage_blast: { src: "assets/sfx/mage_blast.mp3", volume: 0.50, voices: 2, minInterval: 0.08 },
  goblin_windup: { src: "assets/sfx/goblin_windup.mp3", volume: 0.40, voices: 2, minInterval: 0.10 },
  goblin_bonk:   { src: "assets/sfx/goblin_bonk.mp3",   volume: 0.55, voices: 2, minInterval: 0.08 },
  pronggeist_spikes: { src: "assets/sfx/pronggeist_spikes.mp3", volume: 0.50, voices: 2, minInterval: 0.08 }, // fork tines erupt
  // Per-creature ambient voices (picked at random by game.js's chitter scheduler).
  gecko_chitter: { src: "assets/sfx/gecko_chitter.mp3", volume: 0.30, voices: 3, minInterval: 0.25 },
  mage_murmur:   { src: "assets/sfx/mage_murmur.mp3",   volume: 0.30, voices: 3, minInterval: 0.25 },
  goblin_grunt:  { src: "assets/sfx/goblin_grunt.mp3",  volume: 0.32, voices: 3, minInterval: 0.25 },
  pronggeist_chitter: { src: "assets/sfx/pronggeist_chitter.mp3", volume: 0.30, voices: 3, minInterval: 0.25 },
  // Event cues.
  gecko_fling:       { src: "assets/sfx/gecko_fling.mp3",       volume: 0.35, voices: 4, minInterval: 0.08 },
  elder_wisp_charge: { src: "assets/sfx/elder_wisp_charge.mp3", volume: 0.50, voices: 2, minInterval: 0.20 },
  elder_wisp_summon: { src: "assets/sfx/elder_wisp_summon.mp3", volume: 0.45, voices: 2, minInterval: 0.15 },
  // Hive Warden (bee boss): a grunt on the wind-up, a shot when the stinger volley fires.
  bee_charge: { src: "assets/sfx/bee_charge.mp3", volume: 0.45, voices: 2, minInterval: 0.20 },
  bee_sting:  { src: "assets/sfx/bee_sting.mp3",  volume: 0.50, voices: 3, minInterval: 0.10 },
// The Hourkeeper (clockwork boss): a clang as each clock hand strikes, a chime as the alarm runes cast.
  hourkeeper_sweep: { src: "assets/sfx/hourkeeper_sweep.mp3", volume: 0.45, voices: 3, minInterval: 0.12 },
  hourkeeper_alarm: { src: "assets/sfx/hourkeeper_alarm.mp3", volume: 0.45, voices: 2, minInterval: 0.20 },
};

const SFX_STORAGE_KEY = "ff_sfxVolume";
const DEFAULT_SFX_VOLUME = 50; // master, 0..100 (new players start at half)

let sfxVolume = DEFAULT_SFX_VOLUME;
const sfxPools = {}; // name -> { voices: [Audio], index, lastPlayed }

function loadSfxVolume() {
  try {
    const v = parseInt(localStorage.getItem(SFX_STORAGE_KEY), 10);
    if (!Number.isNaN(v)) sfxVolume = Math.max(0, Math.min(100, v));
  } catch (e) { /* storage blocked — keep default */ }
}

export function getSfxVolume() {
  return sfxVolume;
}

export function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem(SFX_STORAGE_KEY, String(sfxVolume)); } catch (e) { /* ignore */ }
}

function initSfx() {
  for (const [name, def] of Object.entries(SFX_DEFS)) {
    const pool = { voices: [], index: 0, lastPlayed: 0 };
    for (let i = 0; i < def.voices; i++) {
      const el = new Audio(def.src);
      el.onerror = () => {}; // missing/blocked file — ignore, never crash
      pool.voices.push(el);
    }
    sfxPools[name] = pool;
  }
}

export function playSfx(name) {
  if (!unlocked) return; // respect autoplay
  const def = SFX_DEFS[name];
  const pool = sfxPools[name];
  if (!def || !pool || pool.voices.length === 0) return;

  const now = performance.now();
  if (now - pool.lastPlayed < def.minInterval * 1000) return; // throttle
  pool.lastPlayed = now;

  const el = pool.voices[pool.index];
  pool.index = (pool.index + 1) % pool.voices.length;
  try {
    el.currentTime = 0;
    el.volume = def.volume * (sfxVolume / 100);
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    /* ignore */
  }
}

// Back-compat wrapper so familiar.js needs no changes.
export function playFamiliarProjectileSfx() {
  playSfx("projectile");
}

// First user gesture unlocks audio (browsers block it until then). Stays
// attached so a still-blocked browser retries on the next gesture, and so a
// genuine autoplay rejection (retryOnGesture) gets re-attempted too.
function onUserGesture() {
  const retry = retryOnGesture;
  retryOnGesture = false;
  if (!unlocked || retry) {
    unlocked = true;
    applyContext();
  }
}

export function initAudio() {
  loadVolume();
  loadSfxVolume();
  initSfx();
  window.addEventListener("keydown", onUserGesture);
  window.addEventListener("pointerdown", onUserGesture);
}
