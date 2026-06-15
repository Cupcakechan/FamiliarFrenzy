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
import { Enemy, WaveManager, HazardZone } from "./enemies.js";
import { Pickup, HealthFlask, SpiritMagnet } from "./pickups.js";
import { getOffers, UPGRADES, getGrimoireEntries } from "./upgrades.js";
import { circlesOverlap, clamp, randomRange, pointSegmentDistance } from "./utils.js";
import { loadImage, getImage } from "./assets.js";
import { drawMenu, drawPlaceholder, drawHighScores, drawHowToPlay, drawHUD, drawUpgradeScreen, drawWaveBanner, drawBossBar, drawEvolutionBanner, drawPauseMenu, drawConfirmQuit, drawVictory, drawGameOver, drawNameEntry, drawFamiliarHint, drawSettings, drawGrimoire, drawBestiary, drawOffscreenIndicators, drawCloset, drawClosetButton } from "./ui.js";
import { setMusicContext, setMusicVolume, getMusicVolume, playSfx, setSfxVolume, getSfxVolume } from "./audio.js";

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
  BESTIARY: "bestiary",
  CLOSET: "closet", // Wardrobe: buy/equip outfits with Spirit Crystals
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

const MAIN_MENU_ITEMS = ["Play", "Grimoire", "Bestiary", "High Scores", "Settings"];
const MODE_SELECT_ITEMS = ["Tutorial Mode", "Endless Mode", "How to Play", "Back"];
const VICTORY_ITEMS = ["Continue to Endless Frenzy", "Replay Tutorial", "Main Menu"];
const PAUSE_ITEMS = ["Resume", "Grimoire", "Settings", "Main Menu"];
const CONFIRM_ITEMS = ["Yes", "No"];

const SCORE_PER_PICKUP = 10;
const OFFER_COUNT = 3; // upgrade cards shown per level-up
const LEVEL_FLASH_TIME = 0.55; // seconds the celebratory gold bloom fades over
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

// Ambient wisp chitter: SCHEDULED, not rolled — after each chitter the next
// one is booked at a random time in [MIN_GAP, MAX_GAP] seconds, and the timer
// only counts down while something spooky is alive. Guarantees breathing room
// (no per-frame coin-flip clustering). Shared by wisps, geckos, and the boss.
const WISP_NOISE_MIN_GAP = 6;
const WISP_NOISE_MAX_GAP = 14;
const WISP_NOISE_FIRST_DELAY = 3; // seconds after a run starts before the first chitter can land

// One line per lesson; each shows at most once per run, one at a time
// (later triggers queue behind the active hint instead of interrupting).
const TUTORIAL_HINTS = {
  move:        "Move with WASD or the arrow keys! I'll handle the spooky stuff.",
  wisps:       "Careful — touching spooky creatures hurts. Keep your distance!",
  wisp_intro:  "Wisps! They drift right at you — don't let them crowd you.",
  mote_drop:   "Ooh! Grab the glowy motes — they make me stronger.",
  mote_pickup: "See the purple strip up top? Fill it and I'll level up!",
  level_up:    "Good pick! Every upgrade makes me scarier.",
  flask:       "A flask! Snag it if you're hurt.",
  spirit:      "I'm all charged — press SPACE for Spirit Imbued!",
  gecko:       "A Gutter Gecko! Dodge whatever it flings at you!",
  boss:        "Something big is coming! Stay sharp and keep dodging!",
  elder_wisp:  "The Elder Wisp! Watch for when it lines up a charge!",
  watching_hand: "The Watching Hand! Don't stand where it aims to slam!",
  bone_mage:   "A Bone Mage! It curses the ground — step off the rune!",
  goblin_bonker: "A Goblin Bonker! Its club swing knocks you flying — dodge it.",
  spirit_crystal: "A Spirit Crystal! Spend these in the Closet between runs.",
};
const FLASK_HEAL = 15;          // HP restored per flask

// --- Spirit Crystals (meta currency) — Wardrobe/Closet feature, Phase 1 ------
// First boss defeated EVER is a guaranteed crystal (+ the familiar tip). After
// that, only ENDLESS bosses can drop one, on a chance that scales with depth and
// Lucky Paws. Tutorial bosses after the first-ever give nothing (not farmable).
const CRYSTAL_BASE_CHANCE = 0.40;     // endless boss crystal chance at tier 1 (wave 10)
const CRYSTAL_CHANCE_PER_TIER = 0.10; // + per endless tier beyond the first
const CRYSTAL_CHANCE_PER_LUCK = 0.04; // + per Lucky Paws level (game.luckLevel, max 3)
const CRYSTAL_CHANCE_CAP = 0.85;      // hard ceiling on the per-boss chance

// --- Outfits (Closet) -----------------------------------------------------
// Data-driven, like UPGRADES/ENEMY_TYPES. Default is owned + free + no buff.
// Only the EQUIPPED outfit's buff applies; buffs never stack. `buff` keys:
//   flaskBonus  — extra HP added per flask (base FLASK_HEAL preserved)
//   expMult     — EXP-gain multiplier
//   scoreMult   — score-gain multiplier
// `swatch` is the code-drawn colour chip shown in the Closet. `spritePrefix` is
// reserved for the in-game witch colour-swap (a later pass, once the recoloured
// sprites + player.js land); it has no effect yet.
const OUTFITS = {
  default: { name: "Default Robe", cost: 0, swatch: "#9b6cff", spritePrefix: "witch",      desc: "No bonus",          buff: {} },
  red:     { name: "Red Robe",     cost: 3, swatch: "#e0584d", spritePrefix: "witch_red",  desc: "Flasks heal +5 HP", buff: { flaskBonus: 5 } },
  blue:    { name: "Blue Robe",    cost: 3, swatch: "#5aa0e0", spritePrefix: "witch_blue", desc: "EXP gain +5%",      buff: { expMult: 1.05 } },
  gold:    { name: "Gold Robe",    cost: 8, swatch: "#f4d58d", spritePrefix: "witch_gold", desc: "Score gain +5%",    buff: { scoreMult: 1.05 } },
};
const OUTFIT_ORDER = ["default", "red", "blue", "gold"]; // Closet display order

// --- Bestiary -------------------------------------------------------------
// Creature entries for the Bestiary screen. `id` is the seen-tracking key
// (persisted in ff_seenEnemies); `match` decides what marks it encountered:
//   - enemyType: an Enemy with this `type` spawned
//   - bossName:  the active boss has this `name`
// `spriteKey` is the asset used for the portrait (a representative idle frame);
// unseen entries draw a black silhouette + "???" instead.
const BESTIARY = [
  {
    id: "wisp", name: "Wisp", kind: "Enemy", enemyType: "wisp",
    spriteKey: "wisp_float_s", frames: 4,
    blurb: "A restless spirit that drifts straight at you. Deadly in a crowd.",
  },
  {
    id: "gutter_gecko", name: "Gutter Gecko", kind: "Enemy", enemyType: "gutter_gecko",
    spriteKey: "gecko_idle_s", frames: 4,
    blurb: "Keeps its distance and flings balls from its pouch. Keep moving.",
  },
  {
    id: "bone_mage", name: "Bone Mage", kind: "Enemy", enemyType: "bone_mage",
    spriteKey: "bone_mage_idle_s", frames: 6,
    blurb: "Curses the ground from afar, then blinks away. Don't linger.",
  },
  {
    id: "goblin_bonker", name: "Goblin Bonker", kind: "Enemy", enemyType: "goblin_bonker",
    spriteKey: "goblin_walk_s", frames: 6,
    blurb: "Winds up a heavy club swing that knocks witches back.",
  },
  {
    id: "elder_wisp", name: "Elder Wisp", kind: "Boss", bossName: "Elder Wisp",
    spriteKey: "elder_wisp_float_s", frames: 4,
    blurb: "Follows, then dashes. Summons lesser wisps.",
  },
  {
    id: "watching_hand", name: "The Watching Hand", kind: "Boss", bossName: "The Watching Hand",
    spriteKey: "watching_hand_idle", frames: 6,
    blurb: "Hops and slams — mind the red ring. Calls geckos when weak.",
  },
];


// Magnet Charm: pulls nearby pickups toward the witch when in range.
const MAGNET_PULL_SPEED = 280;  // px/s a pickup is drawn toward the player

// Lucky Paws: per-level RARE-drop chance bonuses. It now ONLY improves the
// odds of rare drops (flask + magnet) — it no longer spawns bonus XP motes.
const LUCK_FLASK_STEP = 0.04;   // +4% flask chance per Lucky Paws level
const LUCK_MAGNET_STEP = 0.006; // +0.6% Spirit Magnet chance per Lucky Paws level

// Spirit Magnet (rare pickup): vacuums all dropped rewards toward the player.
const BASE_MAGNET_RANGE = 40; // innate pickup attraction (px); Magnet Charm adds +55/level
const SPIRIT_MAGNET_DROP_CHANCE = 0.008; // 0.8% from normal enemies (rare)
const SPIRIT_MAGNET_BOSS_CHANCE = 0.2;   // 20% from bosses (occasional treat)
const VACUUM_DURATION = 1.5;             // seconds the vacuum pull lasts
const VACUUM_PULL_SPEED = 1000;          // px/s items rush toward the player

// Familiar Frenzy meter (Feature 3).
const FRENZY_MOTES = 30;    // motes collected to fill the meter (was 25; Spirit Focus audit)
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
const LINK_BOND_COLOR = "#F4D58D";   // Spirit Bond: the link turns gold and cuts
const SPIRIT_BOND_TICK = 0.5;        // seconds between Bond damage ticks per enemy
const SPIRIT_BOND_WIDTH = 6;         // ribbon half-width (px) beyond the enemy radius

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
    this.settingsIndex = 0;                // selected Settings row: 0 music, 1 sfx

    // Upgrade Grimoire (read-only glossary) screen state.
    this.grimoireReturn = STATE.MAIN_MENU; // where Back returns to
    this.grimoireEntries = [];             // cached list while the screen is open
    this.grimoireIndex = 0;                // highlighted entry (Back = entries.length)

    this.player = new Player(WORLD_W / 2, WORLD_H / 2);
    this.familiar = new Familiar(WORLD_W / 2 - 40, WORLD_H / 2 - 40);

    this.enemies = [];
    this.enemyBolts = []; // Gutter Gecko projectiles (outlive their shooter)
    this.hazards = [];    // Bone Mage cursed-ground zones (telegraph -> blast)
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
    this.levelFlash = 0; // celebratory bloom timer (counts down from LEVEL_FLASH_TIME)
    this.upgradeLevels = {}; // { upgradeId: currentLevel }

    // Upgrade-driven values (mutated by apply()); reset each run.
    this.magnetRange = BASE_MAGNET_RANGE; // pickup attraction radius (innate + Magnet Charm)
    this.frenzyPerMote = 1;   // Frenzy Focus: charge added per mote
    this.luckLevel = 0;       // Lucky Paws: drop-chance level

    // Evolution (one-shot).
    this.phantomPounceUnlocked = false;
    this.spiritBondUnlocked = false;
    this.spiritVolleyUnlocked = false;
    this.evoBannerText = "";
    this.evoBannerTimer = 0;  // seconds the unlock banner stays on screen
    this.beatBestWave = false;  // set by updateEndlessBests() at run end
    this.beatBestScore = false;

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
    this.wispNoiseTimer = WISP_NOISE_FIRST_DELAY; // next ambient chitter (scheduled)

    // Arcade initials entry (shown only for a qualifying Endless score).
    this.nameLetters = ["A", "A", "A"];
    this.nameSlot = 0;

    // Familiar Frenzy meter.
    this.frenzyCharge = 0;  // motes banked toward FRENZY_MOTES
    this.frenzyTimer = 0;   // > 0 while frenzy is active

    // Spirit Crystals (persistent meta currency for the Closet/Wardrobe).
    // Loaded once at boot; survives runs. `crystalsThisRun` is the per-run
    // tally shown on the Game Over / Victory summary (reset each run).
    this.wardrobe = this.loadWardrobe();
    this.crystalsThisRun = 0;
    this.closetIndex = 0;
    // Fractional carries so the Blue/Gold outfit %-buffs stay accurate on small
    // per-pickup amounts (without these, +5% on a value of 10 rounds badly).
    this._scoreCarry = 0;
    this._xpCarry = 0;
  }

  startGame(mode = "tutorial") {
    this.gameMode = mode;
    this.score = 0;
    this.player.reset(WORLD_W / 2, WORLD_H / 2);
    // Equipped outfit drives the witch's sprite skin for this whole run (the
    // Closet is between-runs, so it's fixed once we start). Recolors fall back
    // to the purple set per-frame in player.draw if a file is missing.
    this.player.spritePrefix = (OUTFITS[this.wardrobe.equipped] || OUTFITS.default).spritePrefix;
    this.familiar.reset(WORLD_W / 2 - 40, WORLD_H / 2 - 40);
    this.enemies = [];
    this.enemyBolts = [];
    this.hazards = [];
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
    this.levelFlash = 0;
    this.upgradeLevels = {};

    this.magnetRange = BASE_MAGNET_RANGE;
    this.frenzyPerMote = 1;
    this.luckLevel = 0;
    this.phantomPounceUnlocked = false;
    this.spiritBondUnlocked = false;
    this.spiritVolleyUnlocked = false;
    this.evoBannerText = "";
    this.evoBannerTimer = 0;
    this.beatBestWave = false;
    this.beatBestScore = false;

    this.enemiesDefeated = 0;
    this.upgradesChosen = 0;
    this.bossesDefeated = 0;
    this.runTime = 0;

    this.frenzyCharge = 0;
    this.frenzyTimer = 0;

    this.crystalsThisRun = 0; // per-run Spirit Crystal tally (persistent total lives in this.wardrobe)
    this._scoreCarry = 0;
    this._xpCarry = 0;

    // Tutorial script + hints reset. A scripted tutorial begins with waves
    // held, the shadow veil up, and the (sticky) movement hint showing.
    this.hintsShown = {};
    this.hintQueue = [];
    this.activeHint = null;
    this.tutorialHasMoved = false;
    this.tutorialGraceTimer = 0;
    this.tutorialFlaskGiven = false;
    this.wispNoiseTimer = WISP_NOISE_FIRST_DELAY;
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
    this.enemyBolts = [];
    this.hazards = [];
    this.activeHint = null; // tutorial dialogue ends with the tutorial
    this.hintQueue = [];
    this.state = STATE.PLAYING;
  }

  // --- UPDATE ------------------------------------------------------------
  update(dt) {
    switch (this.state) {
      case STATE.MAIN_MENU:
        this.navMenu(MAIN_MENU_ITEMS.length);
        if (Input.wasPressed("KeyC")) { this.openCloset(); break; }
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) { this.state = STATE.MODE_SELECT; this.menuIndex = 0; }
          else if (this.menuIndex === 1) this.openGrimoire(STATE.MAIN_MENU);
          else if (this.menuIndex === 2) this.openBestiary();
          else if (this.menuIndex === 3) this.state = STATE.HIGHSCORES_PLACEHOLDER;
          else if (this.menuIndex === 4) { this.settingsReturn = STATE.MAIN_MENU; this.settingsIndex = 0; this.state = STATE.SETTINGS_PLACEHOLDER; }
        }
        break;

      case STATE.HOW_TO_PLAY:
        // Lives under Play now, so it returns to Mode Select (How to Play is
        // index 2 there, so restore that highlight).
        if (this.backPressed() || this.confirmPressed()) { this.state = STATE.MODE_SELECT; this.menuIndex = 2; }
        break;

      case STATE.GRIMOIRE:
        this.updateGrimoire();
        break;

      case STATE.BESTIARY:
        this.updateBestiary();
        break;

      case STATE.CLOSET:
        this.updateCloset();
        break;

      case STATE.MODE_SELECT:
        this.navMenu(MODE_SELECT_ITEMS.length);
        if (this.confirmPressed()) {
          if (this.menuIndex === 0) this.startGame("tutorial");        // Tutorial Mode
          else if (this.menuIndex === 1) this.startGame("endless");    // Endless Mode
          else if (this.menuIndex === 2) { this.state = STATE.HOW_TO_PLAY; } // How to Play (returns to Mode Select)
          else if (this.menuIndex === 3) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
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
        // Two rows: 0 = Music Volume, 1 = SFX Volume. Up/Down selects,
        // Left/Right adjusts. SFX adjustments blip so the level is audible.
        if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
          this.settingsIndex = (this.settingsIndex + 1) % 2;
        }
        if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
          this.settingsIndex = (this.settingsIndex + 1) % 2;
        }
        if (Input.wasPressed("ArrowLeft") || Input.wasPressed("KeyA")) {
          if (this.settingsIndex === 0) setMusicVolume(getMusicVolume() - 5);
          else { setSfxVolume(getSfxVolume() - 5); playSfx("hint"); }
        }
        if (Input.wasPressed("ArrowRight") || Input.wasPressed("KeyD")) {
          if (this.settingsIndex === 0) setMusicVolume(getMusicVolume() + 5);
          else { setSfxVolume(getSfxVolume() + 5); playSfx("hint"); }
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
            this.settingsIndex = 0;
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
        if (this.levelFlash > 0) this.levelFlash = Math.max(0, this.levelFlash - dt);
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
  // a boss is alive during play; otherwise gameplay states use the GAMEPLAY
  // pool and menus use the MENU pool (the two pools are split in audio.js).
  updateMusic() {
    const grimoireInPlay = this.state === STATE.GRIMOIRE && this.grimoireReturn === STATE.PAUSED;
    const inPlay = this.state === STATE.PLAYING || this.state === STATE.LEVEL_UP
      || this.state === STATE.PAUSED || this.state === STATE.DYING
      || grimoireInPlay;
    const bossActive = this.waveManager.boss && !this.waveManager.boss.dead;
    setMusicContext(bossActive && inPlay ? "boss" : inPlay ? "gameplay" : "menu");
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
  // A flat, scrolling list (mirrors the Bestiary): the highlighted entry shows
  // its detail automatically — no expand keypress. Entries are grouped under
  // non-interactive Upgrades / Evolutions headers in the renderer.
  // `returnState` is where Back goes. Levels show only when opened from Pause.
  openGrimoire(returnState) {
    this.grimoireReturn = returnState;
    this.grimoireEntries = getGrimoireEntries();
    this.grimoireIndex = 0;
    this.state = STATE.GRIMOIRE;
  }

  closeGrimoire() {
    this.state = this.grimoireReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
  }

  // --- Bestiary -------------------------------------------------------------
  // Seen creatures persist across runs in ff_seenEnemies (a JSON array of ids).
  // Loaded lazily into this._seenEnemies (a Set) on first use.
  loadSeenEnemies() {
    if (this._seenEnemies) return this._seenEnemies;
    let ids = [];
    try {
      const raw = localStorage.getItem("ff_seenEnemies");
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) ids = p; }
    } catch (e) { /* storage blocked — start empty */ }
    this._seenEnemies = new Set(ids);
    return this._seenEnemies;
  }

  hasSeen(id) {
    return this.loadSeenEnemies().has(id);
  }

  // Mark a creature encountered (idempotent; persists on first sight).
  markSeen(id) {
    const seen = this.loadSeenEnemies();
    if (seen.has(id)) return;
    seen.add(id);
    try { localStorage.setItem("ff_seenEnemies", JSON.stringify([...seen])); } catch (e) { /* ignore */ }
  }

  // Enemy-INTRO hints (the familiar's "new creature!" banner) persist across
  // runs in ff_enemyIntros, so each creature is introduced only the FIRST time
  // ever — not once per run. Loaded lazily into a Set on first use.
  loadEnemyIntros() {
    if (this._enemyIntros) return this._enemyIntros;
    let ids = [];
    try {
      const raw = localStorage.getItem("ff_enemyIntros");
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) ids = p; }
    } catch (e) { /* storage blocked — start empty */ }
    this._enemyIntros = new Set(ids);
    return this._enemyIntros;
  }

  openBestiary() {
    this.loadSeenEnemies();
    this.bestiaryIndex = 0;
    this.state = STATE.BESTIARY;
  }

  updateBestiary() {
    const count = BESTIARY.length + 1; // entries + Back
    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.bestiaryIndex = (this.bestiaryIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.bestiaryIndex = (this.bestiaryIndex + 1) % count;
    }
    if (this.confirmPressed()) {
      if (this.bestiaryIndex === BESTIARY.length) { // Back row
        this.state = STATE.MAIN_MENU; this.menuIndex = 0;
      }
    } else if (this.backPressed()) {
      this.state = STATE.MAIN_MENU; this.menuIndex = 0;
    }
  }

  // Build the flat navigable list for the Grimoire: all upgrades, then all
  // evolutions, with Back as index === entries.length. `upgradeCount` tells the
  // renderer where to drop the "Evolutions" section header. Shared by the input
  // handler and the renderer so indexing stays in lock-step.
  grimoireList() {
    const upgrades = this.grimoireEntries.filter((e) => e.kind === "upgrade");
    const evolutions = this.grimoireEntries.filter((e) => e.kind === "evolution");
    return { entries: [...upgrades, ...evolutions], upgradeCount: upgrades.length };
  }

  updateGrimoire() {
    const { entries } = this.grimoireList();
    const count = entries.length + 1; // entries + Back
    const backIndex = entries.length;

    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.grimoireIndex = (this.grimoireIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.grimoireIndex = (this.grimoireIndex + 1) % count;
    }
    if (this.grimoireIndex >= count) this.grimoireIndex = count - 1;

    if (this.confirmPressed()) {
      if (this.grimoireIndex === backIndex) this.closeGrimoire();
    } else if (this.backPressed()) {
      this.closeGrimoire();
    }
  }

  // --- Tutorial hints (the familiar's dialogue) -----------------------------
  // Each id shows at most once per run. One hint at a time; later triggers
  // queue behind the active one. Sticky hints (the movement lesson) ignore the
  // timer and are cleared by their condition via advanceHint().
  // Enemy/boss INTRO hint — unlike the tutorial-only showHint(), these fire in
  // BOTH modes (once per id per run) so the familiar introduces new creatures
  // even in Endless. Shares the same dialogue bar + queue.
  showEnemyHint(id) {
    if (!TUTORIAL_HINTS_ENABLED) return;
    const intros = this.loadEnemyIntros();
    if (intros.has(id)) return;        // already introduced in a PRIOR run
    if (this.hintsShown[id]) return;   // already shown this run
    this.hintsShown[id] = true;
    intros.add(id);                    // persist — never re-introduce this creature
    try { localStorage.setItem("ff_enemyIntros", JSON.stringify([...intros])); } catch (e) { /* ignore */ }
    const hint = { id, text: TUTORIAL_HINTS[id], timer: HINT_DURATION, sticky: false };
    if (this.activeHint) {
      this.hintQueue.push(hint);
    } else {
      this.activeHint = hint;
      playSfx("hint");
    }
  }

  showHint(id, opts = {}) {
    if (!TUTORIAL_HINTS_ENABLED || this.gameMode !== "tutorial") return;
    if (this.hintsShown[id]) return;
    this.hintsShown[id] = true;
    const hint = { id, text: TUTORIAL_HINTS[id], timer: HINT_DURATION, sticky: !!opts.sticky };
    if (this.activeHint) {
      this.hintQueue.push(hint);
    } else {
      this.activeHint = hint;
      playSfx("hint"); // one blip per sentence, when it actually appears
    }
  }

  advanceHint() {
    this.activeHint = this.hintQueue.shift() || null;
    if (this.activeHint) playSfx("hint"); // queued hint rotating in
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
    // Encounter tracking + intro hints (both modes). Wisp + gecko via presence.
    if (this.enemies.length > 0) {
      this.showHint("wisps"); // tutorial-only "touching hurts" lesson
      if (this.enemies.some((e) => e.type === "wisp")) {
        this.markSeen("wisp");
        // The Tutorial already teaches wisps via the "wisps" lesson above, so
        // the standalone intro is Endless-only (avoids two wisp lines at once).
        if (this.gameMode !== "tutorial") this.showEnemyHint("wisp_intro");
      }
      if (this.enemies.some((e) => e.type === "gutter_gecko")) {
        this.markSeen("gutter_gecko");
        this.showEnemyHint("gecko"); // both modes, once per run
      }
      if (this.enemies.some((e) => e.type === "bone_mage")) {
        this.markSeen("bone_mage");
        this.showEnemyHint("bone_mage"); // both modes, once per run
      }
      if (this.enemies.some((e) => e.type === "goblin_bonker")) {
        this.markSeen("goblin_bonker");
        this.showEnemyHint("goblin_bonker"); // both modes, once per run
      }
    }
    if (this.frenzyTimer <= 0 && this.frenzyCharge >= FRENZY_MOTES) this.showHint("spirit");

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player, this.enemyBolts, this.hazards);
      // Goblin Bonker deals NO body-contact damage while committing its attack
      // (leap/windup/recover) — its radial stomp is the attack's only damage, so
      // the lunge can't also tag you. Normal contact resumes while chasing; other
      // enemies are unaffected (only the bruiser sets attackState).
      if (enemy.def.bruiser && enemy.attackState !== "chase") continue;
      // Contact damage uses the enemy's contactRadius when it defines one (the
      // Elder Wisp tightens it mid-dash); everything else falls back to radius.
      const cr = enemy.contactRadius != null ? enemy.contactRadius : enemy.radius;
      if (circlesOverlap(enemy.x, enemy.y, cr, this.player.x, this.player.y, this.player.radius)) {
        this.player.takeDamage(enemy.damage);
      }
    }

    this.familiar.update(dt, this.player, this.enemies, this.frenzyTimer > 0);

    // Spirit Bond (evolution): while Spirit Imbued is active, the witch<->
    // familiar link cuts enemies that cross it. Tick damage scales with the
    // familiar's damage; a per-enemy cooldown stops anything from melting.
    if (this.spiritBondUnlocked && this.frenzyTimer > 0) {
      const tickDmg = Math.max(1, Math.round(this.familiar.damage * 0.5));
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (enemy.bondTickTimer > 0) { enemy.bondTickTimer -= dt; continue; }
        const d = pointSegmentDistance(enemy.x, enemy.y, this.player.x, this.player.y, this.familiar.x, this.familiar.y);
        if (d <= enemy.radius + SPIRIT_BOND_WIDTH) {
          enemy.takeDamage(tickDmg);
          enemy.bondTickTimer = SPIRIT_BOND_TICK;
        }
      }
    }

    // Gutter Gecko balls: move, hit the witch (her i-frames apply normally),
    // and cull on expiry or when they leave the world.
    for (const bolt of this.enemyBolts) {
      bolt.update(dt);
      if (bolt.dead) continue;
      if (circlesOverlap(bolt.x, bolt.y, bolt.radius, this.player.x, this.player.y, this.player.radius)) {
        this.player.takeDamage(bolt.damage);
        bolt.dead = true; // the ball is spent on contact either way
      } else if (bolt.x < 0 || bolt.y < 0 || bolt.x > this.world.width || bolt.y > this.world.height) {
        bolt.dead = true;
      }
    }
    this.enemyBolts = this.enemyBolts.filter((b) => !b.dead);

    // Bone Mage cursed ground: each zone telegraphs then blasts (damage handled
    // inside HazardZone against the witch's i-frames), then fades and is culled.
    for (const hz of this.hazards) hz.update(dt, this.player);
    this.hazards = this.hazards.filter((h) => !h.dead);

    // Boss summons: release queued wisps ONE at a time (staggered) near the boss.
    const boss = this.waveManager.boss;
    if (boss && !boss.dead) {
      // Encounter tracking + boss-specific intro hint (both modes).
      if (boss.name === "Elder Wisp") { this.markSeen("elder_wisp"); this.showEnemyHint("elder_wisp"); }
      else if (boss.name === "The Watching Hand") { this.markSeen("watching_hand"); this.showEnemyHint("watching_hand"); }
      else this.showHint("boss");
    }

    // Ambient creature chitter: the timer ticks while anything spooky is alive;
    // on expiry, pick a random voice from whatever's CURRENTLY alive (each enemy
    // type carries its own ambientSfx) and book the next chitter 6-14s out.
    if (this.enemies.length > 0 || (boss && !boss.dead)) {
      this.wispNoiseTimer -= dt;
      if (this.wispNoiseTimer <= 0) {
        const voices = [];
        for (const e of this.enemies) {
          if (!e.dead && e.ambientSfx && !voices.includes(e.ambientSfx)) voices.push(e.ambientSfx);
        }
        if (voices.length > 0) playSfx(voices[Math.floor(Math.random() * voices.length)]);
        this.wispNoiseTimer = randomRange(WISP_NOISE_MIN_GAP, WISP_NOISE_MAX_GAP);
      }
    }
    if (boss && !boss.dead && boss.consumeSummon()) {
      const a = Math.random() * Math.PI * 2;
      const r = 36 + Math.random() * 28;
      const WISP_R = 13; // matches Enemy.radius
      const ex = clamp(boss.x + Math.cos(a) * r, TILE + WISP_R, this.world.width - TILE - WISP_R);
      const ey = clamp(boss.y + Math.sin(a) * r, TILE + WISP_R, this.world.height - TILE - WISP_R);
      this.enemies.push(new Enemy(ex, ey));
      if (boss.name === "Elder Wisp") playSfx("elder_wisp_summon"); // missing = silent
    }

    // Watching Hand slam: at the impact instant, anyone inside the LOCKED ring
    // takes slam damage (through normal i-frames, so it can't double-dip).
    if (boss && !boss.dead && boss.consumeSlamHit) {
      if (boss.consumeSlamHit()) {
        if (circlesOverlap(boss.slamX, boss.slamY, boss.slamRadius, this.player.x, this.player.y, this.player.radius)) {
          this.player.takeDamage(boss.slamDamage);
        }
        playSfx("hand_slam"); // plays on the slam impact frame
      }
    }

    // Watching Hand summon: spawn a Gutter Gecko burst around the Hand, capped
    // so the total alive (from waves + summons) never exceeds the boss cap.
    if (boss && !boss.dead && boss.consumeSummonBurst) {
      const want = boss.consumeSummonBurst();
      if (want > 0) {
        let geckosAlive = 0;
        for (const e of this.enemies) if (!e.dead && e.type === "gutter_gecko") geckosAlive += 1;
        const room = Math.max(0, boss.summonGeckoCap - geckosAlive);
        const spawn = Math.min(want, room);
        for (let i = 0; i < spawn; i++) {
          // Spawn on a ring clear of the hand's body (boss.radius) plus a gap,
          // so geckos crawl out AROUND the hand rather than on top of it.
          const a = Math.random() * Math.PI * 2;
          const r = boss.radius + 70 + Math.random() * 50; // ~102-152px out
          const GECKO_R = 13; // matches Enemy.radius
          const ex = clamp(boss.x + Math.cos(a) * r, TILE + GECKO_R, this.world.width - TILE - GECKO_R);
          const ey = clamp(boss.y + Math.sin(a) * r, TILE + GECKO_R, this.world.height - TILE - GECKO_R);
          const g = new Enemy(ex, ey, "gutter_gecko");
          this.enemies.push(g);
        }
        playSfx("gecko_chitter"); // the summoned geckos materializing (missing = silent)
      }
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) {
        this.enemiesDefeated += 1;
        // Bone Mage parting shot: one last cursed rune where it fell, punishing
        // greedy point-blank kills. Reuses the mage's own blast tuning.
        if (enemy.type === "bone_mage" && enemy.def.caster) {
          const c = enemy.def.caster;
          this.hazards.push(new HazardZone(enemy.x, enemy.y, c.blastRadius, c.telegraph, c.blastDamage));
        }
        if (enemy.isBoss) {
          this.bossesDefeated += 1;
          this.pendingLevelUps += 1; // boss kill grants a free upgrade choice
          this.awardBossCrystal();   // + a Spirit Crystal (guaranteed first-ever, else endless chance)
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
            // Teaching flask: drop it NEAR the witch (not at an offscreen kill)
            // so the lesson always points at a flask that's actually on-screen.
            // Far enough out to clear the magnet pull, so it isn't auto-grabbed.
            const fa = Math.random() * Math.PI * 2;
            const fd = Math.min(200, Math.max(120, this.magnetRange + 30));
            spot = this.findDropSpot(this.player.x + Math.cos(fa) * fd, this.player.y + Math.sin(fa) * fd, 9);
            this.flasks.push(new HealthFlask(spot.x, spot.y, FLASK_HEAL));
            this.showHint("flask"); // always — it's the lesson, and now on-screen
          } else {
            // Lucky Paws now boosts only the RARE drops (flask + magnet); there is
            // no longer a bonus-mote roll, so it never doubles up XP.
            const flaskChance = FLASK_DROP_CHANCE + this.luckLevel * LUCK_FLASK_STEP;
            if (Math.random() < flaskChance) {
              spot = this.findDropSpot(enemy.x, enemy.y, 9);
              this.flasks.push(new HealthFlask(spot.x, spot.y, FLASK_HEAL));
              if (this.isOnScreen(spot.x, spot.y)) this.showHint("flask"); // don't announce an offscreen flask
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
        this.player.heal(flask.heal + (this.equippedBuff().flaskBonus || 0));
        playSfx("heal");
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
        playSfx("magnet");
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
      this.levelFlash = LEVEL_FLASH_TIME; // celebratory gold bloom + title pop
      playSfx("level_up");
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
      this.levelFlash = LEVEL_FLASH_TIME; // each stacked level pops again
      playSfx("level_up");
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
    this.addXp(pickup.value);       // Blue Robe: +EXP%
    this.addScore(SCORE_PER_PICKUP); // Gold Robe: +score%
    this.showHint("mote_pickup");

    // Charge the frenzy meter (only while not already frenzied / not full).
    // Frenzy Focus raises how much each mote adds (this.frenzyPerMote).
    if (this.frenzyTimer <= 0 && this.frenzyCharge < FRENZY_MOTES) {
      this.frenzyCharge = Math.min(FRENZY_MOTES, this.frenzyCharge + this.frenzyPerMote);
    }

    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext += 4; // was +3; slows deep-Endless level-up spam a touch
      this.pendingLevelUps += 1;
    }
  }

  // --- RENDER ------------------------------------------------------------
  render(ctx) {
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.state === STATE.MAIN_MENU) {
      drawMenu(ctx, this.width, this.height, "FAMILIAR FRENZY", MAIN_MENU_ITEMS, this.menuIndex,
        ["Up / Down: move      Enter: select"], { bg: true, title: true });
      drawClosetButton(ctx, this.width, this.height, this.wardrobe.crystals);
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
    if (this.state === STATE.BESTIARY) {
      const entries = BESTIARY.map((b) => ({
        name: b.name, kind: b.kind, blurb: b.blurb, frames: b.frames,
        seen: this.hasSeen(b.id),
        img: getImage(b.spriteKey),
      }));
      drawBestiary(ctx, this.width, this.height, entries, this.bestiaryIndex);
      return;
    }

    if (this.state === STATE.CLOSET) {
      drawCloset(ctx, this.width, this.height, this.closetData());
      return;
    }

    if (this.state === STATE.GRIMOIRE) {
      const levels = this.grimoireReturn === STATE.PAUSED ? this.upgradeLevels : null;
      const { entries, upgradeCount } = this.grimoireList();
      drawGrimoire(ctx, this.width, this.height, entries, this.grimoireIndex, levels, upgradeCount);
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
      drawSettings(ctx, this.width, this.height, getMusicVolume(), getSfxVolume(), this.settingsIndex);
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
        drawOffscreenIndicators(ctx, this.width, this.height, this.enemies, cam);
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
        drawUpgradeScreen(ctx, this.width, this.height, this.offers, this.levelFlash / LEVEL_FLASH_TIME);
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

  // Is a world point currently within the visible viewport (+ optional margin)?
  isOnScreen(x, y, margin = 0) {
    const cam = this.getCamera();
    return x >= cam.x - margin && x <= cam.x + this.width + margin
        && y >= cam.y - margin && y <= cam.y + this.height + margin;
  }

  // The Watching Hand's locked slam ring: a red→white danger circle that fades
  // in over the windup and pulses while the hand is airborne. Drawn only when
  // the active boss is mid-slam (slamMarkerAlpha > 0).
  drawSlamMarker(ctx) {
    const boss = this.waveManager.boss;
    if (!boss || boss.dead || typeof boss.slamMarkerAlpha !== "function") return;
    const a = boss.slamMarkerAlpha();
    if (a <= 0) return;

    const r = boss.slamRadius;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
    ctx.save();
    ctx.globalAlpha = a;

    // Filled danger tint.
    ctx.fillStyle = `rgba(226, 83, 107, ${0.18 + pulse * 0.12})`;
    ctx.beginPath();
    ctx.arc(boss.slamX, boss.slamY, r, 0, Math.PI * 2);
    ctx.fill();

    // Ring edge (brightens to white as impact nears via the alpha ramp).
    ctx.strokeStyle = "#ff5a6e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(boss.slamX, boss.slamY, r, 0, Math.PI * 2);
    ctx.stroke();

    // Inner crosshair so the locked center is unmistakable.
    ctx.strokeStyle = `rgba(255, 246, 221, ${0.6 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(boss.slamX - r * 0.4, boss.slamY);
    ctx.lineTo(boss.slamX + r * 0.4, boss.slamY);
    ctx.moveTo(boss.slamX, boss.slamY - r * 0.4);
    ctx.lineTo(boss.slamX, boss.slamY + r * 0.4);
    ctx.stroke();

    ctx.restore();
  }

  // The Watching Hand's summon telegraph: a swelling dark-purple glow on the
  // floor beneath the Hand while it calls forth a gecko burst.
  drawSummonGlow(ctx) {
    const boss = this.waveManager.boss;
    if (!boss || boss.dead || typeof boss.summonGlow !== "function") return;
    const g = boss.summonGlow();
    if (g <= 0) return;

    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 70);
    const radius = boss.radius * (1.4 + g * 1.6);
    ctx.save();
    const grad = ctx.createRadialGradient(boss.x, boss.y, 0, boss.x, boss.y, radius);
    grad.addColorStop(0, `rgba(155, 108, 255, ${0.10 + g * 0.30 * pulse})`);
    grad.addColorStop(0.6, `rgba(120, 70, 200, ${0.08 + g * 0.18})`);
    grad.addColorStop(1, "rgba(120, 70, 200, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawWorld(ctx) {
    this.drawArena(ctx);
    this.drawSpiritLink(ctx); // Frenzy ribbon: above the floor, below all actors
    this.drawSlamMarker(ctx); // Watching Hand telegraph: on the floor, under actors
    this.drawSummonGlow(ctx);  // Watching Hand summon telegraph
    for (const hz of this.hazards) hz.draw(ctx); // Bone Mage cursed ground (under actors)
    for (const pickup of this.pickups) pickup.draw(ctx);
    for (const flask of this.flasks) flask.draw(ctx);
    for (const magnet of this.magnets) magnet.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    for (const bolt of this.enemyBolts) bolt.draw(ctx);
    this.familiar.draw(ctx);
    this.player.draw(ctx);

    // Spirit Imbued "ready" spark: a pulsing gold diamond above the witch
    // whenever the meter is full (the on-character cue for players who never
    // look at the HUD corner).
    if (this.frenzyTimer <= 0 && this.frenzyCharge >= FRENZY_MOTES) {
      const t = performance.now() / 1000;
      const pulse = 0.55 + 0.45 * Math.sin(t * 6);
      const bob = Math.sin(t * 3) * 2;
      const sx = this.player.x;
      const sy = this.player.y - this.player.radius - 26 + bob;
      const s = 5 + pulse * 2.5; // spark half-size
      ctx.save();
      ctx.globalAlpha = 0.55 + pulse * 0.45;
      ctx.shadowColor = "#f4d58d";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#f4d58d";
      ctx.beginPath(); // four-point diamond
      ctx.moveTo(sx, sy - s);
      ctx.lineTo(sx + s * 0.55, sy);
      ctx.lineTo(sx, sy + s);
      ctx.lineTo(sx - s * 0.55, sy);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff6dd";
      ctx.beginPath();
      ctx.arc(sx, sy, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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
    const bondActive = this.spiritBondUnlocked; // gold blade while evolved
    ctx.strokeStyle = bondActive ? LINK_BOND_COLOR : LINK_COLOR;
    ctx.shadowColor = bondActive ? LINK_BOND_COLOR : LINK_COLOR;
    ctx.globalAlpha = alpha * 0.5;
    ctx.shadowBlur = 10;
    ctx.lineWidth = bondActive ? 7 : 5;
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
      // Capture whether THIS run beat a prior best BEFORE overwriting — the
      // Game Over screen reads these flags. A first-ever run (no stored best,
      // i.e. 0) only counts as a "best" if the value is actually > 0, so an
      // immediate wave-1 / score-0 death doesn't trigger a celebration.
      this.beatBestWave = wave > bw && wave > 0;
      this.beatBestScore = this.score > bs && this.score > 0;
      if (wave > bw) localStorage.setItem("ff_bestEndlessWave", String(wave));
      if (this.score > bs) localStorage.setItem("ff_bestEndlessScore", String(this.score));
    } catch (e) {
      /* localStorage unavailable — skip persistent bests */
      this.beatBestWave = false;
      this.beatBestScore = false;
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

  // --- Spirit Crystals / Wardrobe persistence ------------------------------
  // One namespaced JSON blob (ff_wardrobe), same try/catch + safe-default
  // pattern as the high-score code. `owned`/`equipped` are seeded now so Phase 2
  // (the Closet screen) needs no migration; Phase 1 only touches crystals +
  // firstBossClaimed. Any missing/corrupt field falls back to its default.
  loadWardrobe() {
    const def = { crystals: 0, owned: ["default"], equipped: "default", firstBossClaimed: false };
    try {
      const raw = localStorage.getItem("ff_wardrobe");
      if (!raw) return def;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return def;
      return {
        crystals: Number.isFinite(p.crystals) ? Math.max(0, Math.floor(p.crystals)) : 0,
        owned: Array.isArray(p.owned) && p.owned.includes("default") ? p.owned : ["default"],
        equipped: typeof p.equipped === "string" ? p.equipped : "default",
        firstBossClaimed: p.firstBossClaimed === true,
      };
    } catch (e) {
      return def;
    }
  }

  saveWardrobe() {
    try {
      localStorage.setItem("ff_wardrobe", JSON.stringify(this.wardrobe));
    } catch (e) {
      /* localStorage unavailable — progression just won't persist this session */
    }
  }

  // Called once per boss death (from the kill loop). First boss EVER is a
  // guaranteed crystal + the familiar tip; after that only ENDLESS bosses roll
  // a chance that scales with depth + Lucky Paws. Tutorial bosses past the
  // first-ever award nothing, so replaying Tutorial can't farm crystals.
  awardBossCrystal() {
    let earned = 0;
    if (!this.wardrobe.firstBossClaimed) {
      earned = 1;
      this.wardrobe.firstBossClaimed = true;
      this.queueFamiliarTip("spirit_crystal"); // once-ever, both modes
    } else if (this.gameMode === "endless") {
      const tier = this.waveManager.endlessTier() + 1; // wave 10 -> 1, 20 -> 2, ...
      const chance = clamp(
        CRYSTAL_BASE_CHANCE + (tier - 1) * CRYSTAL_CHANCE_PER_TIER + this.luckLevel * CRYSTAL_CHANCE_PER_LUCK,
        0,
        CRYSTAL_CHANCE_CAP
      );
      if (Math.random() < chance) earned = 1;
    }
    if (earned > 0) {
      this.wardrobe.crystals += earned;
      this.crystalsThisRun += earned;
      this.saveWardrobe();
    }
  }

  // Enqueue a familiar dialogue line in BOTH modes (the existing showHint() is
  // tutorial-only). Used for the first-ever Spirit Crystal tip.
  queueFamiliarTip(id) {
    if (!TUTORIAL_HINTS_ENABLED) return;
    const hint = { id, text: TUTORIAL_HINTS[id], timer: HINT_DURATION, sticky: false };
    if (this.activeHint) {
      this.hintQueue.push(hint);
    } else {
      this.activeHint = hint;
      playSfx("hint");
    }
  }

  // --- Outfit buffs (equipped outfit only; never stack) --------------------
  equippedBuff() {
    const o = OUTFITS[this.wardrobe.equipped] || OUTFITS.default;
    return o.buff || {};
  }

  // Score/XP gains route through these so the Gold/Blue %-buffs apply with a
  // fractional carry (accurate over many small pickups). With the default robe
  // the multiplier is 1 and the carry stays 0, so behaviour is unchanged.
  addScore(base) {
    this._scoreCarry += base * (this.equippedBuff().scoreMult || 1);
    const whole = Math.floor(this._scoreCarry);
    if (whole > 0) { this.score += whole; this._scoreCarry -= whole; }
  }

  addXp(base) {
    this._xpCarry += base * (this.equippedBuff().expMult || 1);
    const whole = Math.floor(this._xpCarry);
    if (whole > 0) { this.xp += whole; this._xpCarry -= whole; }
  }

  // --- Closet (Wardrobe screen) --------------------------------------------
  openCloset() {
    this.closetIndex = 0;
    this.state = STATE.CLOSET;
  }

  updateCloset() {
    const count = OUTFIT_ORDER.length + 1; // outfit rows + Back
    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.closetIndex = (this.closetIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.closetIndex = (this.closetIndex + 1) % count;
    }
    if (this.confirmPressed()) {
      if (this.closetIndex === OUTFIT_ORDER.length) { // Back row
        this.state = STATE.MAIN_MENU; this.menuIndex = 0;
      } else {
        this.closetSelect();
      }
    } else if (this.backPressed()) {
      this.state = STATE.MAIN_MENU; this.menuIndex = 0;
    }
  }

  // Enter on an outfit: equip it if owned, else buy it (auto-equipping) if
  // affordable. Persists immediately. SFX are graceful-silent if absent.
  closetSelect() {
    const id = OUTFIT_ORDER[this.closetIndex];
    const o = OUTFITS[id];
    if (!o) return;
    if (this.wardrobe.owned.includes(id)) {
      if (this.wardrobe.equipped !== id) {
        this.wardrobe.equipped = id;
        this.saveWardrobe();
        playSfx("equip");
      }
    } else if (this.wardrobe.crystals >= o.cost) {
      this.wardrobe.crystals -= o.cost;
      this.wardrobe.owned.push(id);
      this.wardrobe.equipped = id; // auto-equip on purchase
      this.saveWardrobe();
      playSfx("purchase");
    } else {
      playSfx("denied"); // can't afford
    }
  }

  // View-model for the Closet renderer.
  closetData() {
    return {
      crystals: this.wardrobe.crystals,
      index: this.closetIndex,
      outfits: OUTFIT_ORDER.map((id) => {
        const o = OUTFITS[id];
        return {
          id, name: o.name, cost: o.cost, desc: o.desc, swatch: o.swatch,
          spriteKey: `${o.spritePrefix}_idle_s`, // Closet portrait (idle-south frame 0)
          owned: this.wardrobe.owned.includes(id),
          equipped: this.wardrobe.equipped === id,
          affordable: this.wardrobe.crystals >= o.cost,
        };
      }),
    };
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
    const evolutions = [
      this.phantomPounceUnlocked && "Phantom Pounce",
      this.spiritBondUnlocked && "Spirit Bond",
      this.spiritVolleyUnlocked && "Spirit Volley",
    ].filter(Boolean);

    return {
      endless: this.gameMode === "endless",
      wave: this.waveManager.wave,
      score: this.score,
      level: this.level,
      enemiesDefeated: this.enemiesDefeated,
      bossesDefeated: this.bossesDefeated,
      evolutions,
      bestWave,
      bestScore,
      // Personal-best flags (Endless only; captured before the bests were
      // overwritten in updateEndlessBests()).
      beatBestWave: this.gameMode === "endless" && this.beatBestWave,
      beatBestScore: this.gameMode === "endless" && this.beatBestScore,
      crystalsEarned: this.crystalsThisRun, // Spirit Crystals gained this run
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
      crystalsEarned: this.crystalsThisRun, // Spirit Crystals gained this run
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
      evolution: [this.phantomPounceUnlocked && "Phantom Pounce", this.spiritBondUnlocked && "Spirit Bond", this.spiritVolleyUnlocked && "Spirit Volley"]
        .filter(Boolean).join(" + ") || "None",
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
