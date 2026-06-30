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
import { Enemy, WaveManager, HazardZone, HazardPuddle, separateEnemies, MAX_ENEMY_SPEED } from "./enemies.js";
import { CURSES, CURSE_POOL, rollNextCurse, curseValue } from "./curses.js";
import { Pickup, HealthFlask, SpiritMagnet, RavenFeather } from "./pickups.js";
import { getOffers, UPGRADES, getGrimoireEntries } from "./upgrades.js";
import { circlesOverlap, clamp, randomRange, pointSegmentDistance } from "./utils.js";
import { loadImage, getImage } from "./assets.js";
import { submitStat } from "./kongregate.js";
import { drawMenu, drawPlaceholder, drawHighScores, drawHowToPlay, drawCredits, drawHUD, drawUpgradeScreen, drawWaveBanner, drawBossBar, drawEvolutionBanner, drawPauseMenu, drawConfirmQuit, drawVictory, drawGameOver, drawNameEntry, drawFamiliarHint, drawSettings, drawGrimoire, drawBestiary, drawCurses, drawFamiliars, drawOffscreenIndicators, drawCloset, drawCrystalTotal } from "./ui.js";
import { setMusicContext, setMusicVolume, getMusicVolume, playSfx, setSfxVolume, getSfxVolume } from "./audio.js";
import { getReducedFlash, setReducedFlash, getHighVisWarnings, setHighVisWarnings } from "./settings.js";

// Arena tileset (4x4 grid of 32px tiles: wall frame + detailed floor).
const TILE = 32;
loadImage("dungeon_tiles", "assets/tiles/Main_Dungeon.png");
loadImage("floor_props", "assets/tiles/floor_props.png");
// Wood / wooden-structure theme art — mirrors the stone sheets' layout exactly
// (floor_wood.png = 4×4 wall+floor; floor_props_wood.png = 4×8, same band cells).
loadImage("wood_tiles", "assets/tiles/floor_wood.png");
loadImage("wood_props", "assets/tiles/floor_props_wood.png");
// Cocolito Collective studio logo — shown on the Credits screen (drawn null-guarded,
// so it simply won't appear until the file exists at this exact path).
loadImage("cocolito_logo", "assets/sprites/ui/cocolito_logo.png");

// Floor decoration — TWO independent seeded bands, each with its own frequency:
//   • Runes   — subtle glyphs, common (atmospheric floor texture).
//   • Objects — bold clutter (skull, bones, barrels, moss…), RARE (occasional points of interest).
// Density and variety are separate dials: CHANCE = how often a band appears per floor tile;
// COUNT = how many distinct sprites it draws from (more = less repetition, SAME density).
//
// floor_props.png layout (4 cols × 32px cells), filled in reading order (left→right, top→bottom):
//   cells 0–19  (rows 0–4) = RUNES
//   cells 20–31 (rows 5–7) = OBJECTS
const PROP_COLS = 4;           // sheet width in cells

const RUNE_CHANCE = 0.1;      // how often a rune appears (per floor tile)
const RUNE_COUNT  = 20;        // distinct rune cells, starting at cell 0 (rows 0–4)

const OBJECT_CHANCE = 0.005;   // how often a bold object appears — keep this LOW
const OBJECT_START  = 20;      // first object cell index (row 5)
const OBJECT_COUNT  = 12;      // distinct object cells (rows 5–7)

// Arena floor THEMES — the arena's whole visual floor (base tiles + prop sheet) rotates
// between these as you progress through "sections" of the dungeon. VISUAL ONLY: the
// renderer just samples a different sheet — cell layout, parity, the seeded bands, and
// the world are all unchanged. Both prop sheets share the SAME band layout (cells 0–19
// runes / 20–31 objects), so the constants above drive every theme. Order = the cycle;
// add a 3rd entry and the picker keeps working (alternation becomes a rotation).
const THEMES = [
  { id: "stone", tiles: "dungeon_tiles", props: "floor_props", arriveLine: null },
  { id: "wood",  tiles: "wood_tiles",    props: "wood_props",  arriveLine: "The dungeon shifts beneath us..." },
];

const STATE = {
  MAIN_MENU: "mainMenu",
  MODE_SELECT: "modeSelect",
  HOW_TO_PLAY: "howToPlay",
  GRIMOIRE: "grimoire",
  BESTIARY: "bestiary",
  CURSES: "curses", // Curses archive (Cursed Mode), reached via the Arcane Archive
  FAMILIAR_ARCHIVE: "familiarArchive", // Familiars catalog, reached via the Arcane Archive
  ARCHIVE: "archive", // Arcane Archive hub (Grimoire + Bestiary + Curses + Familiars)
  CLOSET: "closet", // Wardrobe: buy/equip outfits with Spirit Crystals
  ENDLESS_PLACEHOLDER: "endlessPlaceholder",
  HIGHSCORES_PLACEHOLDER: "highScoresPlaceholder",
  SETTINGS_PLACEHOLDER: "settingsPlaceholder",
  CREDITS: "credits", // static credits screen (license attributions), reached from the Main Menu
  PLAYING: "playing",
  PAUSED: "paused",
  CONFIRM_QUIT: "confirmQuit", // confirm Main Menu from the Pause menu
  LEVEL_UP: "levelUp",
  DYING: "dying",      // brief: play the witch's death animation, then Game Over
  NAME_ENTRY: "nameEntry", // arcade 3-letter initials for a qualifying Endless score
  GAME_OVER: "gameOver",
  VICTORY: "victory",
};

const MAIN_MENU_ITEMS = ["Play", "Wardrobe", "Arcane Archive", "High Scores", "Settings", "Credits"];
const ARCHIVE_ITEMS = ["Grimoire", "Bestiary", "Curses", "Familiars", "Back"]; // Arcane Archive hub
const MODE_SELECT_ITEMS = ["Tutorial Mode", "Casual Mode", "Cursed Mode", "How to Play", "Back"];
const VICTORY_ITEMS = ["Continue to Casual Frenzy", "Replay Tutorial", "Main Menu"];
const PAUSE_ITEMS = ["Resume", "Arcane Archive", "Settings", "Main Menu"];
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
  hive_warden: "Careful — that buzz means stingers are coming!",
  bone_mage:   "A Bone Mage! It curses the ground — step off the rune!",
  goblin_bonker: "A Goblin Bonker! Its club swing knocks you flying — dodge it.",
  pronggeist:  "That fork is aiming at the floor — move!",
  hourkeeper:  "It's gone — watch the clock hands!",
  tin_bulwark: "Careful — that tin brute is trying to herd us!",
  spirit_crystal: "A Spirit Crystal! Spend these in the Wardrobe between runs.",
};
const FLASK_HEAL = 15;          // HP restored per flask

// Raven familiar — healing feathers (Scavenger's Gift passive + Grave Tax Spirit Imbued).
// A separate system from flasks, so Withering (which blocks flasks) does NOT block these.
const FEATHER_HEAL = 3;         // HP per feather (vs a flask's 15 — modest, sustain not burst)
const FEATHER_MAX = 6;          // hard cap on active feathers (bounds healing + screen clutter)
const FEATHER_LIFE = 10;        // seconds an uncollected feather lingers before it fades
const SCAVENGER_CHANCE = 0.05;  // Scavenger's Gift: feather chance on a non-boss kill

// Cursed Ground curse: telegraphed cursed patches keep blooming around the witch.
const CG_INTERVAL = 2.4;        // seconds between patches while the curse is active
const CG_RADIUS = 58;           // patch damage radius
const CG_TELEGRAPH = 1.1;       // windup before it bites (the escape window)
const CG_DAMAGE = 14;           // damage if you're standing in it at bloom
const CG_MIN_DIST = 90;         // patches bloom in a ring around the witch...
const CG_MAX_DIST = 320;        // ...near enough to threaten, far enough to dodge

// Vengeful Dead curse: each slain non-boss enemy leaves a brief dark pool where it
// fell — a lingering ground DoT on the witch (HazardPuddle). The witch's 1.0s
// i-frames gate the ticks, so camping a fresh kill costs ~one extra bite. All
// one-value knobs; tune freely.
const VD_PUDDLE_RADIUS = 38;    // pool hitbox/visual radius (px)
const VD_PUDDLE_LIFE = 1.8;     // seconds the pool lingers before fading
const VD_PUDDLE_TICK = 0.5;     // seconds between DoT ticks
const VD_PUDDLE_DAMAGE = 10;    // damage per landed tick
const VD_PUDDLE_MAX = 16;       // simultaneous-pool cap (oldest drops in big clears)

// Emberheart Robe (red outfit) — emergency heal. When equipped and current HP dips
// below EMBER_TRIGGER of max while alive, heal up to EMBER_HEAL_TO of max, once per
// wave (re-armed at each wave change). Fractions of max HP; tunable.
const EMBER_TRIGGER = 0.25;  // fires when current HP < 25% of max
const EMBER_HEAL_TO = 0.50;  // tops her up to 50% of max

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
//   emergencyHeal — once per wave, auto-heal to EMBER_HEAL_TO when HP < EMBER_TRIGGER
//   flaskBonus  — extra HP per flask (still supported by the flask pickup; now unused)
//   expMult     — EXP-gain multiplier
//   scoreMult   — score-gain multiplier
// `swatch` is the code-drawn colour chip shown in the Closet. `spritePrefix` is
// reserved for the in-game witch colour-swap (a later pass, once the recoloured
// sprites + player.js land); it has no effect yet.
const OUTFITS = {
  default: { name: "Apprentice Robe", cost: 0, swatch: "#9b6cff", spritePrefix: "witch",      desc: "No bonus",          buff: {} },
  red:     { name: "Emberheart Robe", cost: 8, swatch: "#e0584d", spritePrefix: "witch_red",  desc: "Below 25% HP, heal to 50% per wave", buff: { emergencyHeal: true } },
  blue:    { name: "Sage's Weave",    cost: 3, swatch: "#5aa0e0", spritePrefix: "witch_blue", desc: "EXP gain +5%",      buff: { expMult: 1.05 } },
  gold:    { name: "Gilded Mantle",   cost: 6, swatch: "#f4d58d", spritePrefix: "witch_gold", desc: "Score gain +5%",    buff: { scoreMult: 1.05 } },
};
const OUTFIT_ORDER = ["default", "blue", "gold", "red"]; // Closet display order (by price; Emberheart last)

// --- Collars (Closet) -----------------------------------------------------
// A collar swaps the familiar's whole attack style (see familiar.js). Default
// is owned + free. `attackStyle` drives the attack; `spritePrefix` is the cat
// recolor (familiar_<collar>_*); `swatch` is the fallback accent if the recolor
// portrait is missing; `cooldown` is the base fire interval (Restless Wisp then
// scales it). Collars cost more than outfits — they change the whole attack.
const COLLARS = {
  default:   { name: "Spirit Collar",   cost: 0,  attackStyle: "rune",      spritePrefix: "familiar",           cooldown: 1.2, swatch: "#b18cff", desc: "Rune bolts" },
  moonbeam:  { name: "Moon Beam Collar", cost: 10, attackStyle: "moonbeam",  spritePrefix: "familiar_moonbeam",  cooldown: 1.6, swatch: "#b18cff", desc: "Fires a purple beam" },
  alchemist: { name: "Alchemist Collar", cost: 12, attackStyle: "alchemist", spritePrefix: "familiar_alchemist", cooldown: 1.5, swatch: "#7bd45a", desc: "Throws acid flasks" },
};
const COLLAR_ORDER = ["default", "moonbeam", "alchemist"];

// --- Familiars (Closet) ---------------------------------------------------
// A familiar ASPECT sets the creature sprite, a minor passive, and the Spirit
// Imbued behavior — independent of the collar (which still drives the normal
// attack). `spritePrefix` is the aspect's BASE sprite (used for the Wardrobe
// portrait and the Spirit/default collar). The Cat (default) keeps the equipped
// collar's own recolor; any other aspect recolors per collar exactly like the cat
// (`<spritePrefix>_<collarId>` for Moon Beam / Alchemist, the bare prefix for
// Spirit) — see startGame. `frenzy` is the Spirit Imbued behavior id read by
// familiar.js; `frenzyMoteMult` is the Star-Eyed Focus mote bonus (collectPickup).
const FAMILIARS = {
  default: {
    name: "Cat Familiar", cost: 0, swatch: "#1c1a26", spritePrefix: "familiar",
    frenzy: "default", frenzyMoteMult: 1, desc: "Classic familiar companion",
    // Arcane Archive (Familiars catalog) copy — future familiars just fill these.
    blurb: "A steadfast spirit companion.",
    passive: "None", passiveDesc: "",
    frenzyName: "Surge", frenzyDesc: "Attacks rapidly.",
  },
  owl: {
    name: "Owl Familiar", cost: 6, swatch: "#3a2f5e", spritePrefix: "familiar_owl",
    frenzy: "astral", frenzyMoteMult: 1.05, desc: "Star-Eyed Focus + Astral Judgment",
    blurb: "A wise spirit that sharpens the bond.",
    passive: "Star-Eyed Focus", passiveDesc: "Spirit Imbued fills slightly faster from motes.",
    frenzyName: "Astral Judgment", frenzyDesc: "Strikes the most dangerous foe with arcane precision.",
  },
  fox: {
    name: "Fox Familiar", cost: 6, swatch: "#7a3b1e", spritePrefix: "familiar_fox",
    frenzy: "foxfire", frenzyMoteMult: 1, desc: "Trickster Luck + Foxfire Chain",
    // Trickster Luck: small flat bumps to the two RARE on-kill drops (flask + Spirit
    // Magnet), added at the drop rolls. Additive with Lucky Paws and well under a full
    // build (3 lvls = +0.12 flask / +0.018 magnet). Does NOT touch Spirit Crystals,
    // which roll separately on bosses. Kept in the table like frenzyMoteMult so tuning
    // is one place; absent on Cat/Owl, defaulted to 0 at run start.
    flaskLuck: 0.015,   // base flask 0.015 -> ~0.030
    magnetLuck: 0.003,  // base magnet 0.008 -> ~0.011
    blurb: "A sly spirit that spreads foxfire between foes.",
    passive: "Trickster Luck", passiveDesc: "Rare pickups appear a little more often.",
    frenzyName: "Foxfire Chain", frenzyDesc: "Wisps bounce between enemies.",
  },
  bat: {
    name: "Bat Familiar", cost: 6, swatch: "#2e2640", spritePrefix: "familiar_bat",
    frenzy: "echo", frenzyMoteMult: 1, desc: "Night Sense + Echo Swarm",
    // Night Sense: a small flat bump to pickup magnet RANGE, added at the attraction
    // check (applyMagnet) so it stacks with the innate magnet + Magnet Charm and can't
    // be clobbered. Kept in the table like frenzyMoteMult; absent on others -> 0 at run start.
    magnetBonus: 10,    // +10px pickup magnet range (tiny vs Magnet Charm's +55/level)
    blurb: "A sharp-eared spirit that scatters foes with echo magic.",
    passive: "Night Sense", passiveDesc: "Pickups are drawn in from a little farther.",
    frenzyName: "Echo Swarm", frenzyDesc: "Echo waves strike nearby enemies.",
  },
  raven: {
    name: "Raven Familiar", cost: 10, swatch: "#1f1a2e", spritePrefix: "familiar_raven",
    frenzy: "raven", frenzyMoteMult: 1, desc: "Scavenger's Gift + Grave Tax",
    // Scavenger's Gift: small chance for a slain non-boss to drop a healing feather.
    // Read at run start into familiarScavengerChance; 0 for every other familiar. The
    // feather drop/heal lives in the death loop + collect loop; Grave Tax (the marking)
    // lives in familiar.js. Premium familiar — the Cursed Mode survival tool, hence cost 10.
    scavengerChance: SCAVENGER_CHANCE,
    blurb: "A dark spirit that draws life from the fallen.",
    passive: "Scavenger's Gift", passiveDesc: "Slain enemies may release a healing feather.",
    frenzyName: "Grave Tax", frenzyDesc: "Spirit Imbued marks foes; marked kills drop feathers.",
  },
};
const FAMILIAR_ORDER = ["default", "owl", "fox", "bat", "raven"];

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
    id: "pronggeist", name: "Pronggeist", kind: "Enemy", enemyType: "pronggeist",
    spriteKey: "pronggeist_walk_s", frames: 4,
    blurb: "Plants itself, then rakes the ground with four spike rows.",
  },
  {
    id: "tin_bulwark", name: "Tin Bulwark", kind: "Enemy", enemyType: "tin_bulwark",
    spriteKey: "tin_bulwark_walk_s", frames: 6,
    blurb: "Raises a moving wall that shoves witches into danger.",
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
  {
    id: "hive_warden", name: "Hive Warden", kind: "Boss", bossName: "Hive Warden",
    spriteKey: "bee_fly_s", frames: 6,
    blurb: "Charges up and fires sharp stinger volleys.",
  },
  {
    id: "hourkeeper", name: "The Hourkeeper", kind: "Boss", bossName: "The Hourkeeper",
    spriteKey: "hourkeeper_idle_s", frames: 6,
    blurb: "Vanishes into time, then returns when the alarms begin.",
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
    this.menuZones = [];       // clickable item rects from the last menu draw (mouse)
    this.offerZones = [];      // clickable card rects from the last level-up draw
    this.offerHoverIndex = -1; // upgrade card under the cursor, or -1
    this.settingsReturn = STATE.MAIN_MENU; // where the Settings screen goes "back" to
    this.settingsIndex = 0;                // selected Settings row: 0 music, 1 sfx
    this.settingsDragging = null;          // row of the slider being dragged, or null
    this.settingsZones = null;             // hit zones fed back from the last Settings render
    this.closetZones = null;               // Wardrobe hit zones (rows/tabs/Back) from the last render
    this.highscoresBackHover = false;      // High Scores Back button hovered (mouse)
    this.highscoresTab = "endless";        // active High Scores board: "endless" | "cursed"
    this.highscoresTabHover = null;         // tab under the cursor: "endless" | "cursed" | null
    this.howToPlayBackHover = false;       // How to Play Back button hovered (mouse)
    this.creditsBackHover = false;         // Credits Back button hovered (mouse)

    // Upgrade Grimoire (read-only glossary) screen state.
    this.grimoireReturn = STATE.MAIN_MENU; // where Back returns to
    this.archiveReturn = STATE.MAIN_MENU;  // Arcane Archive hub: back out to main menu or pause
    this.grimoireEntries = [];             // cached list while the screen is open
    this.grimoireIndex = 0;                // highlighted entry (Back = entries.length)

    // Scroll state for the Grimoire/Bestiary list panels. `*Scroll` is the pixel
    // offset; `*FollowSel` means "keep the highlighted row in view" (keyboard /
    // open / click) versus free wheel-scroll. `*MaxScroll` is fed back from the
    // renderer each frame so the handler can clamp the wheel.
    this.grimoireScroll = 0;
    this.grimoireMaxScroll = 0;
    this.grimoireFollowSel = true;
    this.grimoireScrollbar = null;        // {x, top, viewH, thumbY, thumbH, maxScroll} from last render, or null
    this.grimoireScrollDragging = false;  // dragging the scrollbar thumb?
    this.grimoireDragOffset = 0;          // cursor offset within the thumb at grab time
    this.bestiaryScroll = 0;
    this.bestiaryMaxScroll = 0;
    this.bestiaryFollowSel = true;
    this.bestiaryScrollbar = null;
    this.bestiaryScrollDragging = false;
    this.bestiaryDragOffset = 0;

    this.player = new Player(WORLD_W / 2, WORLD_H / 2);
    this.familiar = new Familiar(WORLD_W / 2 - 40, WORLD_H / 2 - 40);

    this.enemies = [];
    this.enemyBolts = []; // Gutter Gecko projectiles (outlive their shooter)
    this.hazards = [];    // Bone Mage cursed-ground zones (telegraph -> blast)
    this.hazardPuddles = []; // Vengeful Dead pools (lingering ground DoT on the witch)
    this.waveManager = new WaveManager(MAX_WAVES);
    this.pickups = [];
    this.flasks = [];
    this.feathers = [];     // Raven healing feathers (Scavenger's Gift + Grave Tax)
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
    this.emberHealUsed = false;  // Emberheart Robe: emergency heal used this wave (re-armed each wave)
    this.emberHintShown = false; // Emberheart: "saved you!" line shown this run (once per run)

    // Upgrade-driven values (mutated by apply()); reset each run.
    this.magnetRange = BASE_MAGNET_RANGE; // pickup attraction radius (innate + Magnet Charm)
    this.frenzyPerMote = 1;   // Frenzy Focus: charge added per mote
    this.familiarMoteMult = 1; // Star-Eyed Focus (Owl): per-mote frenzy bonus, set per run
    this.familiarFlaskLuck = 0;  // Trickster Luck (Fox): flat flask-drop bonus, set per run
    this.familiarMagnetLuck = 0; // Trickster Luck (Fox): flat Spirit Magnet bonus, set per run
    this.familiarMagnetBonus = 0; // Night Sense (Bat): flat pickup magnet-range bump, set per run
    this.familiarScavengerChance = 0; // Scavenger's Gift (Raven): feather chance on a non-boss kill, set per run
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

    this.gameMode = "tutorial"; // "tutorial" | "endless" | "cursed"
    this.activeCurses = [];     // Cursed Mode: ids of curses in effect this run (grows per boss kill)
    this.cursedGroundTimer = CG_INTERVAL; // countdown for the Cursed Ground curse's patches

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
    this.activeOutfit = this.wardrobe.equipped; // outfit key the RUN uses; startGame forces "default" for tutorial. equippedBuff() reads this live.
    this.crystalsThisRun = 0;
    this.closetIndex = 0;
    this.closetTab = 0; // 0 = Outfits, 1 = Familiars, 2 = Collars
    this.pendingRunMode = null; // null = normal shop Wardrobe; "endless"/"cursed" = pre-run loadout (shows Start)
    // Fractional carries so the Blue/Gold outfit %-buffs stay accurate on small
    // per-pickup amounts (without these, +5% on a value of 10 rounds badly).
    this._scoreCarry = 0;
    this._xpCarry = 0;
  }

  startGame(mode = "tutorial") {
    this.gameMode = mode;
    this.pendingRunMode = null; // any run-start clears the pre-run flag (defensive)
    this.score = 0;
    this.player.reset(WORLD_W / 2, WORLD_H / 2);
    // The TUTORIAL always runs on the default loadout (Apprentice Robe + Spirit
    // Collar + Cat) no matter what's equipped, so it stays a fair baseline a
    // kitted-out player can't trivialize. Casual/Cursed honor the saved wardrobe;
    // the wardrobe itself is never modified — this only picks which keys the run
    // reads. activeOutfit persists because equippedBuff() reads it live mid-run.
    const tut = this.gameMode === "tutorial";
    const outfitKey = tut ? "default" : this.wardrobe.equipped;
    const collarKey = tut ? "default" : this.wardrobe.collarEquipped;
    const familiarKey = tut ? "default" : this.wardrobe.familiarEquipped;
    this.activeOutfit = outfitKey;
    // Equipped outfit drives the witch's sprite skin for this whole run (the
    // Closet is between-runs, so it's fixed once we start). Recolors fall back
    // to the purple set per-frame in player.draw if a file is missing.
    this.player.spritePrefix = (OUTFITS[outfitKey] || OUTFITS.default).spritePrefix;
    this.familiar.reset(WORLD_W / 2 - 40, WORLD_H / 2 - 40);
    // Equipped collar drives the familiar's attack style, skin, and base fire
    // rate for the run (set after reset, which defaults them to the rune).
    const collar = COLLARS[collarKey] || COLLARS.default;
    this.familiar.attackStyle = collar.attackStyle;
    this.familiar.spritePrefix = collar.spritePrefix;
    this.familiar.attackCooldown = collar.cooldown;
    // Equipped familiar aspect (independent of collar): the Cat (default) KEEPS the
    // collar recolor set just above; any other aspect owns its own sprite. Aspects
    // recolor per collar exactly like the cat — the bare aspect prefix is the Spirit/
    // default look, `<aspect>_<collarId>` is the recolor for the other collars.
    // spritePrefixBase lets a missing recolor frame fall back to the base aspect.
    const aspect = FAMILIARS[familiarKey] || FAMILIARS.default;
    this.familiar.spritePrefixBase = aspect.spritePrefix;
    if (familiarKey !== "default") {
      const collarId = collarKey;
      this.familiar.spritePrefix = aspect.spritePrefix + (collarId && collarId !== "default" ? "_" + collarId : "");
    }
    this.familiar.frenzyBehavior = aspect.frenzy || "default";
    this.familiarMoteMult = aspect.frenzyMoteMult || 1;
    this.familiarFlaskLuck = aspect.flaskLuck || 0;   // Trickster Luck (Fox); 0 for others
    this.familiarMagnetLuck = aspect.magnetLuck || 0;
    this.familiarMagnetBonus = aspect.magnetBonus || 0; // Night Sense (Bat); 0 for others
    this.familiarScavengerChance = aspect.scavengerChance || 0; // Scavenger's Gift (Raven); 0 for others
    this.enemies = [];
    this.enemyBolts = [];
    this.hazards = [];
    this.hazardPuddles = [];
    this.waveManager.reset(mode === "endless" || mode === "cursed", mode === "cursed");
    this.activeCurses = []; // Cursed Mode starts with none; one is added per boss kill
    this.cursedGroundTimer = CG_INTERVAL;
    // Arena theme resets to stone each run, then advances as bosses fall: a boss kill
    // QUEUES the next theme; it swaps in cleanly at the next wave's start (helpers below).
    this.themeIndex = 0;
    this.queuedThemeIndex = null;
    this._lastWaveSeen = this.waveManager.wave;
    this.pickups = [];
    this.flasks = [];
    this.feathers = [];
    this.magnets = [];
    this.vacuumTimer = 0;

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;
    this.pendingLevelUps = 0;
    this.offers = [];
    this.levelFlash = 0;
    this.upgradeLevels = {};
    this.emberHealUsed = false;  // re-arm the Emberheart heal for the new run
    this.emberHintShown = false; // allow the one-time Emberheart line again this run

    this.magnetRange = BASE_MAGNET_RANGE;
    this.frenzyPerMote = 1;
    this.familiarMoteMult = 1;
    this.familiarFlaskLuck = 0;
    this.familiarMagnetLuck = 0;
    this.familiarMagnetBonus = 0;
    this.familiarScavengerChance = 0;
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
    this.hazardPuddles = [];
    this.activeHint = null; // tutorial dialogue ends with the tutorial
    this.hintQueue = [];
    this.state = STATE.PLAYING;
  }

  // Cursed Mode escalation: on each boss kill, activate one more random curse (the
  // difficulty also steps from the faster every-5 tier scaling). Stops adding once
  // every pool curse is active. The new curse shows on the HUD (icon), unlocks in
  // the Curses archive, and the familiar heralds it by name (below).
  applyNextCurse() {
    const id = rollNextCurse(this.activeCurses);
    if (!id) return; // every pool curse already active
    this.activeCurses.push(id);
    this.markCurseSeen(id); // unlocks the entry in the Curses archive (persists)

    // The familiar heralds the new curse so it isn't just a silent HUD icon. Each
    // CURSES entry carries its own short `cry`; a missing one degrades to silence
    // (the icon still appears). Reuses the dialogue bar/queue, so it honors the same
    // hints toggle as the tutorial/theme lines and queues behind any active line.
    if (CURSES[id] && CURSES[id].cry) this.sayFamiliar(CURSES[id].cry);

    // Speed curses (Quickening) take effect at once: update the multiplier new
    // enemies spawn with, and bump any already alive by the same ratio. Bosses are
    // left at their tuned speeds. Other curses are passive (read where they apply:
    // Darkness in the veil, Withering in the flask roll, Cursed Ground in update).
    const newMult = curseValue(this.activeCurses, "enemySpeedMult", 1);
    const oldMult = this.waveManager.curseSpeedMult || 1;
    if (newMult !== oldMult) {
      // Clamp here too: a freshly-quickened LIVE enemy could otherwise jump past
      // MAX_ENEMY_SPEED. New spawns are already capped in makeEnemy.
      for (const e of this.enemies) if (!e.isBoss) e.speed = Math.min(MAX_ENEMY_SPEED, e.speed * newMult / oldMult);
      this.waveManager.curseSpeedMult = newMult;
    }

    // Brittle: scale all incoming player damage. Unlike Quickening there's nothing
    // already-alive to adjust — it applies from the next hit on.
    this.player.damageTakenMult = curseValue(this.activeCurses, "damageMult", 1);

    // Teeming: fuller, denser waves. The WaveManager reads these when it builds the
    // next wave and gates spawning — so it takes hold from the next wave on.
    this.waveManager.curseSpawnMult = curseValue(this.activeCurses, "spawnMult", 1);
    this.waveManager.curseMaxAliveBonus = curseValue(this.activeCurses, "maxAliveBonus", 0);
  }

  // --- UPDATE ------------------------------------------------------------
  update(dt) {
    switch (this.state) {
      case STATE.MAIN_MENU: {
        const hov = this.zoneAt(this.menuZones);
        // Hover moves the highlight to the cursor, but only when the mouse
        // actually moves — otherwise a resting pointer would fight the keyboard.
        if (hov >= 0 && Input.mouseMoved()) this.menuIndex = hov;
        this.navMenu(MAIN_MENU_ITEMS.length);
        const clicked = hov >= 0 && Input.mouseClicked();
        if (clicked) this.menuIndex = hov; // click activates the item under the cursor
        if (this.confirmPressed() || clicked) {
          if (this.menuIndex === 0) { this.state = STATE.MODE_SELECT; this.menuIndex = 0; }
          else if (this.menuIndex === 1) this.openCloset();           // Wardrobe
          else if (this.menuIndex === 2) this.openArchive(STATE.MAIN_MENU);  // Arcane Archive
          else if (this.menuIndex === 3) { this.highscoresTab = "endless"; this.highscoresTabHover = null; this.state = STATE.HIGHSCORES_PLACEHOLDER; }
          else if (this.menuIndex === 4) { this.settingsReturn = STATE.MAIN_MENU; this.settingsIndex = 0; this.state = STATE.SETTINGS_PLACEHOLDER; }
          else if (this.menuIndex === 5) { this.creditsBackHover = false; this.state = STATE.CREDITS; }
        }
        break;
      }

      case STATE.HOW_TO_PLAY: {
        // Mouse: a single clickable Back button (hover-highlighted), matching High
        // Scores/Settings. Clicking elsewhere no longer returns — only Back, or
        // Esc/Backspace/Enter. Returns to Mode Select (How to Play is index 3 there).
        const hov = this.zoneAt(this.menuZones);
        if (Input.mouseMoved()) this.howToPlayBackHover = hov === 0;
        const clickedBack = hov === 0 && Input.mouseClicked();
        if (this.backPressed() || this.confirmPressed() || clickedBack) { this.state = STATE.MODE_SELECT; this.menuIndex = 3; }
        break;
      }

      case STATE.CREDITS: {
        // Static screen with a single hover-able Back (Esc/Backspace/Enter also leave).
        const hov = this.zoneAt(this.menuZones);
        if (Input.mouseMoved()) this.creditsBackHover = hov === 0;
        const clickedBack = hov === 0 && Input.mouseClicked();
        if (this.backPressed() || this.confirmPressed() || clickedBack) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        break;
      }

      case STATE.GRIMOIRE:
        this.updateGrimoire();
        break;

      case STATE.BESTIARY:
        this.updateBestiary();
        break;

      case STATE.CURSES:
        this.updateCurses();
        break;
      case STATE.FAMILIAR_ARCHIVE:
        this.updateFamiliarsArchive();
        break;

      case STATE.ARCHIVE:
        this.updateArchive();
        break;

      case STATE.CLOSET:
        this.updateCloset();
        break;

      case STATE.MODE_SELECT: {
        const m = this.mouseMenu(this.menuZones);
        if (m.hover >= 0) this.menuIndex = m.hover;
        this.navMenu(MODE_SELECT_ITEMS.length);
        if (m.clicked >= 0) this.menuIndex = m.clicked;
        if (this.confirmPressed() || m.clicked >= 0) {
          if (this.menuIndex === 0) this.startGame("tutorial");        // Tutorial Mode — starts directly, no Wardrobe
          else if (this.menuIndex === 1) this.openCloset("endless");   // Casual Mode — pre-run Wardrobe loadout, then Start
          else if (this.menuIndex === 2) this.openCloset("cursed");    // Cursed Mode — pre-run Wardrobe loadout, then Start
          else if (this.menuIndex === 3) { this.state = STATE.HOW_TO_PLAY; } // How to Play (returns to Mode Select)
          else if (this.menuIndex === 4) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        } else if (this.backPressed()) {
          this.state = STATE.MAIN_MENU; this.menuIndex = 0;
        }
        break;
      }

      case STATE.ENDLESS_PLACEHOLDER:
        if (this.backPressed() || this.confirmPressed() || Input.mouseClicked()) { this.state = STATE.MODE_SELECT; this.menuIndex = 0; }
        break;

      case STATE.HIGHSCORES_PLACEHOLDER: {
        // Zones: 0 = Back, 1 = Endless tab, 2 = Cursed tab. Tabs switch which
        // leaderboard shows; Back (or Esc/Backspace/Enter) leaves. Mouse and
        // keyboard drive the SAME tab state.
        const hov = this.zoneAt(this.menuZones);
        if (Input.mouseMoved()) {
          this.highscoresBackHover = hov === 0;
          this.highscoresTabHover = hov === 1 ? "endless" : hov === 2 ? "cursed" : null;
        }
        if (Input.mouseClicked()) {
          if (hov === 1) this.highscoresTab = "endless";
          else if (hov === 2) this.highscoresTab = "cursed";
        }
        // Left/Right (or A/D) flips between the two boards.
        if (Input.wasPressed("ArrowLeft") || Input.wasPressed("KeyA")) this.highscoresTab = "endless";
        if (Input.wasPressed("ArrowRight") || Input.wasPressed("KeyD")) this.highscoresTab = "cursed";
        const clickedBack = hov === 0 && Input.mouseClicked();
        if (this.backPressed() || this.confirmPressed() || clickedBack) { this.state = STATE.MAIN_MENU; this.menuIndex = 0; }
        break;
      }

      case STATE.SETTINGS_PLACEHOLDER: {
        // Four rows: 0 = Music Volume, 1 = SFX Volume, 2 = Reduced Flash, 3 = High Vis.
        // Mouse: drag (or click) the volume tracks; click Off/On to flip a toggle;
        // hover highlights the row. Keyboard (Up/Down select, Left/Right adjust) still
        // works — the mouse only ever drives the same settings.
        const z = this.settingsZones;
        if (z) {
          const mx = Input.mouseX(), my = Input.mouseY();
          const inRect = (r) => r && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

          // Press starts a slider drag, or flips a toggle (Off/On are separate targets).
          if (Input.mouseClicked()) {
            if (z.back && inRect(z.back)) {
              this.state = this.settingsReturn || STATE.MAIN_MENU;
              if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
              break; // returned to the previous screen; skip the rest this frame
            }
            for (const s of z.sliders) {
              if (inRect(s)) { this.settingsDragging = s.row; this.settingsIndex = s.row; break; }
            }
            for (const t of z.toggles) {
              if (inRect(t.off)) {
                this.settingsIndex = t.row;
                if (t.row === 2) setReducedFlash(false); else setHighVisWarnings(false);
              } else if (inRect(t.on)) {
                this.settingsIndex = t.row;
                if (t.row === 2) setReducedFlash(true); else setHighVisWarnings(true);
              }
            }
          }

          // While the button is held on a slider, the value tracks the cursor x.
          // No per-frame SFX blip — it would machine-gun; the bar + percentage are
          // the feedback. (This also fires on the press frame, so a click sets the
          // value at the click point straight away.)
          if (this.settingsDragging !== null && Input.mouseHeld()) {
            const s = z.sliders.find((sl) => sl.row === this.settingsDragging);
            if (s) {
              const val = Math.round(Math.max(0, Math.min(1, (mx - s.x) / s.w)) * 100);
              if (this.settingsDragging === 0) setMusicVolume(val);
              else setSfxVolume(val);
              this.settingsIndex = this.settingsDragging;
            }
          }
          if (!Input.mouseHeld()) this.settingsDragging = null;

          // Hover highlights the row under the cursor so keyboard + mouse agree.
          if (Input.mouseMoved()) {
            for (const s of z.sliders) if (inRect(s)) this.settingsIndex = s.row;
            for (const t of z.toggles) if (inRect(t.off) || inRect(t.on)) this.settingsIndex = t.row;
            if (z.back && inRect(z.back)) this.settingsIndex = 4;
          }
        }

        if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
          this.settingsIndex = (this.settingsIndex + 4) % 5; // -1, wrapped (5 rows incl. Back)
        }
        if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
          this.settingsIndex = (this.settingsIndex + 1) % 5;
        }
        if (Input.wasPressed("ArrowLeft") || Input.wasPressed("KeyA")) {
          if (this.settingsIndex === 0) setMusicVolume(getMusicVolume() - 5);
          else if (this.settingsIndex === 1) { setSfxVolume(getSfxVolume() - 5); playSfx("hint"); }
          else if (this.settingsIndex === 2) setReducedFlash(false);
          else if (this.settingsIndex === 3) setHighVisWarnings(false);
        }
        if (Input.wasPressed("ArrowRight") || Input.wasPressed("KeyD")) {
          if (this.settingsIndex === 0) setMusicVolume(getMusicVolume() + 5);
          else if (this.settingsIndex === 1) { setSfxVolume(getSfxVolume() + 5); playSfx("hint"); }
          else if (this.settingsIndex === 2) setReducedFlash(true);
          else if (this.settingsIndex === 3) setHighVisWarnings(true);
        }
        if (this.confirmPressed() && this.settingsIndex === 4) {
          this.state = this.settingsReturn || STATE.MAIN_MENU;
          if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
        }
        if (this.backPressed()) {
          this.state = this.settingsReturn || STATE.MAIN_MENU;
          if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
        }
        break;
      }

      case STATE.PLAYING:
        if (Input.wasPressed("Escape") || Input.wasPressed("KeyP")) {
          this.state = STATE.PAUSED;
          this.menuIndex = 0;
          break;
        }
        this.updatePlaying(dt);
        break;

      case STATE.PAUSED: {
        // Esc / P unpause (but only here, not inside the Settings sub-screen).
        if (Input.wasPressed("Escape") || Input.wasPressed("KeyP")) {
          this.state = STATE.PLAYING;
          break;
        }
        const m = this.mouseMenu(this.menuZones);
        if (m.hover >= 0) this.menuIndex = m.hover;
        this.navMenu(PAUSE_ITEMS.length);
        if (m.clicked >= 0) this.menuIndex = m.clicked;
        if (this.confirmPressed() || m.clicked >= 0) {
          if (this.menuIndex === 0) {
            this.state = STATE.PLAYING;                 // Resume
          } else if (this.menuIndex === 1) {
            this.openArchive(STATE.PAUSED);             // Arcane Archive hub (returns to Pause)
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
      }

      case STATE.CONFIRM_QUIT: {
        const m = this.mouseMenu(this.menuZones);
        if (m.hover >= 0) this.menuIndex = m.hover;
        this.navMenu(CONFIRM_ITEMS.length);
        if (m.clicked >= 0) this.menuIndex = m.clicked;
        if (this.confirmPressed() || m.clicked >= 0) {
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
      }

      case STATE.LEVEL_UP:
        if (this.levelFlash > 0) this.levelFlash = Math.max(0, this.levelFlash - dt);
        this.updateLevelUp();
        break;

      case STATE.DYING:
        this.player.updateDying(dt);
        if (this.player.deathDone) {
          // Personal bests are Endless-only; the leaderboard now covers Endless
          // AND Cursed (separate boards via highScoreKey).
          if (this.gameMode === "endless") this.updateEndlessBests();
          if (this.gameMode === "cursed") this.updateCursedBests();
          this.recordBestLevel();      // any mode — tutorial deaths count toward HighestWitchLevel
          this.pushKongregateStats();  // push this run's bests now; no-op off Kongregate
          if (this.gameMode === "endless" || this.gameMode === "cursed") {
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

      case STATE.VICTORY: {
        const m = this.mouseMenu(this.menuZones);
        if (m.hover >= 0) this.menuIndex = m.hover;
        this.navMenu(VICTORY_ITEMS.length);
        if (m.clicked >= 0) this.menuIndex = m.clicked;
        if (this.confirmPressed() || m.clicked >= 0) {
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
      }

      case STATE.GAME_OVER: {
        // drawGameOver reports two prompt rects: 0 = retry/new run, 1 = main menu.
        // No hover-highlight here (the prompts just pulse), so a click only acts
        // when it lands on a prompt — stray clicks do nothing.
        const click = Input.mouseClicked() ? this.zoneAt(this.menuZones) : -1;
        if (Input.wasPressed("KeyR") || click === 0) {
          this.startGame(this.gameMode);      // retry in the same mode
        } else if (this.backPressed() || click === 1) {
          this.state = STATE.MAIN_MENU;
          this.menuIndex = 0;
        }
        break;
      }
    }

    // Keep music in sync with the current context (cheap; no-ops if unchanged).
    this.updateMusic();
  }

  // Pick the right music context for the current state/wave. "boss" only while
  // a boss is alive during play; otherwise gameplay states use the GAMEPLAY
  // pool and menus use the MENU pool (the two pools are split in audio.js).
  updateMusic() {
    // Any archive screen opened from pause (hub, Grimoire, Bestiary, Curses,
    // Familiars) is still "in the run" for music — keep the gameplay/boss track.
    const inArchiveFromPause = (this.state === STATE.ARCHIVE || this.state === STATE.GRIMOIRE
      || this.state === STATE.BESTIARY || this.state === STATE.CURSES
      || this.state === STATE.FAMILIAR_ARCHIVE)
      && this.archiveReturn === STATE.PAUSED;
    const inPlay = this.state === STATE.PLAYING || this.state === STATE.LEVEL_UP
      || this.state === STATE.PAUSED || this.state === STATE.DYING
      || inArchiveFromPause;
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

  // Index of the clickable zone under the cursor, or -1. Zones are the
  // {x, y, w, h, index} rects reported by the menu / upgrade draws. Mouse
  // support is additive — callers use this to drive the SAME selection the
  // keyboard already sets.
  zoneAt(zones) {
    if (!zones || !zones.length) return -1;
    const mx = Input.mouseX();
    const my = Input.mouseY();
    for (const z of zones) {
      if (mx >= z.x && mx <= z.x + z.w && my >= z.y && my <= z.y + z.h) return z.index;
    }
    return -1;
  }

  // Mouse interaction for a list menu, given its reported zones. Returns the
  // index to hover-highlight (only when the pointer MOVED, so it never fights
  // the keyboard) and the index that was clicked (both -1 if none).
  mouseMenu(zones) {
    const at = this.zoneAt(zones);
    return {
      hover: at >= 0 && Input.mouseMoved() ? at : -1,
      clicked: at >= 0 && Input.mouseClicked() ? at : -1,
    };
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
    this.grimoireScroll = 0;
    this.grimoireFollowSel = true; // start pinned to the top entry
    this.grimoireScrollDragging = false;
    this.state = STATE.GRIMOIRE;
  }

  closeGrimoire() {
    this.state = this.grimoireReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
    else if (this.state === STATE.ARCHIVE) this.archiveIndex = 0; // land back on "Grimoire"
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

  openBestiary(returnState) {
    this.loadSeenEnemies();
    this.bestiaryReturn = returnState || STATE.ARCHIVE;
    this.bestiaryIndex = 0;
    this.bestiaryScroll = 0;
    this.bestiaryFollowSel = true; // start pinned to the top entry
    this.bestiaryScrollDragging = false;
    this.state = STATE.BESTIARY;
  }

  closeBestiary() {
    this.state = this.bestiaryReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
    else if (this.state === STATE.ARCHIVE) this.archiveIndex = 1; // land back on "Bestiary"
  }

  // --- Curses archive (Cursed Mode) -----------------------------------------
  // Discovered curses persist across runs in ff_seenCurses (a JSON array of ids),
  // mirroring ff_seenEnemies. Loaded lazily into this._seenCurses on first use; a
  // curse is marked seen the moment it's applied (see applyNextCurse).
  loadSeenCurses() {
    if (this._seenCurses) return this._seenCurses;
    let ids = [];
    try {
      const raw = localStorage.getItem("ff_seenCurses");
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) ids = p; }
    } catch (e) { /* storage blocked — start empty */ }
    this._seenCurses = new Set(ids);
    return this._seenCurses;
  }

  hasSeenCurse(id) {
    return this.loadSeenCurses().has(id);
  }

  markCurseSeen(id) {
    const seen = this.loadSeenCurses();
    if (seen.has(id)) return;
    seen.add(id);
    try { localStorage.setItem("ff_seenCurses", JSON.stringify([...seen])); } catch (e) { /* ignore */ }
  }

  // Curse icons aren't in the boot preload, and the HUD's lazy loads don't survive
  // a page reload — so ensure they're loaded (once) when the archive opens, keyed
  // exactly as the HUD uses them (curse_icon_<id>).
  loadCurseIcons() {
    if (this._curseIconsLoaded) return;
    this._curseIconsLoaded = true;
    for (const id of CURSE_POOL) loadImage("curse_icon_" + id, "assets/sprites/curses/" + id + ".png");
  }

  openCurses(returnState) {
    this.loadSeenCurses();
    this.loadCurseIcons();
    this.cursesReturn = returnState || STATE.ARCHIVE;
    this.cursesIndex = 0;
    this.cursesScroll = 0;
    this.cursesFollowSel = true; // start pinned to the top entry
    this.cursesScrollDragging = false;
    this.state = STATE.CURSES;
  }

  closeCurses() {
    this.state = this.cursesReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
    else if (this.state === STATE.ARCHIVE) this.archiveIndex = 2; // land back on "Curses"
  }

  // --- Familiars catalog (Arcane Archive) --------------------------------
  // Full catalog: every familiar is shown (so players can see what's buyable),
  // data-driven from the FAMILIARS table. Sprites are already loaded by
  // familiar.js and ownership comes from ff_wardrobe — no extra load/persist.
  openFamiliarsArchive(returnState) {
    this.familiarsArchiveReturn = returnState || STATE.ARCHIVE;
    this.familiarsArchiveIndex = 0;
    this.familiarsArchiveScroll = 0;
    this.familiarsArchiveFollowSel = true; // start pinned to the top entry
    this.familiarsArchiveScrollDragging = false;
    this.state = STATE.FAMILIAR_ARCHIVE;
  }

  closeFamiliarsArchive() {
    this.state = this.familiarsArchiveReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 0;
    else if (this.state === STATE.ARCHIVE) this.archiveIndex = 3; // land back on "Familiars"
  }

  updateFamiliarsArchive() {
    const count = FAMILIAR_ORDER.length + 1; // entries + Back
    const backIndex = FAMILIAR_ORDER.length;

    // Scrollbar drag (mouse): grab the thumb to scrub, click the track to jump.
    let consumedClick = false;
    const sb = this.familiarsArchiveScrollbar;
    if (sb) {
      const mx = Input.mouseX(), my = Input.mouseY();
      const onBar = mx >= sb.x - 2 && mx <= sb.x + 18 && my >= sb.top && my <= sb.top + sb.viewH;
      if (Input.mouseClicked() && onBar) {
        const onThumb = my >= sb.thumbY && my <= sb.thumbY + sb.thumbH;
        this.familiarsArchiveDragOffset = onThumb ? my - sb.thumbY : sb.thumbH / 2;
        this.familiarsArchiveScrollDragging = true;
        this.familiarsArchiveFollowSel = false;
        consumedClick = true;
      }
      if (this.familiarsArchiveScrollDragging && Input.mouseHeld()) {
        const travel = sb.viewH - sb.thumbH;
        const frac = travel > 0 ? Math.max(0, Math.min(1, (my - this.familiarsArchiveDragOffset - sb.top) / travel)) : 0;
        this.familiarsArchiveScroll = frac * sb.maxScroll;
        this.familiarsArchiveFollowSel = false;
      }
    }
    if (!Input.mouseHeld()) this.familiarsArchiveScrollDragging = false;

    // Mouse wheel scrolls freely (drops follow-selection). Clamped to last max.
    const wheel = Input.wheelDelta();
    if (wheel !== 0) {
      this.familiarsArchiveScroll = Math.max(0, Math.min(this.familiarsArchiveMaxScroll || 0, this.familiarsArchiveScroll + wheel));
      this.familiarsArchiveFollowSel = false;
    }

    // Click a row (selecting it) or Back. Skipped if the click hit the scrollbar.
    const click = (!consumedClick && Input.mouseClicked()) ? this.zoneAt(this.menuZones) : -1;
    if (click >= 0) {
      if (click === backIndex) { this.closeFamiliarsArchive(); return; }
      this.familiarsArchiveIndex = click;
      this.familiarsArchiveFollowSel = true;
    }

    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.familiarsArchiveIndex = (this.familiarsArchiveIndex - 1 + count) % count;
      this.familiarsArchiveFollowSel = true;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.familiarsArchiveIndex = (this.familiarsArchiveIndex + 1) % count;
      this.familiarsArchiveFollowSel = true;
    }
    if (this.confirmPressed()) {
      if (this.familiarsArchiveIndex === backIndex) this.closeFamiliarsArchive(); // Back row
    } else if (this.backPressed()) {
      this.closeFamiliarsArchive();
    }
  }

  // --- Arcane Archive hub ---------------------------------------------------
  // A small hub holding the Grimoire + Bestiary + Curses. Each backs out to here;
  // the hub backs out to wherever it was opened from (main menu or pause).
  openArchive(returnState = STATE.MAIN_MENU) {
    this.archiveReturn = returnState;
    this.archiveIndex = 0;
    this.state = STATE.ARCHIVE;
  }

  // Back out of the hub to its opener (main menu re-highlights "Arcane Archive";
  // pause just resumes the pause menu).
  closeArchive() {
    this.state = this.archiveReturn || STATE.MAIN_MENU;
    if (this.state === STATE.MAIN_MENU) this.menuIndex = 2;
  }

  updateArchive() {
    const count = ARCHIVE_ITEMS.length; // Grimoire, Bestiary, Curses, Back
    const m = this.mouseMenu(this.menuZones);
    if (m.hover >= 0) this.archiveIndex = m.hover;
    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.archiveIndex = (this.archiveIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.archiveIndex = (this.archiveIndex + 1) % count;
    }
    if (m.clicked >= 0) this.archiveIndex = m.clicked;
    if (this.confirmPressed() || m.clicked >= 0) {
      if (this.archiveIndex === 0) this.openGrimoire(STATE.ARCHIVE);
      else if (this.archiveIndex === 1) this.openBestiary(STATE.ARCHIVE);
      else if (this.archiveIndex === 2) this.openCurses(STATE.ARCHIVE);
      else if (this.archiveIndex === 3) this.openFamiliarsArchive(STATE.ARCHIVE);
      else this.closeArchive(); // Back
    } else if (this.backPressed()) {
      this.closeArchive();
    }
  }

  updateBestiary() {
    const count = BESTIARY.length + 1; // entries + Back
    const backIndex = BESTIARY.length;

    // --- Scrollbar drag (mouse). Grab the thumb to scrub; click the track to
    // jump. Wins over entry-clicks within its band (consumedClick). ---
    let consumedClick = false;
    const sb = this.bestiaryScrollbar;
    if (sb) {
      const mx = Input.mouseX(), my = Input.mouseY();
      const onBar = mx >= sb.x - 2 && mx <= sb.x + 18 && my >= sb.top && my <= sb.top + sb.viewH;
      if (Input.mouseClicked() && onBar) {
        const onThumb = my >= sb.thumbY && my <= sb.thumbY + sb.thumbH;
        this.bestiaryDragOffset = onThumb ? my - sb.thumbY : sb.thumbH / 2;
        this.bestiaryScrollDragging = true;
        this.bestiaryFollowSel = false;
        consumedClick = true;
      }
      if (this.bestiaryScrollDragging && Input.mouseHeld()) {
        const travel = sb.viewH - sb.thumbH;
        const frac = travel > 0 ? Math.max(0, Math.min(1, (my - this.bestiaryDragOffset - sb.top) / travel)) : 0;
        this.bestiaryScroll = frac * sb.maxScroll;
        this.bestiaryFollowSel = false;
      }
    }
    if (!Input.mouseHeld()) this.bestiaryScrollDragging = false;

    // Mouse wheel scrolls freely (drops follow-selection). Clamped to last max.
    const wheel = Input.wheelDelta();
    if (wheel !== 0) {
      this.bestiaryScroll = Math.max(0, Math.min(this.bestiaryMaxScroll, this.bestiaryScroll + wheel));
      this.bestiaryFollowSel = false;
    }

    // Click a creature (expanding it) or Back, re-centring on it. Skipped if the
    // click hit the scrollbar. No hover-select (the open row expands inline).
    const click = (!consumedClick && Input.mouseClicked()) ? this.zoneAt(this.menuZones) : -1;
    if (click >= 0) {
      if (click === backIndex) { this.closeBestiary(); return; }
      this.bestiaryIndex = click;
      this.bestiaryFollowSel = true;
    }

    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.bestiaryIndex = (this.bestiaryIndex - 1 + count) % count;
      this.bestiaryFollowSel = true;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.bestiaryIndex = (this.bestiaryIndex + 1) % count;
      this.bestiaryFollowSel = true;
    }
    if (this.confirmPressed()) {
      if (this.bestiaryIndex === BESTIARY.length) this.closeBestiary(); // Back row
    } else if (this.backPressed()) {
      this.closeBestiary();
    }
  }

  updateCurses() {
    const count = CURSE_POOL.length + 1; // entries + Back
    const backIndex = CURSE_POOL.length;

    // Scrollbar drag (mouse): grab the thumb to scrub, click the track to jump.
    let consumedClick = false;
    const sb = this.cursesScrollbar;
    if (sb) {
      const mx = Input.mouseX(), my = Input.mouseY();
      const onBar = mx >= sb.x - 2 && mx <= sb.x + 18 && my >= sb.top && my <= sb.top + sb.viewH;
      if (Input.mouseClicked() && onBar) {
        const onThumb = my >= sb.thumbY && my <= sb.thumbY + sb.thumbH;
        this.cursesDragOffset = onThumb ? my - sb.thumbY : sb.thumbH / 2;
        this.cursesScrollDragging = true;
        this.cursesFollowSel = false;
        consumedClick = true;
      }
      if (this.cursesScrollDragging && Input.mouseHeld()) {
        const travel = sb.viewH - sb.thumbH;
        const frac = travel > 0 ? Math.max(0, Math.min(1, (my - this.cursesDragOffset - sb.top) / travel)) : 0;
        this.cursesScroll = frac * sb.maxScroll;
        this.cursesFollowSel = false;
      }
    }
    if (!Input.mouseHeld()) this.cursesScrollDragging = false;

    // Mouse wheel scrolls freely (drops follow-selection). Clamped to last max.
    const wheel = Input.wheelDelta();
    if (wheel !== 0) {
      this.cursesScroll = Math.max(0, Math.min(this.cursesMaxScroll, this.cursesScroll + wheel));
      this.cursesFollowSel = false;
    }

    // Click a row (selecting it) or Back. Skipped if the click hit the scrollbar.
    const click = (!consumedClick && Input.mouseClicked()) ? this.zoneAt(this.menuZones) : -1;
    if (click >= 0) {
      if (click === backIndex) { this.closeCurses(); return; }
      this.cursesIndex = click;
      this.cursesFollowSel = true;
    }

    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.cursesIndex = (this.cursesIndex - 1 + count) % count;
      this.cursesFollowSel = true;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.cursesIndex = (this.cursesIndex + 1) % count;
      this.cursesFollowSel = true;
    }
    if (this.confirmPressed()) {
      if (this.cursesIndex === CURSE_POOL.length) this.closeCurses(); // Back row
    } else if (this.backPressed()) {
      this.closeCurses();
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

    // --- Scrollbar drag (mouse). Grab the thumb to scrub; click the track to
    // jump. Wins over entry-clicks within its band (consumedClick). ---
    let consumedClick = false;
    const sb = this.grimoireScrollbar;
    if (sb) {
      const mx = Input.mouseX(), my = Input.mouseY();
      // Generous grab band, kept right of the entry rows so the two don't fight.
      const onBar = mx >= sb.x - 2 && mx <= sb.x + 18 && my >= sb.top && my <= sb.top + sb.viewH;
      if (Input.mouseClicked() && onBar) {
        // Grabbing the thumb keeps the grab point under the cursor; clicking the
        // bare track centres the thumb on the cursor instead.
        const onThumb = my >= sb.thumbY && my <= sb.thumbY + sb.thumbH;
        this.grimoireDragOffset = onThumb ? my - sb.thumbY : sb.thumbH / 2;
        this.grimoireScrollDragging = true;
        this.grimoireFollowSel = false;
        consumedClick = true;
      }
      if (this.grimoireScrollDragging && Input.mouseHeld()) {
        const travel = sb.viewH - sb.thumbH;
        const frac = travel > 0 ? Math.max(0, Math.min(1, (my - this.grimoireDragOffset - sb.top) / travel)) : 0;
        this.grimoireScroll = frac * sb.maxScroll;
        this.grimoireFollowSel = false;
      }
    }
    if (!Input.mouseHeld()) this.grimoireScrollDragging = false;

    // Mouse wheel scrolls freely (drops follow-selection). Clamped to last max.
    const wheel = Input.wheelDelta();
    if (wheel !== 0) {
      this.grimoireScroll = Math.max(0, Math.min(this.grimoireMaxScroll, this.grimoireScroll + wheel));
      this.grimoireFollowSel = false;
    }

    // Click an entry (which expands it) or Back, re-centring on it. Skipped if the
    // click landed on the scrollbar. No hover-select (the open row expands inline).
    const click = (!consumedClick && Input.mouseClicked()) ? this.zoneAt(this.menuZones) : -1;
    if (click >= 0) {
      if (click === backIndex) { this.closeGrimoire(); return; }
      this.grimoireIndex = click;
      this.grimoireFollowSel = true;
    }

    // Keyboard navigation moves the highlight and snaps the view to follow it.
    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.grimoireIndex = (this.grimoireIndex - 1 + count) % count;
      this.grimoireFollowSel = true;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.grimoireIndex = (this.grimoireIndex + 1) % count;
      this.grimoireFollowSel = true;
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

  // A familiar line that MAY recur within a run (no once-per-run dedup) — used for
  // arena theme shifts. Reuses the same dialogue bar/queue as the hint system.
  sayFamiliar(text) {
    if (!TUTORIAL_HINTS_ENABLED || !text) return;
    const line = { id: "_themeShift", text, timer: HINT_DURATION, sticky: false };
    if (this.activeHint) this.hintQueue.push(line);
    else { this.activeHint = line; playSfx("hint"); }
  }

  // Boss kill → queue the NEXT theme in the cycle (alternates with two; rotates with
  // more). Applied later at a wave boundary, never now — keeps the swap out of combat.
  queueNextTheme() {
    if (THEMES.length < 2) return;
    this.queuedThemeIndex = (this.themeIndex + 1) % THEMES.length;
  }

  // Apply a queued theme at the START of a new wave only. Called every play frame after
  // the wave manager updates; acts only when the wave number actually ticks over.
  applyQueuedThemeOnWaveChange() {
    const w = this.waveManager.wave;
    if (this._lastWaveSeen === undefined) this._lastWaveSeen = w;
    if (w === this._lastWaveSeen) return;
    this._lastWaveSeen = w;
    this.emberHealUsed = false; // re-arm the Emberheart emergency heal each new wave
    if (this.queuedThemeIndex == null) return;
    this.themeIndex = this.queuedThemeIndex;
    this.queuedThemeIndex = null;
    const theme = THEMES[this.themeIndex];
    if (theme && theme.arriveLine) this.sayFamiliar(theme.arriveLine); // skips themes with no line (e.g. stone)
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
    // Swap to a queued arena theme at the start of a new wave (visual only). No-op until
    // a boss falls and queues one; never fires mid-combat (acts on the wave tick).
    this.applyQueuedThemeOnWaveChange();
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
      if (this.enemies.some((e) => e.type === "pronggeist")) {
        this.markSeen("pronggeist");
        this.showEnemyHint("pronggeist"); // both modes, once per run
      }
      if (this.enemies.some((e) => e.type === "tin_bulwark")) {
        this.markSeen("tin_bulwark");
        this.showEnemyHint("tin_bulwark"); // both modes, once per run
      }
    }
    if (this.frenzyTimer <= 0 && this.frenzyCharge >= FRENZY_MOTES) this.showHint("spirit");

    // Move every enemy first (each homes on the witch independently)...
    for (const enemy of this.enemies) {
      enemy.update(dt, this.player, this.enemyBolts, this.hazards);
    }

    // ...then gently un-stack overlapping regular enemies so a swarm doesn't
    // collapse into a single sprite. Runs AFTER movement and BEFORE contact, so
    // the witch is hit at each enemy's resolved position. Bosses + stationary /
    // committed types are skipped inside separateEnemies (data-driven).
    separateEnemies(this.enemies);

    // ...then resolve body-contact damage at the post-separation positions.
    for (const enemy of this.enemies) {
      // Goblin Bonker deals NO body-contact damage at all — its radial stomp is
      // its only damage. The Hourkeeper (noContactDamage) is the same: only its
      // telegraphed hazards hurt, so standing close during its alarm phase for the
      // familiar to reach it never chips you. The `enemy.def &&` guard matters
      // because bosses are separate classes with no `def`, so reading `.bruiser`
      // on them would throw.
      if ((enemy.def && enemy.def.bruiser) || enemy.noContactDamage) continue;
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
    for (const p of this.hazardPuddles) p.update(dt, this.player);

    // Cursed Ground curse: telegraphed cursed patches keep blooming in a ring
    // around the witch, forcing her to keep moving. Reuses the Bone Mage's
    // HazardZone (violet "curse" look, telegraph -> one-time blast).
    if (this.activeCurses.includes("cursed_ground")) {
      this.cursedGroundTimer -= dt;
      if (this.cursedGroundTimer <= 0) {
        this.cursedGroundTimer = CG_INTERVAL;
        const a = Math.random() * Math.PI * 2;
        const d = randomRange(CG_MIN_DIST, CG_MAX_DIST);
        const m = TILE + CG_RADIUS;
        const gx = clamp(this.player.x + Math.cos(a) * d, m, WORLD_W - m);
        const gy = clamp(this.player.y + Math.sin(a) * d, m, WORLD_H - m);
        this.hazards.push(new HazardZone(gx, gy, CG_RADIUS, CG_TELEGRAPH, CG_DAMAGE));
      }
    }
    this.hazards = this.hazards.filter((h) => !h.dead);
    this.hazardPuddles = this.hazardPuddles.filter((p) => !p.dead);

    // Boss summons: release queued wisps ONE at a time (staggered) near the boss.
    const boss = this.waveManager.boss;
    if (boss && !boss.dead) {
      // Encounter tracking + boss-specific intro hint (both modes).
      if (boss.name === "Elder Wisp") { this.markSeen("elder_wisp"); this.showEnemyHint("elder_wisp"); }
      else if (boss.name === "The Watching Hand") { this.markSeen("watching_hand"); this.showEnemyHint("watching_hand"); }
      else if (boss.name === "Hive Warden") { this.markSeen("hive_warden"); this.showEnemyHint("hive_warden"); }
      else if (boss.name === "The Hourkeeper") { this.markSeen("hourkeeper"); this.showEnemyHint("hourkeeper"); }
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
        // Vengeful Dead curse: every slain non-boss enemy leaves a brief dark pool
        // where it fell. The cap keeps big clears (and Teeming, later) bounded —
        // oldest pool drops off. Bosses are exempt (their kill already pays out).
        if (!enemy.isBoss && curseValue(this.activeCurses, "deathPuddle", false)) {
          if (this.hazardPuddles.length >= VD_PUDDLE_MAX) this.hazardPuddles.shift();
          this.hazardPuddles.push(new HazardPuddle(enemy.x, enemy.y, VD_PUDDLE_RADIUS, VD_PUDDLE_DAMAGE, { life: VD_PUDDLE_LIFE, tickInterval: VD_PUDDLE_TICK }));
        }
        if (enemy.isBoss) {
          this.bossesDefeated += 1;
          this.pendingLevelUps += 1; // boss kill grants a free upgrade choice
          this.awardBossCrystal();   // + a Spirit Crystal (guaranteed first-ever, else endless chance)
          this.queueNextTheme();     // queue the next arena theme (applied at the next wave's start)
          if (this.gameMode === "cursed") this.applyNextCurse(); // the curse deepens with each boss
        }
        // Drops are placed on non-overlapping spots near the kill (see
        // findDropSpot), so a mote + flask from the same enemy don't stack.
        let spot = this.findDropSpot(enemy.x, enemy.y, 7);
        this.pickups.push(new Pickup(spot.x, spot.y));
        // Stronger enemies pay out more XP packs: ENEMY_TYPES.moteDrop (default 1
        // for wisps + any unset type; bosses have no .def, so they fall back to 1).
        // Extra motes reuse findDropSpot — which avoids the ones already placed — so
        // they fan out around the kill instead of stacking. `spot` is left untouched
        // (the flask/magnet drops below reassign it).
        const moteDrop = (enemy.def && enemy.def.moteDrop) || 1;
        for (let i = 1; i < moteDrop; i++) {
          const extra = this.findDropSpot(enemy.x, enemy.y, 7);
          this.pickups.push(new Pickup(extra.x, extra.y));
        }
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
            // no longer a bonus-mote roll, so it never doubles up XP. Trickster Luck
            // (Fox) adds a small flat bump on top — additive, never compounding.
            // Withering curse: flasks still fall but FAR more rarely (flaskChanceMult
            // < 1) — a steep reduction, not a hard zero, so a flask-reliant run isn't
            // hard-walled, while a Raven feather build keeps its own intended edge.
            const flaskMult = curseValue(this.activeCurses, "flaskChanceMult", 1);
            const flaskChance = (FLASK_DROP_CHANCE + this.luckLevel * LUCK_FLASK_STEP + this.familiarFlaskLuck) * flaskMult;
            if (Math.random() < flaskChance) {
              spot = this.findDropSpot(enemy.x, enemy.y, 9);
              this.flasks.push(new HealthFlask(spot.x, spot.y, FLASK_HEAL));
              if (this.isOnScreen(spot.x, spot.y)) this.showHint("flask"); // don't announce an offscreen flask
            }
          }

          // Rare Spirit Magnet — base chance by enemy type, plus a Lucky Paws bonus
          // and the Fox's Trickster Luck flat bump (additive). Crystals roll separately.
          const baseMagnet = enemy.isBoss ? SPIRIT_MAGNET_BOSS_CHANCE : SPIRIT_MAGNET_DROP_CHANCE;
          const magnetChance = baseMagnet + this.luckLevel * LUCK_MAGNET_STEP + this.familiarMagnetLuck;
          if (Math.random() < magnetChance) {
            spot = this.findDropSpot(enemy.x, enemy.y, 10);
            this.magnets.push(new SpiritMagnet(spot.x, spot.y));
          }
        }

        // Raven feathers — Grave Tax (guaranteed on a MARKED kill) takes priority over
        // the Scavenger's Gift passive roll, so an enemy drops at most one feather. Non-
        // bosses only, capped at FEATHER_MAX active. Deliberately OUTSIDE the rares block
        // (not tutorial-suppressed) and separate from the flask roll, so Withering — which
        // blocks flasks — does NOT block feathers. Crystals/motes/magnets are untouched.
        if (!enemy.isBoss && this.feathers.length < FEATHER_MAX) {
          const dropFeather =
            enemy.graveMarked ||
            (this.familiarScavengerChance > 0 && Math.random() < this.familiarScavengerChance);
          if (dropFeather) {
            const fs = this.findDropSpot(enemy.x, enemy.y, 8);
            this.feathers.push(new RavenFeather(fs.x, fs.y, FEATHER_HEAL, FEATHER_LIFE));
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

    // Collect Raven feathers (heal on walk-over). Same magnet/vacuum pull as flasks, but
    // a smaller heal and no flaskBonus — feathers are their own sustain channel.
    for (const feather of this.feathers) {
      feather.update(dt);
      this.applyMagnet(feather, dt);
      this.applyVacuum(feather, dt);
      if (circlesOverlap(feather.x, feather.y, feather.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        feather.dead = true;
        this.player.heal(feather.heal);
        playSfx("heal");
      }
    }
    this.feathers = this.feathers.filter((f) => !f.dead);

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

    // Emberheart Robe: once per wave, if HP dips below the trigger while still alive,
    // top her up to EMBER_HEAL_TO of max. Checked AFTER all damage + flask healing
    // this frame and BEFORE the death check, so a lethal hit still dies and a non-
    // lethal dip heals. The once-per-wave flag + the post-heal HP sitting above the
    // trigger both stop it re-firing; heal() clamps, so no overheal.
    if (!this.emberHealUsed && this.equippedBuff().emergencyHeal &&
        this.player.health > 0 && this.player.health < this.player.maxHealth * EMBER_TRIGGER) {
      this.player.heal(this.player.maxHealth * EMBER_HEAL_TO - this.player.health);
      this.emberHealUsed = true;
      playSfx("heal"); // reuse the flask heal cue
      if (!this.emberHintShown) { this.emberHintShown = true; this.sayFamiliar("Emberheart saved you!"); }
    }

    // Priority: death, then victory, then a level-up.
    if (this.player.health <= 0) {
      this.player.startDying();
      this.state = STATE.DYING;
      return;
    }
    // Victory only in Tutorial: defeating the Wave 10 boss ends the run.
    // In Endless, the WaveManager rolls straight into the next wave instead.
    if (this.gameMode === "tutorial" && boss && boss.dead) {
      this.markTutorialComplete(); // record completion + push stats (no-op off Kongregate)
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
    // Hover the card under the cursor (uses the previous frame's zones — a
    // one-frame lag, imperceptible). Drives the hover outline in the draw.
    this.offerHoverIndex = this.zoneAt(this.offerZones);

    let chosen = -1;
    if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter")) chosen = 0;
    else if (Input.wasPressed("Digit1") || Input.wasPressed("Numpad1")) chosen = 0;
    else if (Input.wasPressed("Digit2") || Input.wasPressed("Numpad2")) chosen = 1;
    else if (Input.wasPressed("Digit3") || Input.wasPressed("Numpad3")) chosen = 2;
    if (Input.mouseClicked() && this.offerHoverIndex >= 0) chosen = this.offerHoverIndex; // click a card

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

  // Magnet Charm: ease an item toward the witch when within attraction range. Night
  // Sense (Bat) adds a small flat bump here — additive on top of the innate magnet +
  // Magnet Charm, computed at use so it can never be overwritten by the upgrade.
  applyMagnet(item, dt) {
    const range = this.magnetRange + this.familiarMagnetBonus;
    if (range <= 0) return;
    const dx = this.player.x - item.x;
    const dy = this.player.y - item.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.001 && d < range) {
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

    // Charge the Spirit Imbued meter — now ALSO while one is active (B1): motes
    // collected mid-Imbued bank toward the next one (still capped at FRENZY_MOTES),
    // so it reloads while you're powered and you can re-trigger sooner. The
    // activation gate still blocks re-firing until the current timer ends, and you
    // can't bank past full, so uptime stays bounded by how many motes you grab.
    // Frenzy Focus raises how much each mote adds (this.frenzyPerMote).
    if (this.frenzyCharge < FRENZY_MOTES) {
      // Spirit Drought scales each mote's contribution (1 = unaffected); the XP above is untouched.
      // Star-Eyed Focus (Owl) multiplies the per-mote charge too — frenzy meter ONLY
      // (XP/score/crystals are separate lines). Stacks with Spirit Drought's mult, so
      // Owl + Drought = x0.5 x 1.05 = x0.525 (mitigates, never replaces the curse).
      this.frenzyCharge = Math.min(FRENZY_MOTES, this.frenzyCharge + this.frenzyPerMote * curseValue(this.activeCurses, "frenzyMoteMult", 1) * (this.familiarMoteMult || 1));
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

    // Hide the OS cursor during active play (the mouse is unused then — movement
    // is WASD/arrows); restore the themed sprite cursor everywhere else, including
    // the level-up overlay (clickable cards), pause, and the menus. "" reverts to
    // the #game-canvas CSS rule; "none" overrides it.
    ctx.canvas.style.cursor =
      (this.state === STATE.PLAYING || this.state === STATE.DYING) ? "none" : "";

    if (this.state === STATE.MAIN_MENU) {
      this.menuZones = drawMenu(ctx, this.width, this.height, "FAMILIAR FRENZY", MAIN_MENU_ITEMS, this.menuIndex,
        ["Enter: select"], { bg: true, title: true });
      drawCrystalTotal(ctx, this.width, this.height, this.wardrobe.crystals);
      return;
    }
    if (this.state === STATE.ARCHIVE) {
      this.menuZones = drawMenu(ctx, this.width, this.height, "Arcane Archive", ARCHIVE_ITEMS, this.archiveIndex,
        ["Enter select • Esc back"], { bg: true });
      return;
    }
    if (this.state === STATE.MODE_SELECT) {
      this.menuZones = drawMenu(ctx, this.width, this.height, "Choose Mode", MODE_SELECT_ITEMS, this.menuIndex,
        ["Enter select • Esc back"], { bg: true });
      return;
    }
    if (this.state === STATE.HOW_TO_PLAY) {
      this.menuZones = drawHowToPlay(ctx, this.width, this.height, this.howToPlayBackHover).zones;
      return;
    }
    if (this.state === STATE.CREDITS) {
      this.menuZones = drawCredits(ctx, this.width, this.height, this.creditsBackHover, getImage("cocolito_logo")).zones;
      return;
    }
    if (this.state === STATE.BESTIARY) {
      const entries = BESTIARY.map((b) => ({
        name: b.name, kind: b.kind, blurb: b.blurb, frames: b.frames,
        seen: this.hasSeen(b.id),
        img: getImage(b.spriteKey),
      }));
      const bz = drawBestiary(ctx, this.width, this.height, entries, this.bestiaryIndex, this.bestiaryScroll, this.bestiaryFollowSel);
      this.menuZones = bz.zones;
      this.bestiaryScroll = bz.scroll;
      this.bestiaryMaxScroll = bz.maxScroll;
      this.bestiaryScrollbar = bz.scrollbar;
      return;
    }

    if (this.state === STATE.CURSES) {
      const entries = CURSE_POOL.map((id) => {
        const c = CURSES[id];
        return { id, name: c.name, blurb: c.blurb, seen: this.hasSeenCurse(id), img: getImage("curse_icon_" + id) };
      });
      const cz = drawCurses(ctx, this.width, this.height, entries, this.cursesIndex, this.cursesScroll, this.cursesFollowSel);
      this.menuZones = cz.zones;
      this.cursesScroll = cz.scroll;
      this.cursesMaxScroll = cz.maxScroll;
      this.cursesScrollbar = cz.scrollbar;
      return;
    }

    if (this.state === STATE.FAMILIAR_ARCHIVE) {
      const entries = FAMILIAR_ORDER.map((id) => {
        const f = FAMILIARS[id];
        return {
          id, name: f.name, blurb: f.blurb,
          passive: f.passive, passiveDesc: f.passiveDesc,
          frenzyName: f.frenzyName, frenzyDesc: f.frenzyDesc,
          cost: f.cost,
          owned: this.wardrobe.familiarsOwned.includes(id),
          equipped: this.wardrobe.familiarEquipped === id,
          img: getImage(f.spritePrefix + "_idle_s"), // base aspect, south idle strip
          frames: 4, // FAMILIAR_ANIMS.idle (familiar.js)
        };
      });
      const fz = drawFamiliars(ctx, this.width, this.height, entries, this.familiarsArchiveIndex, this.familiarsArchiveScroll, this.familiarsArchiveFollowSel);
      this.menuZones = fz.zones;
      this.familiarsArchiveScroll = fz.scroll;
      this.familiarsArchiveMaxScroll = fz.maxScroll;
      this.familiarsArchiveScrollbar = fz.scrollbar;
      return;
    }

    if (this.state === STATE.CLOSET) {
      this.closetZones = drawCloset(ctx, this.width, this.height, this.closetData());
      return;
    }

    if (this.state === STATE.GRIMOIRE) {
      const levels = this.archiveReturn === STATE.PAUSED ? this.upgradeLevels : null;
      const { entries, upgradeCount } = this.grimoireList();
      const gz = drawGrimoire(ctx, this.width, this.height, entries, this.grimoireIndex, levels, upgradeCount, this.grimoireScroll, this.grimoireFollowSel);
      this.menuZones = gz.zones;
      this.grimoireScroll = gz.scroll;
      this.grimoireMaxScroll = gz.maxScroll;
      this.grimoireScrollbar = gz.scrollbar;
      return;
    }
    if (this.state === STATE.ENDLESS_PLACEHOLDER) {
      drawPlaceholder(ctx, this.width, this.height, "Casual Mode");
      return;
    }
    if (this.state === STATE.HIGHSCORES_PLACEHOLDER) {
      this.menuZones = drawHighScores(
        ctx, this.width, this.height,
        { endless: this.getHighScores("endless"), cursed: this.getHighScores("cursed") },
        this.highscoresTab, this.highscoresTabHover, this.highscoresBackHover
      ).zones;
      return;
    }
    if (this.state === STATE.SETTINGS_PLACEHOLDER) {
      this.settingsZones = drawSettings(ctx, this.width, this.height, getMusicVolume(), getSfxVolume(), getReducedFlash(), getHighVisWarnings(), this.settingsIndex);
      return;
    }
    if (this.state === STATE.CONFIRM_QUIT) {
      this.menuZones = drawConfirmQuit(ctx, this.width, this.height, CONFIRM_ITEMS, this.menuIndex);
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
    // The dark veil serves two masters: the tutorial intro shadow (this.shadowAlpha,
    // which fades once the tutorial begins) AND the Cursed "Darkness" curse (a
    // persistent gloom whose spotlight radius the curse itself defines). Draw
    // whichever is stronger; the curse path is independent of the tutorial fade.
    const darkVision = curseValue(this.activeCurses, "vision", 0); // 0 = no Darkness curse active
    const veilAlpha = Math.max(this.shadowAlpha, darkVision > 0 ? SHADOW_ALPHA : 0);
    if (veilAlpha > 0.01) {
      const px = this.player.x - cam.x;
      const py = this.player.y - cam.y;
      const radius = darkVision > 0 ? darkVision : SHADOW_RADIUS; // the curse drives its own spotlight size
      const g = ctx.createRadialGradient(px, py, radius * 0.45, px, py, radius);
      g.addColorStop(0, "rgba(8, 7, 18, 0)");
      g.addColorStop(1, `rgba(8, 7, 18, ${veilAlpha.toFixed(3)})`);
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
          const bossWave = this.waveManager.displayWaveIsBoss; // every 10th wave (normal) / 5th (Cursed), from the WaveManager's own rule
          drawWaveBanner(ctx, this.width, this.height, this.waveManager.displayWave, this.waveManager.timer, bossWave);
        }
        if (this.activeHint) {
          drawFamiliarHint(ctx, this.width, this.height, { text: this.activeHint.text, alpha: this.hintAlpha() });
        }
        break;

      case STATE.LEVEL_UP:
        drawHUD(ctx, this.width, this.height, this.hudState());
        // Reduced Flash dims the celebratory bloom + title pop (the base title is
        // always drawn at full size, so the upgrade screen stays readable).
        this.offerZones = drawUpgradeScreen(ctx, this.width, this.height, this.offers, (this.levelFlash / LEVEL_FLASH_TIME) * (getReducedFlash() ? 0.35 : 1), this.offerHoverIndex);
        break;

      case STATE.PAUSED:
        drawHUD(ctx, this.width, this.height, this.hudState());
        this.menuZones = drawPauseMenu(ctx, this.width, this.height, this.pauseInfo(), PAUSE_ITEMS, this.menuIndex);
        break;

      case STATE.DYING:
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.VICTORY:
        this.menuZones = drawVictory(ctx, this.width, this.height, this.runSummary(), VICTORY_ITEMS, this.menuIndex);
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
        this.menuZones = drawGameOver(ctx, this.width, this.height, this.gameOverSummary());
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
    for (const p of this.hazardPuddles) p.draw(ctx); // Vengeful Dead pools (ground layer, under actors)
    this.familiar.drawPuddles(ctx); // Alchemist puddles: ground layer, beneath pickups + enemies
    for (const pickup of this.pickups) pickup.draw(ctx);
    for (const flask of this.flasks) flask.draw(ctx);
    for (const feather of this.feathers) feather.draw(ctx);
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
    // The active arena theme picks the base tiles + prop sheet (visual only). Missing
    // themed art falls back to the stone sheet/props, so the game runs before art lands.
    const theme = THEMES[this.themeIndex] || THEMES[0];
    sheet = getImage(theme.tiles) || sheet;
    const props = getImage(theme.props) || getImage("floor_props");
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

        // ...then a seeded decoration on top. Two independent bands sharing one roll: a rare
        // bold object takes priority, otherwise a common subtle rune. (Drawn on a dark tile
        // background that matches the floor.)
        if (props) {
          const roll = tileRand(tx, ty, 1);
          if (roll < OBJECT_CHANCE) {
            const k = OBJECT_START + Math.floor(tileRand(tx, ty, 2) * OBJECT_COUNT); // bold objects
            const sx = (k % PROP_COLS) * TILE;
            const sy = Math.floor(k / PROP_COLS) * TILE;
            ctx.drawImage(props, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
          } else if (roll < OBJECT_CHANCE + RUNE_CHANCE) {
            const k = Math.floor(tileRand(tx, ty, 3) * RUNE_COUNT); // subtle runes
            const sx = (k % PROP_COLS) * TILE;
            const sy = Math.floor(k / PROP_COLS) * TILE;
            ctx.drawImage(props, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
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

  // Cursed personal bests — mirrors updateEndlessBests for the Cursed board so the
  // Kongregate BestCursed* stats have an accurate, score-independent source. (The
  // top-10 list only keeps the best SCORES, which would undercount a high-wave run,
  // and isn't written until the initials step.) No beat-best celebration flags —
  // Cursed doesn't display them. Runs on every Cursed death; storage-safe.
  updateCursedBests() {
    try {
      const wave = this.waveManager.wave;
      const bw = parseInt(localStorage.getItem("ff_bestCursedWave") || "0", 10);
      const bs = parseInt(localStorage.getItem("ff_bestCursedScore") || "0", 10);
      if (wave > bw) localStorage.setItem("ff_bestCursedWave", String(wave));
      if (this.score > bs) localStorage.setItem("ff_bestCursedScore", String(this.score));
    } catch (e) {
      /* localStorage unavailable — skip persistent Cursed bests */
    }
  }

  // Track the highest witch level ever reached, ANY mode (tutorial included), for the
  // HighestWitchLevel stat. Called at every run end. Storage-safe.
  recordBestLevel() {
    try {
      const bl = parseInt(localStorage.getItem("ff_bestLevel") || "0", 10);
      if (this.level > bl) localStorage.setItem("ff_bestLevel", String(this.level));
    } catch (e) {
      /* localStorage unavailable — skip */
    }
  }

  // Mark the tutorial as completed (TutorialComplete stat = 1) and push the stat set.
  // Called once, when the Wave 10 tutorial boss dies. Storage-safe.
  markTutorialComplete() {
    try { localStorage.setItem("ff_tutorialDone", "1"); } catch (e) { /* storage blocked */ }
    this.recordBestLevel();
    this.pushKongregateStats();
  }

  // Submit the full Kongregate stat set from the persisted bests. Every value is a
  // Max stat, so re-submitting the current bests is idempotent — exactly what the
  // "resubmit ALL stats on every load" rule wants. submitStat clamps to a non-negative
  // integer and no-ops (or queues until the API is ready) off-Kongregate, so this is
  // safe to call anywhere: at boot (resubmit-on-load) and after every run end.
  // ("Loaded" is sent once at boot in main.js.)
  pushKongregateStats() {
    const n = (k) => parseInt(localStorage.getItem(k) || "0", 10) || 0;
    try {
      submitStat("BestCasualScore", n("ff_bestEndlessScore"));
      submitStat("BestCasualWave", n("ff_bestEndlessWave"));
      submitStat("BestCursedScore", n("ff_bestCursedScore"));
      submitStat("BestCursedWave", n("ff_bestCursedWave"));
      submitStat("TutorialComplete", n("ff_tutorialDone"));
      submitStat("HighestWitchLevel", n("ff_bestLevel"));
    } catch (e) {
      /* localStorage read failed — skip this push (bridge calls are already guarded) */
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

  // localStorage key for a mode's leaderboard. Endless and Cursed keep separate
  // boards; tutorial never records (it never reaches the save path).
  highScoreKey(mode = this.gameMode) {
    return mode === "cursed" ? "ff_cursedHighscores" : "ff_highscores";
  }

  // Write this run into the current mode's top-10 leaderboard under `name` (the
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
      localStorage.setItem(this.highScoreKey(), JSON.stringify(scores.slice(0, 10)));
    } catch (e) {
      /* localStorage unavailable — skip the leaderboard write */
    }
  }

  // Read a mode's leaderboard (defaults to the current mode), failing safely to an
  // empty list if the stored value is missing or corrupt. Sorted best-first.
  getHighScores(mode = this.gameMode) {
    try {
      const raw = localStorage.getItem(this.highScoreKey(mode));
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
    const def = { crystals: 0, owned: ["default"], equipped: "default", collarsOwned: ["default"], collarEquipped: "default", familiarsOwned: ["default"], familiarEquipped: "default", firstBossClaimed: false };
    try {
      const raw = localStorage.getItem("ff_wardrobe");
      if (!raw) return def;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return def;
      return {
        crystals: Number.isFinite(p.crystals) ? Math.max(0, Math.floor(p.crystals)) : 0,
        owned: Array.isArray(p.owned) && p.owned.includes("default") ? p.owned : ["default"],
        equipped: typeof p.equipped === "string" ? p.equipped : "default",
        collarsOwned: Array.isArray(p.collarsOwned) && p.collarsOwned.includes("default") ? p.collarsOwned : ["default"],
        collarEquipped: typeof p.collarEquipped === "string" ? p.collarEquipped : "default",
        // New in the Familiars pass — old saves lack these, so default to Cat
        // owned + equipped without touching crystals/outfits/collars.
        familiarsOwned: Array.isArray(p.familiarsOwned) && p.familiarsOwned.includes("default") ? p.familiarsOwned : ["default"],
        familiarEquipped: typeof p.familiarEquipped === "string" ? p.familiarEquipped : "default",
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
    } else if (this.gameMode === "endless" || this.gameMode === "cursed") {
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
    const o = OUTFITS[this.activeOutfit] || OUTFITS.default;
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
  openCloset(pendingMode = null) {
    this.pendingRunMode = pendingMode; // null = normal shop; "endless"/"cursed" = pre-run loadout
    this.closetIndex = 0;
    this.closetTab = 0;
    this.state = STATE.CLOSET;
  }

  // Active tab's order/table/owned-array/equipped-key in one place.
  closetTabRefs() {
    // Tab order: 0 = Outfits, 1 = Familiars, 2 = Collars.
    if (this.closetTab === 0) return { order: OUTFIT_ORDER, table: OUTFITS, owned: this.wardrobe.owned, equippedKey: "equipped" };
    if (this.closetTab === 1) return { order: FAMILIAR_ORDER, table: FAMILIARS, owned: this.wardrobe.familiarsOwned, equippedKey: "familiarEquipped" };
    return { order: COLLAR_ORDER, table: COLLARS, owned: this.wardrobe.collarsOwned, equippedKey: "collarEquipped" };
  }

  updateCloset() {
    const { order } = this.closetTabRefs();
    const hasStart = !!this.pendingRunMode;          // pre-run loadout shows a Start button
    // Bottom buttons match drawCloset: Back is always index order.length; in pre-run a
    // prominent Start follows it at order.length + 1.
    const backIndex = order.length;
    const startIndex = hasStart ? order.length + 1 : -1;
    const count = order.length + (hasStart ? 2 : 1); // rows + Back (+ Start)
    // Act on a row/button like Enter: Start launches the pending run, Back exits (context-
    // aware), any item runs the buy/equip path.
    const activate = (idx) => {
      if (idx === startIndex) { const m = this.pendingRunMode; this.pendingRunMode = null; this.startGame(m); }
      else if (idx === backIndex) this.exitCloset();
      else this.closetSelect();
    };

    // --- Mouse (additive; drives the SAME selection + actions as the keys) ---
    const z = this.closetZones;
    if (z) {
      // Hover highlights the row/Back under the cursor, but only when the mouse
      // moved, so a resting pointer never fights the keyboard.
      if (Input.mouseMoved()) {
        const hov = this.zoneAt(z.zones);
        if (hov >= 0) this.closetIndex = hov;
      }
      if (Input.mouseClicked()) {
        // A tab click SELECTS that tab (keyboard Left/Right toggles instead);
        // clicking the active tab is a no-op so the row cursor isn't reset.
        const mx = Input.mouseX(), my = Input.mouseY();
        let onTab = -1;
        for (const t of z.tabs) {
          if (mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h) { onTab = t.tab; break; }
        }
        if (onTab >= 0) {
          if (onTab !== this.closetTab) { this.closetTab = onTab; this.closetIndex = 0; }
          return;
        }
        // Otherwise a row/button click: select it, then act exactly like Enter.
        const hit = this.zoneAt(z.zones);
        if (hit >= 0) { this.closetIndex = hit; activate(hit); return; }
      }
    }

    // --- Keyboard (primary; unchanged) ---
    // Left/Right cycle the three tabs (Outfits | Familiars | Collars), resetting
    // the row cursor. Left goes back, Right goes forward, both wrap.
    if (Input.wasPressed("ArrowLeft") || Input.wasPressed("KeyA")) {
      this.closetTab = (this.closetTab + 2) % 3;
      this.closetIndex = 0;
      return;
    }
    if (Input.wasPressed("ArrowRight") || Input.wasPressed("KeyD")) {
      this.closetTab = (this.closetTab + 1) % 3;
      this.closetIndex = 0;
      return;
    }
    if (Input.wasPressed("ArrowUp") || Input.wasPressed("KeyW")) {
      this.closetIndex = (this.closetIndex - 1 + count) % count;
    }
    if (Input.wasPressed("ArrowDown") || Input.wasPressed("KeyS")) {
      this.closetIndex = (this.closetIndex + 1) % count;
    }
    if (this.confirmPressed()) {
      activate(this.closetIndex);
    } else if (this.backPressed()) {
      this.exitCloset(); // Esc/Backspace: pre-run → Mode Select, normal shop → Main Menu
    }
  }

  // Leave the Wardrobe. Pre-run loadout returns to Mode Select (cursor on the chosen
  // mode); the normal shop returns to the Main Menu. Always clears the pending mode so a
  // stale Start button can never appear the next time the menu Wardrobe is opened.
  exitCloset() {
    if (this.pendingRunMode) {
      this.menuIndex = this.pendingRunMode === "cursed" ? 2 : 1; // Cursed / Casual row
      this.pendingRunMode = null;
      this.state = STATE.MODE_SELECT;
    } else {
      this.state = STATE.MAIN_MENU;
      this.menuIndex = 0;
    }
  }

  // Enter on a row: equip it if owned, else buy it (auto-equipping) if
  // affordable. Works for either tab. Persists immediately; SFX graceful-silent.
  closetSelect() {
    const { order, table, owned, equippedKey } = this.closetTabRefs();
    const id = order[this.closetIndex];
    const item = table[id];
    if (!item) return;
    if (owned.includes(id)) {
      if (this.wardrobe[equippedKey] !== id) {
        this.wardrobe[equippedKey] = id;
        this.saveWardrobe();
        playSfx("equip");
      }
    } else if (this.wardrobe.crystals >= item.cost) {
      this.wardrobe.crystals -= item.cost;
      owned.push(id); // mutates the wardrobe array (owned/collarsOwned) in place
      this.wardrobe[equippedKey] = id; // auto-equip on purchase
      this.saveWardrobe();
      playSfx("purchase");
    } else {
      playSfx("denied"); // can't afford
    }
  }

  // View-model for the Closet renderer (both tabs + which is active).
  closetData() {
    const rows = (order, table, owned, equippedId, spriteKeyFn) => order.map((id) => {
      const o = table[id];
      return {
        id, name: o.name, cost: o.cost, desc: o.desc, swatch: o.swatch,
        spriteKey: spriteKeyFn ? spriteKeyFn(id, o) : `${o.spritePrefix}_idle_s`, // portrait frame 0
        owned: owned.includes(id),
        equipped: equippedId === id,
        affordable: this.wardrobe.crystals >= o.cost,
      };
    });
    // The Collars tab previews the EQUIPPED familiar wearing each collar (its
    // recolor) so the preview matches what you'll see in-game — base prefix for the
    // Spirit/default collar, <base>_<collarId> for the others (same rule as run start).
    const famBase = (FAMILIARS[this.wardrobe.familiarEquipped] || FAMILIARS.default).spritePrefix;
    const collarSpriteKey = (id) => `${famBase}${id === "default" ? "" : "_" + id}_idle_s`;
    return {
      crystals: this.wardrobe.crystals,
      tab: this.closetTab,
      index: this.closetIndex,
      pendingRun: this.pendingRunMode, // null = shop; "endless"/"cursed" = pre-run (Start button + mode title)
      loadout: {                       // equipped names for the pre-run loadout summary line
        outfit: (OUTFITS[this.wardrobe.equipped] || OUTFITS.default).name,
        familiar: (FAMILIARS[this.wardrobe.familiarEquipped] || FAMILIARS.default).name,
        collar: (COLLARS[this.wardrobe.collarEquipped] || COLLARS.default).name,
      },
      outfits: rows(OUTFIT_ORDER, OUTFITS, this.wardrobe.owned, this.wardrobe.equipped),
      familiars: rows(FAMILIAR_ORDER, FAMILIARS, this.wardrobe.familiarsOwned, this.wardrobe.familiarEquipped),
      collars: rows(COLLAR_ORDER, COLLARS, this.wardrobe.collarsOwned, this.wardrobe.collarEquipped, collarSpriteKey),
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
      mode: this.gameMode === "endless" ? "Casual" : this.gameMode === "cursed" ? "Cursed" : "Tutorial",
      wave: this.waveManager.displayWave,
      level: this.level,
      score: this.score,
      health: Math.ceil(this.player.health),
      maxHealth: this.player.maxHealth,
      frenzy,
      upgrades,
      evolution: [this.phantomPounceUnlocked && "Phantom Pounce", this.spiritBondUnlocked && "Spirit Bond", this.spiritVolleyUnlocked && "Spirit Volley"]
        .filter(Boolean).join(" + ") || "None",
      curses: this.activeCurses.map((id) => ({ id, name: CURSES[id].name })),
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
      curses: this.activeCurses.map((id) => ({ id, name: CURSES[id].name })),
    };
  }
}