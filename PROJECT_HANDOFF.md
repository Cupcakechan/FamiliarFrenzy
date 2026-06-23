# Familiar Frenzy — Project Handoff

Last updated: **2026-06-23** — **1.11.0** (the **Bat** + **Raven** familiars complete
the five-familiar roster, plus a **pre-run Wardrobe loadout flow**) is SHIPPED/LIVE,
on top of **1.10.0** (the **Owl** + **Fox** familiars, the new **Familiars** Wardrobe
category + Familiars archive, a Cursed-Mode rebalance, and the Endless→**Casual**
display rename).
Covers all post-launch work through **1.11.0**.
**1.2.0–1.11.0 are all SHIPPED/LIVE.** The big arc since 1.9.0 is the **alternate
Familiar system** — five familiars (Cat / Owl / Fox / Bat / Raven), each changing only
its aspect + a small passive + its Spirit Imbued behavior, all working with every
collar (see **§3b**) — and a **loadout screen** that opens the Wardrobe before Casual /
Cursed runs (Tutorial still starts directly; see §9). Raven introduced the one new
pickup type, the **healing feather** (§3b). No release is mid-flight.

> The Hourkeeper boss is in `BOSS_TYPES` (4 bosses: elder_wisp, watching_hand,
> hive_warden, hourkeeper) and its detailed entry is now filled in (§3 / §5); the
> Tin Bulwark enemy (1.9.0) is likewise documented (§3 / §5). The boss roster + Tin
> Bulwark + Hourkeeper specifics in this doc were verified against the review-only
> repo on 2026-06-20 — confirm the tuned values against your local `enemies.js`
> before treating them as preservation values.

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
    **Pronggeist (1.7.0):** a heavy spectral charger — `healthMult = 2.0` (tanky),
    `PRONG_INTRO_WAVE = 7`. **Bone Mage (1.8.0 fix):** the caster blink is now
    DIRECTION-AWARE — `base = len > c.fireRange ? toward : toward + Math.PI` (retreat
    when too close, approach when too far) — plus `MAGE_BLINK_COOLDOWN = 2.5` (was
    1.5); caster tuning to preserve: `damage 8`, `fireRange 460`, `preferredRange 300`,
    `blinkRange 150`, `blinkDist 200`, `blastRadius 70`, `blastDamage 15`,
    `telegraph 1.1`, `castCooldown 3.5`, `speedMult 0`. `MAGE_INTRO_WAVE = 8`.
  * **Tin Bulwark (1.9.0):** a slow position-control enemy — `spriteScale 0.9`,
    `speedMult 0.55`, `healthMult 2.5`, contact `damage 8` (the WALL itself deals
    NONE). Its `bulwark` def: `castRange 260`, `approachTime 1.0`, `windup 0.9`
    (wall telegraph), `active 1.2`, `recover 0.8`, `wallWidth 240`, `wallThick 90`,
    `pushSpeed 140`, `wallSpeed 130` (keep wallSpeed < pushSpeed < the witch's 220 so
    she can always cut out of the band), `castFrame 1`. Wave composition:
    `TIN_INTRO_WAVE 9`, `TIN_SPAWN_CHANCE 0.12`, `TIN_MAX_ALIVE 1`. Mechanic in §3, art
    in §5.
  * **The Hourkeeper boss (1.8.0):** `HK_RADIUS 30`, `HK_HP_MULT 1.0`, `HK_DMG_BASE 12`,
    `HK_DMG_PER_TIER 4`, `HK_RANGE 220`; fades `HK_APPEAR_TIME 0.6` / `HK_VANISH_TIME
    0.35` / `HK_REAPPEAR_TIME 0.35` / `HK_BLINK_TIME 0.2` / `HK_FX_LIFE 0.35`; sweep
    `HK_HAND_WARN 0.7`, `HK_STRIKE_GAP 0.5`, `HK_HAND_LENGTH 1200` (spans the 960×540
    view through the pivot — the camera knob), `HK_HAND_WIDTH 52`, `HK_HAND_KNOCKBACK
    0`; alarm `HK_RUNE_WARN 0.9`, `HK_RUNE_RADIUS 60`, `HK_RUNE_FIELD 170`,
    `HK_RUNE_STAGGER 0.12`, `HK_RECOVER 1.0`, `HK_TIGHTEN 0.85`; punish-window
    `HK_GUARD_HAND_HP 0.6` (set to `1.0` ONLY to test it from the first set — ship at
    `0.6`). `spriteScale 1.0` (body radius 30). Full fight in §3.
  * **Boss rotation:** `BOSS_TYPES = ["elder_wisp","watching_hand","hive_warden",
    "hourkeeper"]` is the shuffled bag, used ONLY by Cursed Mode (`drawBossFromBag`).
    NORMAL play steps a FIXED easiest→hardest `BOSS_ORDER = ["elder_wisp",
    "hive_warden","watching_hand","hourkeeper"]` via `nextOrderedBoss()` (wave 10 Elder
    Wisp, 20 Hive Warden, 30 Watching Hand, 40 Hourkeeper, then loops); `_bossIndex`
    resets per run in `WaveManager.reset()`. `DEBUG_FORCE_BOSS` + `DEBUG_BOSS_TYPE`
    still override both paths (each forced boss simply takes the next slot in order).
  * `audio.js`: `POOL_COUNT = 9` (NEVER lower — §8); `MENU_POOL_COUNT = 3`
    (menu pool = themes 01-03, gameplay = 04-09); `DEFAULT_VOLUME = 60`;
    `DEFAULT_SFX_VOLUME = 50`.
  * `game.js`: `FLASK_HEAL = 15`; `LEVEL_FLASH_TIME = 0.55`; innate magnet
    `BASE_MAGNET_RANGE` (40); `SCORE_PER_PICKUP = 10`. The body-contact guard in the
    contact loop is **boss-safe AND skips no-contact enemies**:
    `if ((enemy.def && enemy.def.bruiser) || enemy.noContactDamage) continue;` — the
    `enemy.def &&` prefix prevents a boss-wave crash (bosses are separate classes with
    NO `.def`), the `bruiser` branch keeps the Goblin's stomp its only damage, and
    `noContactDamage` keeps the Hourkeeper's body harmless. Do not drop any part.
    **Floor-decoration bands (1.6.0):**
    `RUNE_CHANCE = 0.07` / `RUNE_COUNT = 20` (subtle runes, sheet cells 0-19);
    `OBJECT_CHANCE = 0.012` / `OBJECT_START = 20` / `OBJECT_COUNT = 12` (rare bold
    objects, cells 20-31). These two independent seeded bands REPLACED the old single
    `PROP_VARIANT_CHANCE`/`PROP_CIRCLE_CHANCE` pool (see §3/§5). **Emberheart Robe
    rework (1.7.0):** the outfit is now an EMERGENCY auto-heal — `EMBER_TRIGGER = 0.25`
    (fires once per run when HP drops below 25%) → `EMBER_HEAL_TO = 0.50` (heals up to
    50%). `OUTFIT_ORDER = ["default", "blue", "gold", "red"]` (Wardrobe lists outfits
    in price order).
  * `settings.js` (NEW, 1.7.0): Display & Accessibility — keys `ff_reducedFlash` +
    `ff_highVisWarnings`; `REDUCED_FLASH_MULT = 0.4` (dampens screen-flash intensity
    when Reduced Flash is on). get/set pairs are imported by `game.js`.
  * `input.js` (mouse, 1.8.0): keyboard stays primary; the mouse only mirrors menu
    selection/confirm. Exposes `mouseX/Y`, `mouseMoved`, `mouseClicked`, `mouseHeld`
    (held across frames for drags; cleared on window `mouseup`/`blur`), `wheelDelta`
    (cleared each `endFrame`). Hit-testing maps client px through the canvas's live
    bounding rect, so it's correct at any display scale.
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
* **Workflow reminder: copy the changed files to the OUTPUT folder and ATTACH them
  (present) BEFORE writing the summary.** It is easy to `node --check` files in the
  workspace and then forget to actually send them — that has happened; do the
  copy-out + attach as the first step of the delivery, not the last.

```bash
git add .
git commit -m "Describe completed tested feature"
git push
```

---

## 3. Game Summary & Current Feature Set

Player controls a young witch (move/collect only); her ghost cat **familiar**
auto-attacks. EXP motes → level-ups → upgrades; **a boss every 10 waves**, stepping a FIXED easiest→hardest rotation
(`BOSS_ORDER`) in normal play, looping (Cursed Mode draws a shuffled bag instead —
§3a). Tutorial mode ends after
Wave 10 (Victory, can carry into Endless); Endless runs until death with per-tier
scaling, personal bests, a run recap, and a top-10 leaderboard. Bosses now drop
**Spirit Crystals**, a between-runs currency spent in the **Wardrobe**.

**Cursed Mode (1.9.0)** is a third run mode (Mode Select): a harder Endless where
**bosses arrive every 5 waves** and **each boss kill lays one more random curse**,
stacking, until the eight-curse pool is exhausted (see §3a). It has its own scaling
bumps, its own leaderboard, on-HUD curse icons, and a familiar that heralds each new
curse. The full curse system lives in **`curses.js`** (data-driven registry).

Implemented and tested:

* **Menus/screens:** Main Menu (**Play / Wardrobe / Arcane Archive / High Scores /
  Settings**; background + title-banner art; a small Spirit-Crystal readout sits
  top-right via `drawCrystalTotal`), Mode Select (Tutorial Mode / **Casual Mode** /
  **Cursed Mode** / How to Play / Back — "Casual" is the display rename of the internal
  `endless` mode), How to Play, **Arcane Archive** (hub → Grimoire / Bestiary / Curses /
  **Familiars** / Back), **Grimoire** (flat scrolling glossary, detail on-SELECT,
  Upgrades/Evolutions headers), **Bestiary** (scrolling accordion, animated portrait,
  silhouettes for unseen), **Wardrobe** (**Outfits / Familiars / Collars** tabs —
  buy/equip with crystals; opens as a **pre-run loadout screen** with a Start button
  before Casual/Cursed runs — §3b / §9), Settings (music + SFX sliders), High Scores,
  Pause, Confirm-Quit, Victory, Game Over, Name Entry.
* **Mouse support (1.8.0):** keyboard-primary; the mouse is ADDITIVE and drives the
  SAME selections the keys do. Clickable: Main Menu, Mode Select, Arcane Archive, the
  **level-up cards**, Pause, Confirm-Quit, Victory, Game Over (two regions), and the
  High Scores / How to Play / Endless screens (click anywhere to return). **Grimoire +
  Bestiary** scroll by mouse wheel with a **draggable right-side scrollbar** (grab the
  thumb / click the track); keyboard still drives the highlight. **Settings** sliders
  drag/click and the toggles click Off/On; hover highlights the row. A custom **sprite
  cursor** (`assets/sprites/ui/cursor.png`) shows on menus and is HIDDEN during active
  play (PLAYING/DYING). **All three former gaps CLOSED (shipped 1.8.0):** the
  **Wardrobe** is fully click-driven (Outfits/Collars tabs, click-to-select,
  click-to-buy/equip, clickable Back), and **Settings + High Scores have clickable
  Back** rows.
* **Display & Accessibility (1.7.0, in Settings):** **Reduced Flash** (dampens
  screen-flash intensity, `REDUCED_FLASH_MULT 0.4`) and **High Visibility Warnings**
  (clearer enemy telegraphs), persisted via `settings.js` (`ff_reducedFlash`,
  `ff_highVisWarnings`).
* **World/combat:** 2400x1344 world, player-following camera, tiled dungeon arena
  + wall collision; wave system; boss kill grants a free upgrade. **Floor decoration
  (1.6.0)** scatters two independent seeded bands across the stone — common subtle
  **runes** + rare bold **objects** (bones, skulls, mushrooms, candles, moss…); §5.
  **Rotating arena floor themes (1.7.0):** the dungeon floor cycles through visual
  themes as a run progresses (palette/tileset variations layered over the §5 bands).
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
    Robe (0◆, no buff), Emberheart Robe (3◆, **1.7.0**: emergency auto-heal — HP<25%
    → heal to 50%, once/run), Sage's Weave (3◆, EXP
    ×1.05), Gilded Mantle (8◆, score ×1.05). Witch skin via `player.spritePrefix`.
  * **Collars** — swap the familiar's whole attack (see Familiar below): Spirit
    Collar (0◆, rune), Moon Beam Collar (10◆), Alchemist Collar (12◆).
* **Bosses (`BOSS_TYPES` = elder_wisp, watching_hand, hive_warden, hourkeeper):**
  Normal play steps a FIXED easiest→hardest `BOSS_ORDER` (Elder Wisp → Hive Warden →
  Watching Hand → Hourkeeper, looping); Cursed Mode draws the shuffled bag for
  run-to-run variety. All four are SEPARATE classes (no `.def`) and implement
  `consumeSummon()`.
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
    four bosses now implement (game.js calls it unguarded). `spriteScale = 1.0`.
  * **The Hourkeeper (1.8.0, class `Hourkeeper`)** — a teleporting, rhythm /
    vulnerability-window boss. State loop: **appear → vanish → sweep → reappear →
    (alarm → blink)×N → vanish → …**, where N is the alarm-set count for the current
    HP phase. It is **`untargetable`** (the familiar skips it — familiar.js) and
    `vulnerable === false` (its `takeDamage` no-ops) EXCEPT during the alarm window —
    so it can ONLY be hurt while it casts. `noContactDamage` keeps its body harmless
    (its telegraphed hazards are its only damage). Every attack reuses `HazardZone`
    pushed into the shared `hazards` array (game.js drives telegraph / blast / damage /
    draw), so it runs fully code-drawn and lights up when art lands. Two attacks:
    * **Clock-Hand Sweep** (while vanished / untargetable — pure dodge): rect
      HazardZones (`skin "clock"`) fired one-at-a-time through a LOCKED pivot at its
      last-seen spot. `HK_HAND_ANGLES` apply IN ORDER (vertical, horizontal, then
      diagonals + off-axis tilts), `HK_HAND_WARN 0.7` tell each, `HK_STRIKE_GAP 0.5`
      between, `HK_HAND_LENGTH 1200`, `HK_HAND_WIDTH 52`, no knockback.
    * **Alarm Rune Burst** (after it reappears, VULNERABLE + static — punish it):
      circle HazardZones (`skin "clock"`) scattered uniformly over a disc of radius
      `HK_RUNE_FIELD 170` centred on the witch (covers her spot, so standing still is
      risky), `HK_RUNE_RADIUS 60`, `HK_RUNE_WARN 0.9` tell, `HK_RUNE_STAGGER 0.12`
      apart; it stays vulnerable `HK_RECOVER 1.0` after the last rune.
    * **HP-phase ramp** (`hkPhase()`, re-evaluated each sweep / alarm): ≥60% HP →
      3 hands / 4 runes / 1 set; ≥30% → 4 / 5 / 2; <30% → 5 / 6 / 2 with timings
      tightened by `HK_TIGHTEN 0.85`.
    * **Guard hand** (below `HK_GUARD_HAND_HP 0.6`): during the vulnerable recovery it
      sweeps ONE extra hand through its OWN position (random 0..π orientation, same
      0.7s tell), fired shortly AFTER the runes burst — the offense / defense dilemma
      (keep punishing while you step off the line). Phase 1 stays a clean teach.
    SFX: `hourkeeper_sweep` (a hand strike) + `hourkeeper_alarm` (a cast), both
    graceful-silent until registered.
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
  * **Pronggeist (1.7.0)** — a heavy spectral charger (`PRONG_INTRO_WAVE 7`, ~18%
    spawn, cap 2; `healthMult 2.0`). It SHUFFLES into position, PLANTS, then erupts a
    fan of 4 parallel rotated-rect spike `HazardZone`s (`skin "spikes"`) after an
    ~0.85s telegraph — one combined hit (her i-frames swallow the simultaneous prongs).
    A wide DIRECTIONAL band you sidestep, vs the Bone Mage's circular curse. (Top-level
    `spriteScale` not re-captured this session.)
  * **Tin Bulwark (1.9.0)** — a slow, tanky **position-control** enemy. It advances to
    `castRange 260`, PLANTS, and raises a telegraphed broadside **push wall** (a rect
    `HazardZone` in "push" mode, `skin "wall"`) centred just past the witch so its full
    thickness shoves her away from the Bulwark. **The wall deals NO damage** — the
    threat is being herded into other enemies / hazards / arena edges. The wall is a
    *moving* barrier (`wallSpeed 130`, kept under both the push and her run speed so she
    can always cut sideways out of the band). Body contact still deals `damage 8` if she
    stands on it. WALK-only, 4-dir art (freezes a frame while planted). The shove is a
    sustained `player.applyPush` (a per-frame directional push, separate from knockback
    and cleared each frame so it's update-order-safe). `TIN_INTRO_WAVE 9`,
    `TIN_SPAWN_CHANCE 0.12`, `TIN_MAX_ALIVE 1`.
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

## 3a. Cursed Mode (1.9.0) — the curse system

A third run mode (Mode Select). Plays like Endless, with two twists driven by
`WaveManager.reset(endless, cursed)`: **bosses every 5 waves** (`bossEvery = 5`) and
base difficulty bumps on regular enemies, plus **one more random curse per boss kill**
(`applyNextCurse()` → `rollNextCurse`, no repeats), stacking until the pool is spent.

**Registry — `curses.js` (the single data-driven source):**
* `CURSES` entries carry `id`, `name`, `blurb`, `cry` (the familiar's one-line
  herald), and their EFFECT FIELD(S). `CURSE_POOL` = eligible ids (order is cosmetic;
  the picker is random). Helpers: `rollNextCurse(activeIds)`,
  `curseValue(activeIds, field, fallback)`.
* **The eight curses → effect field → where it's read:**
  * Darkness (`vision: 230`) → dark-veil spotlight radius (game.js renderer).
  * Withering (`noFlasks: true`) → the flask-drop roll skips (game.js).
  * Cursed Ground (`groundHazard: true`) → ambient telegraphed HazardZone patches
    bloom near the witch (game.js, `CG_*`).
  * Quickening (`enemySpeedMult: 1.25`) → regular-enemy speed (game.js sets
    `waveManager.curseSpeedMult`; bosses keep tuned speeds).
  * Vengeful Dead (`deathPuddle: true`) → each slain NON-boss enemy drops a
    `HazardPuddle` where it fell (game.js death block, `VD_PUDDLE_*`).
  * Brittle (`damageMult: 1.5`) → multiplies ALL incoming player damage at the single
    `player.takeDamage` chokepoint (game.js sets `player.damageTakenMult`).
  * Teeming (`spawnMult: 1.5`, `maxAliveBonus: 6`) → bigger + denser waves (game.js
    sets `waveManager.curseSpawnMult` + `curseMaxAliveBonus`).
  * Spirit Drought (`frenzyMoteMult: 0.5`) → halves each mote's charge toward the
    Spirit Imbued meter; XP/leveling untouched (game.js `collectPickup`).
* **Adding a curse = a registry entry + the one place that reads its field.** HUD
  icon, herald, archive, and pool all auto-flow. Keep this contract.

**`HazardPuddle` (enemies.js):** a lingering ground DoT that damages the WITCH — the
mirror of the Alchemist `Puddle` (which damages ENEMIES). They are kept SEPARATE; do
not merge. Owned by `game.this.hazardPuddles` (init/update/draw/filter parallel to
`this.hazards`). Tuning (game.js): `VD_PUDDLE_RADIUS 38`, `VD_PUDDLE_LIFE 1.8`,
`VD_PUDDLE_TICK 0.5`, `VD_PUDDLE_DAMAGE 10`, `VD_PUDDLE_MAX 16`. Dark code-drawn
fallback; sprite `assets/sprites/projectiles/puddle_dark.png`.

**Feedback:**
* **HUD curse icons** — `ui.drawCurseIcons` renders the active curses' 64×64 icons at
  32px, bottom-left during play; fallback = rune box + initial. Icons at
  `assets/sprites/curses/<id>.png`.
* **Familiar herald** — on each new curse, `applyNextCurse` calls
  `sayFamiliar(CURSES[id].cry)` (reuses the dialogue bar; honors `TUTORIAL_HINTS_ENABLED`).
* **Boss Incoming banner** — now correct in Cursed via `WaveManager.displayWaveIsBoss`
  (`displayWave % bossEvery === 0`), not a hardcoded `% 10`.

**Curses archive** — a third Arcane-Archive section (`STATE.CURSES`, `ui.drawCurses`),
mirroring the Bestiary: each curse shows icon + name + blurb, blacked-out "???" until
first suffered. Discovery persists in `ff_seenCurses` (marked in `applyNextCurse`);
"N / total discovered" header.

**Separate Cursed leaderboard** — `highScoreKey(mode)` → `ff_cursedHighscores` (cursed)
vs `ff_highscores` (endless). The High Scores screen has **Endless / Cursed tabs**.
Cursed runs route through NAME_ENTRY on qualifying; endless bests stay endless-only.

**Unified Arcane-Archive pause (Option C)** — the pause menu replaced its separate
Grimoire + Bestiary items with one **Arcane Archive** entry:
`PAUSE_ITEMS = [Resume, Arcane Archive, Settings, Main Menu]`. The hub opens with
return-to-Pause; Grimoire/Bestiary/Curses all open from it. Main menu and pause now
both funnel through the hub.

**Naming:** player-facing "Curses", internals stay `curse*` (`STATE.CURSES`,
`drawCurses`, `openCurses`, `ff_seenCurses`) — same decoupling as Wardrobe/closet (§9).

---

## 3b. Familiar System (1.10.0–1.11.0) — alternate familiars

A data-driven roster of alternate familiars, bought/equipped in the Wardrobe's
**Familiars** tab. Each familiar changes exactly three things and nothing else: its
**sprite/aspect**, a small **passive**, and its **Spirit Imbued behavior** (internally
the "frenzy"). **Collars still own the normal attack** — every familiar works with every
collar (Spirit rune / Moon Beam / Alchemist). The Cat is the free default.

**The five familiars** (`FAMILIAR_ORDER`):

* **Cat** (`default`, 0◆) — baseline; Spirit Imbued = faster firing only (`frenzyBehavior "default"`).
* **Owl** (`owl`, 6◆) — passive **Star-Eyed Focus** (`frenzyMoteMult 1.05`: Spirit Imbued
  fills slightly faster from motes); Spirit Imbued **Astral Judgment** (`"astral"`) — a
  timed precision strike on the most dangerous foe (threat score: boss > caster > ranged
  > bruiser > else).
* **Fox** (`fox`, 6◆) — passive **Trickster Luck** (small flat bump to the two RARE drops:
  flask `+0.015`, magnet `+0.003`; additive with Lucky Paws, **crystals untouched**);
  Spirit Imbued **Foxfire Chain** (`"foxfire"`) — volleys of wisps that chain between
  enemies; strong vs groups, weak vs a lone boss (per-volley boss-hit cap = 1).
* **Bat** (`bat`, 6◆) — passive **Night Sense** (`magnetBonus +10`px pickup magnet range,
  added at `applyMagnet` so it stacks with the innate magnet + Magnet Charm and can't be
  clobbered); Spirit Imbued **Echo Swarm** (`"echo"`) — expanding sonar rings that damage
  each nearby enemy once per ring; reduced boss damage.
* **Raven** (`raven`, 10◆, premium / Cursed survival) — passive **Scavenger's Gift**
  (`scavengerChance 0.05`: a slain non-boss may drop a healing feather); Spirit Imbued
  **Grave Tax** (`"raven"`) — on the rising edge of Spirit Imbued, marks several non-boss
  enemies (Option D: wounded-near-the-player first, then nearest); a marked enemy KILLED
  before its mark expires drops a GUARANTEED healing feather. Feathers are a NEW pickup
  (below).

**Architecture — a new familiar = `familiar.js` + `game.js` only (the catalog/Wardrobe/
previews are data-driven):**

* `FAMILIAR_ASPECTS` (familiar.js) — array of sprite prefixes (each aspect's base +
  per-collar recolors) registered via one `loadImage` loop. A new familiar appends its 3
  prefixes here.
* `FAMILIARS` table + `FAMILIAR_ORDER` (game.js) — each entry: `name/cost/swatch/
  spritePrefix/frenzy/frenzyMoteMult` + passive fields (`flaskLuck`/`magnetLuck`/
  `magnetBonus`/`scavengerChance`, absent → 0) + archive copy (`blurb/passive/passiveDesc/
  frenzyName/frenzyDesc`). This one table drives the Wardrobe Familiars tab, buy/equip,
  persistence, the collar-row previews, AND the Arcane-Archive Familiars catalog —
  automatically.
* **Spirit Imbued dispatch:** `familiar.frenzyBehavior` (set per run from the equipped
  aspect's `frenzy`) selects the behavior in `familiar.update`/`draw`. Each behavior is a
  self-contained block + helpers in familiar.js: **Astral** (astralTimer / findPriorityTarget
  / threatScore), **Foxfire** (launchFoxfire / updateFoxfireWisps / pickFoxfireTarget),
  **Echo** (emitEcho / updateEchoRings), **Grave Tax** (markGraveTargets + per-frame mark
  ageing; rising edge via `_wasFrenzy`; draws the omen above marked enemies — familiar.draw
  runs AFTER the enemy pass, so marks sit on top).
* **Per-run wiring** (game.js `startGame`): sets `familiar.frenzyBehavior`, plus
  `familiarMoteMult` / `familiarFlaskLuck` / `familiarMagnetLuck` / `familiarMagnetBonus` /
  `familiarScavengerChance` from the equipped aspect (0/1 defaults for the rest). The
  per-collar recolor prefix is built like the cat's (`aspect.spritePrefix + (collar ===
  "default" ? "" : "_" + collar)`); `spritePrefixBase` set for the draw fallback.
* **Draw fallback chain:** full prefix (aspect + collar) → base aspect (`spritePrefixBase`)
  → base cat → code placeholder. A missing aspect sprite degrades to the cat, never crashes.

**Raven healing feathers — the one new pickup type:**

* `RavenFeather` class in **pickups.js** (mirrors `HealthFlask`: x/y/`heal`/`dead`/update/
  draw + magnet & vacuum pull). Loads `raven_feather` (`assets/sprites/pickups/
  raven_feather.png`, 32×32) with a code-drawn dark-feather fallback. UNLIKE the other
  pickups it has a short TTL + fade (`FEATHER_LIFE 10`s) — collect promptly, no hoarding.
* `this.feathers[]` in game.js (constructor + reset); collect loop mirrors flasks
  (walk-over → `player.heal(FEATHER_HEAL)` → `playSfx("heal")`).
* **Two sources, one feather max per enemy:** in the death loop, a non-boss kill under the
  cap drops a feather if `enemy.graveMarked` (Grave Tax, guaranteed) **OR** the Scavenger
  roll passes — the `||` short-circuits, so Grave Tax wins and never double-rolls. Bosses
  excluded. **Feathers are SEPARATE from the flask roll → NOT gated by Withering**
  (intentional: Raven's premium Cursed counterplay; the player still must kill + collect).
  Crystals / motes / magnets untouched.

**Protected familiar constants (verify from source before any ship):**

* familiar.js: `ASTRAL_STRIKE_INTERVAL 0.9` / `ASTRAL_STRIKE_DAMAGE 5` / `ASTRAL_STAR_LIFE
  0.45`; `FOXFIRE_INTERVAL 1.2` / `FOXFIRE_WISPS 3` / `FOXFIRE_BOUNCES 3` / `FOXFIRE_DAMAGE
  5` / `FOXFIRE_CHAIN_RANGE 140` / `FOXFIRE_BOSS_HITS_PER_VOLLEY 1` / `FOXFIRE_WISP_SPEED
  460` / `FOXFIRE_HIT_LIFE 0.28`; `ECHO_INTERVAL 0.5` / `ECHO_START_RADIUS 24` /
  `ECHO_MAX_RADIUS 200` / `ECHO_RING_LIFE 0.55` / `ECHO_DAMAGE 4` / **`ECHO_BOSS_DAMAGE 1`**
  (lowered from 2 — at 2 it killed the first Cursed boss too fast); `GRAVE_MARK_COUNT 6` /
  `GRAVE_MARK_DURATION 6` / `GRAVE_WOUNDED_FRAC 0.6`. `FAMILIAR_ASPECTS` = owl/fox/bat/raven
  × (base / `_moonbeam` / `_alchemist`).
* game.js: `FEATHER_HEAL 3` / `FEATHER_MAX 6` / `FEATHER_LIFE 10` / `SCAVENGER_CHANCE 0.05`;
  Trickster `flaskLuck 0.015` / `magnetLuck 0.003`; Night Sense `magnetBonus 10`. Costs:
  Cat 0, Owl/Fox/Bat 6, Raven 10.

**Balance watch:** Raven's sustain in Cursed Mode — especially under **Withering** (feathers
bypass the no-flask rule by design) — is the newest variable; `FEATHER_MAX 6 × 3 HP` + the
5% passive. Watch whether an aggressive Withering run feels too survivable before changing
anything.

**Naming:** player-facing "Familiars"; internals stay `familiar*` and the Spirit Imbued
behavior stays `frenzy*` — same decoupling as Wardrobe/closet (§9) and Casual/`endless`.

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
                 #   (RUNE_*/OBJECT_*) in drawTiledArena's seeded prop scatter;
                 #   MOUSE (1.8.0): mouseMenu/zoneAt helpers + per-screen click zones
                 #   (this.menuZones); list scroll state (grimoire/bestiary
                 #   Scroll/MaxScroll/FollowSel/Scrollbar); settings.js get/set imports
    input.js     # keyboard (held + one-frame presses) + MOUSE (1.8.0): mouseX/Y,
                 #   mouseMoved / mouseClicked / mouseHeld (drag) / wheelDelta
    player.js    # witch (+ applyKnockback) + spritePrefix outfit recolor
    familiar.js  # ghost cat + attack styles: Bolt (rune, +Spirit Volley spread),
                 #   Beam (Moon Beam), FlaskShot + Puddle (Alchemist DoT); collar
                 #   skin via spritePrefix; drawPuddles (ground layer); pointSegDist
    enemies.js   # ENEMY_TYPES, Enemy (wisp/gecko/bone_mage/goblin leap-stomp/
                 #   pronggeist/tin_bulwark), EnemyBolt (+ optional sprite opts),
                 #   HazardZone (+ "push"/"wall", "spikes", "clock" skins), Boss /
                 #   WatchingHand / HiveWarden / Hourkeeper, WaveManager,
                 #   BOSS_TYPES (4 bosses) + BOSS_ORDER (fixed normal rotation) +
                 #   nextOrderedBoss / drawBossFromBag; DEBUG_FORCE_BOSS +
                 #   DEBUG_BOSS_TYPE here (Daniel's LOCAL file);
                 #   HazardPuddle (1.9.0, Vengeful Dead — a ground DoT vs the PLAYER)
    curses.js    # NEW (1.9.0): Cursed Mode curse registry (CURSES / CURSE_POOL) +
                 #   rollNextCurse / curseValue. Data-driven — see §3a.
    pickups.js   # motes, flasks (+ spawn flash), Spirit Magnet
    upgrades.js  # UPGRADES + EVOLUTIONS (Phantom Pounce, Spirit Bond, Spirit Volley)
                 #   + Grimoire entries
    ui.js        # all screens/HUD; drawGrimoire, drawBestiary, drawUpgradeScreen,
                 #   drawCloset (Wardrobe: Outfits/Collars tabs), drawCrystalTotal
                 #   (main-menu corner readout), drawCrystalIcon, drawSkinnedBar, etc.
                 #   Arcane Archive reuses drawMenu (no dedicated screen fn).
                 #   MOUSE (1.8.0): most draws return clickable {zones}; drawScrollbar
                 #   (draggable list scrollbar); drawSettings returns slider/toggle
                 #   zones. NOTE: drawCloset does NOT return zones yet (§12 pending).
    assets.js    # loadImage/getImage with graceful fallback
    utils.js     # math helpers; dirFromVector; pointSegmentDistance (Spirit Bond)
    audio.js     # dual-deck music (menu/gameplay/boss) + SFX registry (§8)
    settings.js  # NEW (1.7.0): Reduced Flash + High Visibility Warnings toggles
                 #   (ff_reducedFlash / ff_highVisWarnings; REDUCED_FLASH_MULT)
  assets/
    fonts/ tiles/ music/ sfx/
    backgrounds/background_main.png   # 960x540, menu + mode-select backdrop
    sprites/
      player/    # witch_* + outfit recolors witch_<color>_* (red/blue/gold)
      familiar/  # familiar_* + collar recolors familiar_<collar>_* (moonbeam/alchemist)
      pickups/   projectiles/   # rune_*, flask_throw.png, puddle.png, puddle_dark.png (1.9.0)
      upgrades/  # <id>.png 32x32
      curses/    # <id>.png 64x64 — Cursed Mode curse icons (1.9.0)
      enemies/   ui/   # + spirit_crystal.png
        menu_button.png  upgrade_card.png  health_bar.png  spirit_bar.png  title_main.png  cursor.png
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
* **Alternate familiar aspects (1.10.0–1.11.0):** the Owl / Fox / Bat / Raven use the
  SAME layout as the cat — 8 dirs, idle 4 / attack 6 — with prefix
  `familiar_<aspect>_<anim>_<dir>.png` (`<aspect>` ∈ `owl`, `fox`, `bat`, `raven`) plus
  per-collar recolors `familiar_<aspect>_<collar>_<anim>_<dir>.png` (`<collar>` ∈
  `moonbeam`, `alchemist`). All registered in `FAMILIAR_ASPECTS`; missing files degrade
  through the fallback chain (aspect+collar → base aspect → base cat → placeholder), so
  any familiar runs with no art. Spirit Imbued effects (Astral / Foxfire / Echo / Grave
  Tax omen) are all CODE-DRAWN — no extra art (§3b).
* **Raven feather pickup (1.11.0):** `assets/sprites/pickups/raven_feather.png` (32×32,
  single frame), loaded in `pickups.js` like the other pickup sprites; code-drawn
  dark-feather fallback. The healing pickup for Scavenger's Gift + Grave Tax (§3b).
* **Wisp / Elder Wisp / Gutter Gecko / Bone Mage:** unchanged (see prior notes).
* **Goblin Bonker:** 8 dirs, 6-frame strips, **WALK + ATTACK only** —
  `goblin_walk_<dir>.png`, `goblin_attack_<dir>.png`. Attack is PROGRESS-DRIVEN
  (leap → stomp wind-up → recover). `spriteScale 0.9`.
* **Pronggeist (1.7.0):** `pronggeist_walk_<dir>.png` — 4 dirs, **walk-only**,
  4-frame strips (`ENEMY_ANIMS.pronggeist = { walk: 4 }`); the cast freezes a single
  walk frame. (Top-level `spriteScale` not re-captured this session.)
* **Tin Bulwark (1.9.0):** `tin_bulwark_walk_<dir>.png` — **4 dirs only** (n/s/e/w,
  facing clamped via `dir4`; no diagonal strips), **walk-only**, **6-frame** strips
  (a heavy trudge; `ENEMY_ANIMS.tin_bulwark = { walk: 6 }`). It freezes a walk frame
  (`castFrame 1`) while planted — no idle/attack/die strips. `spriteScale 0.9`. Missing
  strips fall back to the steel placeholder (`#9fb3c8` / `#4a5a6b`). The push WALL is
  **code-drawn** (`HazardZone` `skin "wall"`: a steel panel with world-space push-
  direction arrows); a panel sprite can replace it later.
* **The Watching Hand boss:** sprite-driven. `watching_hand_*`.
* **The Hive Warden boss (1.6.0):** `bee_fly_<dir>.png` — 8 dirs, 6-frame strips,
  reused for hover + charge (facing via `dirFromVector`). `spriteScale 1.0` (tune to
  the native art). Stinger projectile: `assets/sprites/projectiles/bee_stinger.png`
  (16x16, single frame, authored pointing EAST — code rotates it to travel; amber
  dart code fallback). The charge aura / aim guide / release flash are code-drawn.
* **The Hourkeeper boss (1.8.0):** **single front-facing (south) strips only** —
  `hourkeeper_idle_s.png` (6fr, loops) + `hourkeeper_attack_s.png` (6fr, one-shot cast
  pose) — sliced at draw time (`HK_ANIMS = { idle: 6, attack: 6 }`, `HK_FPS { idle: 6,
  attack: 10 }`). `spriteScale 1.0` (body radius 30). The vanish / reappear / blink are
  **code fades + poof rings** (no sprites). The clock hands + alarm runes are code-drawn
  `HazardZone`s (`skin "clock"`); `clock_rune.png` is an OPTIONAL alarm-rune ground mark
  (code fallback if absent). A drawn-clock fallback covers a missing idle/attack file,
  so the whole boss runs with no art.
* **Collar attack art (projectiles/):** `flask_throw.png` (32x32, single frame,
  drawn 0.7 scale, code green-orb fallback); `puddle.png` (96x96 canvas, ~90px
  visible splash, single frame — code does fade+pulse; drawn at 2×radius so the
  visible splash ≈ the hitbox; semi-transparent toxic green, code circle fallback).
* **Upgrade icons:** `assets/sprites/upgrades/<id>.png` (32x32), filename = internal id.
* **Cursor (1.8.0):** `assets/sprites/ui/cursor.png` — the menu pointer, set on
  `#game-canvas` via CSS; hidden in-play by toggling `canvas.style.cursor` to "none"
  during PLAYING/DYING (reverts to the CSS sprite on menus).
* **Floor decoration (1.6.0):** `assets/tiles/floor_props.png` — a **128x256** sheet,
  4 cols × 8 rows of 32px cells on a dark **`#131523`** background (NOT transparent —
  props are dark-backed to match the floor). Reading order (left→right, top→bottom):
  **cells 0–19 (rows 0–4) = runes**, **cells 20–31 (rows 5–7) = objects**. Two
  independent seeded bands draw from those regions (§2 game.js `RUNE_*`/`OBJECT_*`);
  the old separate rune-circle band was retired/folded into the runes. To add props:
  paint cells + bump `RUNE_COUNT`/`OBJECT_START`/`OBJECT_COUNT`. (`tileRand(x,y,seed)`
  hashes coords for a stable, flicker-free, per-tile scatter — not `Math.random`.)
* **Rotating floor themes (1.7.0):** the arena floor cycles palette/tileset themes as
  a run progresses (`game.js` floor/world draw); confirm the exact theme list + switch
  cadence from code next session.

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
1.11.0 (SHIPPED 2026-06-23) — "the roster is complete + loadout screen":
  - Bat familiar (6◆): passive Night Sense (+10px magnet range, additive at applyMagnet);
    Spirit Imbued Echo Swarm — expanding sonar rings, damage-each-once-per-ring, reduced
    boss damage (ECHO_BOSS_DAMAGE lowered 2->1 after the first Cursed boss died too fast).
    familiar.js + game.js only. See §3b.
  - Raven familiar (10◆, premium / Cursed survival): passive Scavenger's Gift (5% feather
    on a non-boss kill); Spirit Imbued Grave Tax — marks non-boss enemies (wounded-near-
    player first), a marked KILL drops a guaranteed healing feather. Introduced the ONE new
    pickup type, RavenFeather (pickups.js) — short TTL, code-drawn fallback; feathers are
    separate from flasks so Withering does NOT block them (by design). Grave Tax wins over
    the passive roll (one feather/enemy); capped at FEATHER_MAX. familiar.js + game.js +
    pickups.js. See §3b.
  - Pre-run Wardrobe loadout flow: Casual/Cursed now route Mode Select -> Wardrobe (with a
    Start button) -> run; Tutorial still starts directly; the main-menu Wardrobe stays a
    normal Back-only shop. New this.pendingRunMode context (null = shop, "endless"/"cursed"
    = pre-run); openCloset(pendingMode); context-aware exitCloset (pre-run Back -> Mode
    Select, shop Back -> Main Menu); Start = nav index order.length+1, keyboard + mouse.
    drawCloset gained the mode-titled header ("WARDROBE — Cursed Run") + a live loadout
    summary line. game.js + ui.js. See §9.

1.10.0 (SHIPPED ~2026-06-22) — "the Familiars update (Owl + Fox)":
  - New Familiars Wardrobe category — the Wardrobe split from Outfits/Collars into THREE
    tabs (Outfits / Familiars / Collars). Established the whole data-driven familiar system
    (FAMILIAR_ASPECTS + FAMILIARS + FAMILIAR_ORDER + the frenzyBehavior dispatch + the
    per-collar recolor + draw fallback chain) — §3b. Persistence added familiarsOwned /
    familiarEquipped to ff_wardrobe (old saves default to Cat).
  - Owl familiar (6◆): Star-Eyed Focus (frenzyMoteMult 1.05) + Astral Judgment (smart
    single-target strike, threat-scored).
  - Fox familiar (6◆): Trickster Luck (flat rare-drop bump, flask +0.015 / magnet +0.003,
    additive with Lucky Paws, crystals untouched) + Foxfire Chain (chaining wisps, group-
    strong, lone-boss-weak via a per-volley boss cap).
  - Arcane-Archive Familiars catalog — a 4th archive section, data-driven from FAMILIARS
    (auto-includes new familiars). Collar-row previews now show the EQUIPPED familiar's
    recolor.
  - Cursed-Mode rebalance (Option D): CURSED_HP_MULT 1.25->1.12, added CURSED_DAMAGE_MULT
    1.20 (contact damage). Less spongy, hits harder.
  - Display rename Endless -> "Casual" (player-facing strings only; ALL internals —
    "endless" ids/flags/STATE/keys — preserved). Bests/scores/saves carry over.

1.9.0 (SHIPPED 2026-06-20) — "Cursed Mode":
  - New hard run mode (Mode Select): Endless rules + bosses every 5 waves + base
    difficulty bumps; each boss kill stacks one more random curse. Full system in the
    NEW curses.js (CURSES / CURSE_POOL / rollNextCurse / curseValue). See §3a.
  - Eight curses (data-driven; each = a registry entry + ONE read site): Darkness,
    Withering, Cursed Ground, Quickening, Vengeful Dead (NEW HazardPuddle — a ground
    DoT vs the player), Brittle (player.damageTakenMult), Teeming (waveManager
    curseSpawnMult + curseMaxAliveBonus), Spirit Drought (frenzyMoteMult; XP untouched).
  - Curse HUD icons (ui.drawCurseIcons) + the familiar heralds each curse by voice
    (sayFamiliar(cry)). Boss Incoming banner fixed to fire on Cursed boss waves
    (WaveManager.displayWaveIsBoss, not a hardcoded %10).
  - Curses archive — a 3rd Arcane-Archive section (STATE.CURSES, drawCurses),
    Bestiary-style "???" discovery, persisted in ff_seenCurses.
  - Separate Cursed leaderboard (ff_cursedHighscores) with Endless/Cursed tabs on the
    High Scores screen; cursed runs route through NAME_ENTRY on qualifying.
  - Unified pause: the separate Grimoire + Bestiary pause items were replaced by one
    Arcane Archive entry (PAUSE_ITEMS = Resume / Arcane Archive / Settings / Main Menu).
  - Removed the arena swap-back-to-stone announce line (both floor themes are stone now).
  - Tin Bulwark — a new slow position-control enemy (intro w9, 12%, cap 1) that plants
    and raises a telegraphed MOVING push wall (no damage) to herd the witch into
    danger. Reused HazardZone via a backward-compatible "push"/"wall" mode + a new
    isolated player.applyPush sustained shove (knockback untouched). 4-dir walk-only
    art; Bestiary + familiar hint; tin_bulwark_step/charge/wall SFX slots.
  - Fixed easiest->hardest boss rotation for NORMAL play (BOSS_ORDER: Elder Wisp ->
    Hive Warden -> Watching Hand -> Hourkeeper, looping) via nextOrderedBoss() + a
    per-run index reset; the shuffled bag (drawBossFromBag) is now reserved for Cursed
    Mode's random bosses. DEBUG override/force still honored.

1.8.0 (SHIPPED 2026-06-20) — "feedback polish / mouse everywhere":
  - Bone Mage fix: the caster blink is now DIRECTION-AWARE (retreat when too close,
    approach when too far) + an approach trigger; MAGE_BLINK_COOLDOWN 1.5 -> 2.5.
  - Custom sprite cursor (assets/sprites/ui/cursor.png) on the canvas, HIDDEN during
    active play (PLAYING/DYING) by toggling canvas.style.cursor; reverts to the CSS
    sprite on menus. (style.css sets the sprite cursor on #game-canvas.)
  - Mouse support across the menus (keyboard-primary, mouse additive — same selection):
    Main Menu, Mode Select, Arcane Archive, level-up cards, Pause, Confirm-Quit,
    Victory, Game Over (two click regions), High Scores / How to Play / Endless
    (click-anywhere-returns). Reusable game.js helpers mouseMenu(zones) / zoneAt(zones);
    draws return clickable {zones}; hover gated on mouseMoved so it never fights keys.
  - Grimoire + Bestiary: mouse-wheel FREE-SCROLL + a slim right-side SCROLLBAR you can
    DRAG (grab the thumb) or click the track to jump; keyboard still follows the
    selection (followSel model: wheel/drag => free, arrows/click => snap). drawScrollbar
    reports thumb/track geometry; draws return {zones, scroll, maxScroll, scrollbar}.
  - Settings: volume sliders DRAG (or click to set) + toggles click Off/On; hover
    highlights the row; keyboard unchanged. drawSettings returns slider/toggle zones.
  - input.js gained mouse: mouseX/Y, mouseMoved, mouseClicked, mouseHeld (held for
    drags; cleared on window mouseup/blur), wheelDelta (cleared each endFrame).
  - Closed the three mouse gaps to finish 1.8.0: the Wardrobe (STATE.CLOSET) is now
    fully click-driven (tabs / select / buy-equip / Back), and Settings + High Scores
    got clickable Back rows.
  - The Hourkeeper — a teleporting rhythm/vulnerability-window boss (4th in
    BOSS_TYPES) — was enrolled into the live roster and shipped in 1.8.0. It is
    untargetable while it sweeps clock-hand HazardZones (dodge), then reappears
    VULNERABLE to cast scattered alarm runes (punish), blinking between sets, with an
    HP-phase ramp + a sub-60%-HP "guard hand" punish-window. Detailed entry now in
    §3 / §5; ship flags re-verified (DEBUG_FORCE_BOSS false, DEBUG_BOSS_TYPE "auto",
    HK_GUARD_HAND_HP 0.6).

1.7.0 (SHIPPED) — "The Shifting Dungeon":
  - Rotating arena floor themes — the dungeon floor cycles visual themes as a run
    progresses (layered over the 1.6.0 decoration bands).
  - Pronggeist — a new heavy spectral charger enemy (~Wave 7, PRONG_INTRO_WAVE 7;
    healthMult 2.0). (Re-verify exact behaviour from enemies.js.)
  - Emberheart Robe reworked into an EMERGENCY auto-heal (EMBER_TRIGGER 0.25 -> heal
    to EMBER_HEAL_TO 0.50, once per run).
  - Display & Accessibility toggles (NEW settings.js): Reduced Flash
    (REDUCED_FLASH_MULT 0.4) + High Visibility Warnings; keys ff_reducedFlash /
    ff_highVisWarnings.
  - Bestiary added to the Pause menu.
  - Wardrobe outfits re-ordered by price (OUTFIT_ORDER).

1.6.0 (SHIPPED 2026-06-16) — "The Hive Warden":
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
MAIN_MENU, MODE_SELECT, HOW_TO_PLAY, GRIMOIRE, BESTIARY, CURSES, ARCHIVE, CLOSET,
ENDLESS_PLACEHOLDER, HIGHSCORES_PLACEHOLDER, SETTINGS_PLACEHOLDER,
PLAYING, PAUSED, CONFIRM_QUIT, LEVEL_UP, DYING, NAME_ENTRY, GAME_OVER, VICTORY
```

Main menu = Play / Wardrobe / Arcane Archive / High Scores / Settings.
* **Wardrobe** = `STATE.CLOSET` (`openCloset(pendingMode = null)` / `updateCloset` /
  `closetSelect` / `closetData` / `closetTab` / `closetIndex`; `ui.drawCloset`).
  **Outfits / Familiars / Collars** tabs (A/D switch; tab 1 = Familiars, the §3b roster).
  **Display name only is "Wardrobe" — ALL internals stay `closet*`.** Persistence:
  `ff_wardrobe` `{crystals, owned, equipped, collarsOwned, collarEquipped,
  familiarsOwned, familiarEquipped, firstBossClaimed}` (loadWardrobe defaults missing
  fields — old saves forward-compatible; pre-familiar saves default to Cat
  owned+equipped).
  **Pre-run loadout flow (1.11.0):** Mode Select routes Casual → `openCloset("endless")`
  and Cursed → `openCloset("cursed")` (Tutorial still calls `startGame` directly). The
  context lives in `this.pendingRunMode` (`null` = normal shop opened from the main menu;
  `"endless"`/`"cursed"` = pre-run loadout). When set, `drawCloset` titles the screen for
  the run ("WARDROBE — Cursed Run"), shows a live **Loadout** summary line, and draws a
  **Start Run** button (nav index `order.length + 1`, after Back; keyboard + mouse).
  `updateCloset`'s `activate()` routes Start → `startGame(pendingRunMode)` and Back →
  `exitCloset()`; **`exitCloset` is context-aware** — pre-run → `MODE_SELECT` (cursor on
  the chosen mode), shop → `MAIN_MENU`. `pendingRunMode` is cleared on Start, on Back, and
  at every `startGame`, so a stale Start never leaks into the menu Wardrobe.
* **Arcane Archive** = `STATE.ARCHIVE` (`openArchive(returnState)`/`updateArchive`,
  `ARCHIVE_ITEMS = [Grimoire, Bestiary, Curses, Back]`; renders via `drawMenu`).
  Grimoire / Bestiary / **Curses** each open from the hub and back out to it. **(1.9.0)
  The hub tracks where it was opened from (`archiveReturn`):** from the main menu it
  backs out to the menu; from PAUSE it backs out to Pause. The pause menu's old
  separate Grimoire + Bestiary items were REPLACED by a single "Arcane Archive" entry
  that opens the hub with return-to-Pause (Option C) — both entry points now funnel
  through the hub.
* **Curses** = `STATE.CURSES` (`openCurses(returnState)`/`updateCurses`/`closeCurses`;
  `ui.drawCurses`) — a Bestiary-style scroll list; each curse is "???" until suffered;
  discovery persists in `ff_seenCurses` (§3a).

**Mouse:** every screen above is click-driven via `this.menuZones` (set in render,
hit-tested next frame) — INCLUDING the Wardrobe (`STATE.CLOSET`: tabs / select /
buy-equip / Back) and the Settings + High Scores **Back** rows, all closed in 1.8.0.
The Curses screen (1.9.0) follows the Bestiary's mouse model (wheel + draggable
scrollbar).

Flow: `DYING -> (endless OR cursed, if it qualifies for THAT mode's board) ->
NAME_ENTRY -> GAME_OVER`, else `GAME_OVER`. Bests in `ff_bestEndlessWave/Score`
(endless only); scores in `ff_highscores` (endless) / `ff_cursedHighscores` (cursed),
keyed by `highScoreKey(mode)`.

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
("Crystals & Collars"), 1.6.0 ("The Hive Warden"), 1.7.0 ("The Shifting Dungeon"),
1.8.0 ("Point, Click, Conjure"), 1.9.0 ("Cursed Mode"). **All POSTED.** The 1.8.0
draft kept below is a record — it was posted on release; the 1.9.0 entry was posted at
the 1.9.0 ship.

### Devlog 8 — ready-to-paste draft (1.8.0)

````markdown
## 🖱️ Familiar Frenzy 1.8.0 — Point, Click, Conjure

The coven heard you — **Familiar Frenzy is now mouse-friendly**. ✨

### 🐭 Mouse around the menus
- 🎯 Click through the **Main Menu, Mode Select, Arcane Archive**, and the
  **level-up cards** — no keyboard required.
- ⏸️ **Pause, Victory, and Game Over** are clickable too.
- 🕯️ A custom **spirit cursor** now lights your way through the menus, and politely
  vanishes once the frenzy begins.

### 📜 Scrollable Grimoire & Bestiary
- 🖱️ **Scroll** the Grimoire and Bestiary with your mouse wheel.
- 🎚️ A **draggable scrollbar** rides the right edge — grab the thumb or click the
  track to fly through your spells and your foes.

### 🔊 A friendlier Settings screen
- 🎛️ **Drag the volume sliders** and **click** the accessibility toggles directly.

### 🦴 Bone Mage, behave
- 🛠️ Fixed the **Bone Mage's** blink so it keeps its distance instead of teleporting
  into your lap — a fairer, more readable fight.

⌨️ Every keyboard control still works exactly as before — the mouse just rides
alongside. Happy haunting! 👻
````

(The §12 Wardrobe-mouse fix landed in 1.8.0, so a "👗 Click into the Wardrobe"
bullet can be appended to the live 1.8.0 post if you want it complete.)

### Tin Bulwark addendum — append to the live 1.9.0 "Cursed Mode" post

The Tin Bulwark shipped in 1.9.0 but was left out of the original post. Ready-to-paste
under a new heading:

````markdown
### 🛡️ New foe — the Tin Bulwark
- 🧱 A slow, armored sentinel that plants its feet and raises a **moving push wall** —
  it deals no damage, but it **shoves you into whatever else is hunting you**.
- 🏃 Read the telegraph and cut sideways out of the band before it herds you into the
  swarm. Standing still is a mistake.
````

---

## 12. Current Backlog / Next Steps

```txt
DONE — 1.5.0 through 1.11.0 all SHIPPED/LIVE. The 1.8.0 mouse cycle is complete; the
  Hourkeeper (4th boss) went live in 1.8.0; CURSED MODE shipped as 1.9.0 (eight-curse arc
  + separate leaderboard + Curses archive + familiar heralds + unified Arcane-Archive
  pause — §3a) alongside the Tin Bulwark and a fixed normal-mode boss rotation. **1.10.0 +
  1.11.0 built out the whole alternate Familiar system** — five familiars (Cat / Owl / Fox
  / Bat / Raven), the new Familiars Wardrobe tab + archive catalog, the RavenFeather
  healing pickup, a Cursed-Mode rebalance, the Endless→Casual rename, and a pre-run
  Wardrobe loadout flow (§3b / §9). No release is mid-flight. The five-familiar roster is
  considered COMPLETE for now — do not add Raven/other familiars without Daniel's say-so.

OPTIONAL POLISH (1.8.0+, only if Daniel wants):
  - Scrollbar / slider grab-band widths are one-number tunables if anything feels
    fiddly to grab (in the list handlers / drawVolumeSlider).

NEXT CONTENT (pick one with Daniel, now that 1.9.0 has shipped):
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
  ff_musicVolume, ff_sfxVolume, ff_highscores, ff_cursedHighscores (1.9.0 Cursed
  leaderboard), ff_bestEndlessWave/Score, ff_seenEnemies (Bestiary), ff_seenCurses
  (1.9.0 Curses archive), ff_enemyIntros (intro banners), ff_wardrobe (crystals +
  owned/equipped outfits, collars, AND familiars — familiarsOwned/familiarEquipped added
  1.10.0; pre-familiar saves default to Cat), ff_reducedFlash + ff_highVisWarnings (1.7.0
  Display & Accessibility toggles). A "reset progress" should clear ff_seenEnemies,
  ff_seenCurses, ff_enemyIntros, and consider ff_wardrobe.

BALANCE WATCH (only if Daniel reports it):
  - Goblin now stomp-only (touch-safe). If too passive, re-add contact ONLY while
    chasing. Slam speed = bruiser `windup` (0.55) in enemies.js.
  - Moon Beam (AoE line): if still strong, MOONBEAM_WIDTH down / cooldown up, or add
    a MOONBEAM_DAMAGE_SCALE (<1, integer-safe via round, floored at 1).
  - Alchemist puddles: cap 3, tick ceil(dmg*0.5)/0.5s; watch overlap double-dip.
  - Spirit Bond tick / Bone Mage hazard density on busy waves.
  - Tin Bulwark: TIN_MAX_ALIVE is 1 on purpose (position-control stacks badly). If the
    wall feels unfair, widen the escape — lower wallSpeed / active, or wallWidth.
  - Hourkeeper: HK_GUARD_HAND_HP 0.6 gates the punish-window hand to phases 2-3; raise
    toward 1.0 only if it feels too soft late. HK_HP_MULT 1.0 -> ~0.8 if the fight drags.
  - Cursed Mode is under LIVE player testing for overall difficulty (see §3a) — hold
    curse / scaling changes until there's feedback.
  - Familiars (1.10.0–1.11.0): Raven sustain in Cursed/Withering is the newest variable
    (feathers bypass the no-flask rule by design; FEATHER_MAX 6 × 3 HP + 5% passive) —
    levers SCAVENGER_CHANCE / FEATHER_HEAL / FEATHER_MAX / GRAVE_MARK_COUNT. Echo boss
    damage was already nudged 2->1. Adjust only on reported feel (§3b).
```

Guardrails: one feature at a time; no large new systems, online leaderboards,
external libraries, or build tooling; data-driven tables over subclasses
(ENEMY_TYPES / UPGRADES / BOSS_TYPES / OUTFITS / COLLARS / FAMILIARS patterns).

---

## 13. First Response Required from Next Claude

1. Confirm this handoff was read.
2. Briefly summarize current state (**1.2.0–1.11.0 are all SHIPPED/LIVE. The alternate
   Familiar system is complete — five familiars (Cat / Owl / Fox / Bat / Raven), the
   Familiars Wardrobe tab + archive, the RavenFeather healing pickup, and a pre-run
   Wardrobe loadout flow; shipped across 1.10.0 + 1.11.0 — see §3b / §9. Cursed Mode
   shipped as 1.9.0 (§3a). No release is mid-flight.** Open follow-ups: the
   camera-following larger world + drop-reach clamping is parked (§12); Raven sustain in
   Cursed/Withering is on balance-watch (§3b / §12)).
3. Verify `DEBUG_FORCE_BOSS` and `DEBUG_BOSS_TYPE` from `enemies.js` (don't trust
   this doc) and report.
4. Note any stale-looking handoff items.
5. Offer a short option list and ask what Daniel wants to do.

Do not start coding immediately.