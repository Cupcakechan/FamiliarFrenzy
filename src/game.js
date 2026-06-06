/* =========================================================================
   game.js — the state machine + owner of all the game objects.

   States (Phase 1–5):
        title    --ENTER-->            playing
        playing  --(XP bar fills)-->   levelUp   (game PAUSES)
        levelUp  --(pick upgrade)-->   playing   (resumes; upgrade applied)
        playing  --(health hits 0)-->  gameOver
        gameOver --R-->                playing   (fresh game)

   Phase 5 adds: the levelUp state. When the XP bar fills, everything freezes
   and an upgrade card appears. Confirming applies the upgrade (e.g. Sharper
   Claws → familiar damage +1) and resumes. Level-ups are QUEUED, so crossing
   two thresholds shows two cards in a row, never a skip.

   dt = seconds since last frame.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { Familiar } from "./familiar.js";
import { Enemy, Spawner } from "./enemies.js";
import { Pickup } from "./pickups.js";
import { getOffers } from "./upgrades.js";
import { circlesOverlap } from "./utils.js";
import { drawTitle, drawHUD, drawUpgradeScreen, drawGameOver } from "./ui.js";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  LEVEL_UP: "levelUp",
  GAME_OVER: "gameOver",
  // VICTORY: "victory",  // Phase 6
};

const SCORE_PER_PICKUP = 10;
const OFFER_COUNT = 1; // how many upgrade cards to show (1 for now; raise later)

export class Game {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bounds = { width, height };

    this.state = STATE.TITLE;

    this.player = new Player(width / 2, height / 2);
    this.familiar = new Familiar(width / 2 - 22, height / 2 - 22);

    this.enemies = [];
    this.spawner = new Spawner(1.5, 8);
    this.pickups = [];

    this.score = 0;
    this.wave = 1; // placeholder; Phase 6

    // XP / leveling.
    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;

    // Level-up queue + the cards currently being offered.
    this.pendingLevelUps = 0;
    this.offers = [];
  }

  startGame() {
    this.score = 0;
    this.wave = 1;
    this.player.reset(this.width / 2, this.height / 2);
    this.familiar.reset(this.width / 2 - 22, this.height / 2 - 22);
    this.enemies = [];
    this.spawner.reset();
    this.pickups = [];

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;
    this.pendingLevelUps = 0;
    this.offers = [];

    this.state = STATE.PLAYING;
  }

  // --- UPDATE ------------------------------------------------------------
  update(dt) {
    switch (this.state) {
      case STATE.TITLE:
        if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter")) {
          this.startGame();
        }
        break;

      case STATE.PLAYING:
        this.updatePlaying(dt);
        break;

      case STATE.LEVEL_UP:
        this.updateLevelUp();
        break;

      case STATE.GAME_OVER:
        if (Input.wasPressed("KeyR")) {
          this.startGame();
        }
        break;
    }
  }

  updatePlaying(dt) {
    this.player.update(dt, Input, this.bounds);

    this.spawner.update(dt, this.enemies, this.bounds);

    // Enemies chase + contact damage.
    for (const enemy of this.enemies) {
      enemy.update(dt, this.player);
      if (circlesOverlap(enemy.x, enemy.y, enemy.radius, this.player.x, this.player.y, this.player.radius)) {
        this.player.takeDamage(enemy.damage);
      }
    }

    // Cat fires; bolts damage enemies.
    this.familiar.update(dt, this.player, this.enemies);

    // Dead enemies drop a mote, then are removed.
    for (const enemy of this.enemies) {
      if (enemy.dead) this.pickups.push(new Pickup(enemy.x, enemy.y));
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    // Collect pickups (XP + score + queue level-ups).
    for (const pickup of this.pickups) {
      pickup.update(dt);
      if (circlesOverlap(pickup.x, pickup.y, pickup.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        pickup.dead = true;
        this.collectPickup(pickup);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.dead);

    // Game over takes priority over a level-up that happened the same frame.
    if (this.player.health <= 0) {
      this.state = STATE.GAME_OVER;
      return;
    }

    // If we leveled up, pause and open the upgrade screen.
    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT);
      this.state = STATE.LEVEL_UP;
    }
  }

  // Paused state: wait for the player to pick an upgrade.
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
    this.offers[index].apply(this);
    this.pendingLevelUps -= 1;

    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT); // queue up the next card
    } else {
      this.offers = [];
      this.state = STATE.PLAYING; // resume right where we froze
    }
  }

  // Grant XP + score; queue a level-up each time the threshold is crossed.
  collectPickup(pickup) {
    this.xp += pickup.value;
    this.score += SCORE_PER_PICKUP;

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

    switch (this.state) {
      case STATE.TITLE:
        drawTitle(ctx, this.width, this.height);
        break;

      case STATE.PLAYING:
        this.drawWorld(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.LEVEL_UP:
        // Draw the frozen world + HUD, then the upgrade overlay on top.
        this.drawWorld(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        drawUpgradeScreen(ctx, this.width, this.height, this.offers);
        break;

      case STATE.GAME_OVER:
        this.drawWorld(ctx);
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
  }

  // Draw the whole arena + entities (shared by playing / levelUp / gameOver).
  drawWorld(ctx) {
    this.drawArena(ctx);
    for (const pickup of this.pickups) pickup.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    this.familiar.draw(ctx);
    this.player.draw(ctx);
  }

  drawArena(ctx) {
    ctx.fillStyle = "#161430";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(155, 108, 255, 0.08)";
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = step; x < this.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = step; y < this.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  hudState() {
    return {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      score: this.score,
      wave: this.wave,
      xp: this.xp,
      xpToNext: this.xpToNext,
      level: this.level,
    };
  }
}
