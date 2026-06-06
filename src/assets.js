/* =========================================================================
   assets.js — a tiny image loader + cache with GRACEFUL FALLBACK.

   The golden rule (from the design doc): the game must still run if a sprite
   is missing. So loading never throws — if a file is absent or still loading,
   isLoaded(key) stays false and the draw code falls back to placeholder shapes.

   Usage:
     Assets.loadImage("player_walk_s", "assets/sprites/player/walk_s.png");
     const rec = Assets.getImage("player_walk_s");
     if (rec && rec.loaded) ctx.drawImage(rec.img, ...);
   ========================================================================= */

const cache = {}; // key -> { img: HTMLImageElement, loaded: boolean }

export function loadImage(key, src) {
  if (cache[key]) return cache[key]; // already requested — don't reload

  const record = { img: new Image(), loaded: false };
  record.img.onload = () => { record.loaded = true; };
  record.img.onerror = () => { record.loaded = false; }; // missing → fallback
  record.img.src = src;

  cache[key] = record;
  return record;
}

export function getImage(key) {
  return cache[key] || null;
}

export function isLoaded(key) {
  const r = cache[key];
  return !!(r && r.loaded);
}
