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
import { Pickup, HealthFlask, SpiritMagnet } from "./pickups.js";
import { getOffers, UPGRADES, getGrimoireEntries } from "./upgrades.js";
import { circlesOverlap, clamp } from "./utils.js";
import { loadImage, getImage } from "./assets.js";
import { drawMenu, drawPlaceholder, drawHighScores, drawHowToPlay, drawHUD, drawUpgradeScreen, drawWaveBanner, drawBossBar, drawEvolutionBanner, drawPauseMenu, drawConfirmQuit, drawVictory, drawGameOver, drawNameEntry, drawFamiliarHint, drawSettings, drawGrimoire } from "./ui.js";
import { setMusicContext, setMusicVolume, getMusicVolume } from "./audio.js";

// Arena tileset (4x4 grid of 32px tiles: wall frame + detailed floor).
const TILE = 32;
loadImage("dungeon_tiles", "assets/tiles/Main_Dungeon.png");
loadImage("floor_props", "assets/tiles/floor_props.png");

// Floor prop density (seeded per cell). Rows 0-2 = floor variants, row 3 = rune circles.
// Dial these up/down to taste: ~0.05 very subtle · ~0.10 subtle · ~0.22 busy.
const PROP_VARIANT_CHANCE = 0.09;  // cracks / moss / rune-tinted floor
const PROP_CIRCLE_CHANCE = 0.003;  // rune-circle seals (a few across the map)

const STATE = {
  MAIN_MENU: "mainMenu",
  MODE_SELECT: "modeSelect",
  HOW_TO_PLAY: "howToPlay",
  GRIMOIRE: "grimoire",
  ENDLESS_PLACEHOLDER: "endlessPlaceholder",
  HIGHSCORES_PLACEHOLDER: "highScoresPlaceholder",
  SETTINGS_PLACEHOLDER: "settingsPlaceholder",
  PLAYING: "playing",
  PAUSED: "paused",
  CONFIRM_QUIT: "confirmQuit", // confirm Main Menu from the Pause menu
  LEVEL_UP: "levelUp",
  DYING: "dying",      // brief: play the witch's death animation, then Game Over
  NAME_ENTRY: "nameEntry", // arcade 3-letter initials for a qualifying Endless score
  GAME_OVER: "gameOver",
  VICTORY: "victory",
};

const MAIN_MENU_ITEMS = ["Play", "How to Play", "Grimoire", "High Scores", "Settings"];
const MODE_SELECT_ITEMS = ["Tutorial Run", "Endless Mode", "Back"];
const VICTORY_ITEMS = ["Continue to Endless Frenzy", "Replay Tutorial", "Main Menu"];
const PAUSE_ITEMS = ["Resume", "Grimoire", "Settings", "Main Menu"];
const CONFIRM_ITEMS = ["Yes", "No"];

const SCORE_PER_PICKUP = 10;
const OFFER_COUNT = 3; // upgrade cards shown per level-up
const MAX_WAVES = 10;

// Health flask drops (Feature 1) — both easy to tune.
const FLASK_DROP_CHANCE = 0.015; // base chance per enemy killed

// --- Tutorial script + familiar hints (tutorial mode ONLY; Endless and the
// Tutorial→Endless carryover are never affected) ------------------------------
const TUTORIAL_HINTS_ENABLED = true; // master switch for the cat's dialogue
const TUTORIAL_SCRIPT = {
  holdWavesUntilMove: true, // wave 1 won't start until the player first moves
  graceSeconds: 5,          // shadowed free-walk time after the first move
  motesOnlyWave: 1,         // no flask/magnet rolls during this wave
  guaranteedFlaskWave: 2,   // first kill of this wave always drops a flask
};
const HINT_DURATION = 5;          // seconds a hint stays up
const HINT_FADE = 0.25;           // hint fade in/out seconds
const SHADOW_ALPHA = 0.78;        // darkness of the intro shadow veil
const SHADOW_RADIUS = 230;        // clear "spotlight" radius around the witch
const SHADOW_FADE_SECONDS = 1.2;  // how long the shadow takes to lift

// One line per lesson; each shows at most once per run, one at a time
// (later triggers queue behind the active hint instead of interrupting).
const TUTORIAL_HINTS = {
  move:        "Move with WASD or the arrows! I'll handle the spooky stuff.",
  wisps:       "Careful — touching wisps hurts. Keep your distance!",
  mote_drop:   "Ooh! Grab the glowy motes — they make us stronger.",
  mote_pickup: "See the purple strip up top? Fill it and we level up!",
  level_up:    "Good pick! Every upgrade makes me scarier.",
  flask:       "A flask! Snag it if you're hurt.",
  spirit:      "I'm all charged — press SPACE for Spirit Imbued!",
  boss:        "B-big wisp incoming! Dodge when it lines up a charge!",
};
const FLASK_HEAL = 15;          // HP restored per flask

// Magnet Charm: pulls nearby pickups toward the witch when in range.
const MAGNET_PULL_SPEED = 280;  // px/s a pickup is drawn toward the player

// Lucky Paws: per-level RARE-drop chance bonuses. It now ONLY improves the
// odds of rare drops (flask + magnet) — it no longer spawns bonus XP motes.
const LUCK_FLASK_STEP = 0.04;   // +4% flask chance per Lucky Paws level
const LUCK_MAGNET_STEP = 0.006; // +0.6% Spirit Magnet chance per Lucky Paws level

// Spirit Magnet (rare pickup): vacuums all dropped rewards toward the player.
const SPIRIT_MAGNET_DROP_CHANCE = 0.008; // 0.8% from normal enemies (rare)
const SPIRIT_MAGNET_BOSS_CHANCE = 0.2;   // 20% from bosses (occasional treat)
const VACUUM_DURATION = 1.5;             // seconds the vacuum pull lasts
const VACUUM_PULL_SPEED = 1000;          // px/s items rush toward the player

// Familiar Frenzy meter (Feature 3).
const FRENZY_MOTES = 25;    // motes collected to fill the meter
const FRENZY_DURATION = 6;  // seconds the frenzy lasts

// World size (larger than the 960x540 viewport; the camera follows the player).
const WORLD_W = 2400; // 75 tiles wide
const WORLD_H = 1344; // 42 tiles tall (multiple of 32 so the wall row lands flush)

// --- Frenzy Spirit Link (visual only) ------------------------------------
const LINK_COLOR = "#F2A540";
const LINK_BASE_ALPHA = 0.26;   // base ribbon opacity
const LINK_PULSE_ALPHA = 0.06;  // +/- opacity pulse on top of base
const LINK_AMPLITUDE = 9;       // max perpendicular wave offset (px)
const LINK_WAVES = 2.2;         // number of wave humps along the link
const LINK_SEGMENTS = 24;       // points sampled along the link (smoothness)
const LINK_FADE_IN = 0.30;      // seconds to fade in when frenzy starts
const LINK_FADE_OUT = 0.50;     // seconds to fade out as frenzy ends
const LINK_ATTACK_BOOST = 1.7;  // opacity multiplier while the cat is attacking

// Deterministic 0..1 value for a tile + seed (stable every frame, no flicker).
function tileRand(x, y, seed) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (seed * 83492791);
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Game {
  constructor(width, height) {
    this.width = width;   // viewport (canvas) size
    this.height = height;
    this.world = { width: WORLD_W, height: WORLD_H, inset: TILE };

    this.state = STATE.MAIN_MENU;
    this.menuIndex = 0; // highlighted option in the current menu
    this.settingsReturn = STATE.MAIN_MENU; // where the Settings screen goes "back" to

    // Upgrade Grimoire (read-only glossary) screen state.
    this.grimoireReturn = STATE.MAIN_MENU; // where Back returns to
    this.grimoireEntries = [];             // cached list while the screen is open
    this.grimoireIndex = 0;                // highlighted navigable row
    this.grimoireCategory = null;          // open category: null | "upgrades" | "evolutions"
    this.grimoireExpanded = null;          // open entry id within the category, or null

    this.player = new Player(WORLD_W / 2, WORLD_H / 2);
    this.familiar = new Familiar(WORLD_W / 2 - 40, WORLD_H / 2 - 40);

    this.enemies = [];
    this.waveManager = new WaveManager(MAX_WAVES);
    this.pickups = [];
    this.flasks = [];
    this.magnets = [];      // rare Spirit Magnet pickups
    this.vacuumTimer = 0;   // > 0 while a Spirit Magnet vacuum is active

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

    // Tutorial script + familiar-hint state (reset per run in startGame).
    this.hintsShown = {};
    this.hintQueue = [];
    this.activeHint = null;            // { id, text, timer, sticky }
    this.tutorialHasMoved = false;
    this.tutorialGraceTimer = 0;
    this.tutorialWavesStarted = true;  // only flips false for scripted tutorial runs
    this.tutorialFlaskGiven = false;
    this.shadowAlpha = 0;              // intro shadow veil opacity

    // Arcade initials entry (shown only for a qualifying Endless score).
    this.nameLetters = ["A", "A", "A"];
    this.nameSlot = 0;

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
    this.magnets = [];
    this.vacuumTimer = 0;

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

    // Tutorial script + hints reset. A scripted tutorial begins with waves
    // held, the shadow veil up, and the (sticky) movement hint showing.
    this.hintsShown = {};
    this.hintQueue = [];
    this.activeHint = null;
    this.tutorialHasMoved = false;
    this.tutorialGraceTimer = 0;
    this.tutorialFlaskGiven = false;
    const scripted = this.gameMode === "tutorial" && TUTORIAL_SCRIPT.holdWavesUntilMove;
    this.tutorialWavesStarted = !scripted;
    this.shadowAlpha = scripted ? SHADOW_ALPHA : 0;
    if (scripted) this.showHint("move", { sticky: true });

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
    this.activeHint = null; // tutorial dialogue ends with the tutorial
    this.hintQueue = [];
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
          else if (this.menuIndex === 2) this.openGrimoire(STATE.MAIN_MENU);
          else if (this.menuIndex === 3) this.state = STATE.HIGHSCORES_PLACEHOLDER;
          else if (this.menuIndex === 4) { this.settingsReturn = STATE.MAIN_MENU; this.state = STATE.SETTINGS_PLACEHOLDER; }
        }
        break;

      case STATE.HOW_TO_PLAY:
        if (this.backPressed() || this.confirmPressed()) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        break;

      case STATE.GRIMOIRE:
        this.updateGrimoire();
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
        if (Input.wasPressed("ArrowLeft") || Input.wasPressed("KeyA")) {
          setMusicVolume(getMusicVolume() - 5);
        }
        if (Input.wasPressed("ArrowRight") || Input.wasPressed("KeyD")) {
          setMusicVolume(getMusicVolume() + 5);
        }
        if (this.backPressed()) {
          this.state = this.settingsReturn || STATE.MAIN_MENU;
          if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
        }
        break;

      case STATE.PLAYING:
        if (Input.wasPressed("Escape") || Input.wasPressed("KeyP")) {
          this.state = STATE.PAUSED;
          this.menuIndex = 0;
          break;
        }
        this.updatePlaying(dt);
        break;

      case STATE.PAUSED:
        // Esc / P unpause (but only here, not inside the Settings sub-screen).
        if (Input.wasPressed("Escape") || Input.wasPressed("KeyP")) {
          this.state = STATE.PLAYING;
          break;
        }
        this.navMenu(PAUSE_ITEMS.length);
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) {
            this.state = STATE.PLAYING;                 // Resume
          } else if (this.menuIndex === 1) {
            this.openGrimoire(STATE.PAUSED);            // Upgrade Grimoire (returns to Pause)
          } else if (this.menuIndex === 2) {
            this.settingsReturn = STATE.PAUSED;         // Settings (returns to Pause)
            this.state = STATE.SETTINGS_PLACEHOLDER;
          } else {
            this.state = STATE.CONFIRM_QUIT;            // Main Menu (confirm first)
            this.menuIndex = 1;                         // default highlight = "No"
          }
        }
        break;

      case STATE.CONFIRM_QUIT:
        this.navMenu(CONFIRM_ITEMS.length);
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) {                   // Yes → end run, main menu
            this.state = STATE.MAIN_MENU;
            this.menuIndex = 0;
          } else {                                      // No → back to Pause
            this.state = STATE.PAUSED;
            this.menuIndex = 0;
          }
        } else if (this.backPressed()) {
          this.state = STATE.PAUSED;
          this.menuIndex = 0;
        }
        break;

      case STATE.LEVEL_UP:
        this.updateLevelUp();
        break;

      case STATE.DYING:
        this.player.updateDying(dt);
        if (this.player.deathDone) {
          if (this.gameMode === "endless") {
            // Personal bests always update immediately on death.
            this.updateEndlessBests();
            if (this.qualifiesForTop10()) {
              // Made the top 10 → enter initials before the Game Over screen.
              this.nameLetters = ["A", "A", "A"];
              this.nameSlot = 0;
              this.state = STATE.NAME_ENTRY;
              break;
            }
          }
          this.state = STATE.GAME_OVER;
        }
        break;

      case STATE.NAME_ENTRY: {
        // Classic arcade entry: Up/Down cycles the letter in the active slot,
        // Left/Right moves between the three slots.
        const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const idx = ALPHABET.indexOf(this.nameLetters[this.nameSlot]);
        if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
          this.nameLetters[this.nameSlot] = ALPHABET[(idx + 1) % 26];
        }
        if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
          this.nameLetters[this.nameSlot] = ALPHABET[(idx + 25) % 26];
        }
        if (Input.wasPressed("ArrowLeft") || Input.wasPressed("KeyA")) {
          this.nameSlot = (this.nameSlot + 2) % 3;
        }
        if (Input.wasPressed("ArrowRight") || Input.wasPressed("KeyD")) {
          this.nameSlot = (this.nameSlot + 1) % 3;
        }
        // Enter (not Space — players are often still mashing it when they die)
        // confirms; Esc also confirms with whatever is shown, so the run can
        // never be lost.
        if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter") || Input.wasPressed("Escape")) {
          this.saveHighScore(this.nameLetters.join(""));
          this.state = STATE.GAME_OVER;
        }
        break;
      }

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

    // Keep music in sync with the current context (cheap; no-ops if unchanged).
    this.updateMusic();
  }

  // Pick the right music context for the current state/wave. "boss" only while
  // a boss is alive during play; everything else shares the normal pool (Opt A).
  updateMusic() {
    const grimoireInPlay = this.state === STATE.GRIMOIRE && this.grimoireReturn === STATE.PAUSED;
    const inPlay = this.state === STATE.PLAYING || this.state === STATE.LEVEL_UP
      || this.state === STATE.PAUSED || this.state === STATE.DYING
      || grimoireInPlay;
    const bossActive = this.waveManager.boss && !this.waveManager.boss.dead;
    setMusicContext(inPlay && bossActive ? "boss" : "normal");
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

  // --- Upgrade Grimoire (read-only glossary) -----------------------------
  // Two collapsible categories (Upgrades, Evolutions); opening one closes the
  // other. Inside the open category, one entry's detail expands at a time.
  // `returnState` is where Back goes. Levels show only when opened from Pause.
  openGrimoire(returnState) {
    this.grimoireReturn = returnState;
    this.grimoireEntries = getGrimoireEntries();
    this.grimoireIndex = 0;
    this.grimoireCategory = null;
    this.grimoireExpanded = null;
    this.state = STATE.GRIMOIRE;
  }

  closeGrimoire() {
    this.state = this.grimoireReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
  }

  // Build the flat list of NAVIGABLE rows from the current expansion state.
  // (Entry detail blocks are display-only and are NOT rows.) Shared by the
  // input handler and the renderer so indexing stays in lock-step.
  grimoireRows() {
    const upgrades = this.grimoireEntries.filter((e) => e.kind === "upgrade");
    const evolutions = this.grimoireEntries.filter((e) => e.kind === "evolution");
    const rows = [];

    rows.push({ type: "category", key: "upgrades", label: "Upgrades", open: this.grimoireCategory === "upgrades", count: upgrades.length });
    if (this.grimoireCategory === "upgrades") {
      for (const e of upgrades) rows.push({ type: "entry", entry: e, open: this.grimoireExpanded === e.id });
    }
    rows.push({ type: "category", key: "evolutions", label: "Evolutions", open: this.grimoireCategory === "evolutions", count: evolutions.length });
    if (this.grimoireCategory === "evolutions") {
      for (const e of evolutions) rows.push({ type: "entry", entry: e, open: this.grimoireExpanded === e.id });
    }
    rows.push({ type: "back" });
    return rows;
  }

  updateGrimoire() {
    const rows = this.grimoireRows();
    const count = rows.length;

    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.grimoireIndex = (this.grimoireIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.grimoireIndex = (this.grimoireIndex + 1) % count;
    }
    if (this.grimoireIndex >= count) this.grimoireIndex = count - 1;

    if (this.confirmPressed()) {
      const row = rows[this.grimoireIndex];
      if (row.type === "back") {
        this.closeGrimoire();
      } else if (row.type === "category") {
        // Accordion: toggle this category, close the other + any open entry,
        // then keep the cursor on the category we just acted on.
        this.grimoireCategory = this.grimoireCategory === row.key ? null : row.key;
        this.grimoireExpanded = null;
        const rebuilt = this.grimoireRows();
        this.grimoireIndex = rebuilt.findIndex((r) => r.type === "category" && r.key === row.key);
      } else if (row.type === "entry") {
        // Accordion within the category: one entry detail open at a time.
        const id = row.entry.id;
        this.grimoireExpanded = this.grimoireExpanded === id ? null : id;
      }
    } else if (this.backPressed()) {
      this.closeGrimoire();
    }
  }

  // --- Tutorial hints (the familiar's dialogue) -----------------------------
  // Each id shows at most once per run. One hint at a time; later triggers
  // queue behind the active one. Sticky hints (the movement lesson) ignore the
  // timer and are cleared by their condition via advanceHint().
  showHint(id, opts = {}) {
    if (!TUTORIAL_HINTS_ENABLED || this.gameMode !== "tutorial") return;
    if (this.hintsShown[id]) return;
    this.hintsShown[id] = true;
    const hint = { id, text: TUTORIAL_HINTS[id], timer: HINT_DURATION, sticky: !!opts.sticky };
    if (this.activeHint) this.hintQueue.push(hint);
    else this.activeHint = hint;
  }

  advanceHint() {
    this.activeHint = this.hintQueue.shift() || null;
  }

  updateHints(dt) {
    const h = this.activeHint;
    if (!h) return;
    h.timer -= dt; // sticky hints go negative harmlessly (used for fade-in only)
    if (!h.sticky && h.timer <= 0) this.advanceHint();
  }

  // 0..1 draw opacity for the active hint (fade in; fade out near expiry).
  hintAlpha() {
    const h = this.activeHint;
    if (!h) return 0;
    const fadeIn = Math.min(1, (HINT_DURATION - h.timer) / HINT_FADE);
    if (h.sticky) return fadeIn;
    const fadeOut = Math.max(0, Math.min(1, h.timer / HINT_FADE));
    return Math.min(fadeIn, fadeOut);
  }

  updatePlaying(dt) {
    this.runTime += dt;
    if (this.evoBannerTimer > 0) this.evoBannerTimer -= dt;
    if (this.vacuumTimer > 0) this.vacuumTimer -= dt;
    this.player.update(dt, Input, this.world);

    // Familiar Frenzy: tick the active timer, else allow activation when full.
    if (this.frenzyTimer > 0) {
      this.frenzyTimer -= dt;
    } else if (this.frenzyCharge >= FRENZY_MOTES && Input.wasPressed("Space")) {
      this.frenzyTimer = FRENZY_DURATION;
      this.frenzyCharge = 0;
    }

    // --- Tutorial script: hold the waves until the player first moves, then
    // grant a short shadowed free-walk before the first spawns. ---
    if (!this.tutorialWavesStarted) {
      if (!this.tutorialHasMoved) {
        const mv = Input.getMoveAxis();
        if (mv.x !== 0 || mv.y !== 0) {
          this.tutorialHasMoved = true;
          this.tutorialGraceTimer = TUTORIAL_SCRIPT.graceSeconds;
          if (this.activeHint && this.activeHint.id === "move") this.advanceHint();
        }
      } else {
        this.tutorialGraceTimer -= dt;
        if (this.tutorialGraceTimer <= 0) this.tutorialWavesStarted = true; // shadow lifts, waves begin
      }
    }

    // Intro shadow eases toward its target (dark during the scripted intro,
    // lifting over SHADOW_FADE_SECONDS once the waves begin).
    const shadowTarget = this.tutorialWavesStarted ? 0 : SHADOW_ALPHA;
    const fadeStep = (SHADOW_ALPHA / SHADOW_FADE_SECONDS) * dt;
    if (this.shadowAlpha > shadowTarget) this.shadowAlpha = Math.max(shadowTarget, this.shadowAlpha - fadeStep);
    else if (this.shadowAlpha < shadowTarget) this.shadowAlpha = Math.min(shadowTarget, this.shadowAlpha + fadeStep);

    this.updateHints(dt);

    // Waves: spawn just outside the current view so enemies always approach
    // from the screen edges, wherever you are in the world.
    const cam = this.getCamera();
    const view = {
      camX: cam.x, camY: cam.y,
      viewW: this.width, viewH: this.height,
      worldW: this.world.width, worldH: this.world.height,
    };
    if (this.tutorialWavesStarted) this.waveManager.update(dt, this.enemies, view);
    if (this.enemies.length > 0) this.showHint("wisps");
    if (this.frenzyTimer <= 0 && this.frenzyCharge >= FRENZY_MOTES) this.showHint("spirit");

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player);
      if (circlesOverlap(enemy.x, enemy.y, enemy.radius, this.player.x, this.player.y, this.player.radius)) {
        this.player.takeDamage(enemy.damage);
      }
    }

    this.familiar.update(dt, this.player, this.enemies, this.frenzyTimer > 0);

    // Boss summons: release queued wisps ONE at a time (staggered) near the boss.
    const boss = this.waveManager.boss;
    if (boss && !boss.dead) this.showHint("boss");
    if (boss && !boss.dead && boss.consumeSummon()) {
      const a = Math.random() * Math.PI * 2;
      const r = 36 + Math.random() * 28;
      const ex = clamp(boss.x + Math.cos(a) * r, TILE, this.world.width - TILE);
      const ey = clamp(boss.y + Math.sin(a) * r, TILE, this.world.height - TILE);
      this.enemies.push(new Enemy(ex, ey));
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) {
        this.enemiesDefeated += 1;
        if (enemy.isBoss) {
          this.bossesDefeated += 1;
          this.pendingLevelUps += 1; // boss kill grants a free upgrade choice
        }
        // Drops are placed on non-overlapping spots near the kill (see
        // findDropSpot), so a mote + flask from the same enemy don't stack.
        let spot = this.findDropSpot(enemy.x, enemy.y, 7);
        this.pickups.push(new Pickup(spot.x, spot.y));
        this.showHint("mote_drop");

        // Tutorial staging: wave 1 drops motes ONLY (so the mote lesson lands
        // alone); wave 2's first kill always drops a flask (so the flask
        // lesson lands alone). Endless is untouched (tutWave stays 0).
        const tutWave = this.gameMode === "tutorial" ? this.waveManager.wave : 0;
        const suppressRares = tutWave > 0 && tutWave <= TUTORIAL_SCRIPT.motesOnlyWave;

        if (!suppressRares) {
          if (tutWave === TUTORIAL_SCRIPT.guaranteedFlaskWave && !this.tutorialFlaskGiven) {
            this.tutorialFlaskGiven = true;
            spot = this.findDropSpot(enemy.x, enemy.y, 9);
            this.flasks.push(new HealthFlask(spot.x, spot.y, FLASK_HEAL));
            this.showHint("flask");
          } else {
            // Lucky Paws now boosts only the RARE drops (flask + magnet); there is
            // no longer a bonus-mote roll, so it never doubles up XP.
            const flaskChance = FLASK_DROP_CHANCE + this.luckLevel * LUCK_FLASK_STEP;
            if (Math.random() < flaskChance) {
              spot = this.findDropSpot(enemy.x, enemy.y, 9);
              this.flasks.push(new HealthFlask(spot.x, spot.y, FLASK_HEAL));
              this.showHint("flask");
            }
          }

          // Rare Spirit Magnet — base chance by enemy type, plus a Lucky Paws bonus.
          const baseMagnet = enemy.isBoss ? SPIRIT_MAGNET_BOSS_CHANCE : SPIRIT_MAGNET_DROP_CHANCE;
          const magnetChance = baseMagnet + this.luckLevel * LUCK_MAGNET_STEP;
          if (Math.random() < magnetChance) {
            spot = this.findDropSpot(enemy.x, enemy.y, 10);
            this.magnets.push(new SpiritMagnet(spot.x, spot.y));
          }
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    for (const pickup of this.pickups) {
      pickup.update(dt);
      this.applyMagnet(pickup, dt);
      this.applyVacuum(pickup, dt);
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
      this.applyVacuum(flask, dt);
      if (circlesOverlap(flask.x, flask.y, flask.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        flask.dead = true;
        this.player.heal(flask.heal);
      }
    }
    this.flasks = this.flasks.filter((f) => !f.dead);

    // Collect Spirit Magnets — each triggers a short "vacuum all rewards" burst.
    for (const magnet of this.magnets) {
      magnet.update(dt);
      this.applyMagnet(magnet, dt);
      if (circlesOverlap(magnet.x, magnet.y, magnet.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        magnet.dead = true;
        this.vacuumTimer = VACUUM_DURATION;
      }
    }
    this.magnets = this.magnets.filter((m) => !m.dead);

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

    this.pendingLevelUps -= 1;

    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT, this.upgradeLevels);
    } else {
      this.offers = [];
      this.state = STATE.PLAYING;
      this.showHint("level_up");
    }
  }

  // Find a spawn spot near (baseX, baseY) that doesn't overlap items already
  // on the ground (motes, flasks, magnets), so co-dropped pickups don't stack.
  // Tries the kill point first, then a few points on growing rings; if every
  // nearby spot is crowded it accepts a small random jitter. Always clamped to
  // the world floor so a drop can never land out of reach. Runs only on a kill
  // (not per frame), and `radius` is the new item's radius for the spacing test.
  findDropSpot(baseX, baseY, radius) {
    const cx = (v) => clamp(v, TILE, this.world.width - TILE);
    const cy = (v) => clamp(v, TILE, this.world.height - TILE);
    const clear = (x, y) => {
      const far = (arr) => arr.every((o) => Math.hypot(x - o.x, y - o.y) >= radius + o.radius);
      return far(this.pickups) && far(this.flasks) && far(this.magnets);
    };

    let x = cx(baseX), y = cy(baseY);
    if (clear(x, y)) return { x, y };

    const STEP = 16;
    for (let ring = 1; ring <= 4; ring++) {
      const r = ring * STEP;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2 + ring; // offset each ring so points don't line up
        const tx = cx(baseX + Math.cos(ang) * r);
        const ty = cy(baseY + Math.sin(ang) * r);
        if (clear(tx, ty)) return { x: tx, y: ty };
      }
    }

    // Everything nearby is crowded — fall back to a small random jitter.
    return { x: cx(baseX + (Math.random() - 0.5) * 24), y: cy(baseY + (Math.random() - 0.5) * 24) };
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

  // Spirit Magnet: while the vacuum is active, pull an item hard toward the
  // player from any distance (clamped so it doesn't overshoot). The existing
  // overlap check then collects it normally.
  applyVacuum(item, dt) {
    if (this.vacuumTimer <= 0) return;
    const dx = this.player.x - item.x;
    const dy = this.player.y - item.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.001) {
      const step = Math.min(d, VACUUM_PULL_SPEED * dt);
      item.x += (dx / d) * step;
      item.y += (dy / d) * step;
    }
  }

  // First familiar evolution: Phantom Pounce. It now enters the upgrade pool
  // as a choosable card (see EVOLUTIONS in upgrades.js) once its requirements
  // are met, instead of auto-applying — so the player reads + picks it.
  collectPickup(pickup) {
    this.xp += pickup.value;
    this.score += SCORE_PER_PICKUP;
    this.showHint("mote_pickup");

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
        ["Up / Down: move      Enter: select"], { bg: true, title: true });
      return;
    }
    if (this.state === STATE.MODE_SELECT) {
      drawMenu(ctx, this.width, this.height, "Choose Mode", MODE_SELECT_ITEMS, this.menuIndex,
        ["Up/Down move • Enter select • Esc back"], { bg: true });
      return;
    }
    if (this.state === STATE.HOW_TO_PLAY) {
      drawHowToPlay(ctx, this.width, this.height);
      return;
    }
    if (this.state === STATE.GRIMOIRE) {
      const levels = this.grimoireReturn === STATE.PAUSED ? this.upgradeLevels : null;
      drawGrimoire(ctx, this.width, this.height, this.grimoireRows(), this.grimoireIndex, levels);
      return;
    }
    if (this.state === STATE.ENDLESS_PLACEHOLDER) {
      drawPlaceholder(ctx, this.width, this.height, "Endless Mode");
      return;
    }
    if (this.state === STATE.HIGHSCORES_PLACEHOLDER) {
      drawHighScores(ctx, this.width, this.height, this.getHighScores());
      return;
    }
    if (this.state === STATE.SETTINGS_PLACEHOLDER) {
      drawSettings(ctx, this.width, this.height, getMusicVolume());
      return;
    }
    if (this.state === STATE.CONFIRM_QUIT) {
      drawConfirmQuit(ctx, this.width, this.height, CONFIRM_ITEMS, this.menuIndex);
      return;
    }

    // World is drawn THROUGH the camera; HUD/overlays stay in screen space.
    const cam = this.getCamera();
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.drawWorld(ctx);
    ctx.restore();

    // Tutorial intro shadow: a dark veil with a clear spotlight around the
    // witch (screen space, over the world, under all UI). Beyond the outer
    // radius the gradient clamps to its last stop, covering the whole screen.
    if (this.shadowAlpha > 0.01) {
      const px = this.player.x - cam.x;
      const py = this.player.y - cam.y;
      const g = ctx.createRadialGradient(px, py, SHADOW_RADIUS * 0.45, px, py, SHADOW_RADIUS);
      g.addColorStop(0, "rgba(8, 7, 18, 0)");
      g.addColorStop(1, `rgba(8, 7, 18, ${this.shadowAlpha.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    switch (this.state) {
      case STATE.PLAYING:
        drawHUD(ctx, this.width, this.height, this.hudState());
        if (this.waveManager.boss && !this.waveManager.boss.dead) {
          drawBossBar(ctx, this.width, this.height, this.waveManager.boss);
        }
        if (this.evoBannerTimer > 0) {
          drawEvolutionBanner(ctx, this.width, this.height, this.evoBannerText, this.evoBannerTimer);
        }
        if (this.tutorialWavesStarted && this.waveManager.phase === "intermission") {
          const bossWave = this.waveManager.displayWave % 10 === 0;
          drawWaveBanner(ctx, this.width, this.height, this.waveManager.displayWave, this.waveManager.timer, bossWave);
        }
        if (this.activeHint) {
          drawFamiliarHint(ctx, this.width, this.height, { text: this.activeHint.text, alpha: this.hintAlpha() });
        }
        break;

      case STATE.LEVEL_UP:
        drawHUD(ctx, this.width, this.height, this.hudState());
        drawUpgradeScreen(ctx, this.width, this.height, this.offers);
        break;

      case STATE.PAUSED:
        drawHUD(ctx, this.width, this.height, this.hudState());
        drawPauseMenu(ctx, this.width, this.height, this.pauseInfo(), PAUSE_ITEMS, this.menuIndex);
        break;

      case STATE.DYING:
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.VICTORY:
        drawVictory(ctx, this.width, this.height, this.runSummary(), VICTORY_ITEMS, this.menuIndex);
        break;

      case STATE.NAME_ENTRY:
        drawNameEntry(ctx, this.width, this.height, {
          score: this.score,
          wave: this.waveManager.wave,
          letters: this.nameLetters,
          slot: this.nameSlot,
        });
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
    return { x: Math.round(camX), y: Math.round(camY) };
  }

  drawWorld(ctx) {
    this.drawArena(ctx);
    this.drawSpiritLink(ctx); // Frenzy ribbon: above the floor, below all actors
    for (const pickup of this.pickups) pickup.draw(ctx);
    for (const flask of this.flasks) flask.draw(ctx);
    for (const magnet of this.magnets) magnet.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    this.familiar.draw(ctx);
    this.player.draw(ctx);
  }

  // Frenzy Spirit Link (visual only): a wavy, semi-transparent ribbon between
  // the witch and the familiar while Frenzy is active. Fades in/out cleanly at
  // the edges of the frenzy window and brightens while the cat is attacking.
  drawSpiritLink(ctx) {
    if (this.frenzyTimer <= 0) return;

    const ax = this.player.x, ay = this.player.y;
    const bx = this.familiar.x, by = this.familiar.y;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1) return; // overlapping — nothing meaningful to draw

    // Perpendicular unit vector (for the side-to-side wave).
    const px = -dy / len, py = dx / len;

    // Opacity: base + pulse, gated by a clean fade-in/out at the frenzy edges.
    const fadeIn = clamp((FRENZY_DURATION - this.frenzyTimer) / LINK_FADE_IN, 0, 1);
    const fadeOut = clamp(this.frenzyTimer / LINK_FADE_OUT, 0, 1);
    const edge = Math.min(fadeIn, fadeOut);
    const pulse = LINK_PULSE_ALPHA * Math.sin(performance.now() / 180);
    let alpha = (LINK_BASE_ALPHA + pulse) * edge;
    if (this.familiar.animState === "attack") alpha *= LINK_ATTACK_BOOST;
    if (alpha <= 0.01) return;

    // Build an animated, end-tapered wave path from witch to cat.
    const phase = performance.now() / 130;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= LINK_SEGMENTS; i++) {
      const u = i / LINK_SEGMENTS;
      const taper = Math.sin(u * Math.PI); // 0 at both ends → attaches cleanly
      const off = Math.sin(u * Math.PI * LINK_WAVES + phase) * LINK_AMPLITUDE * taper;
      const x = ax + dx * u + px * off;
      const y = ay + dy * u + py * off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Soft outer glow, then a thin inner line (same path, stroked twice).
    ctx.strokeStyle = LINK_COLOR;
    ctx.shadowColor = LINK_COLOR;
    ctx.globalAlpha = alpha * 0.5;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  drawArena(ctx) {
    const W = this.world.width;
    const H = this.world.height;
    const sheet = getImage("dungeon_tiles");

    if (sheet) {
      this.drawTiledArena(ctx, sheet, W, H);
      return;
    }

    // Fallback (sheet missing / still loading): flat floor + faint grid + border.
    ctx.fillStyle = "#161430";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(155, 108, 255, 0.08)";
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = step; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = step; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    ctx.strokeStyle = "rgba(244, 213, 141, 0.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, W, H);
  }

  // Draw the floor everywhere with a stone wall ring around the world edge.
  // Only the tiles inside the camera viewport are drawn (cheap culling).
  drawTiledArena(ctx, sheet, W, H) {
    const props = getImage("floor_props");
    const cam = this.getCamera();
    const lastX = Math.floor(W / TILE) - 1; // 74
    const lastY = Math.floor(H / TILE) - 1; // 41

    const startX = Math.max(0, Math.floor(cam.x / TILE));
    const endX = Math.min(lastX, Math.floor((cam.x + this.width - 1) / TILE));
    const startY = Math.max(0, Math.floor(cam.y / TILE));
    const endY = Math.min(lastY, Math.floor((cam.y + this.height - 1) / TILE));

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const dx = tx * TILE, dy = ty * TILE;
        const top = ty === 0, bottom = ty === lastY;
        const left = tx === 0, right = tx === lastX;
        const border = top || bottom || left || right;

        if (border) {
          let scol, srow;
          if (top && left)          { scol = 0; srow = 0; }
          else if (top && right)    { scol = 3; srow = 0; }
          else if (bottom && left)  { scol = 0; srow = 3; }
          else if (bottom && right) { scol = 3; srow = 3; }
          else if (top)    { scol = 1; srow = 0; }
          else if (bottom) { scol = 1; srow = 3; }
          else if (left)   { scol = 0; srow = 1; }
          else             { scol = 3; srow = 1; }
          ctx.drawImage(sheet, scol * TILE, srow * TILE, TILE, TILE, dx, dy, TILE, TILE);
          continue;
        }

        // Interior: base floor (2x2 block by parity) first...
        ctx.drawImage(sheet, (1 + (tx % 2)) * TILE, (1 + (ty % 2)) * TILE, TILE, TILE, dx, dy, TILE, TILE);

        // ...then a seeded prop on top (props have soft edges, so the floor shows through).
        if (props) {
          const roll = tileRand(tx, ty, 1);
          if (roll < PROP_CIRCLE_CHANCE) {
            const i = Math.floor(tileRand(tx, ty, 2) * 4); // row 3 = rune circles
            ctx.drawImage(props, i * TILE, 3 * TILE, TILE, TILE, dx, dy, TILE, TILE);
          } else if (roll < PROP_CIRCLE_CHANCE + PROP_VARIANT_CHANCE) {
            const k = Math.floor(tileRand(tx, ty, 3) * 12); // rows 0-2 = 12 floor variants
            ctx.drawImage(props, (k % 4) * TILE, Math.floor(k / 4) * TILE, TILE, TILE, dx, dy, TILE, TILE);
          }
        }
      }
    }
  }

  // Persist endless personal bests (best wave + best score) in the browser.
  // Runs immediately on every Endless death, independent of the initials step.
  // Wrapped in try/catch so a storage-blocked browser simply skips it.
  updateEndlessBests() {
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

  // Would this run land in the top 10? Simulates the insert with the SAME
  // comparator used everywhere (score-desc, tie-break wave-desc). The
  // candidate is pushed last, so at an exact tie on the bubble the existing
  // entry keeps its place (Array.sort is stable).
  qualifiesForTop10() {
    const candidate = { score: this.score, wave: this.waveManager.wave };
    const scores = this.getHighScores();
    scores.push(candidate);
    scores.sort((a, b) => (b.score - a.score) || (b.wave - a.wave));
    return scores.indexOf(candidate) < 10;
  }

  // Write this run into the top-10 Endless leaderboard under `name` (the
  // 3-letter arcade initials). Called once, when initials are confirmed.
  saveHighScore(name) {
    try {
      const entry = {
        name,
        score: this.score,
        wave: this.waveManager.wave,
        date: new Date().toISOString().slice(0, 10),
      };
      const scores = this.getHighScores();
      scores.push(entry);
      scores.sort((a, b) => (b.score - a.score) || (b.wave - a.wave));
      localStorage.setItem("ff_highscores", JSON.stringify(scores.slice(0, 10)));
    } catch (e) {
      /* localStorage unavailable — skip the leaderboard write */
    }
  }

  // Read the Endless leaderboard, failing safely to an empty list if the
  // stored value is missing or corrupt. Sorted best-first for display.
  getHighScores() {
    try {
      const raw = localStorage.getItem("ff_highscores");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e) => e && typeof e.score === "number" && typeof e.wave === "number")
        .sort((a, b) => (b.score - a.score) || (b.wave - a.wave));
    } catch (e) {
      return [];
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

  // Run info shown on the Pause screen.
  pauseInfo() {
    const upgrades = [];
    for (const u of UPGRADES) {
      const lvl = this.upgradeLevels[u.id] || 0;
      if (lvl > 0) upgrades.push({ name: u.name, level: lvl, maxLevel: u.maxLevel });
    }
    const frenzy = this.frenzyTimer > 0
      ? "ACTIVE"
      : `${Math.round((this.frenzyCharge / FRENZY_MOTES) * 100)}%`;
    return {
      mode: this.gameMode === "endless" ? "Endless" : "Tutorial",
      wave: this.waveManager.displayWave,
      level: this.level,
      score: this.score,
      health: Math.ceil(this.player.health),
      maxHealth: this.player.maxHealth,
      frenzy,
      upgrades,
      evolution: this.phantomPounceUnlocked ? "Phantom Pounce" : "None",
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
