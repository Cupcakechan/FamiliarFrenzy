# Familiar Frenzy — Project Handoff

Last updated: **2026-06-16** — merged the **1.6.0** bundle in (the Hive Warden boss
+ the two-band floor-decoration system).
Covers all post-launch work through the **1.6.0** release.
**1.2.0–1.5.0 are all SHIPPED/LIVE.** **1.6.0 ("The Hive Warden") was built + tested
this session and is being packaged/published (`package_itch.bat 1.6.0` + an itch
devlog post); treat it as shipped unless Daniel says otherwise.**

> Versioning note: the Spirit Crystals / Wardrobe / Collars bundle shipped as
> **1.5.0**, not 1.4.0. 1.4.0 was the prior asset-completion release (Spirit
> Volley + Bone Mage + Goblin + Bestiary/Grimoire redesign + audio split).

---

## 1. Purpose of This Document

Living source of truth for continuing **Familiar Frenzy**, Daniel's browser-based
top-down survival arena game, originally built for **AI Browser Game Jam 3** and
now in post-launch update development. Read fully before suggesting or changing
anything. Update it at the end of any session that completes work.

---

## 2. Ground Rules for Working With Daniel

* Tech stack: **plain HTML / CSS / JS + HTML5 Canvas, ES modules. No frameworks,
  no npm, no TypeScript, no build tools.** Runs locally via VS Code **Live
  Server**. **Python is NOT available** — never suggest Python commands.
* Repo access in the Claude project context is **review-only** and may reflect the
  last push, not the working copy. The `assets/` folder may be excluded from sync.
  **When exact file contents matter, ask Daniel to upload the current files** first.
* Deliver **entire updated files** via the file tool (no diffs/snippets as the main
  delivery), built from Daniel's current uploaded versions.
* Every changed JS file must pass `node --check`. Confirm in the delivery.
* **Never clobber Daniel's local tuning.** `spriteScale` is VISUAL ONLY; `radius`
  is the gameplay hitbox — never conflate them. Known tuned values to preserve:
  * `enemies.js` (Daniel's LOCAL file — do NOT deliver it unless asked):
    `DEBUG_FORCE_BOSS = false`; `DEBUG_BOSS_TYPE = "auto"`; Elder Wisp boss
    `spriteScale = 1.0`, `BOSS_DASH_CONTACT_RADIUS = 22` (tight contact only while
    dashing, via a `contactRadius` getter); Gutter Gecko `spriteScale = 0.6`;
    `GOBLIN_LUNGE_TIME = 0.18`. **Goblin Bonker is a LEAP & STOMP enemy**
    (reworked from the old rect club swing): it chases, leaps, then drops a radial
    **stomp HazardZone** (`skin:"stomp"`, green) which is its ONLY damage — all
    body-contact damage is suppressed (see §3). Goblin `windup` is Daniel-tuned to
    **0.55**; `approachRange`/`lunge` are also locally tuned. `spriteScale = 0.9`.
    **Hive Warden boss (1.6.0):** `spriteScale = 1.0` (a GUESS — tune to the native
    `bee_fly` art size); `BEE_CONE_CHANCE = 0.35` (the cone volley is the kitable
    MINORITY ~35%; the radial burst is the main threat ~65% and MAY repeat — the
    `pickAttack` guard prevents two CONES in a row, not two bursts); `STINGER_OPTS`
    draw `scale = 1.1` (bigger stingers; the hitbox stays the shared `EnemyBolt`
    radius 5 — visual is intentionally a touch forgiving).
  * `audio.js`: `POOL_COUNT = 9` (NEVER lower — §8); `MENU_POOL_COUNT = 3`
    (menu pool = themes 01-03, gameplay = 04-09); `DEFAULT_VOLUME = 60`;
    `DEFAULT_SFX_VOLUME = 50`.
  * `game.js`: `FLASK_HEAL = 15`; `LEVEL_FLASH_TIME = 0.55`; innate magnet
    `BASE_MAGNET_RANGE` (40); `SCORE_PER_PICKUP = 10`. Goblin body-contact guard in
    the contact loop is **boss-safe**: `if (enemy.def && enemy.def.bruiser) continue;`
    (bosses are separate classes with NO `.def` — the `enemy.def &&` prefix prevents
    a boss-wave crash; do not drop it). **Floor-decoration bands (1.6.0):**
    `RUNE_CHANCE = 0.07` / `RUNE_COUNT = 20` (subtle runes, sheet cells 0-19);
    `OBJECT_CHANCE = 0.012` / `OBJECT_START = 20` / `OBJECT_COUNT = 12` (rare bold
    objects, cells 20-31). These two independent seeded bands REPLACED the old single
    `PROP_VARIANT_CHANCE`/`PROP_CIRCLE_CHANCE` pool (see §3/§5).
  * `pickups.js`: `FLASK_SPAWN_FLASH_TIME = 2.0`.
  * `familiar.js`: `RUNE_COUNT 14`, `RUNE_SCALE 0.5`, `spriteScale 0.55`;
    Spirit Volley `SIDE_DAMAGE_SCALE 0.5`, `SPREAD_ANGLE 0.26`. **Collar constants
    (1.5.0):** Moon Beam — `MOONBEAM_LENGTH 210`, `MOONBEAM_WIDTH 14`,
    `MOONBEAM_PIERCE_WIDTH 4`, `MOONBEAM_LIFE 0.15`, `MOONBEAM_SIDE_WIDTH 0.7`;
    Alchemist — `FLASK_SHOT_SPEED 420`, `FLASK_THROW_SCALE 0.7`, `PUDDLE_RADIUS 44`,
    `PUDDLE_PIERCE_RADIUS 3`, `PUDDLE_DURATION 3.0`, `PUDDLE_TICK_INTERVAL 0.5`,
    `PUDDLE_TICK_SCALE 0.5`, `PUDDLE_MAX 3`, `PUDDLE_FADE 0.6`, `PUDDLE_FLASH 0.9`
    (DoT white-flash duration — >tick interval, so enemies stay lit white in acid).
  * `ui.js`: `TITLE_OFFSET_X` (optical centering of the title banner).
* Daniel often applies small one-line tweaks himself between turns (text, single
  constants, banner gate). **Sync those into the working copy before building on a
  file**, and ask if unsure whether he's edited it since the last delivery.
* Options/plan before non-trivial coding; wait for the go-ahead. Single-value
  tweaks are often best handed back as "change line N to X."
* For sizable feature/system decisions, present 2-3 options (pros/cons + a
  recommendation) and wait for Daniel's pick before coding.
* After completed work provide, in order: files changed; what changed; test steps;
  known risks; `node --check` confirmation; a ready-to-paste **itch.io devlog** entry
  (player-facing, **with emojis** — see §11; there is NO DEVLOG.md file); a
  ready-to-paste **AI_USAGE.md** row;
  the git checkpoint block (NO `cd` lines). **Daniel tests first and decides when to
  commit — never commit for him.**

```bash
git add .
git commit -m "Describe completed tested feature"
git push
```

---

## 3. Game Summary & Current Feature Set

Player controls a young witch (move/collect only); her ghost cat **familiar**
auto-attacks. EXP motes → level-ups → upgrades; **a boss every 10 waves**, picked
from a shuffled-bag roster (no back-to-back repeats). Tutorial mode ends after
Wave 10 (Victory, can carry into Endless); Endless runs until death with per-tier
scaling, personal bests, a run recap, and a top-10 leaderboard. Bosses now drop
**Spirit Crystals**, a between-runs currency spent in the **Wardrobe**.

Implemented and tested:

* **Menus/screens:** Main Menu (**Play / Wardrobe / Arcane Archive / High Scores /
  Settings**; background + title-banner art; a small Spirit-Crystal readout sits
  top-right via `drawCrystalTotal`), Mode Select (Tutorial Mode / Endless Mode /
  How to Play / Back), How to Play, **Arcane Archive** (hub → Grimoire / Bestiary /
  Back), **Grimoire** (flat scrolling glossary, detail on-SELECT, Upgrades/Evolutions
  headers), **Bestiary** (scrolling accordion, animated portrait, silhouettes for
  unseen), **Wardrobe** (Outfits/Collars tabs — buy/equip with crystals), Settings
  (music + SFX sliders), High Scores, Pause, Confirm-Quit, Victory, Game Over,
  Name Entry.
* **World/combat:** 2400x1344 world, player-following camera, tiled dungeon arena
  + wall collision; wave system; boss kill grants a free upgrade. **Floor decoration
  (1.6.0)** scatters two independent seeded bands across the stone — common subtle
  **runes** + rare bold **objects** (bones, skulls, mushrooms, candles, moss…); §5.
* **Spirit Crystals (meta currency, 1.5.0):** earned from bosses and persisted in
  `ff_wardrobe`. The first-ever boss kill grants a guaranteed crystal (+ a familiar
  tip); subsequent **Endless** bosses have a scaling chance
  (`clamp(0.40 + (tier-1)*0.10 + luck*0.04, 0, 0.85)`); tutorial bosses after the
  first grant nothing (not farmable). `crystalsThisRun` is shown on the Game Over /
  Victory summary. `drawCrystalIcon` (uses `spirit_crystal.png`, code gem fallback).
* **Wardrobe (1.5.0):** between-runs shop. **Internally still `closet*`** (display
  name decoupled — see §9). Two tabs:
  * **Outfits** — recolor the witch + a small passive buff (applied at run start via
    `equippedBuff()` with fractional carries `_scoreCarry`/`_xpCarry`): Apprentice
    Robe (0◆, no buff), Emberheart Robe (3◆, flask heal +5), Sage's Weave (3◆, EXP
    ×1.05), Gilded Mantle (8◆, score ×1.05). Witch skin via `player.spritePrefix`.
  * **Collars** — swap the familiar's whole attack (see Familiar below): Spirit
    Collar (0◆, rune), Moon Beam Collar (10◆), Alchemist Collar (12◆).
* **Bosses (shuffled-bag `BOSS_TYPES` = elder_wisp, watching_hand, hive_warden):**
  * **Elder Wisp** — wobble-follow, telegraphed dash (charge wind-up, **tightened
    contact radius 22 while dashing**), staggered wisp summons. `spriteScale = 1.0`.
  * **The Watching Hand** — hops; locked-marker jump slam (`hand_slam` SFX);
    gecko-summon phases at 75/50/25% HP; north slam.
  * **The Hive Warden (1.6.0)** — projectile-pattern boss (the `HiveWarden` class).
    Hovers 240–340px, then a **hover → charge → release → recover** loop; it LOCKS
    the aim + pattern at charge start (no release tracking = fair). Two stinger
    patterns: a **Cone Volley** (5 bolts, kitable — the minority) and a **Spread
    Burst** (8-bolt even radial ring — the main threat). Telegraph: a growing charge
    aura + aim guide + a `bee_charge` grunt; fires with a `bee_sting` shot. Stingers
    are `EnemyBolt`s with sprite opts (`bee_stinger`, velocity-oriented). Does **NOT**
    summon — it carries a `consumeSummon(){ return false; }` no-op stub that ALL
    three bosses now implement (game.js calls it unguarded). `spriteScale = 1.0`.
  * New bosses go in `BOSS_TYPES`. Bosses are SEPARATE classes (no `.def`) and must
    implement `consumeSummon()`.
* **Player:** 8-dir idle/walk/die sprites, i-frames, death animation,
  `applyKnockback`; `spritePrefix` outfit recolor (fallback to base witch → purple).
* **Familiar:** 8-dir idle/attack sprites, ghost imprints, projectile SFX.
  `attackStyle` ("rune"/"moonbeam"/"alchemist") + `spritePrefix` (collar skin) set
  at run start from the equipped collar. Owns + updates its own attack objects vs
  the enemy list:
  * **rune** (default) — `Bolt` pool; pierce passes through; **Spirit Volley** =
    3-bolt cone.
  * **moonbeam** — `Beam`: a brief capsule line that hits each overlapping enemy
    ONCE (no pierce). Spread → +2 thinner beams at next-nearest distinct targets;
    pierce → +beam width.
  * **alchemist** — `FlaskShot` lobs to a point, then spawns a `Puddle` (enemy-only
    DoT, capped at `PUDDLE_MAX`). Spread → +1 flask at a second target; pierce →
    +puddle radius. Each DoT tick extends the enemy's white hit-flash (`PUDDLE_FLASH`)
    so the corrosion reads clearly. Puddles draw on the GROUND layer via
    `familiar.drawPuddles(ctx)` (see §4 draw order), beams/flasks in `familiar.draw`.
* **Enemies (data-driven `ENEMY_TYPES`; each carries `ambientSfx`):**
  * **Wisp** — melee chaser. **Gutter Gecko** — ranged skirmisher (`spriteScale 0.6`).
  * **Bone Mage** — stationary zoning caster; curses the GROUND (HazardZone).
    `spriteScale 0.8`.
  * **Goblin Bonker** — **leap & stomp** disruptor (reworked 1.5.0): chases, leaps
    (`GOBLIN_LUNGE_TIME`), then drops a radial **stomp HazardZone** (green) which is
    its ONLY damage. **No body-contact damage** (suppressed via the boss-safe bruiser
    guard in game.js). Knockback on stomp. `windup 0.55` (Daniel-tuned). `spriteScale 0.9`.
* **HazardZone (reusable telegraph → blast, in enemies.js):** circle + rotated-rect,
  optional knockback, i-frame-safe, code-drawn fallback. Damages the **player**.
  Owned by `game.this.hazards`. (The Alchemist `Puddle` is a SEPARATE familiar-owned
  class that damages ENEMIES — it only borrows the circle look; do not merge them.)
* **Pickups:** EXP motes, health flasks (heal 15, 2s green spawn flash), rare Spirit
  Magnet (vacuum). Innate 40px magnet.
* **Upgrades (data-driven):** capped pool + 32x32 icons + Grimoire. **Three
  evolutions:** Phantom Pounce, Spirit Bond, Spirit Volley (§7). Pierce + spread
  reinterpret per equipped collar (§7).
* **Spirit Imbued** mode (internals `frenzy*`) + Spirit Link ribbon; ready cues.
* **HUD:** XP strip; HP + Spirit bars; Score + Lv; familiar dialogue bar; off-screen
  indicators. Enemy-intro banners fire FIRST-TIME-EVER (`ff_enemyIntros`).
* **Audio:** dual-deck music (split menu/gameplay pools + boss); data-driven SFX (§8).
* Asset-fallback safety everywhere: missing art/sound → placeholder/silence, never a crash.

---

## 4. Architecture / File Map

```txt
familiar-frenzy/
  index.html   style.css
  package_itch.bat            # packaging + butler auto-publish (§10) — not shipped
  ITCH_RELEASE_CHECKLIST.md   # release steps (§10) — not shipped in the zip
  # NOTE: no DEVLOG.md — release notes are posted directly to the itch.io devlog (§11)
  src/
    main.js      # entry, canvas, dt loop, font preload, initAudio
    game.js      # state machine, world/camera, drops/collection, high scores,
                 #   tutorial script + hints, hazards, isOnScreen, level-up flash,
                 #   Spirit Bond damage, SFX triggers + ambient scheduler, music sync;
                 #   OUTFITS + COLLARS tables, ff_wardrobe persistence (Spirit
                 #   Crystals), awardBossCrystal, equippedBuff, Wardrobe (closet*)
                 #   + Arcane Archive nav, drawWorld order; floor-decoration bands
                 #   (RUNE_*/OBJECT_*) in drawTiledArena's seeded prop scatter
    input.js     # keyboard (held + one-frame presses)
    player.js    # witch (+ applyKnockback) + spritePrefix outfit recolor
    familiar.js  # ghost cat + attack styles: Bolt (rune, +Spirit Volley spread),
                 #   Beam (Moon Beam), FlaskShot + Puddle (Alchemist DoT); collar
                 #   skin via spritePrefix; drawPuddles (ground layer); pointSegDist
    enemies.js   # ENEMY_TYPES, Enemy (wisp/gecko/bone_mage/goblin leap-stomp),
                 #   EnemyBolt (+ optional sprite opts), HazardZone, Boss /
                 #   WatchingHand / HiveWarden, WaveManager, BOSS_TYPES (3 bosses);
                 #   DEBUG_FORCE_BOSS + DEBUG_BOSS_TYPE here  (Daniel's LOCAL file)
    pickups.js   # motes, flasks (+ spawn flash), Spirit Magnet
    upgrades.js  # UPGRADES + EVOLUTIONS (Phantom Pounce, Spirit Bond, Spirit Volley)
                 #   + Grimoire entries
    ui.js        # all screens/HUD; drawGrimoire, drawBestiary, drawUpgradeScreen,
                 #   drawCloset (Wardrobe: Outfits/Collars tabs), drawCrystalTotal
                 #   (main-menu corner readout), drawCrystalIcon, drawSkinnedBar, etc.
                 #   Arcane Archive reuses drawMenu (no dedicated screen fn)
    assets.js    # loadImage/getImage with graceful fallback
    utils.js     # math helpers; dirFromVector; pointSegmentDistance (Spirit Bond)
    audio.js     # dual-deck music (menu/gameplay/boss) + SFX registry (§8)
  assets/
    fonts/ tiles/ music/ sfx/
    backgrounds/background_main.png   # 960x540, menu + mode-select backdrop
    sprites/
      player/    # witch_* + outfit recolors witch_<color>_* (red/blue/gold)
      familiar/  # familiar_* + collar recolors familiar_<collar>_* (moonbeam/alchemist)
      pickups/   projectiles/   # rune_*, flask_throw.png, puddle.png
      upgrades/  # <id>.png 32x32
      enemies/   ui/   # + spirit_crystal.png
        menu_button.png  upgrade_card.png  health_bar.png  spirit_bar.png  title_main.png
  README.md  CREDITS.md  AI_USAGE.md  PROJECT_HANDOFF.md  .gitignore
  builds/      # packaging output (gitignored)
```

**In-game draw order (`game.js drawWorld`)** — puddles sit on the ground so they
never hide pickups or enemies:
`floor → hazards → puddles (familiar.drawPuddles) → pickups → flasks → magnets →
enemies → enemyBolts → familiar.draw (bolts/beams/flasks + cat) → player`.

HUD bar template: gold pixel border + transparent well; code draws backing → fill →
frame. Menu art via `drawMenu(..., art={bg,title})`; title scaled by `TITLE_SCALE`,
nudged by `TITLE_OFFSET_X`.

---

## 5. Sprite Conventions

Frame width always computed at runtime (`img.width / frameCount`); diagonals use
vertical-first names (`ne`, `sw`). Per-type `spriteScale` lives in `ENEMY_TYPES`
(visual only; never the hitbox).

* **Player:** 8 dirs — idle 4 / walk 6 / die 8. `witch_<anim>_<dir>.png`.
  **Outfit recolors:** `witch_<color>_<anim>_<dir>.png` (red/blue/gold), same frame
  layout; drawn via `player.spritePrefix` with per-frame fallback to the base witch.
* **Familiar:** 8 dirs — idle 4 (loops) / attack 6 (one-shot).
  `familiar_<anim>_<dir>.png`, `spriteScale 0.55`. **Collar recolors:**
  `familiar_<collar>_<anim>_<dir>.png` where `<collar>` ∈ `moonbeam`, `alchemist`
  (must match `COLLARS[*].spritePrefix`); same native size + frame counts as the base
  cat; per-frame fallback to the base. The Wardrobe collar-row icon reuses
  `familiar_<collar>_idle_s.png` (idle-south frame 0); fallback = accent ring.
* **Wisp / Elder Wisp / Gutter Gecko / Bone Mage:** unchanged (see prior notes).
* **Goblin Bonker:** 8 dirs, 6-frame strips, **WALK + ATTACK only** —
  `goblin_walk_<dir>.png`, `goblin_attack_<dir>.png`. Attack is PROGRESS-DRIVEN
  (leap → stomp wind-up → recover). `spriteScale 0.9`.
* **The Watching Hand boss:** sprite-driven. `watching_hand_*`.
* **The Hive Warden boss (1.6.0):** `bee_fly_<dir>.png` — 8 dirs, 6-frame strips,
  reused for hover + charge (facing via `dirFromVector`). `spriteScale 1.0` (tune to
  the native art). Stinger projectile: `assets/sprites/projectiles/bee_stinger.png`
  (16x16, single frame, authored pointing EAST — code rotates it to travel; amber
  dart code fallback). The charge aura / aim guide / release flash are code-drawn.
* **Collar attack art (projectiles/):** `flask_throw.png` (32x32, single frame,
  drawn 0.7 scale, code green-orb fallback); `puddle.png` (96x96 canvas, ~90px
  visible splash, single frame — code does fade+pulse; drawn at 2×radius so the
  visible splash ≈ the hitbox; semi-transparent toxic green, code circle fallback).
* **Upgrade icons:** `assets/sprites/upgrades/<id>.png` (32x32), filename = internal id.
* **Floor decoration (1.6.0):** `assets/tiles/floor_props.png` — a **128x256** sheet,
  4 cols × 8 rows of 32px cells on a dark **`#131523`** background (NOT transparent —
  props are dark-backed to match the floor). Reading order (left→right, top→bottom):
  **cells 0–19 (rows 0–4) = runes**, **cells 20–31 (rows 5–7) = objects**. Two
  independent seeded bands draw from those regions (§2 game.js `RUNE_*`/`OBJECT_*`);
  the old separate rune-circle band was retired/folded into the runes. To add props:
  paint cells + bump `RUNE_COUNT`/`OBJECT_START`/`OBJECT_COUNT`. (`tileRand(x,y,seed)`
  hashes coords for a stable, flicker-free, per-tile scatter — not `Math.random`.)

> **Art status:** all creature/boss/player/familiar sprite sets through 1.4.0 are
> final. **1.5.0 art (witch outfit recolors, familiar collar recolors,
> `flask_throw.png`, `puddle.png`) and 1.6.0 art (`bee_stinger.png` + the new
> floor-prop cells) may be partial** — every one has a code-drawn fallback, so the
> game ships and plays correctly even before the art lands. Drop art in at the
> documented paths; no code change needed.
>
> **Art pipeline:** Daniel makes ALL Familiar Frenzy art in **PixelLab.ai** (a
> pixel-art generator). MCP docs: https://api.pixellab.ai/mcp/docs — it exposes tools
> for characters/animations, transparent top-down **objects** (props, projectiles),
> and tilesets, and can be connected as a custom MCP connector for on-demand asset
> generation (its output then needs fitting to the game's 32px grid + strip layout +
> naming before it drops into `assets/`). PixelLab is art only — SFX come from
> elsewhere (e.g. bfxr/jsfxr).

---

## 6. Post-Launch Work Log (newest first)

```txt
1.6.0 (built + tested 2026-06-16; packaging/publishing) — "The Hive Warden":
  - The Hive Warden, a 3rd boss (projectile/stinger-pattern; HiveWarden class) added
    to BOSS_TYPES. hover→charge→release→recover; aim/pattern lock at charge; Cone
    Volley (kitable, ~35%) + Spread Burst (8-bolt radial ring, the main threat, ~65%,
    may repeat — guard prevents two cones in a row). Telegraph aura + bee_charge grunt
    + bee_sting shot. Bigger stingers (STINGER_OPTS scale 1.1). Bestiary entry +
    first-time-ever intro. EnemyBolt extended with optional sprite opts (additive;
    gecko ball unchanged). All 3 bosses now implement a consumeSummon() stub (fixes a
    boss-wave crash where game.js called it unguarded).
  - bee_charge + bee_sting registered in the audio.js SFX registry.
  - Floor-decoration overhaul: replaced the single prop pool with TWO independent
    seeded bands — common runes (RUNE_CHANCE 0.07, 20 cells) + rare objects
    (OBJECT_CHANCE 0.012, 12 cells); floor_props.png reorganized to 128x256 (runes
    rows 0–4, objects rows 5–7); rune-circle band retired. Fixes the "junkyard"
    over-density + washed-out runes that came from mixing bold props into one pool.

1.5.0 (SHIPPED 2026-06-15) — "Crystals & Collars":
  - Spirit Crystals meta-currency: bosses drop crystals (first-ever guaranteed;
    Endless bosses scaling chance), persisted in ff_wardrobe; summary readout.
  - Wardrobe (internally closet*): Outfits/Collars tabs, buy/equip with crystals.
      * Outfits: Apprentice / Emberheart (flask+5) / Sage's Weave (EXP x1.05) /
        Gilded Mantle (score x1.05); witch recolor via spritePrefix.
      * Familiar Collars (swap attack style): Spirit (rune), Moon Beam (capsule
        beam burst, single-tick, no pierce), Alchemist (thrown flask -> enemy-only
        DoT puddle). pierce/spread reinterpret per style (Option 1): spread = beam
        multi-target / +1 flask; pierce = beam +width / puddle +radius.
  - Arcane Archive: Grimoire + Bestiary folded into one hub; Wardrobe promoted to a
    main-menu item; C hotkey + corner button retired (drawCrystalTotal readout kept).
  - Goblin Bonker reworked: rect club swing -> LEAP & STOMP; stomp HazardZone is its
    ONLY damage (all body contact removed); windup tuned to 0.55. Fixed a latent
    boss-wave crash (boss-safe enemy.def guard).
  - Elder Wisp dash contact tightened (radius 22 only while dashing).
  - Puddle layering fix (ground layer, below pickups + enemies); acid DoT now extends
    the enemy white-flash (PUDDLE_FLASH 0.9) so it reads. Moon Beam nerf (cooldown
    1.6, length 210). Wardrobe screen spacing.

1.4.0 (SHIPPED 2026-06-14): Spirit Volley evolution; Bone Mage + HazardZone; Goblin
  Bonker (then a knockback rect-swing bruiser); Bestiary + Grimoire redesign;
  level-up juice; per-creature ambient SFX + menu/gameplay music split; flask
  offscreen fix; first-time-ever enemy-intro banners.

1.3.0 (SHIPPED): The Watching Hand boss + random bosses (BOSS_TYPES) + Bestiary +
  personal bests / run recap + main-menu & mode-select reorg.

1.2.0 (SHIPPED): Gutter Gecko + SFX registry + master SFX slider + Spirit Imbued
  cues + Spirit Bond evolution + balance audit.

1.1.0 (SHIPPED): familiar tutorial hints + scripted intro.

1.0.0 (SHIPPED): jam submission.
```

---

## 7. Upgrade System

Data-driven in `upgrades.js`. Upgrades: Sharper Spirit Claws (5), Restless Wisp
(5), Spirit Heart (3), Magnet Charm (4), Ghost Pounce (3), Spirit Focus (3, id
`frenzy_focus`), Lucky Paws (3, rare-drop-only). Evolutions:
* **Phantom Pounce** — requires Claws 5 + Ghost Pounce 3 (fully maxed); +2 pierce,
  +2 damage.
* **Spirit Bond** — requires Spirit Heart 3 + Spirit Focus 3; Spirit Link damages
  enemies crossing it.
* **Spirit Volley** — requires Restless Wisp 5 + Spirit Focus 3; +spread.

**Collar interaction (1.5.0):** generic upgrades (damage, cooldown, frenzy, health,
magnet, luck) apply to every attack style automatically. The two SHAPE upgrades
reinterpret per equipped collar (one tree, no collar-specific upgrades, no pool
filtering): **spread** (`spreadShot`) = rune cone / Moon Beam +2 distinct-target
beams / Alchemist +1 flask; **pierce** = rune pass-through / Moon Beam +beam width
/ Alchemist +puddle radius. Phantom Pounce's +2 damage applies everywhere; its
pierce expresses as the width/radius bonus. Grimoire descriptions for Ghost Pounce
("strike an extra enemy") and Spirit Volley ("split toward extra foes") are
generalized so they read true for any collar.

Spirit Recovery is the all-maxed fallback (NOT in the Grimoire). New upgrade →
add to `UPGRADES` with `maxedStat` (+ `evolutionNotes`); offers/Grimoire/icon pick
it up automatically. Do not rename internal `frenzy*` ids.

---

## 8. Audio System (read before touching)

**Music** — `audio.js` uses **two persistent decks + a generation counter**.
Transitions swap the active deck; `pause()` never interrupts a pending `play()`;
only `NotAllowedError` arms retry-on-gesture (AbortError/load hiccups are logged and
ignored — **do not "fix" by treating them as autoplay blocks; that was the original
silence bug**). Pools: 9 themes **split** — `MENU_SRCS` (01-03) / `GAMEPLAY_SRCS`
(04-09) — plus a boss track. Contexts "menu"/"gameplay"/"boss" routed by
`game.js updateMusic`. Invariants: `POOL_COUNT = 9`; 240s loop-then-rotate; volume
persisted (`ff_musicVolume`).

**SFX** — data-driven `SFX_DEFS`; `playSfx(name)` with per-sound voice pools +
throttle, scaled by master SFX volume (`ff_sfxVolume`). `playFamiliarProjectileSfx()`
kept as a wrapper. Core: projectile, level_up, heal, magnet, hint (+ Wardrobe
equip/purchase/denied cues are graceful-silent if absent). Per-creature ambient:
wisp, gecko_chitter, mage_murmur, goblin_grunt (random scheduler over ALIVE enemies).
Event cues: gecko_fling, elder_wisp_charge/summon, mage_cast/blast, goblin_windup/
bonk, hand_slam, **bee_charge** (Hive Warden wind-up grunt) + **bee_sting** (stinger
volley shot). Missing files = silent.

---

## 9. State Machine

```txt
MAIN_MENU, MODE_SELECT, HOW_TO_PLAY, GRIMOIRE, BESTIARY, ARCHIVE, CLOSET,
ENDLESS_PLACEHOLDER, HIGHSCORES_PLACEHOLDER, SETTINGS_PLACEHOLDER,
PLAYING, PAUSED, CONFIRM_QUIT, LEVEL_UP, DYING, NAME_ENTRY, GAME_OVER, VICTORY
```

Main menu = Play / Wardrobe / Arcane Archive / High Scores / Settings.
* **Wardrobe** = `STATE.CLOSET` (`openCloset`/`updateCloset`/`closetSelect`/
  `closetData`/`closetTab`/`closetIndex`; `ui.drawCloset`). Outfits/Collars tabs
  (A/D switch). **Display name only is "Wardrobe" — ALL internals stay `closet*`.**
  The old `drawClosetButton` corner affordance + `C` hotkey are REMOVED; replaced by
  `drawCrystalTotal` (top-right crystal readout). Persistence: `ff_wardrobe`
  `{crystals, owned, equipped, collarsOwned, collarEquipped, firstBossClaimed}`
  (loadWardrobe defaults missing fields — old saves are forward-compatible).
* **Arcane Archive** = `STATE.ARCHIVE` (`openArchive`/`updateArchive`,
  `ARCHIVE_ITEMS = [Grimoire, Bestiary, Back]`; renders via `drawMenu`). Grimoire and
  Bestiary back out to the hub (`grimoireReturn`/`bestiaryReturn = STATE.ARCHIVE`,
  via `closeGrimoire`/`closeBestiary`); the hub backs out to the main menu with
  "Arcane Archive" re-highlighted. The Pause-menu Grimoire path is unaffected
  (`grimoireReturn = STATE.PAUSED`).

Flow: `DYING -> (endless + qualifies) -> NAME_ENTRY -> GAME_OVER`, else `GAME_OVER`.
Bests in `ff_bestEndlessWave/Score`; scores in `ff_highscores`.

Legacy names (cleanup candidates): `HIGHSCORES_PLACEHOLDER` / `SETTINGS_PLACEHOLDER`
are functional screens with misleading names; `ENDLESS_PLACEHOLDER` is dead.

---

## 10. Release / Publishing Workflow

* **Debug flags: `DEBUG_FORCE_BOSS = false` and `DEBUG_BOSS_TYPE = "auto"`.**
  Re-verify from code before every package; never trust this doc alone. (Daniel sets
  them to force-test a specific boss — must be false/"auto" to ship.)
* **Package + publish (one step):** `package_itch.bat` (root). Validates, stages
  runtime files, zips with `index.html` at the ZIP root, then **auto-publishes via
  butler** to `mrcanela/familiar-frenzy:html`. Optional version:
  `package_itch.bat 1.6.0`. Degrades to zip-only if butler is missing.
* ZIP includes index.html, style.css, src/, assets/, README.md, CREDITS.md,
  AI_USAGE.md. Excludes .git, dev docs, the bat, builds/.
* Checklist: `ITCH_RELEASE_CHECKLIST.md`. itch is case-sensitive — asset filenames
  on disk must exactly match code paths.

---

## 11. Changelog / Devlog (player-facing)

**There is NO `DEVLOG.md` file.** Release notes are posted DIRECTLY to the game's
**itch.io devlog** page. Every significant pass still gets a ready-to-paste,
player-facing, newest-first markdown entry for Daniel to post. **Standing
convention: entries ALWAYS include tasteful emojis** (section headers + key bullets)
matching the witch/spirit theme. Live posts: 1.4.0 ("The Coven Grows"), 1.5.0
("Crystals & Collars"), 1.6.0 ("The Hive Warden").

---

## 12. Current Backlog / Next Steps

```txt
DONE — 1.5.0 shipped 2026-06-15. 1.6.0 ("The Hive Warden" + two-band floor
  decoration) built + tested 2026-06-16; packaging/publishing now.

1.6.0 LOOSE ENDS (art/files Daniel is finishing — code fallbacks render meanwhile):
  - bee_charge.mp3 + bee_sting.mp3 in assets/sfx/ (the two boss SFX clips).
  - bee_stinger.png in assets/sprites/projectiles/ (amber dart fallback renders).
  - Hive Warden spriteScale (1.0) is a GUESS — tune to the native bee_fly art size.
  - Any remaining floor-prop cells (objects/runes) Daniel still wants to draw.

NEXT (pick one with Daniel):
  - Next content beat — one new gameplay system at a time (prior candidates: a
    Skeleton Mage area-control enemy [HazardZone is reusable], or a 3rd Spirit
    Grimoire / familiar evolution). Confirm direction first.
  - A 3rd collar or a 3rd outfit tier, building on the Wardrobe.
  - Optional 3rd floor-decoration band (a very-rare "treasure"/circle tier) if Daniel
    wants standout props rarer than the object band.

WORLD/CAMERA BACKLOG (raised earlier, not scheduled): Vampire-Survivors-style
  larger world feel is partly in (2400x1344 + following camera). Revisit drop-reach
  clamping if needed.

WHEN READY (housekeeping):
  - README.md refresh (likely stale vs current feature set).
  - Legacy state cleanup + ENDLESS_PLACEHOLDER removal.
  - Optional internal rename of closet* -> wardrobe* (currently intentionally NOT
    done to avoid churn; display name already "Wardrobe").

PERSISTENCE KEYS:
  ff_musicVolume, ff_sfxVolume, ff_highscores, ff_bestEndlessWave/Score,
  ff_seenEnemies (Bestiary), ff_enemyIntros (intro banners), ff_wardrobe (crystals +
  owned/equipped outfits & collars). A "reset progress" should clear ff_seenEnemies,
  ff_enemyIntros, and consider ff_wardrobe.

BALANCE WATCH (only if Daniel reports it):
  - Goblin now stomp-only (touch-safe). If too passive, re-add contact ONLY while
    chasing. Slam speed = bruiser `windup` (0.55) in enemies.js.
  - Moon Beam (AoE line): if still strong, MOONBEAM_WIDTH down / cooldown up, or add
    a MOONBEAM_DAMAGE_SCALE (<1, integer-safe via round, floored at 1).
  - Alchemist puddles: cap 3, tick ceil(dmg*0.5)/0.5s; watch overlap double-dip.
  - Spirit Bond tick / Bone Mage hazard density on busy waves.
```

Guardrails: one feature at a time; no large new systems, online leaderboards,
external libraries, or build tooling; data-driven tables over subclasses
(ENEMY_TYPES / UPGRADES / BOSS_TYPES / OUTFITS / COLLARS patterns).

---

## 13. First Response Required from Next Claude

1. Confirm this handoff was read.
2. Briefly summarize current state (note 1.5.0 is shipped/live; **1.6.0 was built +
   tested and is being published** — treat as shipped unless Daniel says otherwise).
3. Verify `DEBUG_FORCE_BOSS` and `DEBUG_BOSS_TYPE` from `enemies.js` (don't trust
   this doc) and report.
4. Note any stale-looking handoff items.
5. Offer a short option list and ask what Daniel wants to do.

Do not start coding immediately.
