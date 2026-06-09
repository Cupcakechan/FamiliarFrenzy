/* =========================================================================
   utils.js — tiny shared helpers.
   Think of this like a static "MathUtils" class in Unity: no state, just
   pure functions you can call from anywhere.
   ========================================================================= */

// Keep a value inside a [min, max] range.
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Smoothly blend from a -> b by t (0..1). Handy for following / easing later.
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Straight-line distance between two points.
export function distance(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

// Random float in [min, max).
export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

// Random whole number in [min, max] (inclusive).
export function randomInt(min, max) {
  return Math.floor(randomRange(min, max + 1));
}

// Circle-vs-circle overlap test. We will use this a lot in later phases
// (player vs enemy, familiar bolt vs enemy, player vs pickup).
export function circlesOverlap(ax, ay, ar, bx, by, br) {
  return distance(ax, ay, bx, by) < ar + br;
}

// Pick one of 8 directions (N/S/E/W + diagonals) from a direction vector.
// Canvas y+ points DOWN, so positive dy = south. Diagonal names are
// vertical-first (e.g. "ne", "sw") to match the sprite file naming and the
// witch/familiar conventions. Shared by the familiar and the enemies so the
// 8-way facing logic lives in exactly one place.
export function dirFromVector(dx, dy) {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  switch ((octant + 8) % 8) {
    case 0: return "e";
    case 1: return "se";
    case 2: return "s";
    case 3: return "sw";
    case 4: return "w";
    case 5: return "nw";
    case 6: return "n";
    case 7: return "ne";
    default: return "s";
  }
}
