# Familiar Frenzy — Project Handoff

Last updated: **2026-06-14** — merged the 1.4.0 bundle in; all sprite art + SFX confirmed present.
Covers all post-launch work through the **1.4.0** release.
**1.2.0, 1.3.0, and 1.4.0 are all SHIPPED/LIVE.** 1.4.0 shipped 2026-06-14 (asset-complete).

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
  * `enemies.js`: `DEBUG_FORCE_BOSS = false`; `DEBUG_BOSS_TYPE = "auto"`;
    Elder Wisp boss `spriteScale = 1.0`; Gutter Gecko `spriteScale = 0.6`;
    Goblin Bonker `bruiser` block { windup 0.65, recover 0.8, cooldown 0.6,
    swingReach 150, swingWidth 96, swingDamage 10, knockback 78, lunge 60 };
    `GOBLIN_LUNGE_TIME = 0.18`.
  * `audio.js`: `POOL_COUNT = 9` (NEVER lower — §8); `MENU_POOL_COUNT = 3`
    (menu pool = themes 01-03, gameplay = 04-09); `DEFAULT_VOLUME = 60`;
    `DEFAULT_SFX_VOLUME = 50`.
  * `game.js`: `FLASK_HEAL = 15`; `LEVEL_FLASH_TIME = 0.55`; innate magnet
    `BASE_MAGNET_RANGE` (40).
  * `pickups.js`: `FLASK_SPAWN_FLASH_TIME = 2.0`.
  * `familiar.js`: `RUNE_COUNT 14`, `RUNE_SCALE 0.5`, `spriteScale 0.55`;
    Spirit Volley `SIDE_DAMAGE_SCALE 0.5`, `SPREAD_ANGLE 0.26`.
  * `ui.js`: `TITLE_OFFSET_X` (optical centering of the title banner).
* Daniel often applies small one-line tweaks himself between turns (text, single
  constants, banner gate). **Sync those into the working copy before building on a
  file**, and ask if unsure whether he's edited it since the last delivery.
* Options/plan before non-trivial coding; wait for the go-ahead. Single-value
  tweaks are often best handed back as "change line N to X."
* For sizable feature/system decisions, present 2-3 options (pros/cons + a
  recommendation) and wait for Daniel's pick before coding.
* After completed work provide, in order: files changed; what changed; test steps;
  known risks; `node --check` confirmation; a ready-to-paste **DEVLOG.md** entry
  (player-facing, see §11); a ready-to-paste **AI_USAGE.md** row; the git
  checkpoint block (NO `cd` lines). **Daniel tests first and decides when to
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
scaling, personal bests, a run recap, and a top-10 leaderboard.

Implemented and tested:

* **Menus/screens:** Main Menu (Play / Grimoire / Bestiary / High Scores /
  Settings; background + title-banner art), Mode Select (Tutorial Mode / Endless
  Mode / How to Play / Back), How to Play (two-column bold action list),
  **Grimoire** (read-only glossary — now a flat scrolling list, detail shown
  on-SELECT, grouped under non-interactive Upgrades/Evolutions headers),
  **Bestiary** (scrolling accordion, detail on-SELECT, animated portrait,
  silhouettes + "???" for unseen), Settings (music + SFX sliders), High Scores
  (arcade initials), Pause, Confirm-Quit, Victory, Game Over, Name Entry.
* **World/combat:** 2400x1344 world, player-following camera, tiled dungeon arena
  + wall collision; wave system; boss kill grants a free upgrade.
* **Bosses (shuffled-bag `BOSS_TYPES`):**
  * **Elder Wisp** — wobble-follow, telegraphed dash (charge wind-up), staggered
    wisp summons. Charge + summon SFX cues. `spriteScale = 1.0`.
  * **The Watching Hand** — hops; locked-marker jump slam (`hand_slam` SFX);
    gecko-summon phases at 75/50/25% HP; north slam.
  * New bosses go in `BOSS_TYPES` (currently elder_wisp, watching_hand).
* **Player:** 8-dir idle/walk/die sprites, i-frames, death animation,
  `applyKnockback` (decaying impulse; used by the Goblin — no stun, keeps control).
* **Familiar:** 8-dir idle/attack sprites, ghost imprints, rune projectile pool,
  pierce, projectile SFX. **Spirit Volley** evolution fires a 3-bolt spread.
* **Enemies (data-driven `ENEMY_TYPES`; each carries `ambientSfx`):**
  * **Wisp** — melee chaser, 8-dir float/attack sprites.
  * **Gutter Gecko** — ranged skirmisher; holds ~280px, strafes, retreats, flings
    dodgeable projectiles (`gecko_fling` cue). `spriteScale 0.6`.
  * **Bone Mage** — stationary zoning caster: phase-steps (blinks) and curses the
    GROUND, forcing the witch to move. Uses the HazardZone system. `spriteScale 0.8`.
  * **Goblin Bonker** — tanky close-range disruptor: lumbers in, plants, winds up
    a LOCKED rect club swing, lunges into it, and KNOCKS the witch back. Tuned to
    actually connect (see §2). `spriteScale 0.9`.
* **HazardZone (reusable telegraph → blast system, in enemies.js):** a warned
  danger zone that detonates after `telegraph` seconds. Supports **circle and
  rotated-rect** shapes, optional **knockback**, i-frame-safe damage, code-drawn
  fallback (+ optional `hex_rune.png`). Owned by `game.this.hazards`; passed into
  `enemy.update(dt, player, enemyBolts, hazards)`. Reuse it for future enemies/bosses.
* **Pickups:** EXP motes (glow), health flasks (heal 15, **2s green spawn flash**),
  rare Spirit Magnet (vacuum). Innate 40px magnet range for everyone. The tutorial
  teaching flask now drops near the witch (on-screen, beyond magnet pull); other
  flask hints are gated to on-screen via `isOnScreen`.
* **Upgrades (data-driven):** capped pool + 32x32 icons + Grimoire; Spirit Recovery
  fallback. **Three evolutions:** Phantom Pounce, Spirit Bond, Spirit Volley (§7).
* **Spirit Imbued** mode (internals still `frenzy*`) with the Spirit Link ribbon;
  ready cues: pulsing gold spark over the witch + breathing gold bar fill + the
  flashing prompt under the HUD cluster.
* **Level-up juice:** a fading gold bloom + a "LEVEL UP!" title pop on the upgrade
  screen (gentle, single fade — photosensitivity-safe), re-fires per stacked level.
* **HUD:** top-edge XP strip; HP + Spirit bars (263x24 frames) stacked top-left;
  Score + Lv top-right; familiar dialogue bar (bottom-center); off-screen enemy
  indicators.
* **Familiar dialogue / enemy intros:** enemy-INTRO banners now fire FIRST-TIME-EVER
  (persisted in `ff_enemyIntros`), not once per run.
* **Audio:** dual-deck music with **split menu / gameplay pools** + boss (§8);
  data-driven SFX registry with per-creature ambient voices + event cues (§8).
* Asset-fallback safety everywhere: missing art/sound → placeholder/silence, never
  a crash.

---

## 4. Architecture / File Map

```txt
familiar-frenzy/
  index.html   style.css
  package_itch.bat            # packaging + butler auto-publish (§10) — not shipped
  ITCH_RELEASE_CHECKLIST.md   # release steps (§10) — not shipped in the zip
  DEVLOG.md                   # player-facing release notes (§11) — not shipped
  src/
    main.js      # entry, canvas, dt loop, font preload, initAudio
    game.js      # state machine, world/camera, drops/collection, high scores,
                 #   tutorial script + hints (+ enemy-intro persistence),
                 #   hazards collection, isOnScreen, level-up flash, Spirit Bond
                 #   damage, SFX triggers + ambient scheduler, music-context sync
    input.js     # keyboard (held + one-frame presses)
    player.js    # witch (+ applyKnockback)
    familiar.js  # ghost cat + bolts (+ Spirit Volley spread) + Spirit Link
    enemies.js   # ENEMY_TYPES table, Enemy (wisp/gecko/bone_mage/goblin),
                 #   EnemyBolt, HazardZone, Boss(es), WaveManager, BOSS_TYPES;
                 #   DEBUG_FORCE_BOSS + DEBUG_BOSS_TYPE here
    pickups.js   # motes, flasks (+ spawn flash), Spirit Magnet
    upgrades.js  # UPGRADES + EVOLUTIONS (Phantom Pounce, Spirit Bond, Spirit
                 #   Volley) + Grimoire entries
    ui.js        # all screens/HUD; drawGrimoire (flat scrolling), drawBestiary
                 #   (scrolling accordion), drawUpgradeScreen (level-up flash),
                 #   drawSkinnedBar, drawFamiliarHint, wrapText, drawNameEntry,
                 #   drawOffscreenIndicators, title-card tunables
    assets.js    # loadImage/getImage with graceful fallback
    utils.js     # math helpers; dirFromVector; pointSegmentDistance (Spirit Bond)
    audio.js     # dual-deck music (menu/gameplay/boss) + SFX registry (§8)
  assets/
    fonts/ tiles/ music/ sfx/
    backgrounds/background_main.png   # 960x540, menu + mode-select backdrop
    sprites/
      player/ familiar/ pickups/ projectiles/ upgrades/
      enemies/   # wisp_*, elder_wisp_*, gecko_*, bone_mage_*, goblin_*,
                 #   watching_hand_* (all art present + final)
      ui/
        menu_button.png (175x37)  upgrade_card.png (240x180)
        health_bar.png (263x24)   spirit_bar.png (263x24)
        title_main.png            # title banner, drawn 1:1 centered at y=100
  README.md  CREDITS.md  AI_USAGE.md  PROJECT_HANDOFF.md  .gitignore
  builds/      # packaging output (gitignored)
```

HUD bar template: gold pixel border + transparent well inset 3px (x) / 4px (y);
code draws dark backing -> fill -> frame on top; helper reads native size.
Menu art: `drawMenu(..., art = { bg, title })`; title scaled by integer
`TITLE_SCALE`, nudged by `TITLE_OFFSET_X`.

---

## 5. Sprite Conventions

Frame width always computed at runtime (`img.width / frameCount`); diagonals use
vertical-first names (`ne`, `sw`). Per-type `spriteScale` lives in `ENEMY_TYPES`
(visual only; never the hitbox).

* **Player:** 8 dirs — idle 4 / walk 6 / die 8. `witch_<anim>_<dir>.png`.
* **Familiar:** 8 dirs — idle 4 (loops, doubles as float) / attack 6 (one-shot).
  `familiar_<anim>_<dir>.png`, `spriteScale 0.55`.
* **Wisp:** 8 dirs — float 4 / attack 4 (both loop). `wisp_<anim>_<dir>.png`.
* **Elder Wisp boss:** 8 dirs — float 4 / charge 2 (state-driven). `spriteScale 1.0`.
* **Gutter Gecko:** 8 dirs, single-row 4-frame strips — `gecko_idle_<dir>.png`
  (loops), `gecko_walk_<dir>.png` (loops), `gecko_attack_<dir>.png` (ONE-SHOT,
  throw on frame 2-3). `spriteScale 0.6`.
* **Bone Mage:** 8 dirs, 6-frame strips — `bone_mage_idle_<dir>.png`,
  `bone_mage_attack_<dir>.png`. `spriteScale 0.8`.
* **Goblin Bonker:** 8 dirs, 6-frame strips, **WALK + ATTACK only** (no idle, no
  die) — `goblin_walk_<dir>.png`, `goblin_attack_<dir>.png`. Attack is
  PROGRESS-DRIVEN (wind-up frames 0..4, swing frame held through recover);
  rest state = walk. `spriteScale 0.9`.
* **The Watching Hand boss:** sprite-driven (slam/hop states). `watching_hand_*`.
* **Upgrade icons:** `assets/sprites/upgrades/<id>.png` (32x32). The icon system
  is data-driven by internal id — the PNG filename must match the id. Existing:
  `phantom_pounce.png`, `spirit_bond.png`, `spirit_volley.png`.

Pixel-art rules: INTEGER scales only; author on a true uniform grid (watch
PixelLab wobble); trim margins consistently; match new creatures' frame size to
the wisp strips for shared scale.

> **Art status:** all sprite sets above are in and final — Gutter Gecko, Bone
> Mage, Goblin Bonker, the Watching Hand, and the Elder Wisp boss (plus player,
> familiar, and Wisp). No creature is on a placeholder anymore; the asset
> fallbacks remain in code purely as safety.

---

## 6. Post-Launch Work Log (newest first)

```txt
1.4.0 (SHIPPED 2026-06-14):
  - Spirit Volley evolution (familiar.js 3-bolt spread: center full dmg + 2 side
    bolts at SIDE_DAMAGE_SCALE 0.5 in a SPREAD_ANGLE 0.26 cone; requires
    restless_wisp>=5 && frenzy_focus>=3). Spirit Focus now gates Bond AND Volley.
  - Bone Mage zoning enemy + reusable HazardZone telegraph system (circle + rect
    shapes, optional knockback, i-frame-safe). Wave intro ~8.
  - Goblin Bonker tanky knockback bruiser (player.applyKnockback). Tuned so its
    LOCKED swing connects: shorter wind-up + reaching forward lunge.
  - Bestiary redesign: flowing scrolling accordion, detail on-SELECT, animated
    portrait (fixed the old "Back overlaps detail panel" bug).
  - Grimoire redesign: flat scrolling list, detail on-SELECT (no expand key),
    non-interactive Upgrades/Evolutions headers; value column measured off the
    widest label. Dropped grimoireCategory/grimoireExpanded state.
  - Level-up juice: fading gold bloom + title pop (drawUpgradeScreen flash param),
    re-fires per stacked level. How to Play actions bolded into two columns.
  - Audio: per-creature ambient voices (ENEMY_TYPES.ambientSfx, random scheduler),
    gecko-fling cue, Elder Wisp charge/summon cues; menu vs gameplay MUSIC SPLIT
    (themes 01-03 menu / 04-09 gameplay, crossfade on run start; boss unchanged).
  - Flask offscreen fix: tutorial teaching flask placed near the witch (on-screen,
    beyond magnet pull), other flask hints gated to on-screen; 2s green spawn flash.
  - Enemy-intro banners now FIRST-TIME-EVER (persisted ff_enemyIntros).

1.3.0 (SHIPPED): The Watching Hand boss + random bosses (shuffled-bag BOSS_TYPES,
  no back-to-back repeats) + Enemy Bestiary + personal bests / run recap +
  main-menu & mode-select reorg.

1.2.0 (SHIPPED): Gutter Gecko ranged enemy + SFX registry (playSfx) + master SFX
  volume slider + Spirit Imbued visibility cues + Spirit Bond evolution + balance
  audit (FRENZY_MOTES 30, innate 40px magnet, xpToNext +4).

1.1.0 (SHIPPED): familiar tutorial hints + scripted intro (waves held until first
  move, free-walk spotlight, wave-1 motes-only, wave-2 guaranteed flask).

1.0.0 (SHIPPED): jam submission.
```

---

## 7. Upgrade System

Data-driven in `upgrades.js`. Upgrades: Sharper Spirit Claws (5), Restless Wisp
(5), Spirit Heart (3), Magnet Charm (4), Ghost Pounce (3), Spirit Focus (3, id
`frenzy_focus`), Lucky Paws (3, rare-drop-only). Evolutions:
* **Phantom Pounce** — requires Claws 5 + Ghost Pounce 3 (Ghost Pounce must be
  fully maxed Lv.3); +2 pierce, +2 damage.
* **Spirit Bond** — requires Spirit Heart 3 + Spirit Focus 3; during Spirit Imbued
  the witch<->familiar link damages enemies crossing it (half the familiar's
  damage, min 1, per 0.5s per enemy; gold/thicker link visual).
* **Spirit Volley** — requires Restless Wisp 5 + Spirit Focus 3; the familiar
  fires a 3-bolt spread (center bolt full damage, two side bolts at half).

Spirit Recovery is the all-maxed fallback (NOT in the Grimoire). New upgrade ->
add to `UPGRADES` with `maxedStat` (+ `evolutionNotes` if it feeds an evolution);
offers, Grimoire, and the icon all pick it up automatically. Do not rename internal
`frenzy*` ids. Spirit Focus is intentionally strong (it now gates BOTH Spirit Bond
and Spirit Volley).

---

## 8. Audio System (read before touching)

**Music** — `audio.js` uses **two persistent decks + a generation counter**.
Transitions swap the active deck; `pause()` never interrupts a pending `play()`
(waits for the promise, skips if reactivated); only `NotAllowedError` arms
retry-on-gesture (AbortError/load hiccups are logged and ignored — **do not
"fix" by treating them as autoplay blocks; that was the original silence bug**).

Pools (1.4.0): the 9 themes are **split** — `MENU_SRCS` (themes 01-03) and
`GAMEPLAY_SRCS` (04-09) — plus a single boss track. Contexts are **"menu" /
"gameplay" / "boss"**, routed by `game.js updateMusic`: boss while a boss is alive
in play, gameplay for play states (incl. pause/level-up/Grimoire-from-pause/dying),
menu otherwise. Starting/ending a run crossfades between pools (handled cleanly by
the deck system — no restart glitch). Rebalance via `MENU_POOL_COUNT`.
Invariants: `POOL_COUNT = 9`; 240s loop-then-rotate within a pool; volume persisted
(`ff_musicVolume`).

**SFX** — data-driven `SFX_DEFS` registry; `playSfx(name)` with per-sound voice
pools + throttle, scaled by a master SFX volume (0-100, default 50, persisted
`ff_sfxVolume`). `playFamiliarProjectileSfx()` kept as a wrapper so familiar.js
needs no changes. Registered sounds:
* Core: projectile (.wav), level_up, heal, magnet, hint.
* Per-creature ambient (random scheduler): wisp, gecko_chitter, mage_murmur,
  goblin_grunt. Each enemy carries `ambientSfx`; the game.js chitter scheduler
  picks a random voice from whatever's ALIVE on a 6-14s timer.
* Event cues: gecko_fling, elder_wisp_charge, elder_wisp_summon, mage_cast,
  mage_blast, goblin_windup, goblin_bonk, hand_slam.
* Missing files = silent (graceful) — but all of the above are present on disk as
  of 2026-06-14.

---

## 9. State Machine

```txt
MAIN_MENU, MODE_SELECT, HOW_TO_PLAY, GRIMOIRE, BESTIARY,
ENDLESS_PLACEHOLDER, HIGHSCORES_PLACEHOLDER, SETTINGS_PLACEHOLDER,
PLAYING, PAUSED, CONFIRM_QUIT, LEVEL_UP, DYING, NAME_ENTRY, GAME_OVER, VICTORY
```

Flow: `DYING -> (endless + qualifies top-10) -> NAME_ENTRY -> GAME_OVER`, else
straight to `GAME_OVER`. High scores: `{name, score, wave, date}` in
`ff_highscores` (top 10, score-desc/wave-desc); bests in
`ff_bestEndlessWave/Score`. Quitting Endless via Pause records nothing (intentional).

The Grimoire is now navigated as a flat entry list (entries + Back; section headers
are non-navigable) — no category/expand state. The Bestiary navigates entries + Back.

Legacy names (cleanup candidates): `HIGHSCORES_PLACEHOLDER` /
`SETTINGS_PLACEHOLDER` are functional screens with misleading names;
`ENDLESS_PLACEHOLDER` is dead (never entered) — safe to remove together.

---

## 10. Release / Publishing Workflow

* **Debug flags: `DEBUG_FORCE_BOSS = false` and `DEBUG_BOSS_TYPE = "auto"` —
  verified in enemies.js 2026-06-14.** Re-verify from code before every package;
  never trust this doc alone. (Daniel flips DEBUG_FORCE_BOSS=true / sets
  DEBUG_BOSS_TYPE to force-test a specific boss — must be false/"auto" to ship.)
* **Package + publish (one step):** `package_itch.bat` (root). Validates, stages
  runtime files, zips with `index.html` at the ZIP root (self-verified), then
  **auto-publishes via butler** to `mrcanela/familiar-frenzy:html` (slug is a
  variable at the top of the script). Optional version: `package_itch.bat 1.4.0`.
  Degrades to zip-only if butler is missing.
* ZIP includes index.html, style.css, src/, assets/, README.md, CREDITS.md,
  AI_USAGE.md. Excludes .git, dev docs, the bat, builds/.
* Checklist: `ITCH_RELEASE_CHECKLIST.md`. itch is case-sensitive — asset filenames
  on disk must exactly match code paths.

---

## 11. DEVLOG.md (player-facing)

Maintain `DEVLOG.md` (newest first); every significant pass gets a ready-to-paste
entry that doubles as an itch devlog post. The **1.4.0 entry ("The Coven Grows")
is live** on itch (with emoji flair).

---

## 12. Current Backlog / Next Steps

```txt
DONE — 1.4.0 shipped 2026-06-14 (asset-complete; DEVLOG posted). No release in flight.

NEXT (pick one with Daniel):
  - Start the next content beat — one new gameplay system at a time. Prior
    roadmap candidate: a Skeleton Mage area-control enemy (HazardZone is reusable
    for it). Confirm direction before building.

WHEN READY (non-blocking housekeeping):
  - Flask sprite renders from flask_idle.png (single frame). If it's an animated
    strip, bump FLASK_FRAMES in pickups.js; otherwise no action needed.
  - README.md refresh (status sections likely stale vs current feature set).
  - Legacy state cleanup + ENDLESS_PLACEHOLDER removal.

PERSISTENCE KEYS:
  ff_musicVolume, ff_sfxVolume, ff_highscores, ff_bestEndlessWave/Score,
  ff_seenEnemies (Bestiary), ff_enemyIntros (first-time-ever intro banners).
  A future "reset progress" should clear ff_seenEnemies + ff_enemyIntros.

BALANCE WATCH (only if Daniel reports it):
  - Goblin swing: if it now lands TOO reliably, dial windup 0.65->0.75 or
    swingReach 150->125; harder = lunge 60->80.
  - Bone Mage cast cadence / hazard density on busy waves.
  - Spirit Bond tick (half dmg / 0.5s) — watch for trivializing crowds.
```

Guardrails: one feature at a time; no large new systems, online leaderboards,
external libraries, or build tooling; data-driven tables over subclasses for new
content (ENEMY_TYPES / UPGRADES / BOSS_TYPES patterns).

---

## 13. First Response Required from Next Claude

1. Confirm this handoff was read.
2. Briefly summarize current state (note 1.4.0 is shipped/live; no release in flight).
3. Verify `DEBUG_FORCE_BOSS` and `DEBUG_BOSS_TYPE` from `enemies.js` (don't trust
   this doc) and report.
4. Note any stale-looking handoff items.
5. Offer a short option list and ask what Daniel wants to do.

Do not start coding immediately.
