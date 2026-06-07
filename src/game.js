/* =========================================================================
   game.js — the state machine + owner of all the game objects.

   States (Phase 1–6 = full MVP):
        title    --ENTER-->            playing
        playing  --(XP bar fills)-->   levelUp   (PAUSES)
        levelUp  --(pick upgrade)-->   playing
        playing  --(health hits 0)-->  gameOver
        playing  --(clear wave 10)-->  victory
        gameOver --R-->                playing
        victory  --R-->                playing

   Phase 6 adds: the WaveManager (escalating waves with a between-wave
   intermission banner) and the VICTORY state when all 10 waves are cleared.

   dt = seconds since last frame.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { Familiar } from "./familiar.js";
import { Enemy, WaveManager } from "./enemies.js";
import { Pickup, HealthFlask } from "./pickups.js";
import { getOffers } from "./upgrades.js";
import { circlesOverlap, clamp } from "./utils.js";
import { drawMenu, drawPlaceholder, drawHowToPlay, drawHUD, drawUpgradeScreen, drawWaveBanner, drawBossBar, drawVictory, drawGameOver } from "./ui.js";

const STATE = {
  MAIN_MENU: "mainMenu",
  MODE_SELECT: "modeSelect",
  HOW_TO_PLAY: "howToPlay",
  ENDLESS_PLACEHOLDER: "endlessPlaceholder",
  HIGHSCORES_PLACEHOLDER: "highScoresPlaceholder",
  SETTINGS_PLACEHOLDER: "settingsPlaceholder",
  PLAYING: "playing",
  LEVEL_UP: "levelUp",
  DYING: "dying",      // brief: play the witch's death animation, then Game Over
  GAME_OVER: "gameOver",
  VICTORY: "victory",
};

const MAIN_MENU_ITEMS = ["Play", "How to Play", "High Scores", "Settings"];
const MODE_SELECT_ITEMS = ["Tutorial Run", "Endless Mode", "Back"];

const SCORE_PER_PICKUP = 10;
const OFFER_COUNT = 3; // upgrade cards shown per level-up
const MAX_WAVES = 10;

// Health flask drops (Feature 1) — both easy to tune.
const FLASK_DROP_CHANCE = 0.12; // 12% chance per enemy killed
const FLASK_HEAL = 25;          // HP restored per flask

// Familiar Frenzy meter (Feature 3).
const FRENZY_MOTES = 25;    // motes collected to fill the meter
const FRENZY_DURATION = 6;  // seconds the frenzy lasts

// World size (larger than the 960x540 viewport; the camera follows the player).
const WORLD_W = 2400;
const WORLD_H = 1350;

// How many normal wisps the boss summons each time.
const SUMMON_COUNT = 3;

export class Game {
  constructor(width, height) {
    this.width = width;   // viewport (canvas) size
    this.height = height;
    this.world = { width: WORLD_W, height: WORLD_H };

    this.state = STATE.MAIN_MENU;
    this.menuIndex = 0; // highlighted option in the current menu

    this.player = new Player(WORLD_W / 2, WORLD_H / 2);
    this.familiar = new Familiar(WORLD_W / 2 - 40, WORLD_H / 2 - 40);

    this.enemies = [];
    this.waveManager = new WaveManager(MAX_WAVES);
    this.pickups = [];
    this.flasks = [];

    this.score = 0;

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;

    this.pendingLevelUps = 0;
    this.offers = [];
    this.upgradeLevels = {}; // { upgradeId: currentLevel }

    // Familiar Frenzy meter.
    this.frenzyCharge = 0;  // motes banked toward FRENZY_MOTES
    this.frenzyTimer = 0;   // > 0 while frenzy is active
  }

  startGame() {
    this.score = 0;
    this.player.reset(WORLD_W / 2, WORLD_H / 2);
    this.familiar.reset(WORLD_W / 2 - 40, WORLD_H / 2 - 40);
    this.enemies = [];
    this.waveManager.reset();
    this.pickups = [];
    this.flasks = [];

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;
    this.pendingLevelUps = 0;
    this.offers = [];
    this.upgradeLevels = {};

    this.frenzyCharge = 0;
    this.frenzyTimer = 0;

    this.state = STATE.PLAYING;
  }

  // --- UPDATE ------------------------------------------------------------
  update(dt) {
    switch (this.state) {
      case STATE.MAIN_MENU:
        this.navMenu(MAIN_MENU_ITEMS.length);
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) { this.state = STATE.MODE_SELECT; this.menuIndex = 0; }
          else if (this.menuIndex === 1) this.state = STATE.HOW_TO_PLAY;
          else if (this.menuIndex === 2) this.state = STATE.HIGHSCORES_PLACEHOLDER;
          else if (this.menuIndex === 3) this.state = STATE.SETTINGS_PLACEHOLDER;
        }
        break;

      case STATE.HOW_TO_PLAY:
        if (this.backPressed() || this.confirmPressed()) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        break;

      case STATE.MODE_SELECT:
        this.navMenu(MODE_SELECT_ITEMS.length);
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) this.startGame();                 // Tutorial Run
          else if (this.menuIndex === 1) this.state = STATE.ENDLESS_PLACEHOLDER;
          else if (this.menuIndex === 2) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        } else if (this.backPressed()) {
          this.state = STATE.MAIN_MENU; this.menuIndex = 0;
        }
        break;

      case STATE.ENDLESS_PLACEHOLDER:
        if (this.backPressed() || this.confirmPressed()) { this.state = STATE.MODE_SELECT; this.menuIndex = 0; }
        break;

      case STATE.HIGHSCORES_PLACEHOLDER:
        if (this.backPressed() || this.confirmPressed()) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        break;

      case STATE.SETTINGS_PLACEHOLDER:
        if (this.backPressed() || this.confirmPressed()) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        break;

      case STATE.PLAYING:
        this.updatePlaying(dt);
        break;

      case STATE.LEVEL_UP:
        this.updateLevelUp();
        break;

      case STATE.DYING:
        this.player.updateDying(dt);
        if (this.player.deathDone) this.state = STATE.GAME_OVER;
        break;

      case STATE.GAME_OVER:
      case STATE.VICTORY:
        if (Input.wasPressed("KeyR")) {
          this.startGame();
        } else if (this.backPressed()) {
          this.state = STATE.MAIN_MENU;
          this.menuIndex = 0;
        }
        break;
    }
  }

  // --- Menu helpers ------------------------------------------------------
  navMenu(count) {
    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.menuIndex = (this.menuIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.menuIndex = (this.menuIndex + 1) % count;
    }
  }

  confirmPressed() {
    return Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter") || Input.wasPressed("Space");
  }

  backPressed() {
    return Input.wasPressed("Escape") || Input.wasPressed("Backspace");
  }

  updatePlaying(dt) {
    this.player.update(dt, Input, this.world);

    // Familiar Frenzy: tick the active timer, else allow activation when full.
    if (this.frenzyTimer > 0) {
      this.frenzyTimer -= dt;
    } else if (this.frenzyCharge >= FRENZY_MOTES && Input.wasPressed("Space")) {
      this.frenzyTimer = FRENZY_DURATION;
      this.frenzyCharge = 0;
    }

    // Waves: spawn just outside the current view so enemies always approach
    // from the screen edges, wherever you are in the world.
    const cam = this.getCamera();
    const view = {
      camX: cam.x, camY: cam.y,
      viewW: this.width, viewH: this.height,
      worldW: this.world.width, worldH: this.world.height,
    };
    this.waveManager.update(dt, this.enemies, view);

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player);
      if (circlesOverlap(enemy.x, enemy.y, enemy.radius, this.player.x, this.player.y, this.player.radius)) {
        this.player.takeDamage(enemy.damage);
      }
    }

    this.familiar.update(dt, this.player, this.enemies, this.frenzyTimer > 0);

    // Boss summons: drop a few normal wisps next to the boss when it's ready.
    const boss = this.waveManager.boss;
    if (boss && !boss.dead && boss.summonReady) {
      for (let i = 0; i < SUMMON_COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 36 + Math.random() * 28;
        const ex = clamp(boss.x + Math.cos(a) * r, 0, this.world.width);
        const ey = clamp(boss.y + Math.sin(a) * r, 0, this.world.height);
        this.enemies.push(new Enemy(ex, ey));
      }
      boss.summonReady = false;
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) {
        // Small random scatter so the mote + flask don't land on the same spot,
        // clamped inside the world so drops never land out of reach.
        const j = () => (Math.random() - 0.5) * 24; // ±12px
        const cx = (v) => clamp(v, 0, this.world.width);
        const cy = (v) => clamp(v, 0, this.world.height);
        this.pickups.push(new Pickup(cx(enemy.x + j()), cy(enemy.y + j())));
        if (Math.random() < FLASK_DROP_CHANCE) {
          this.flasks.push(new HealthFlask(cx(enemy.x + j()), cy(enemy.y + j()), FLASK_HEAL));
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    for (const pickup of this.pickups) {
      pickup.update(dt);
      if (circlesOverlap(pickup.x, pickup.y, pickup.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        pickup.dead = true;
        this.collectPickup(pickup);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.dead);

    // Collect health flasks (heal on walk-over).
    for (const flask of this.flasks) {
      flask.update(dt);
      if (circlesOverlap(flask.x, flask.y, flask.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        flask.dead = true;
        this.player.heal(flask.heal);
      }
    }
    this.flasks = this.flasks.filter((f) => !f.dead);

    // Priority: death, then victory, then a level-up.
    if (this.player.health <= 0) {
      this.player.startDying();
      this.state = STATE.DYING;
      return;
    }
    // Victory: the Wave 10 boss has been defeated.
    if (boss && boss.dead) {
      this.state = STATE.VICTORY;
      return;
    }
    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT, this.upgradeLevels);
      this.state = STATE.LEVEL_UP;
    }
  }

  updateLevelUp() {
    let chosen = -1;
    if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter")) chosen = 0;
    else if (Input.wasPressed("Digit1") || Input.wasPressed("Numpad1")) chosen = 0;
    else if (Input.wasPressed("Digit2") || Input.wasPressed("Numpad2")) chosen = 1;
    else if (Input.wasPressed("Digit3") || Input.wasPressed("Numpad3")) chosen = 2;

    if (chosen >= 0 && chosen < this.offers.length) {
      this.applyUpgrade(chosen);
    }
  }

  applyUpgrade(index) {
    const offer = this.offers[index];
    offer.apply(this);

    // Bump the level for real (capped) upgrades. The fallback has no maxLevel.
    if (offer.maxLevel !== undefined) {
      this.upgradeLevels[offer.id] = (this.upgradeLevels[offer.id] || 0) + 1;
    }

    this.pendingLevelUps -= 1;

    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT, this.upgradeLevels);
    } else {
      this.offers = [];
      this.state = STATE.PLAYING;
    }
  }

  collectPickup(pickup) {
    this.xp += pickup.value;
    this.score += SCORE_PER_PICKUP;

    // Charge the frenzy meter (only while not already frenzied / not full).
    if (this.frenzyTimer <= 0 && this.frenzyCharge < FRENZY_MOTES) {
      this.frenzyCharge += 1;
    }

    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext += 3;
      this.pendingLevelUps += 1;
    }
  }

  // --- RENDER ------------------------------------------------------------
  render(ctx) {
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.state === STATE.MAIN_MENU) {
      drawMenu(ctx, this.width, this.height, "FAMILIAR FRENZY", MAIN_MENU_ITEMS, this.menuIndex,
        ["Up / Down: move      Enter: select"]);
      return;
    }
    if (this.state === STATE.MODE_SELECT) {
      drawMenu(ctx, this.width, this.height, "Choose Mode", MODE_SELECT_ITEMS, this.menuIndex,
        ["Tutorial: capped 10-wave run", "Endless: coming soon", "Up/Down move • Enter select • Esc back"]);
      return;
    }
    if (this.state === STATE.HOW_TO_PLAY) {
      drawHowToPlay(ctx, this.width, this.height);
      return;
    }
    if (this.state === STATE.ENDLESS_PLACEHOLDER) {
      drawPlaceholder(ctx, this.width, this.height, "Endless Mode");
      return;
    }
    if (this.state === STATE.HIGHSCORES_PLACEHOLDER) {
      drawPlaceholder(ctx, this.width, this.height, "High Scores");
      return;
    }
    if (this.state === STATE.SETTINGS_PLACEHOLDER) {
      drawPlaceholder(ctx, this.width, this.height, "Settings");
      return;
    }

    // World is drawn THROUGH the camera; HUD/overlays stay in screen space.
    const cam = this.getCamera();
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.drawWorld(ctx);
    ctx.restore();

    switch (this.state) {
      case STATE.PLAYING:
        drawHUD(ctx, this.width, this.height, this.hudState());
        if (this.waveManager.boss && !this.waveManager.boss.dead) {
          drawBossBar(ctx, this.width, this.height, this.waveManager.boss);
        }
        if (this.waveManager.phase === "intermission") {
          drawWaveBanner(ctx, this.width, this.height, this.waveManager.displayWave, this.waveManager.timer);
        }
        break;

      case STATE.LEVEL_UP:
        drawHUD(ctx, this.width, this.height, this.hudState());
        drawUpgradeScreen(ctx, this.width, this.height, this.offers);
        break;

      case STATE.DYING:
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.VICTORY:
        drawVictory(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.GAME_OVER:
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
  }

  // Camera top-left in world coords: centers the player, clamped to the world
  // so the view never shows past the edges.
  getCamera() {
    const camX = clamp(this.player.x - this.width / 2, 0, this.world.width - this.width);
    const camY = clamp(this.player.y - this.height / 2, 0, this.world.height - this.height);
    return { x: camX, y: camY };
  }

  drawWorld(ctx) {
    this.drawArena(ctx);
    for (const pickup of this.pickups) pickup.draw(ctx);
    for (const flask of this.flasks) flask.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    this.familiar.draw(ctx);
    this.player.draw(ctx);
  }

  drawArena(ctx) {
    const W = this.world.width;
    const H = this.world.height;

    ctx.fillStyle = "#161430";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(155, 108, 255, 0.08)";
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = step; x < W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = step; y < H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // World border so the edges of the playfield are visible.
    ctx.strokeStyle = "rgba(244, 213, 141, 0.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, W, H);
  }

  hudState() {
    return {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      score: this.score,
      wave: this.waveManager.displayWave,
      maxWaves: this.waveManager.maxWaves,
      xp: this.xp,
      xpToNext: this.xpToNext,
      level: this.level,
      frenzyCharge: this.frenzyCharge,
      frenzyMax: FRENZY_MOTES,
      frenzyActive: this.frenzyTimer > 0,
      frenzyTimer: this.frenzyTimer,
      frenzyDuration: FRENZY_DURATION,
    };
  }
}
