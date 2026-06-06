/* =========================================================================
   familiar.js — the black cat: the REAL attacker in the game.

   Phase 2 responsibilities:
     - FOLLOW the witch with a slight delay (so it feels alive, not glued on).
     - Every `attackCooldown` seconds, find the NEAREST target in range and
       fire a magic bolt at it.
     - Manage its own bolts (move them, remove them when they hit or expire).

   IMPORTANT (Phase 2): bolts do NOT deal damage yet, because enemies don't
   have health until Phase 3. For now a bolt just flies and disappears when it
   reaches a target. The damage hook is marked below so Phase 3 can plug in.

   "targets" is an array of objects shaped like: { x, y, radius, dead }.
   Right now those are the temporary practice dummies from game.js.
   In Phase 3 we simply pass the real enemies instead — no rewrite needed.
   ========================================================================= */

import { distance, lerp } from "./utils.js";

// --- A single magic bolt -------------------------------------------------
// It locks its direction at spawn time and flies straight (it does NOT home
// in on a moving target). Simple and reliable.
class Bolt {
  constructor(x, y, targetX, targetY, speed) {
    this.x = x;
    this.y = y;
    this.radius = 5;

    // Aim: unit vector from the cat toward the target, times speed.
    const dx = targetX - x;
    const dy = targetY - y;
    const len = Math.hypot(dx, dy) || 1; // avoid divide-by-zero
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;

    this.life = 2;     // seconds before it auto-despawns (cleanup safety)
    this.dead = false; // set true on hit or when life runs out
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.shadowColor = "#b18cff";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#c9a8ff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class Familiar {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 9;

    // --- Tunable Phase 2 numbers (easy to change) ---
    this.attackRange = 260;     // px: only fires at targets within this distance
    this.attackCooldown = 1.2;  // seconds between shots
    this.boltSpeed = 520;       // px per second
    this.damage = 1;            // Sharper Claws upgrade will raise this (Phase 5)

    this.attackTimer = 0;       // counts down; fires when <= 0 AND a target exists
    this.bolts = [];            // bolts currently in flight
  }

  // dt = seconds. player = the witch. targets = array of {x,y,radius,dead}.
  update(dt, player, targets) {
    // --- FOLLOW ----------------------------------------------------------
    // Aim for a spot slightly up-left of the witch so the cat never perfectly
    // overlaps her. Frame-rate-independent smoothing: the cat eases toward
    // that spot, lagging a little when she moves and settling when she stops.
    const goalX = player.x - 22;
    const goalY = player.y - 22;
    const smooth = 1 - Math.pow(0.001, dt); // ~consistent feel at any fps
    this.x = lerp(this.x, goalX, smooth);
    this.y = lerp(this.y, goalY, smooth);

    // --- FIRE on cooldown ------------------------------------------------
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      const target = this.findNearestTarget(targets);
      if (target) {
        this.bolts.push(new Bolt(this.x, this.y, target.x, target.y, this.boltSpeed));
        this.attackTimer = this.attackCooldown; // only reset when we actually fire
      }
      // If no target is in range, we keep the timer ready and fire the instant
      // something comes into range.
    }

    // --- MOVE bolts + check hits ----------------------------------------
    for (const bolt of this.bolts) {
      bolt.update(dt);
      for (const target of targets) {
        if (target.dead) continue;
        if (distance(bolt.x, bolt.y, target.x, target.y) < bolt.radius + target.radius) {
          bolt.dead = true;
          target.hitFlash = 0.12; // brief flash so a hit is visible (Phase 2 feedback)
          // PHASE 3 HOOK: this is where damage will be applied, e.g.
          //   target.health -= this.damage;
          //   if (target.health <= 0) target.dead = true;
          break; // one bolt hits one target
        }
      }
    }
    // Drop spent bolts.
    this.bolts = this.bolts.filter((b) => !b.dead);
  }

  // Closest living target within attackRange, or null if none.
  findNearestTarget(targets) {
    let nearest = null;
    let nearestDist = this.attackRange;
    for (const target of targets) {
      if (target.dead) continue;
      const d = distance(this.x, this.y, target.x, target.y);
      if (d <= nearestDist) {
        nearestDist = d;
        nearest = target;
      }
    }
    return nearest;
  }

  draw(ctx) {
    // Bolts first, then the cat on top.
    for (const bolt of this.bolts) bolt.draw(ctx);

    ctx.save();

    // Body: a dark circle. A faint purple rim-light keeps the "black cat"
    // readable against the dark arena floor (placeholder until we add a sprite).
    ctx.shadowColor = "rgba(155,108,255,0.5)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#1c1a26";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Two little ears.
    ctx.beginPath();
    ctx.moveTo(this.x - 7, this.y - 5);
    ctx.lineTo(this.x - 4, this.y - 13);
    ctx.lineTo(this.x - 1, this.y - 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(this.x + 1, this.y - 6);
    ctx.lineTo(this.x + 4, this.y - 13);
    ctx.lineTo(this.x + 7, this.y - 5);
    ctx.closePath();
    ctx.fill();

    // Glowing gold eyes so the cat pops on the dark floor.
    ctx.fillStyle = "#f4d58d";
    ctx.beginPath(); ctx.arc(this.x - 3, this.y - 1, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.x + 3, this.y - 1, 1.7, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  // Fresh start (called from Game on restart).
  reset(x, y) {
    this.x = x;
    this.y = y;
    this.attackTimer = 0;
    this.bolts = [];
    this.damage = 1; // back to base damage each new game
  }
}
