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
