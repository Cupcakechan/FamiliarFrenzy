/* =========================================================================
   pickups.js — things enemies drop that the witch collects.

   Pickup (currency mote): grants XP. Uses a small looping idle sprite, with
   a gold-circle fallback. The loaded sprite now gets a soft, pulsing gold
   GLOW HALO + a gentle "breathing" scale so motes read as little magical
   beacons (cheap: a radial gradient, NOT shadowBlur, so swarms stay smooth).

   HealthFlask (Feature 1): a rarer drop that restores HP. Uses a SIMPLE green
   placeholder shape for now (no sprite — art is paused). Carries its heal
   amount so the game stays the single source of tuning.
   ========================================================================= */

import { randomRange, randomInt } from "./utils.js";
import { loadImage, getImage } from "./assets.js";

const MOTE_FRAMES = 4;
const MOTE_FPS = 6;

// --- Mote glow tuning (all easy to dial) ---------------------------------
const MOTE_GLOW_SPEED = 3;        // radians/sec the halo + scale pulse breathes
const MOTE_HALO_SCALE = 2.6;      // halo radius as a multiple of the mote radius
const MOTE_HALO_PULSE = 0.30;     // how much the halo radius grows/shrinks (0..1)
const MOTE_BREATHE_AMOUNT = 0.14; // sprite scale swing (≈ ±7%)

// Health flask sprite (single static frame by default; bump FLASK_FRAMES if a
// future animated strip is provided). Missing/loading → green-orb fallback.
const FLASK_FRAMES = 1;
const FLASK_FPS = 6; // only used when FLASK_FRAMES > 1
const FLASK_SPAWN_FLASH_TIME = 2.0; // seconds the "look here!" glow pulses + fades after a flask appears

loadImage("mote_idle", "assets/sprites/pickups/mote_idle.png");
loadImage("flask_idle", "assets/sprites/pickups/flask_idle.png");
loadImage("spirit_magnet", "assets/sprites/pickups/spirit_magnet.png");
loadImage("raven_feather", "assets/sprites/pickups/raven_feather.png");

export class Pickup {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 7;
    this.value = 1;
    this.dead = false;

    this.bob = randomRange(0, Math.PI * 2);
    this.glow = randomRange(0, Math.PI * 2); // own phase so glow ≠ in lock-step with bob
    this.spriteScale = 0.5;
    this.animFrame = randomInt(0, MOTE_FRAMES - 1);
    this.animTimer = 0;
  }

  update(dt) {
    this.bob += dt * 4;
    this.glow += dt * MOTE_GLOW_SPEED;

    const frameDur = 1 / MOTE_FPS;
    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      this.animFrame = (this.animFrame + 1) % MOTE_FRAMES;
    }
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    const cy = this.y + yOff;
    const img = getImage("mote_idle");

    // Breathing value 0..1 (drives both the halo and the sprite scale).
    const pulse = 0.5 + 0.5 * Math.sin(this.glow);

    if (img && img.width > 0) {
      // --- Soft glow halo behind the sprite ---
      // A radial gradient is far cheaper than ctx.shadowBlur, so dozens of
      // motes on screen at once (swarms / Lucky Paws) stay smooth.
      const haloR = this.radius * MOTE_HALO_SCALE * (1 - MOTE_HALO_PULSE / 2 + pulse * MOTE_HALO_PULSE);
      const g = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, haloR);
      g.addColorStop(0, `rgba(244, 213, 141, ${0.32 + pulse * 0.26})`);
      g.addColorStop(0.45, "rgba(244, 213, 141, 0.16)");
      g.addColorStop(1, "rgba(244, 213, 141, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // --- Sprite, with a subtle breathing scale ---
      const breathe = 1 + (pulse - 0.5) * MOTE_BREATHE_AMOUNT;
      const fw = img.width / MOTE_FRAMES;
      const fh = img.height;
      const dw = fw * this.spriteScale * breathe;
      const dh = fh * this.spriteScale * breathe;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, cy - dh / 2, dw, dh);
    } else {
      // --- Fallback gold mote (unchanged) ---
      ctx.save();
      ctx.shadowColor = "#f4d58d";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#f4d58d";
      ctx.beginPath();
      ctx.arc(this.x, cy, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff6dd";
      ctx.beginPath();
      ctx.arc(this.x, cy, this.radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// --- Health Flask (Feature 1) --------------------------------------------
// Placeholder: a green orb with a white "+" cross. Easy to swap for a sprite
// later when art resumes.
export class HealthFlask {
  constructor(x, y, heal) {
    this.x = x;
    this.y = y;
    this.radius = 9;
    this.heal = heal;     // HP restored on pickup
    this.dead = false;
    this.bob = randomRange(0, Math.PI * 2);
    this.spriteScale = 0.5; // visual only; tune to match the flask art
    this.animFrame = 0;
    this.animTimer = 0;
    this.spawnFlash = FLASK_SPAWN_FLASH_TIME; // brief attention glow on appearance
  }

  update(dt) {
    this.bob += dt * 4;
    if (this.spawnFlash > 0) this.spawnFlash -= dt;
    if (FLASK_FRAMES > 1) {
      const frameDur = 1 / FLASK_FPS;
      this.animTimer += dt;
      while (this.animTimer >= frameDur) {
        this.animTimer -= frameDur;
        this.animFrame = (this.animFrame + 1) % FLASK_FRAMES;
      }
    }
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    const cy = this.y + yOff;
    const img = getImage("flask_idle");

    // Spawn flash: a soft green glow that pulses + fades right after the flask
    // appears, so it's easy to spot even in a busy or large arena.
    if (this.spawnFlash > 0) {
      const t = this.spawnFlash / FLASK_SPAWN_FLASH_TIME; // 1 -> 0
      const pulse = 0.5 + 0.5 * Math.sin(this.spawnFlash * 9);
      const haloR = this.radius * (2.4 + pulse * 0.9);
      const a = 0.5 * t * (0.55 + 0.45 * pulse);
      const g = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, haloR);
      g.addColorStop(0, `rgba(120, 240, 150, ${a})`);
      g.addColorStop(1, "rgba(120, 240, 150, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, cy, haloR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (img && img.width > 0) {
      // --- Sprite path (single static frame, or a strip if FLASK_FRAMES > 1) ---
      const fw = img.width / FLASK_FRAMES;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, cy - dh / 2, dw, dh);
    } else {
      // --- Fallback: green orb + white "+" cross (unchanged) ---
      ctx.save();
      ctx.shadowColor = "#5ad17a";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#5ad17a";
      ctx.beginPath();
      ctx.arc(this.x, cy, this.radius, 0, Math.PI * 2);
      ctx.fill();

      // White health "+" cross.
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      const arm = 6;  // length from center
      const thick = 2; // half-thickness
      ctx.fillRect(this.x - thick, cy - arm, thick * 2, arm * 2); // vertical
      ctx.fillRect(this.x - arm, cy - thick, arm * 2, thick * 2); // horizontal

      ctx.restore();
    }
  }
}

// --- Spirit Magnet (rare) -------------------------------------------------
// A rare pickup that, when collected, vacuums all dropped rewards toward the
// player (effect handled in game.js). Placeholder: a pulsing golden-orange
// charm/ring. Future sprite: assets/sprites/pickups/spirit_magnet.png (single
// frame). Missing/loading sprite falls back to the placeholder — never crashes.
export class SpiritMagnet {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 10;
    this.dead = false;
    this.bob = randomRange(0, Math.PI * 2);
    this.glow = randomRange(0, Math.PI * 2);
    this.spriteScale = 0.5; // visual only; tune to match future art
  }

  update(dt) {
    this.bob += dt * 4;
    this.glow += dt * 3;
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    const cy = this.y + yOff;
    const pulse = 0.5 + 0.5 * Math.sin(this.glow);
    const img = getImage("spirit_magnet");

    if (img && img.width > 0) {
      // --- Sprite path: keep the pulsing gold halo + hover behind the real
      // art so the magnet still reads as a rare beacon. The ring + inner core
      // were placeholder stand-ins for the art itself, so they're dropped. ---
      ctx.save();
      const haloR = this.radius * (2.0 + pulse * 0.5);
      const g = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, haloR);
      g.addColorStop(0, `rgba(242, 165, 64, ${0.35 + pulse * 0.25})`);
      g.addColorStop(1, "rgba(242, 165, 64, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      const dw = img.width * this.spriteScale;
      const dh = img.height * this.spriteScale;
      ctx.drawImage(img, this.x - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
      return;
    }

    // --- Placeholder: pulsing golden-orange charm ---
    ctx.save();

    // Soft halo (cheap radial gradient, like the EXP mote glow).
    const haloR = this.radius * (2.0 + pulse * 0.5);
    const g = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, haloR);
    g.addColorStop(0, `rgba(242, 165, 64, ${0.35 + pulse * 0.25})`);
    g.addColorStop(1, "rgba(242, 165, 64, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, cy, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Hollow ring — distinct from the solid gold motes / green flasks.
    ctx.strokeStyle = "#F2A540";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(this.x, cy, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Bright inner core.
    ctx.fillStyle = "#ffe7c2";
    ctx.beginPath();
    ctx.arc(this.x, cy, this.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// --- Raven Feather (Raven familiar) ---------------------------------------
// A small healing pickup dropped by Scavenger's Gift (chance on a non-boss kill)
// and Grave Tax (guaranteed when a marked enemy dies). Heals a little; uses
// raven_feather.png (32x32) with a code-drawn dark-feather fallback. UNLIKE the
// other pickups it has a short TTL and fades out, so the player has to collect it
// promptly — sustain through active play, not hoarding a pile of heals for later.
const FEATHER_FADE = 1.5; // seconds of fade-out at the end of its life

export class RavenFeather {
  constructor(x, y, heal, life) {
    this.x = x;
    this.y = y;
    this.radius = 8;
    this.heal = heal;       // HP restored on pickup
    this.dead = false;
    this.life = life;       // seconds before it fades away uncollected
    this.maxLife = life;
    this.bob = randomRange(0, Math.PI * 2);
    this.spriteScale = 0.5; // visual only; matches the 32x32 art
  }

  update(dt) {
    this.bob += dt * 4;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    const cy = this.y + yOff;
    // Fade over the final FEATHER_FADE seconds so its disappearance reads clearly.
    const alpha = this.life < FEATHER_FADE ? Math.max(0, this.life / FEATHER_FADE) : 1;
    const img = getImage("raven_feather");

    ctx.save();
    ctx.globalAlpha = alpha;
    if (img && img.width > 0) {
      // Soft violet halo so the feather reads as a magical pickup (cheap gradient).
      const haloR = this.radius * 2.0;
      const g = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, haloR);
      g.addColorStop(0, "rgba(170, 140, 220, 0.30)");
      g.addColorStop(1, "rgba(170, 140, 220, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      const dw = img.width * this.spriteScale;
      const dh = img.height * this.spriteScale;
      ctx.drawImage(img, this.x - dw / 2, cy - dh / 2, dw, dh);
    } else {
      // --- Fallback: a small dark feather (violet vane + pale shaft) ---
      ctx.translate(this.x, cy);
      ctx.shadowColor = "#7a5aa8";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#3a2f5e";
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius * 0.55, this.radius, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#cdb4ff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-this.radius * 0.5, this.radius * 0.7);
      ctx.lineTo(this.radius * 0.5, -this.radius * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}