/* =========================================================================
   familiar.js — the black cat (a floating ghost): the REAL attacker.

   Follow + auto-fire bolts at the nearest enemy.

   Phase 7 sprite animation (4 directions: N/S/E/W):
     - IDLE (9 frames, loops) — its floaty "movement".
     - ATTACK (6 frames, plays ONCE) — triggered when it fires an orb,
       then it returns to idle.
     - Facing: while idle it faces its drift/follow direction; when it fires
       it turns to face the orb's target.
     - Drawn SMALLER than the witch via `spriteScale`.
     - Missing/loading sprite → fall back to the placeholder black cat.

   Sprite files (single-row strips) in assets/sprites/familiar/:
     familiar_idle_{n,s,e,w}.png    (9 frames)
     familiar_attack_{n,s,e,w}.png  (6 frames)
   ========================================================================= */

import { distance, lerp } from "./utils.js";
import { loadImage, getImage } from "./assets.js";

const DIRS = ["n", "s", "e", "w"];
const FAMILIAR_ANIMS = { idle: 9, attack: 6 };
const FAMILIAR_FPS = { idle: 8, attack: 12 }; // attack: 6 @ 12fps = 0.5s (fits cooldown)
const LOOPING = { idle: true, attack: false };

// How far (px) the cat trails up-left of the witch. Bigger = more separation.
const FOLLOW_OFFSET = 40;

// During Familiar Frenzy the cat fires this fraction of its normal cooldown.
const FRENZY_COOLDOWN_SCALE = 0.35; // ~3x faster

for (const anim of ["idle", "attack"]) {
  for (const d of DIRS) {
    const key = `familiar_${anim}_${d}`;
    loadImage(key, `assets/sprites/familiar/${key}.png`);
  }
}

// Pick N/S/E/W from a direction vector (horizontal wins ties).
function dirFromVector(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n"; // canvas y+ is downward
}

// --- A single magic bolt -------------------------------------------------
class Bolt {
  constructor(x, y, targetX, targetY, speed) {
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

    this.attackRange = 260;
    this.attackCooldown = 1.2;
    this.boltSpeed = 520;
    this.damage = 1;

    this.attackTimer = 0;
    this.bolts = [];
    this.frenzyActive = false;

    // Animation.
    this.facing = "s";
    this.animState = "idle"; // "idle" | "attack"
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 1;    // lower if the cat looks too big vs the witch
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
        this.bolts.push(new Bolt(this.x, this.y, target.x, target.y, this.boltSpeed));
        this.attackTimer = this.attackCooldown * (frenzyActive ? FRENZY_COOLDOWN_SCALE : 1);
        this.facing = dirFromVector(target.x - this.x, target.y - this.y); // face the shot
        this.startAttackAnim();
      }
    }

    // While idle (not mid-attack), face the way it's drifting.
    if (this.animState === "idle" && (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1)) {
      this.facing = dirFromVector(moveX, moveY);
    }

    // --- Move bolts + hits ---
    for (const bolt of this.bolts) {
      bolt.update(dt);
      for (const target of targets) {
        if (target.dead) continue;
        if (distance(bolt.x, bolt.y, target.x, target.y) < bolt.radius + target.radius) {
          bolt.dead = true;
          target.takeDamage(this.damage);
          break;
        }
      }
    }
    this.bolts = this.bolts.filter((b) => !b.dead);

    this.updateAnimation(dt);
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

  draw(ctx) {
    for (const bolt of this.bolts) bolt.draw(ctx);

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

    const key = `familiar_${this.animState}_${this.facing}`;
    const img = getImage(key);

    if (img && img.width > 0) {
      const frames = FAMILIAR_ANIMS[this.animState];
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
    } else {
      // --- Fallback placeholder black cat ---
      ctx.save();
      ctx.shadowColor = "rgba(155,108,255,0.5)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#1c1a26";
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
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
      ctx.fillStyle = "#f4d58d";
      ctx.beginPath(); ctx.arc(this.x - 3, this.y - 1, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(this.x + 3, this.y - 1, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.attackTimer = 0;
    this.bolts = [];
    this.damage = 1;
    this.attackCooldown = 1.2;
    this.frenzyActive = false;
    this.facing = "s";
    this.animState = "idle";
    this.animFrame = 0;
    this.animTimer = 0;
  }
}
