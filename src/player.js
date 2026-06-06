/* =========================================================================
   player.js — the witch (placeholder shape: a purple circle with a hat notch).

   Phase 1: move + stay in bounds + hold health.
   Phase 3: takeDamage() with invulnerability frames (i-frames) so a single
            touch doesn't drain you instantly, plus a flicker while invulnerable.

   Later: sprite, etc. (the draw() is the only thing that changes for art.)
   ========================================================================= */

import { clamp } from "./utils.js";

export class Player {
  constructor(x, y) {
    // Position is the CENTER of the player.
    this.x = x;
    this.y = y;

    this.radius = 16;          // used for drawing + collisions
    this.speed = 220;          // pixels per SECOND (frame-rate independent)
    this.color = "#9b6cff";    // placeholder purple

    // Health system.
    this.maxHealth = 100;
    this.health = 100;

    // Invulnerability after taking a hit.
    this.invulnDuration = 1.0; // seconds of i-frames per hit
    this.invulnTimer = 0;      // seconds remaining (0 = can be hit)
  }

  // dt = delta time in seconds. bounds = { width, height } of the arena.
  update(dt, input, bounds) {
    const move = input.getMoveAxis();

    this.x += move.x * this.speed * dt;
    this.y += move.y * this.speed * dt;

    // Keep the whole circle inside the arena.
    this.x = clamp(this.x, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y, this.radius, bounds.height - this.radius);

    // Count down i-frames.
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
  }

  // Apply damage, but only if not currently invulnerable.
  // Returns true if the hit landed (useful for sfx/feedback later).
  takeDamage(amount) {
    if (this.invulnTimer > 0) return false; // ignore during i-frames
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    this.invulnTimer = this.invulnDuration; // start i-frames
    return true;
  }

  // Convenience: am I currently invulnerable?
  get isInvulnerable() {
    return this.invulnTimer > 0;
  }

  draw(ctx) {
    ctx.save();

    // Flicker while invulnerable so the player can SEE the i-frames.
    // Toggles roughly every 0.1s between visible and faint.
    if (this.invulnTimer > 0) {
      const blinkOn = Math.floor(this.invulnTimer * 10) % 2 === 0;
      ctx.globalAlpha = blinkOn ? 0.35 : 1;
    }

    // Soft glow body.
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 14;

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Little hat triangle (cosmetic placeholder).
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#5b3aa6";
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - this.radius - 12);
    ctx.lineTo(this.x - 10, this.y - this.radius + 2);
    ctx.lineTo(this.x + 10, this.y - this.radius + 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Reset everything for a fresh game (called from Game on restart).
  reset(x, y) {
    this.x = x;
    this.y = y;
    this.health = this.maxHealth;
    this.invulnTimer = 0;
  }
}
