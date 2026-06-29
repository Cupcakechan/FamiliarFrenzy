/* =========================================================================
   kongregate.js — the Kongregate integration layer.

   This is the ONLY file in the project that knows Kongregate exists. The rest
   of the game imports a tiny, neutral interface from here (submitStat, isGuest,
   onLogin, showRegister, isAvailable) and never touches the raw `kongregate`
   object. That keeps the platform glue in one isolated, swappable place.

   HOW IT BEHAVES IN EACH BUILD:
     • Kongregate build  — index.kongregate.html loads kongregate_api.js in
       <head>, which defines window.kongregateAPI. We detect it, run loadAPI,
       and submit/queue stats for real.
     • itch / local      — that script tag is absent, so window.kongregateAPI is
       undefined. We detect the absence and run in NO-OP mode: every call is a
       harmless logged no-op and the game boots exactly as it does today.

   SAFETY CONTRACT: nothing in here may ever throw during import or boot. Every
   entry point is wrapped so a failure degrades to no-op mode instead of taking
   the game down with it. That is the real robustness lever (not detection).
   ========================================================================= */

// Console logging for the integration. Left TRUE through development so stat
// submits, the queue, and login events are visible in the browser console.
// FLIP TO false FOR THE PUBLIC LAUNCH BUILD (see the P10 launch checklist) to
// keep the console quiet for players.
const KONG_LOG = true;

// --- Internal state ----------------------------------------------------------
// `api` is the live Kongregate API object once ready; null until then (and
// forever on itch/local). `ready` gates real submits vs. the queue. `available`
// is true only when we are genuinely embedded on Kongregate.
let api = null;
let ready = false;
let available = false;

// Stats submitted before loadAPI's async callback fires wait here, then flush.
const pendingStats = [];

// Login callbacks registered by later passes (P7). A single dispatcher (wired
// once the API is ready) iterates this array live at event time, so callbacks
// registered before OR after wiring both fire correctly.
const loginCallbacks = [];

function log(...args) {
  if (KONG_LOG) console.log("[kongregate]", ...args);
}

// --- Boot --------------------------------------------------------------------
// Detect Kongregate and initialize the API. Call once at startup. NEVER throws.
export function initKongregate() {
  try {
    // The Kongregate build includes kongregate_api.js as a normal (blocking)
    // <script> in <head>; it defines window.kongregateAPI synchronously BEFORE
    // this deferred ES module runs. So a simple presence check is reliable —
    // no polling needed. Absence means itch/local → stay in no-op mode.
    if (typeof window === "undefined" || typeof window.kongregateAPI === "undefined") {
      log("API not present — running in no-op mode (itch / local).");
      return;
    }

    available = true;
    log("API detected — initializing…");

    // loadAPI runs exactly once per page load (per Kongregate's docs) and its
    // callback is ASYNC: it can fire after the game has already booted. Anything
    // submitted before then sits in pendingStats and is flushed here.
    window.kongregateAPI.loadAPI(function () {
      try {
        window.kongregate = window.kongregateAPI.getAPI();
        api = window.kongregate;
        ready = true;
        log("API ready — username:", safeUsername(), "| guest:", isGuest());

        flushPending();
        wireLoginListener();
      } catch (e) {
        // A failure in the ready callback must not break the page.
        log("error in API ready callback:", e);
      }
    });
  } catch (e) {
    // Detection / init must never break boot — fall back to no-op mode.
    log("init failed — staying in no-op mode:", e);
  }
}

// --- Stats -------------------------------------------------------------------
// Submit a stat to Kongregate. Kongregate requires non-negative integers, so we
// floor/clamp defensively here too (callers should still pass clean values).
//   ready + available → submit now
//   available, not yet ready → queue (flushes when the API finishes loading)
//   not available (itch/local) → logged no-op
export function submitStat(name, value) {
  const v = Math.max(0, Math.floor(Number(value) || 0));
  if (ready && api) {
    rawSubmit(name, v);
  } else if (available) {
    pendingStats.push({ name: name, value: v });
    log("queued", name, "=", v, "(API not ready yet)");
  } else {
    log("no-op submit", name, "=", v, "(Kongregate unavailable)");
  }
}

function rawSubmit(name, value) {
  try {
    api.stats.submit(name, value);
    log("submit", name, "=", value);
  } catch (e) {
    log("submit failed for", name, ":", e);
  }
}

function flushPending() {
  if (!ready || !api) return;
  while (pendingStats.length > 0) {
    const s = pendingStats.shift();
    rawSubmit(s.name, s.value);
  }
}

// --- Status / guests / login (used from P7 onward) ---------------------------
// True only when genuinely running on Kongregate with the API loaded. Callers
// gate any Kongregate-specific UI (e.g. the register prompt) behind this.
export function isAvailable() {
  return available;
}

// Is the current Kongregate user a guest? Returns false when unavailable or not
// yet ready, so off-platform builds never show a "please register" prompt (the
// prompt logic in P7 checks isAvailable() && isGuest()).
export function isGuest() {
  try {
    if (ready && api) return !!api.services.isGuest();
  } catch (e) {
    log("isGuest failed:", e);
  }
  return false;
}

// Register a callback for Kongregate's in-page login event (a guest signing in
// without a page reload). Safe to call at any time; stored and fired by the
// dispatcher below.
export function onLogin(cb) {
  if (typeof cb === "function") loginCallbacks.push(cb);
}

function wireLoginListener() {
  if (!ready || !api) return;
  try {
    api.services.addEventListener("login", function () {
      log("login event — user is now:", safeUsername());
      for (const cb of loginCallbacks) {
        try { cb(); } catch (e) { log("login callback error:", e); }
      }
    });
  } catch (e) {
    log("could not wire login listener:", e);
  }
}

// Show Kongregate's sign-in / register lightbox. No-op off-platform.
export function showRegister() {
  try {
    if (ready && api) api.services.showRegistrationBox();
    else log("showRegister no-op (Kongregate unavailable / not ready)");
  } catch (e) {
    log("showRegister failed:", e);
  }
}

// --- Internal helper ---------------------------------------------------------
function safeUsername() {
  try {
    if (ready && api) return api.services.getUsername();
  } catch (e) { /* ignore — best-effort logging only */ }
  return "(unknown)";
}
