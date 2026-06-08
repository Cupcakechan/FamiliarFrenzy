/* =========================================================================
   familiar.js — the black cat (a floating ghost): the REAL attacker.

   Follow + auto-fire bolts at the nearest enemy.

   Sprite animation (8 directions: N/S/E/W + NE/NW/SE/SW, like the witch):
     - IDLE (4 frames, loops) — its floaty "movement". It's a ghost, so the
       idle loop doubles as drifting/following; there is no separate walk.
     - ATTACK (6 frames, plays ONCE) — triggered when it fires an orb,
       then it returns to idle.
     - Facing: while idle it faces its drift/follow direction; when it fires
       it turns to face the orb's target.
     - Drawn SMALLER than the witch via `spriteScale`.
     - Missing/loading sprite → fall back to the placeholder black cat.

   Sprite files (single-row strips) in assets/sprites/familiar/, where <dir>
   is one of: n, s, e, w, ne, nw, se, sw:
     familiar_idle_<dir>.png    (4 frames)
     familiar_attack_<dir>.png  (6 frames)
   ========================================================================= */

import { distance, lerp } from "./utils.js";
import { loadImage, getImage } from "./assets.js";

const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const FAMILIAR_ANIMS = { idle: 4, attack: 6 };
const FAMILIAR_FPS = { idle: 6, attack: 12 }; // attack: 6 @ 12fps = 0.5s (fits cooldown)
const LOOPING = { idle: true, attack: false };

// How far (px) the cat trails up-left of the witch. Bigger = more separation.
const FOLLOW_OFFSET = 40;

// During Familiar Frenzy the cat fires this fraction of its normal cooldown.
const FRENZY_COOLDOWN_SCALE = 0.35; // ~3x faster

// --- Ghost trail (visual only) -------------------------------------------
const TRAIL_MAX = 6;          // past snapshots kept (the newest sits under the cat)
const TRAIL_ALPHA_MIN = 0.12; // oldest afterimage opacity
const TRAIL_ALPHA_MAX = 0.40; // newest visible afterimage opacity

// Registers 8 dirs x 2 anims = 16 strips (missing ones fall back gracefully).
for (const anim of ["idle", "attack"]) {
  for (const d of DIRS) {
    const key = `familiar_${anim}_${d}`;
    loadImage(key, `assets/sprites/familiar/${key}.png`);
  }
}

// Pick one of 8 directions (N/S/E/W + diagonals) from a direction vector.
// Canvas y+ points DOWN, so positive dy = south. Diagonal names are
// vertical-first (e.g. "ne", "sw") to match the sprite file naming + the witch.
function dirFromVector(dx, dy) {
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

// --- A single magic bolt -------------------------------------------------
class Bolt {
  constructor(x, y, targetX, targetY, speed, pierce = 0, evolved = false) {
    this.x = x;
    this.y = y;
    this.radius = 5;

    const dx = targetX - x;
    const dy = targetY - y;
    const len = Math.hypot(dx, dy) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;

    this.life = 2;
    this.dead = false;

    this.remainingPierce = pierce; // extra enemies it can pass through
    this.hitTargets = new Set();   // so it never hits the same enemy twice
    this.evolved = evolved;        // cosmetic: Phantom Pounce golden tint
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    if (this.evolved) {
      ctx.shadowColor = "#f4d58d";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#ffe7a6";
    } else {
      ctx.shadowColor = "#b18cff";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#c9a8ff";
    }
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.evolved ? this.radius + 1.5 : this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class Familiar {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 9;

    this.attackRange = 260;
    this.attackCooldown = 1.2;
    this.boltSpeed = 520;
    this.damage = 1;
    this.pierce = 0;        // extra enemies each bolt passes through (Ghost Pounce)
    this.evolved = false;   // Phantom Pounce unlocked

    this.attackTimer = 0;
    this.bolts = [];
    this.frenzyActive = false;

    // Animation.
    this.facing = "s";
    this.animState = "idle"; // "idle" | "attack"
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 0.65; // visual only; lower if the cat looks too big vs the witch
    this.trail = [];         // ghost-trail snapshots (visual only)
  }

  update(dt, player, targets, frenzyActive = false) {
    this.frenzyActive = frenzyActive;

    // --- FOLLOW (eases toward a spot near the witch) ---
    const prevX = this.x;
    const prevY = this.y;
    const goalX = player.x - FOLLOW_OFFSET;
    const goalY = player.y - FOLLOW_OFFSET;
    const smooth = 1 - Math.pow(0.001, dt);
    this.x = lerp(this.x, goalX, smooth);
    this.y = lerp(this.y, goalY, smooth);
    const moveX = this.x - prevX;
    const moveY = this.y - prevY;

    // --- FIRE on cooldown ---
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      const target = this.findNearestTarget(targets);
      if (target) {
        this.bolts.push(new Bolt(this.x, this.y, target.x, target.y, this.boltSpeed, this.pierce, this.evolved));
        this.attackTimer = this.attackCooldown * (frenzyActive ? FRENZY_COOLDOWN_SCALE : 1);
        this.facing = dirFromVector(target.x - this.x, target.y - this.y); // face the shot
        this.startAttackAnim();
      }
    }

    // While idle (not mid-attack), face the way it's drifting.
    if (this.animState === "idle" && (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1)) {
      this.facing = dirFromVector(moveX, moveY);
    }

    // --- Move bolts + hits (with piercing) ---
    for (const bolt of this.bolts) {
      bolt.update(dt);
      if (bolt.dead) continue;
      for (const target of targets) {
        if (target.dead || bolt.hitTargets.has(target)) continue;
        if (distance(bolt.x, bolt.y, target.x, target.y) < bolt.radius + target.radius) {
          target.takeDamage(this.damage);
          bolt.hitTargets.add(target);
          if (bolt.remainingPierce > 0) {
            bolt.remainingPierce -= 1; // pass through to the next enemy
          } else {
            bolt.dead = true;
            break;
          }
        }
      }
    }
    this.bolts = this.bolts.filter((b) => !b.dead);

    this.updateAnimation(dt);

    // Record a snapshot for the ghost trail (visual only). Sampled every frame,
    // so the trail naturally spreads when moving and bunches up when still.
    this.trail.push({
      x: this.x, y: this.y,
      facing: this.facing,
      animState: this.animState,
      animFrame: this.animFrame,
    });
    if (this.trail.length > TRAIL_MAX) this.trail.shift();
  }

  startAttackAnim() {
    this.animState = "attack";
    this.animFrame = 0;
    this.animTimer = 0;
  }

  updateAnimation(dt) {
    const fps = FAMILIAR_FPS[this.animState];
    const frames = FAMILIAR_ANIMS[this.animState];
    const frameDur = 1 / fps;
    const loops = LOOPING[this.animState];

    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      if (loops) {
        this.animFrame = (this.animFrame + 1) % frames;
      } else if (this.animFrame < frames - 1) {
        this.animFrame += 1;
      } else {
        this.animState = "idle";
        this.animFrame = 0;
        this.animTimer = 0;
        break;
      }
    }
  }

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

  // Draw one cat (sprite or fallback) at a position + facing + frame, at a
  // given opacity. Used for BOTH the real cat (alpha 1) and the ghost-trail
  // afterimages (low alpha). Wrapped in save/restore so globalAlpha + shadow
  // never leak out and dim anything else on screen.
  drawCat(ctx, x, y, facing, animState, animFrame, alpha) {
    const key = `familiar_${animState}_${facing}`;
    const img = getImage(key);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (img && img.width > 0) {
      const frames = FAMILIAR_ANIMS[animState];
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, x - dw / 2, y - dh / 2, dw, dh);
    } else {
      // --- Fallback placeholder black cat ---
      ctx.shadowColor = "rgba(155,108,255,0.5)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#1c1a26";
      ctx.beginPath();
      ctx.arc(x, y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 5);
      ctx.lineTo(x - 4, y - 13);
      ctx.lineTo(x - 1, y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 1, y - 6);
      ctx.lineTo(x + 4, y - 13);
      ctx.lineTo(x + 7, y - 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f4d58d";
      ctx.beginPath(); ctx.arc(x - 3, y - 1, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 3, y - 1, 1.7, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  draw(ctx) {
    for (const bolt of this.bolts) bolt.draw(ctx);

    // --- Ghost trail: faded afterimages behind the cat, oldest → newest ---
    for (let i = 0; i < this.trail.length; i++) {
      const s = this.trail[i];
      const t = this.trail.length > 1 ? i / (this.trail.length - 1) : 1;
      const alpha = TRAIL_ALPHA_MIN + (TRAIL_ALPHA_MAX - TRAIL_ALPHA_MIN) * t;
      this.drawCat(ctx, s.x, s.y, s.facing, s.animState, s.animFrame, alpha);
    }

    // Frenzy aura (cheap drawn glow, no sprite).
    if (this.frenzyActive) {
      const pulse = 16 + Math.sin(performance.now() / 110) * 4;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.shadowColor = "#f4d58d";
      ctx.shadowBlur = 22;
      ctx.fillStyle = "rgba(244, 213, 141, 0.28)";
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // The real cat on top, full opacity.
    this.drawCat(ctx, this.x, this.y, this.facing, this.animState, this.animFrame, 1);
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.attackTimer = 0;
    this.bolts = [];
    this.damage = 1;
    this.attackCooldown = 1.2;
    this.pierce = 0;
    this.evolved = false;
    this.frenzyActive = false;
    this.facing = "s";
    this.animState = "idle";
    this.animFrame = 0;
    this.animTimer = 0;
    this.trail = [];
  }
}
