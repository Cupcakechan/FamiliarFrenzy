/* =========================================================================
   assets.js — a tiny image loader with GRACEFUL FALLBACK.

   Why fallback matters: the game must keep running even if a sprite file is
   missing or still loading. So getImage() returns the image ONLY once it has
   fully loaded; until then (or if the file 404s) it returns null, and the
   drawing code falls back to its placeholder shape.

   Usage:
     loadImage("witch_walk_s", "assets/sprites/player/witch_walk_s.png");
     const img = getImage("witch_walk_s");  // null until loaded, then the <img>

   Single-row strips: slice at draw time with frameWidth = img.width / frames,
   frameHeight = img.height. No pixel sizes need to be hard-coded.
   ========================================================================= */

const images = {};       // key -> HTMLImageElement
const loadedFlags = {};  // key -> boolean (true only after onload fires)

export function loadImage(key, src) {
  const img = new Image();
  img.onload = () => { loadedFlags[key] = true; };
  img.onerror = () => { loadedFlags[key] = false; }; // missing file → stay on fallback
  img.src = src;
  images[key] = img;
  if (!(key in loadedFlags)) loadedFlags[key] = false;
}

// Returns the loaded image, or null if it isn't ready / failed (→ use fallback).
export function getImage(key) {
  return loadedFlags[key] ? images[key] : null;
}
