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
import { drawMenu, drawPlaceholder, drawHowToPlay, drawHUD, drawUpgradeScreen, drawWaveBanner, drawBossBar, drawEvolutionBanner, drawVictory, drawGameOver } from "./ui.js";

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
const VICTORY_ITEMS = ["Continue to Endless Frenzy", "Replay Tutorial", "Main Menu"];

const SCORE_PER_PICKUP = 10;
const OFFER_COUNT = 3; // upgrade cards shown per level-up
const MAX_WAVES = 10;

// Health flask drops (Feature 1) — both easy to tune.
const FLASK_DROP_CHANCE = 0.12; // 12% base chance per enemy killed
const FLASK_HEAL = 25;          // HP restored per flask

// Magnet Charm: pulls nearby pickups toward the witch when in range.
const MAGNET_PULL_SPEED = 280;  // px/s a pickup is drawn toward the player

// Lucky Paws: per-level drop-chance bonuses.
const LUCK_FLASK_STEP = 0.04;   // +4% flask chance per Lucky Paws level
const LUCK_MOTE_STEP = 0.08;    // chance per level for a bonus mote on a kill

// Phantom Pounce evolution bonuses (applied once).
const PHANTOM_PIERCE_BONUS = 2;
const PHANTOM_DAMAGE_BONUS = 2;

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

    // Upgrade-driven values (mutated by apply()); reset each run.
    this.magnetRange = 0;     // Magnet Charm: pickup attraction radius (0 = none)
    this.frenzyPerMote = 1;   // Frenzy Focus: charge added per mote
    this.luckLevel = 0;       // Lucky Paws: drop-chance level

    // Evolution (one-shot).
    this.phantomPounceUnlocked = false;
    this.evoBannerText = "";
    this.evoBannerTimer = 0;  // seconds the unlock banner stays on screen

    // Simple run-summary counters (shown on the Victory screen).
    this.enemiesDefeated = 0;
    this.upgradesChosen = 0;
    this.bossesDefeated = 0;
    this.runTime = 0; // seconds spent in the PLAYING state this run

    this.gameMode = "tutorial"; // "tutorial" | "endless"

    // Familiar Frenzy meter.
    this.frenzyCharge = 0;  // motes banked toward FRENZY_MOTES
    this.frenzyTimer = 0;   // > 0 while frenzy is active
  }

  startGame(mode = "tutorial") {
    this.gameMode = mode;
    this.score = 0;
    this.player.reset(WORLD_W / 2, WORLD_H / 2);
    this.familiar.reset(WORLD_W / 2 - 40, WORLD_H / 2 - 40);
    this.enemies = [];
    this.waveManager.reset(mode === "endless");
    this.pickups = [];
    this.flasks = [];

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;
    this.pendingLevelUps = 0;
    this.offers = [];
    this.upgradeLevels = {};

    this.magnetRange = 0;
    this.frenzyPerMote = 1;
    this.luckLevel = 0;
    this.phantomPounceUnlocked = false;
    this.evoBannerText = "";
    this.evoBannerTimer = 0;

    this.enemiesDefeated = 0;
    this.upgradesChosen = 0;
    this.bossesDefeated = 0;
    this.runTime = 0;

    this.frenzyCharge = 0;
    this.frenzyTimer = 0;

    this.state = STATE.PLAYING;
  }

  // From the Tutorial Complete screen: roll the SAME run into Endless at Wave 11.
  // Health, score, upgrades, familiar stats and counters all carry over.
  continueToEndless() {
    this.gameMode = "endless";
    this.waveManager.endless = true;
    // The wave-10 boss is already defeated; clear its leftover summons and
    // queue the next wave. wave stays 10, so the next wave starts at 11.
    this.waveManager.boss = null;
    this.waveManager.phase = "intermission";
    this.waveManager.timer = this.waveManager.intermissionLength;
    this.enemies = [];
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
          if (this.menuIndex === 0) this.startGame("tutorial");        // Tutorial Run
          else if (this.menuIndex === 1) this.startGame("endless");    // Endless Mode
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
        if (this.player.deathDone) {
          if (this.gameMode === "endless") this.recordEndlessResult();
          this.state = STATE.GAME_OVER;
        }
        break;

      case STATE.VICTORY:
        this.navMenu(VICTORY_ITEMS.length);
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) {
            this.continueToEndless();         // continue this run at Wave 11
          } else if (this.menuIndex === 1) {
            this.startGame("tutorial");       // Replay Tutorial from Wave 1
          } else {
            this.state = STATE.MAIN_MENU;
            this.menuIndex = 0;
          }
        }
        break;

      case STATE.GAME_OVER:
        if (Input.wasPressed("KeyR")) {
          this.startGame(this.gameMode);      // retry in the same mode
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
    this.runTime += dt;
    if (this.evoBannerTimer > 0) this.evoBannerTimer -= dt;
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
        this.enemiesDefeated += 1;
        if (enemy.isBoss) this.bossesDefeated += 1;
        // Small random scatter so the mote + flask don't land on the same spot,
        // clamped inside the world so drops never land out of reach.
        const j = () => (Math.random() - 0.5) * 24; // ±12px
        const cx = (v) => clamp(v, 0, this.world.width);
        const cy = (v) => clamp(v, 0, this.world.height);
        this.pickups.push(new Pickup(cx(enemy.x + j()), cy(enemy.y + j())));

        // Lucky Paws: chance for a bonus mote, and a higher flask chance.
        if (this.luckLevel > 0 && Math.random() < this.luckLevel * LUCK_MOTE_STEP) {
          this.pickups.push(new Pickup(cx(enemy.x + j()), cy(enemy.y + j())));
        }
        const flaskChance = FLASK_DROP_CHANCE + this.luckLevel * LUCK_FLASK_STEP;
        if (Math.random() < flaskChance) {
          this.flasks.push(new HealthFlask(cx(enemy.x + j()), cy(enemy.y + j()), FLASK_HEAL));
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    for (const pickup of this.pickups) {
      pickup.update(dt);
      this.applyMagnet(pickup, dt);
      if (circlesOverlap(pickup.x, pickup.y, pickup.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        pickup.dead = true;
        this.collectPickup(pickup);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.dead);

    // Collect health flasks (heal on walk-over).
    for (const flask of this.flasks) {
      flask.update(dt);
      this.applyMagnet(flask, dt);
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
    // Victory only in Tutorial: defeating the Wave 10 boss ends the run.
    // In Endless, the WaveManager rolls straight into the next wave instead.
    if (this.gameMode === "tutorial" && boss && boss.dead) {
      this.menuIndex = 0;
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
    this.upgradesChosen += 1;

    // Bump the level for real (capped) upgrades. The fallback has no maxLevel.
    if (offer.maxLevel !== undefined) {
      this.upgradeLevels[offer.id] = (this.upgradeLevels[offer.id] || 0) + 1;
    }

    this.checkEvolutions();

    this.pendingLevelUps -= 1;

    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT, this.upgradeLevels);
    } else {
      this.offers = [];
      this.state = STATE.PLAYING;
    }
  }

  // Magnet Charm: ease an item toward the witch when within attraction range.
  applyMagnet(item, dt) {
    if (this.magnetRange <= 0) return;
    const dx = this.player.x - item.x;
    const dy = this.player.y - item.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.001 && d < this.magnetRange) {
      item.x += (dx / d) * MAGNET_PULL_SPEED * dt;
      item.y += (dy / d) * MAGNET_PULL_SPEED * dt;
    }
  }

  // First familiar evolution: Phantom Pounce. Auto-unlocks ONCE when
  // Sharper Spirit Claws is maxed AND Ghost Pounce is at least level 2.
  checkEvolutions() {
    if (this.phantomPounceUnlocked) return;

    const sharper = this.upgradeLevels["sharper_spirit_claws"] || 0;
    const pounce = this.upgradeLevels["ghost_pounce"] || 0;
    const sharperMax = 5; // matches Sharper Spirit Claws maxLevel

    if (sharper >= sharperMax && pounce >= 2) {
      this.phantomPounceUnlocked = true;
      this.familiar.pierce += PHANTOM_PIERCE_BONUS;
      this.familiar.damage += PHANTOM_DAMAGE_BONUS;
      this.familiar.evolved = true;
      this.evoBannerText = "Evolution Unlocked: Phantom Pounce";
      this.evoBannerTimer = 4; // seconds on screen
    }
  }

  collectPickup(pickup) {
    this.xp += pickup.value;
    this.score += SCORE_PER_PICKUP;

    // Charge the frenzy meter (only while not already frenzied / not full).
    // Frenzy Focus raises how much each mote adds (this.frenzyPerMote).
    if (this.frenzyTimer <= 0 && this.frenzyCharge < FRENZY_MOTES) {
      this.frenzyCharge = Math.min(FRENZY_MOTES, this.frenzyCharge + this.frenzyPerMote);
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
        if (this.evoBannerTimer > 0) {
          drawEvolutionBanner(ctx, this.width, this.height, this.evoBannerText, this.evoBannerTimer);
        }
        if (this.waveManager.phase === "intermission") {
          const bossWave = this.waveManager.displayWave >= this.waveManager.maxWaves;
          drawWaveBanner(ctx, this.width, this.height, this.waveManager.displayWave, this.waveManager.timer, bossWave);
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
        drawVictory(ctx, this.width, this.height, this.runSummary(), VICTORY_ITEMS, this.menuIndex);
        break;

      case STATE.GAME_OVER:
        drawGameOver(ctx, this.width, this.height, this.gameOverSummary());
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

  // Persist endless bests (best wave + best score) in the browser. Wrapped in
  // try/catch so a storage-blocked browser simply skips it instead of erroring.
  recordEndlessResult() {
    try {
      const wave = this.waveManager.wave;
      const bw = parseInt(localStorage.getItem("ff_bestEndlessWave") || "0", 10);
      const bs = parseInt(localStorage.getItem("ff_bestEndlessScore") || "0", 10);
      if (wave > bw) localStorage.setItem("ff_bestEndlessWave", String(wave));
      if (this.score > bs) localStorage.setItem("ff_bestEndlessScore", String(this.score));
    } catch (e) {
      /* localStorage unavailable — skip persistent bests */
    }
  }

  // Data for the Game Over screen (mode-aware).
  gameOverSummary() {
    let bestWave = 0;
    let bestScore = 0;
    try {
      bestWave = parseInt(localStorage.getItem("ff_bestEndlessWave") || "0", 10);
      bestScore = parseInt(localStorage.getItem("ff_bestEndlessScore") || "0", 10);
    } catch (e) {
      /* ignore */
    }
    return {
      endless: this.gameMode === "endless",
      wave: this.waveManager.wave,
      score: this.score,
      bossesDefeated: this.bossesDefeated,
      bestWave,
      bestScore,
    };
  }

  // Simple end-of-run summary for the Victory screen (existing data only).
  runSummary() {
    const total = Math.floor(this.runTime);
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return {
      level: this.level,
      wave: this.waveManager.wave,
      maxWaves: this.waveManager.maxWaves,
      score: this.score,
      enemiesDefeated: this.enemiesDefeated,
      upgradesChosen: this.upgradesChosen,
      timeText: `${mm}:${ss}`,
    };
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
