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

import { distance, lerp, dirFromVector } from "./utils.js";
import { loadImage, getImage } from "./assets.js";
import { playFamiliarProjectileSfx } from "./audio.js";

const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const FAMILIAR_ANIMS = { idle: 4, attack: 6 };
const FAMILIAR_FPS = { idle: 6, attack: 12 }; // attack: 6 @ 12fps = 0.5s (fits cooldown)
const LOOPING = { idle: true, attack: false };

// How far (px) the cat trails up-left of the witch. Bigger = more separation.
const FOLLOW_OFFSET = 40;

// During Familiar Frenzy the cat fires this fraction of its normal cooldown.
const FRENZY_COOLDOWN_SCALE = 0.35; // ~3x faster

// --- Astral Judgment (Owl familiar's Spirit Imbued behavior) -------------------
// While Spirit Imbued is active AND the equipped familiar is the Owl, the Owl
// periodically smites the single highest-priority target (boss > caster > ranged >
// bruiser > nearest) for a flat, capped amount — repeated over the Spirit Imbued
// window rather than a melt. It runs ALONGSIDE the normal collar attack (which keeps
// firing at nearest) and any Spirit Bond link; it never changes the collar attack.
const ASTRAL_STRIKE_INTERVAL = 0.9; // seconds between strikes (slower = more deliberate, less boss-melt)
const ASTRAL_STRIKE_DAMAGE = 5;     // flat CHIP per strike — the Owl's value is its targeting + passive,
                                    //   not raw DPS (~7 strikes x 5 = ~35 over a 6s Spirit Imbued, so it
                                    //   chips a boss rather than soloing it, and won't one-shot mid-tier trash)
const ASTRAL_STAR_LIFE = 0.45;      // seconds the code-drawn star lingers/fades (a touch longer = more readable)

// Threat tier for Astral Judgment's priority pick. Higher = struck first. Reads
// only existing enemy fields (isBoss + the def flags), so no enemy code changes.
function threatScore(t) {
  if (t.isBoss) return 5;                                // bosses first, always
  const def = t.def;
  if (def && (def.caster || def.lineCaster)) return 4;   // ground/line zoners (Bone Mage, Pronggeist)
  if (def && def.ranged) return 3;                       // skirmishers (Gutter Gecko)
  if (def && def.bruiser) return 2;                      // committed melee (Goblin)
  return 1;                                              // wisps + everything else (nearest tiebreak)
}

// --- Spirit Volley evolution (spread-shot) -------------------------------
// Once unlocked (familiar.spreadShot = true), every attack fires a center bolt
// PLUS two angled side bolts. The center keeps full familiar damage; the side
// bolts deal a reduced cut (still enough to chip enemy HP). All three share the
// familiar's pierce + evolved (Phantom Pounce) visual. Tunable:
const SPREAD_ANGLE = 0.26;       // radians (~15 deg) between the center and each side bolt
const SIDE_DAMAGE_SCALE = 0.5;   // side-bolt damage as a fraction of familiar damage
                                 //   (rounded UP, floored at 1, so sides always sting)

// --- Collar attack styles (Familiar Collars) -----------------------------
// A collar swaps the familiar's whole attack: "rune" (default), "moonbeam"
// (a brief straight beam burst), or "alchemist" (lobbed flasks -> DoT puddles).
// Generic upgrades (damage, cooldown, frenzy) carry over to all styles. The two
// SHAPE upgrades reinterpret per style:
//   spread (Spirit Volley) -> rune cone / beam multi-target / +1 flask
//   pierce (Ghost/Phantom)  -> rune pass-through / beam +width / puddle +radius
const MOONBEAM_LENGTH = 210;       // reach (shorter = hits fewer in a line)
const MOONBEAM_WIDTH = 14;         // base beam thickness (px)
const MOONBEAM_PIERCE_WIDTH = 4;   // + width per pierce level ("strikes more")
const MOONBEAM_LIFE = 0.15;        // active burst window (seconds)
const MOONBEAM_SIDE_WIDTH = 0.7;   // spread side-beam width as a fraction of the main

const FLASK_SHOT_SPEED = 420;      // thrown-flask travel speed (px/s)
const FLASK_THROW_SCALE = 0.7;     // flask sprite draw scale
const PUDDLE_RADIUS = 44;          // base puddle radius (px); hitbox == this
const PUDDLE_PIERCE_RADIUS = 3;    // + radius per pierce level ("reaches more")
const PUDDLE_DURATION = 3.0;       // seconds a puddle lasts
const PUDDLE_TICK_INTERVAL = 0.5;  // seconds between DoT ticks
const PUDDLE_TICK_SCALE = 0.5;     // per-tick dmg = ceil(familiar.damage * this), min 1
const PUDDLE_MAX = 3;              // simultaneous puddle cap (oldest drops off)
const PUDDLE_FADE = 0.6;           // seconds over which a dying puddle fades out
const PUDDLE_FLASH = 0.9;          // white-flash duration on each DoT tick. >0.5 (the tick
                                   //   interval) keeps them lit the whole time they're in
                                   //   the acid, so the damage reads clearly.
const PUDDLE_SPLASH_SCALE = 0.6;   // on-LAND burst dmg = ceil(familiar.damage * this), min 1.
                                   //   A guaranteed bite the instant the flask shatters, so
                                   //   enemies that pass through without lingering still take
                                   //   a hit (the DoT alone whiffed on mobile chasers).
const ACID_SLOW_LINGER = 0.2;      // seconds the acid slow clings after an enemy leaves a
                                   //   puddle (re-set every frame it's inside) — a small
                                   //   linger so the slow fades smoothly instead of flickering.
                                   //   The slow STRENGTH (ACID_SLOW_MULT) lives in enemies.js,
                                   //   where the enemy applies it to its own movement.

// Shortest distance from point (px,py) to segment (ax,ay)->(bx,by). Used for the
// Moon Beam's capsule hit test (no projectile, so the pierce upgrade never applies).
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// --- Ghost imprints (visual only) ----------------------------------------
// Spaced afterimages: drop one only after travelling IMPRINT_GAP px, then let
// it fade over IMPRINT_LIFE. Gives "2  2  2  2" spacing, not a packed smear.
const IMPRINT_GAP = 22;         // px the cat must travel before dropping a new imprint
const IMPRINT_LIFE = 0.45;      // seconds an imprint takes to fade out
const IMPRINT_MAX = 6;          // safety cap on simultaneous imprints
const IMPRINT_ALPHA_MAX = 0.40; // opacity of a fresh imprint

// Registers the default cat + collar recolors: skins x 2 anims x 8 dirs.
// Recolor prefixes must match COLLARS[*].spritePrefix in game.js. Missing files
// fall back to the default cat per-frame at draw time — never a crash.
const FAMILIAR_SKINS = ["familiar", "familiar_moonbeam", "familiar_alchemist"];
for (const prefix of FAMILIAR_SKINS) {
  for (const anim of ["idle", "attack"]) {
    for (const d of DIRS) {
      const key = `${prefix}_${anim}_${d}`;
      loadImage(key, `assets/sprites/familiar/${key}.png`);
    }
  }
}

// Alternate familiar ASPECTS (Wardrobe "Familiars" tab) — each a full sprite set,
// same anim structure as the cat (idle 4f, attack 6f). At run start the equipped
// aspect's prefix replaces the cat's; like the cat, an aspect can ALSO carry per-
// collar recolors (`<aspect>_<collarId>`), with the bare aspect prefix used for the
// Spirit/default collar. List every prefix that has art here. Owl ships with all
// three; missing files fall back to the base aspect, then the cat (see drawCat).
const FAMILIAR_ASPECTS = ["familiar_owl", "familiar_owl_moonbeam", "familiar_owl_alchemist"];
for (const prefix of FAMILIAR_ASPECTS) {
  for (const anim of ["idle", "attack"]) {
    for (const d of DIRS) {
      const key = `${prefix}_${anim}_${d}`;
      loadImage(key, `assets/sprites/familiar/${key}.png`);
    }
  }
}

// Collar attack art (code-drawn fallbacks render until these exist).
loadImage("flask_throw", "assets/sprites/projectiles/flask_throw.png");
loadImage("puddle", "assets/sprites/projectiles/puddle.png");

// --- Rune projectile sprite pool (visual only) ---------------------------
// Each bolt picks one rune at spawn and keeps it for its whole lifetime.
// Set RUNE_COUNT to however many rune_0N.png files you actually have. Any that
// are missing/still loading just fall back to the orb draw — never a crash.
const RUNE_COUNT = 14;
const RUNE_SCALE = .5;  // visual size = native sprite size * this (lower if too big)
const RUNE_KEYS = [];
for (let i = 1; i <= RUNE_COUNT; i++) {
  const key = `rune_${String(i).padStart(2, "0")}`;
  RUNE_KEYS.push(key);
  loadImage(key, `assets/sprites/projectiles/${key}.png`);
}

// dirFromVector (8-way facing from a movement/target vector) now lives in
// utils.js so the familiar and the enemies share one copy.

// --- A single magic bolt -------------------------------------------------
class Bolt {
  constructor(x, y, targetX, targetY, speed, pierce = 0, evolved = false, damage = 1) {
    this.x = x;
    this.y = y;
    this.radius = 5;
    this.damage = damage; // per-bolt now (side bolts of a spread deal less)

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

    // Pick one rune from the pool for this bolt's whole lifetime (visual only).
    this.runeKey = RUNE_KEYS.length
      ? RUNE_KEYS[Math.floor(Math.random() * RUNE_KEYS.length)]
      : null;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const img = this.runeKey ? getImage(this.runeKey) : null;

    if (img && img.width > 0) {
      // --- Rune sprite (chosen once at spawn; keeps the magical glow) ---
      const dw = img.width * RUNE_SCALE;
      const dh = img.height * RUNE_SCALE;
      ctx.save();
      ctx.shadowColor = this.evolved ? "#f4d58d" : "#b18cff";
      ctx.shadowBlur = this.evolved ? 14 : 12;
      ctx.drawImage(img, this.x - dw / 2, this.y - dh / 2, dw, dh);
      ctx.restore();
    } else {
      // --- Fallback orb (unchanged) ---
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
}

// --- Moon Beam: a brief straight beam burst ------------------------------
// Not a projectile — a short-lived line that hits each overlapping enemy ONCE
// (tracked), so the pierce upgrade never applies. Pierce instead widens it.
class Beam {
  constructor(x, y, angle, length, width, damage) {
    this.x = x; this.y = y;
    this.ex = x + Math.cos(angle) * length;
    this.ey = y + Math.sin(angle) * length;
    this.width = width;
    this.damage = damage;
    this.life = MOONBEAM_LIFE;
    this.maxLife = MOONBEAM_LIFE;
    this.dead = false;
    this.hitTargets = new Set();
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const a = Math.max(0, this.life / this.maxLife); // 1 -> 0
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha = a;
    ctx.shadowColor = "#b18cff";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "#c9a8ff";
    ctx.lineWidth = this.width;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.ex, this.ey); ctx.stroke();
    // Bright inner core.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = Math.max(2, this.width * 0.35);
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.ex, this.ey); ctx.stroke();
    ctx.restore();
  }
}

// --- Alchemist: a thrown flask that lands and leaves a puddle -------------
class FlaskShot {
  constructor(x, y, tx, ty, tickDamage, splashDamage, puddleRadius) {
    this.x = x; this.y = y;
    this.tx = tx; this.ty = ty;
    this.radius = 6;
    const dx = tx - x, dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    this.vx = (dx / len) * FLASK_SHOT_SPEED;
    this.vy = (dy / len) * FLASK_SHOT_SPEED;
    this.travel = len / FLASK_SHOT_SPEED; // seconds to reach the landing point
    this.spin = 0;
    this.landed = false;
    this.dead = false;
    this.tickDamage = tickDamage;     // carried to the puddle it spawns
    this.splashDamage = splashDamage; // one-time corrosive burst when it shatters
    this.puddleRadius = puddleRadius;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += dt * 12;
    this.travel -= dt;
    if (this.travel <= 0) { this.landed = true; this.dead = true; }
  }

  draw(ctx) {
    const img = getImage("flask_throw");
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    if (img && img.width > 0) {
      const dw = img.width * FLASK_THROW_SCALE;
      const dh = img.height * FLASK_THROW_SCALE;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.shadowColor = "#7bd45a"; ctx.shadowBlur = 8;
      ctx.fillStyle = "#9be86a";
      ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

// --- Alchemist puddle: a ground DoT zone that damages ENEMIES -------------
// Borrows the HazardZone circle look but is familiar-owned and hits the enemy
// list (HazardZone itself stays player-targeted). Never touches the witch.
class Puddle {
  constructor(x, y, radius, tickDamage) {
    this.x = x; this.y = y;
    this.radius = radius;       // gameplay hitbox == visible splash
    this.tickDamage = tickDamage;
    this.life = PUDDLE_DURATION;
    this.tickTimer = PUDDLE_TICK_INTERVAL;
    this.dead = false;
  }

  update(dt, targets) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.tickTimer -= dt;
    const doTick = this.tickTimer <= 0;
    if (doTick) this.tickTimer += PUDDLE_TICK_INTERVAL;
    // Every frame: SLOW regular enemies standing in the acid so they bog down and
    // actually eat the DoT (the tar-pit effect). On a tick frame, also corrode them.
    // The slow is just a short-lived timer the enemy reads in its OWN movement
    // (enemies.js applies ACID_SLOW_MULT). Bosses move via their own classes and
    // carry no `.def`, so they're naturally exempt.
    for (const t of targets) {
      if (t.dead || t.untargetable) continue;
      if (distance(this.x, this.y, t.x, t.y) > this.radius + t.radius) continue;
      if (t.def) t.acidSlowTimer = ACID_SLOW_LINGER;
      if (doTick) {
        t.takeDamage(this.tickDamage);
        // Extend the enemy's existing white hit-flash (set ~0.1 by takeDamage)
        // so the DoT pulses clearly while they stand in the acid.
        t.hitFlash = Math.max(t.hitFlash || 0, PUDDLE_FLASH);
      }
    }
  }

  draw(ctx) {
    const fade = this.life < PUDDLE_FADE ? this.life / PUDDLE_FADE : 1;
    const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 200);
    const img = getImage("puddle");
    ctx.save();
    ctx.globalAlpha = 0.7 * fade;
    if (img && img.width > 0) {
      const d = this.radius * 2;
      ctx.drawImage(img, this.x - this.radius, this.y - this.radius, d, d);
    } else {
      const r = this.radius * pulse;
      ctx.fillStyle = "#7bd45a";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(155, 232, 106, 0.9)";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

export class Familiar {
  constructor(x, y) {
    this.y = y;
    this.radius = 9;

    this.attackRange = 260;
    this.attackCooldown = 1.2;
    this.boltSpeed = 520;
    this.damage = 1;
    this.pierce = 0;        // extra enemies each bolt passes through (Ghost Pounce)
    this.evolved = false;   // Phantom Pounce unlocked
    this.spreadShot = false; // Spirit Volley unlocked (fires a 3-bolt spread)

    this.attackTimer = 0;
    this.bolts = [];
    this.frenzyActive = false;

    // Spirit Imbued behavior, set by game.startGame from the equipped familiar:
    // "default" (Cat: faster firing only) | "astral" (Owl: Astral Judgment strikes).
    this.frenzyBehavior = "default";
    this.astralTimer = 0;     // counts down to the next Astral Judgment strike
    this.astralStrikes = [];  // brief code-drawn star flashes { x, y, ox, oy, life }
    this.astralMark = null;   // the enemy currently being judged (drives the reticle)

    // Collar attack style + skin (set by game.startGame from the equipped collar).
    this.attackStyle = "rune";      // "rune" | "moonbeam" | "alchemist"
    this.spritePrefix = "familiar"; // collar recolor prefix (e.g. familiar_moonbeam)
    this.spritePrefixBase = "familiar"; // aspect base (e.g. familiar_owl) — draw fallback before the cat
    this.beams = [];        // Moon Beam bursts (short-lived)
    this.flaskShots = [];   // Alchemist flasks in flight
    this.puddles = [];      // Alchemist ground DoT zones

    // Animation.
    this.facing = "s";
    this.animState = "idle"; // "idle" | "attack"
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 0.55; // visual only; lower if the cat looks too big vs the witch
    this.trail = [];            // ghost imprints (visual only)
    this.lastImprintX = this.x; // where the last imprint was dropped
    this.lastImprintY = this.y;
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
        if (this.attackStyle === "moonbeam") this.fireMoonBeam(target, targets);
        else if (this.attackStyle === "alchemist") this.fireFlask(target, targets, player);
        else this.fireBolts(target);
        this.attackTimer = this.attackCooldown * (frenzyActive ? FRENZY_COOLDOWN_SCALE : 1);
        this.facing = dirFromVector(target.x - this.x, target.y - this.y); // face the shot
        this.startAttackAnim();
        playFamiliarProjectileSfx(); // fire event only (throttled, autoplay-gated)
      }
    }

    // --- Astral Judgment (Owl): periodic precision strike during Spirit Imbued ---
    // Runs ALONGSIDE the normal attack above (which keeps firing at nearest) and any
    // Spirit Bond link — it never changes the collar attack. Each tick smites the
    // single highest-priority target (boss > caster > ranged > bruiser > nearest) for
    // a flat capped amount, with a code-drawn star. Timer resets whether or not a
    // target was in reach, so strikes stay evenly paced.
    if (frenzyActive && this.frenzyBehavior === "astral") {
      // Recompute the judged target every frame so the reticle (drawn in draw())
      // tracks the current highest-threat enemy; the timed strike smites that mark.
      this.astralMark = this.findPriorityTarget(targets);
      this.astralTimer -= dt;
      if (this.astralTimer <= 0) {
        if (this.astralMark) {
          this.astralMark.takeDamage(ASTRAL_STRIKE_DAMAGE);
          // Record the Owl's position too, so draw() can flash a cast beam from the
          // Owl to where the strike landed.
          this.astralStrikes.push({ x: this.astralMark.x, y: this.astralMark.y, ox: this.x, oy: this.y, life: ASTRAL_STAR_LIFE });
        }
        this.astralTimer = ASTRAL_STRIKE_INTERVAL;
      }
    } else {
      this.astralMark = null; // no reticle outside the Owl's Spirit Imbued
    }
    // Age the star flashes regardless of behavior so a strike landed on the final
    // Spirit Imbued frame still finishes fading out.
    if (this.astralStrikes.length) {
      for (const s of this.astralStrikes) s.life -= dt;
      this.astralStrikes = this.astralStrikes.filter((s) => s.life > 0);
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
        if (target.dead || target.untargetable || bolt.hitTargets.has(target)) continue;
        if (distance(bolt.x, bolt.y, target.x, target.y) < bolt.radius + target.radius) {
          target.takeDamage(bolt.damage);
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

    // --- Moon Beam bursts: hit each overlapping enemy ONCE (capsule test) ---
    for (const beam of this.beams) {
      beam.update(dt);
      if (beam.dead) continue;
      for (const t of targets) {
        if (t.dead || t.untargetable || beam.hitTargets.has(t)) continue;
        if (pointSegDist(t.x, t.y, beam.x, beam.y, beam.ex, beam.ey) <= beam.width / 2 + t.radius) {
          t.takeDamage(beam.damage);
          beam.hitTargets.add(t);
        }
      }
    }
    this.beams = this.beams.filter((b) => !b.dead);

    // --- Alchemist flasks: travel, then break into a puddle on landing ---
    for (const fs of this.flaskShots) {
      fs.update(dt);
      if (fs.landed) {
        // On-land splash: a one-time corrosive burst at the landing point, so even
        // enemies passing through (who won't linger for the DoT) take a guaranteed
        // bite the instant the flask shatters.
        for (const t of targets) {
          if (t.dead || t.untargetable) continue;
          if (distance(fs.tx, fs.ty, t.x, t.y) <= fs.puddleRadius + t.radius) {
            t.takeDamage(fs.splashDamage);
            t.hitFlash = Math.max(t.hitFlash || 0, PUDDLE_FLASH);
          }
        }
        if (this.puddles.length >= PUDDLE_MAX) this.puddles.shift(); // drop the oldest
        this.puddles.push(new Puddle(fs.tx, fs.ty, fs.puddleRadius, fs.tickDamage));
      }
    }
    this.flaskShots = this.flaskShots.filter((f) => !f.dead);

    // --- Alchemist puddles: tick DoT onto enemies standing in them ---
    for (const p of this.puddles) p.update(dt, targets);
    this.puddles = this.puddles.filter((p) => !p.dead);

    this.updateAnimation(dt);

    // --- Ghost imprints (visual only) ---
    // Drop a new imprint only after the cat has travelled IMPRINT_GAP px, so
    // imprints sit spaced apart instead of as a packed smear. Each one then
    // fades over IMPRINT_LIFE, so the trail dissolves when the cat stops.
    const movedFromLast = Math.hypot(this.x - this.lastImprintX, this.y - this.lastImprintY);
    if (movedFromLast >= IMPRINT_GAP) {
      this.trail.push({
        x: this.x, y: this.y,
        facing: this.facing,
        animState: this.animState,
        animFrame: this.animFrame,
        life: IMPRINT_LIFE,
      });
      this.lastImprintX = this.x;
      this.lastImprintY = this.y;
      if (this.trail.length > IMPRINT_MAX) this.trail.shift();
    }
    for (const s of this.trail) s.life -= dt; // age them
    this.trail = this.trail.filter((s) => s.life > 0);
  }

  // Fire at a target. Normally one bolt; with Spirit Volley unlocked, a center
  // bolt at full damage plus two reduced-damage side bolts in a narrow cone.
  fireBolts(target) {
    const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
    this.spawnBolt(baseAngle, this.damage); // center bolt, full damage
    if (this.spreadShot) {
      const sideDmg = Math.max(1, Math.ceil(this.damage * SIDE_DAMAGE_SCALE));
      this.spawnBolt(baseAngle - SPREAD_ANGLE, sideDmg);
      this.spawnBolt(baseAngle + SPREAD_ANGLE, sideDmg);
    }
  }

  // Spawn one bolt aimed along `angle`. Bolt normalizes its own velocity, so the
  // aim point can sit any fixed distance out along the angle.
  spawnBolt(angle, damage) {
    const aimDist = 100;
    const tx = this.x + Math.cos(angle) * aimDist;
    const ty = this.y + Math.sin(angle) * aimDist;
    this.bolts.push(new Bolt(this.x, this.y, tx, ty, this.boltSpeed, this.pierce, this.evolved, damage));
  }

  // --- Moon Beam Collar -----------------------------------------------------
  // A primary beam at the target; with Spirit Volley, two thinner beams at the
  // next-nearest DISTINCT targets (reduced damage). Pierce widens the beam
  // instead of passing through (a beam already hits everything on its line).
  fireMoonBeam(target, targets) {
    const width = MOONBEAM_WIDTH + this.pierce * MOONBEAM_PIERCE_WIDTH;
    this.spawnBeam(target, width, this.damage);
    if (this.spreadShot) {
      const sideDmg = Math.max(1, Math.ceil(this.damage * SIDE_DAMAGE_SCALE));
      for (const t of this.findExtraTargets(targets, target, 2)) {
        this.spawnBeam(t, width * MOONBEAM_SIDE_WIDTH, sideDmg);
      }
    }
  }

  spawnBeam(target, width, damage) {
    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    this.beams.push(new Beam(this.x, this.y, angle, MOONBEAM_LENGTH, width, damage));
  }

  // --- Alchemist Collar -----------------------------------------------------
  // Lob a flask at the target; with Spirit Volley, +1 flask at the next-nearest
  // distinct target (reduced damage). Pierce grows the puddle radius. The throw is
  // LED along the target's path (toward the witch) so the acid lands where the
  // enemy is heading — into the tar pit — instead of behind it.
  fireFlask(target, targets, player) {
    const radius = PUDDLE_RADIUS + this.pierce * PUDDLE_PIERCE_RADIUS;
    const tick = Math.max(1, Math.ceil(this.damage * PUDDLE_TICK_SCALE));
    const splash = Math.max(1, Math.ceil(this.damage * PUDDLE_SPLASH_SCALE));
    const aim = this.leadPoint(target, player);
    this.spawnFlask(aim.x, aim.y, tick, splash, radius);
    if (this.spreadShot) {
      const sideTick = Math.max(1, Math.ceil(this.damage * PUDDLE_TICK_SCALE * SIDE_DAMAGE_SCALE));
      const sideSplash = Math.max(1, Math.ceil(this.damage * PUDDLE_SPLASH_SCALE * SIDE_DAMAGE_SCALE));
      for (const t of this.findExtraTargets(targets, target, 1)) {
        const sideAim = this.leadPoint(t, player);
        this.spawnFlask(sideAim.x, sideAim.y, sideTick, sideSplash, radius);
      }
    }
  }

  // Where to actually throw: enemies chase the witch, so aim ahead along the
  // target's path (toward the player) by ~how far it travels while the flask is
  // airborne, capped so the puddle never overshoots past the witch. A stationary
  // target (speed 0) just gets its current spot. The puddle only damages enemies,
  // so landing it near the witch is fine — that's where the swarm is densest.
  leadPoint(target, player) {
    const flight = distance(this.x, this.y, target.x, target.y) / FLASK_SHOT_SPEED;
    const pdx = player.x - target.x, pdy = player.y - target.y;
    const pd = Math.hypot(pdx, pdy);
    if (pd < 1e-3) return { x: target.x, y: target.y };
    const lead = Math.min((target.speed || 0) * flight, pd);
    return { x: target.x + (pdx / pd) * lead, y: target.y + (pdy / pd) * lead };
  }

  spawnFlask(tx, ty, tickDamage, splashDamage, puddleRadius) {
    this.flaskShots.push(new FlaskShot(this.x, this.y, tx, ty, tickDamage, splashDamage, puddleRadius));
  }

  // Up to `n` nearest in-range targets, excluding the primary, for collar spread.
  findExtraTargets(targets, exclude, n) {
    return targets
      .filter((t) => !t.dead && !t.untargetable && t !== exclude && distance(this.x, this.y, t.x, t.y) <= this.attackRange)
      .sort((a, b) => distance(this.x, this.y, a.x, a.y) - distance(this.x, this.y, b.x, b.y))
      .slice(0, n);
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
      if (target.dead || target.untargetable) continue;
      const d = distance(this.x, this.y, target.x, target.y);
      if (d <= nearestDist) {
        nearestDist = d;
        nearest = target;
      }
    }
    return nearest;
  }

  // Astral Judgment's target picker: the single most dangerous in-reach enemy,
  // ranked by threat tier (boss > caster/zoner > ranged > bruiser > everything
  // else) with nearest as the tiebreak. Reads existing def flags + isBoss only —
  // no enemy/boss changes. Honors attackRange so it strikes what the Owl can reach.
  findPriorityTarget(targets) {
    let best = null, bestScore = -1, bestDist = Infinity;
    for (const t of targets) {
      if (t.dead || t.untargetable) continue;
      const d = distance(this.x, this.y, t.x, t.y);
      if (d > this.attackRange) continue;
      const score = threatScore(t);
      if (score > bestScore || (score === bestScore && d < bestDist)) {
        best = t; bestScore = score; bestDist = d;
      }
    }
    return best;
  }

  // Draw one cat (sprite or fallback) at a position + facing + frame, at a
  // given opacity. Used for BOTH the real cat (alpha 1) and the ghost-trail
  // afterimages (low alpha). Wrapped in save/restore so globalAlpha + shadow
  // never leak out and dim anything else on screen.
  drawCat(ctx, x, y, facing, animState, animFrame, alpha) {
    // Prefer the full prefix (aspect + collar recolor); per frame, fall back to the
    // base aspect (e.g. familiar_owl), then the default cat, then the placeholder —
    // so a missing recolor frame degrades to the base owl, never flashes a cat.
    const prefix = this.spritePrefix || "familiar";
    const base = this.spritePrefixBase || "familiar";
    const img = getImage(`${prefix}_${animState}_${facing}`)
             || (base !== prefix ? getImage(`${base}_${animState}_${facing}`) : null)
             || getImage(`familiar_${animState}_${facing}`);

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
    for (const beam of this.beams) beam.draw(ctx);
    for (const fs of this.flaskShots) fs.draw(ctx);

    // --- Ghost imprints: spaced, fading afterimages behind the cat ---
    for (const s of this.trail) {
      const alpha = (s.life / IMPRINT_LIFE) * IMPRINT_ALPHA_MAX;
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

    // Astral reticle: a slow-spinning gold ring + ticks on the enemy the Owl is
    // judging RIGHT NOW (recomputed each frame in update). This is the legibility
    // win — you can see it favor a caster/boss over nearby wisps. Skips a dead mark.
    if (this.astralMark && !this.astralMark.dead) {
      const m = this.astralMark;
      const R = (m.radius || 12) + 8;
      const rot = performance.now() / 600;
      const pulse = 0.55 + 0.2 * Math.sin(performance.now() / 180);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(rot);
      ctx.shadowColor = "#cdb4ff";
      ctx.shadowBlur = 10;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#f4d58d";
      ctx.lineWidth = 2;
      ctx.globalAlpha = pulse;
      for (let i = 0; i < 4; i++) { // four arcs with gaps = a targeting lock
        const a0 = i * (Math.PI / 2) + 0.28;
        ctx.beginPath();
        ctx.arc(0, 0, R, a0, a0 + (Math.PI / 2) - 0.56);
        ctx.stroke();
      }
      ctx.globalAlpha = pulse * 0.9;
      for (let i = 0; i < 4; i++) { // inward ticks at the gaps
        const a = i * (Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (R + 3), Math.sin(a) * (R + 3));
        ctx.lineTo(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Astral Judgment strikes: a quick cast beam from the Owl to the target, then a
    // gold/violet star at the impact — both fade together. Drawn here (after enemies,
    // before the cat) so they read as the Owl's strike landing. No sprite — no crash.
    for (const s of this.astralStrikes) {
      const t = s.life / ASTRAL_STAR_LIFE; // 1 -> 0 (always > 0 here; culled in update)
      // Cast beam: Owl -> impact (only if we recorded an origin).
      if (s.ox != null) {
        ctx.save();
        ctx.globalAlpha = t * 0.7;
        ctx.shadowColor = "#cdb4ff";
        ctx.shadowBlur = 8;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#cdb4ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.ox, s.oy); ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.restore();
      }
      const R = 18 + (1 - t) * 12; // expands as it fades
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.shadowColor = "#cdb4ff";
      ctx.shadowBlur = 14;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#f4d58d";
      ctx.lineWidth = 2;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.moveTo(0, -R); ctx.lineTo(0, R);
      ctx.moveTo(-R, 0); ctx.lineTo(R, 0);
      ctx.stroke();
      const r2 = R * 0.55;
      ctx.globalAlpha = t * 0.6;
      ctx.beginPath();
      ctx.moveTo(-r2, -r2); ctx.lineTo(r2, r2);
      ctx.moveTo(-r2, r2); ctx.lineTo(r2, -r2);
      ctx.stroke();
      ctx.globalAlpha = t;
      ctx.fillStyle = "#fff6da";
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // The real cat on top, full opacity.
    this.drawCat(ctx, this.x, this.y, this.facing, this.animState, this.animFrame, 1);
  }

  // Drawn separately by game.js on the GROUND layer (above items, below enemies)
  // so puddles never paint over the creatures wading through them.
  drawPuddles(ctx) {
    for (const p of this.puddles) p.draw(ctx);
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
    this.spreadShot = false;
    this.frenzyActive = false;
    this.frenzyBehavior = "default"; // game.startGame overrides from the equipped familiar
    this.astralTimer = 0;
    this.astralStrikes = [];
    this.astralMark = null;
    this.attackStyle = "rune";      // game.startGame overrides from the equipped collar
    this.spritePrefix = "familiar";
    this.spritePrefixBase = "familiar";
    this.beams = [];
    this.flaskShots = [];
    this.puddles = [];
    this.facing = "s";
    this.animState = "idle";
    this.animFrame = 0;
    this.animTimer = 0;
    this.trail = [];
    this.lastImprintX = x;
    this.lastImprintY = y;
  }
}