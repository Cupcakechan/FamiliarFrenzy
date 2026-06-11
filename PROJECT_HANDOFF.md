# Familiar Frenzy — Handoff for Next Claude Session

> Living document. Update §5, §6, §7, §8, §9 whenever something changes so the
> next session starts with an accurate picture. Last updated: 2026-06-11.

## 1. Project Context

We are working on **Familiar Frenzy**, a browser-based top-down survival arena game for **AI Browser Game Jam 3**.

Daniel uses:

* **Claude** for coding implementation
* **ChatGPT** as middleman / planner / reviewer / prompt writer / scope guard

Tech stack:

* Plain HTML
* Plain CSS
* Plain JavaScript
* HTML5 Canvas
* ES modules
* No Unity
* No npm
* No TypeScript
* No React
* No Phaser
* No build tools

The game runs locally through **VS Code Live Server** (Python is not available on the dev machine).

Final jam submission goal:

* Keep `index.html` at the root
* Zip the folder
* Upload to itch.io as an HTML5 browser game
* **itch.io's server is case-sensitive** — asset filenames must match the code exactly (lowercase snake_case).

Repo:

```txt
https://github.com/Cupcakechan/FamiliarFrenzy   (branch: main)
```

Local repo path:

```txt
C:\Users\danie\Documents\HTML Projects\familiar-frenzy\familiar-frenzy
```

Important repo note:

* The current repo should be treated as updated/current. It is synced into the
  Claude project as **review-only** context (the `assets/` folder is excluded for
  size, so a sprite missing from Claude's view does NOT mean Daniel lacks it).
* The synced repo reflects the **last push**, not Daniel's working copy. When a
  delivery depends on exact current file contents, work from files Daniel
  uploads in-session, not the synced copy.
* Repo access is **review-only** unless Daniel explicitly asks for code changes.
* Do not commit. Daniel tests first and decides when to commit.

---

## 2. Daniel’s Working Preferences

Daniel decides what happens next.

Claude may: suggest options, recommend the safest option, explain tradeoffs, help protect scope.

Claude should not: take over project direction, overbuild systems, make large rewrites without approval, add unrelated features, or assume approval to code sizable changes.

Before coding, Claude should provide:

1. Intended change
2. Files affected
3. Risks / assumptions
4. Recommended approach
5. Whether the change is safe as a small controlled pass

For sizable features, wait for Daniel’s “go ahead.” Small, clearly-specified tweaks can be implemented directly. Single-value tweaks are often best handed back as "change line N to X" so Daniel edits them himself.

After coding, Claude should provide:

1. Files changed
2. What changed
3. Exact test steps
4. Known risks / bugs
5. Confirmation that every changed JS file passed `node --check`
6. Ready-to-paste `AI_USAGE.md` log row
7. Git checkpoint reminder

Git reminder format (do **not** include `cd <path>`):

```bash
git add .
git commit -m "Describe completed tested feature"
git push
```

Editing style: surgical edits over full rewrites; group tunable constants; **deliver the entire updated file** via the file tool (no partial snippets/diffs), built from Daniel’s current versions to avoid clobbering his local tweaks (e.g. sprite scales, projectile counts, tuned constants). Daniel provides current files at session start when exactness matters.

Asset-art workflow (recurring): Daniel authors sprites himself (PixelLab.AI). Pattern is — Claude gives exact size/spec, Daniel makes the PNG and uploads it, Claude measures it (size/alpha/inner bounds) and wires it 1:1 with a code-drawn fallback. Author 1:1, integer scale only for crispness (`imageSmoothingEnabled = false`), draw on whole-pixel coords, lowercase filenames.

---

## 3. Current Game Summary

Core fantasy:

> A young witch survives waves of cursed creatures. Her ghost cat familiar is the real attacker. The witch dodges, collects EXP motes, levels up, chooses upgrades, and shapes the familiar into a stronger spirit.

Core gameplay:

* Player moves and dodges; never aims or manually shoots
* Ghost cat familiar auto-attacks the nearest enemy
* EXP motes level the player; the player chooses upgrades
* Boss appears every 10th wave
* Endless mode continues until death

Modes: **Tutorial Run** (10 waves → Wave-10 boss → Victory) and **Endless Mode** (bosses every 10 waves, per-tier scaling, localStorage best wave/score + a top-10 high-score table). The world is larger than the 960×540 screen (2400×1344) with a player-following camera.

The UI is now **pixel-art skinned** (menu buttons, upgrade cards, health bar, upgrade icons), all with code-drawn fallbacks so missing art never breaks anything.

---

## 4. Current Architecture

```txt
familiar-frenzy/
  index.html
  style.css
  src/
    main.js      # entry point, canvas setup, delta-time game loop, font preload, initAudio
    game.js      # main state machine + gameplay orchestration; world/camera; arena tiles;
                 #   run logic; drop & collection logic (findDropSpot); high-score persistence;
                 #   music-context sync; all screen wiring
    input.js     # keyboard input and one-frame ("pressed this frame") presses
    player.js    # witch movement, health, animation, wall clamp/collision, death anim
    familiar.js  # ghost cat: follow, auto-attacks, projectile (Bolt) behavior, attack visuals,
                 #   ghost imprints, rune projectile sprites
    enemies.js   # Enemy (Cursed Wisp) + Boss (Elder Wisp, sprite-driven) + WaveManager + scaling
                 #   NOTE: DEBUG_FORCE_BOSS flag lives here (see §6 / §10).
    pickups.js   # EXP motes, health flasks, Spirit Magnet
    upgrades.js  # upgrade definitions, caps, offer selection, fallback reward, evolution data,
                 #   getGrimoireEntries()
    ui.js        # menus, HUD, upgrade cards + icons, pause, boss bar, victory, game over,
                 #   settings, Grimoire, High Scores; loads + draws all UI sprites
    assets.js    # safe image loading with graceful fallback (loadImage/getImage; null until loaded)
    utils.js     # math helpers (clamp/lerp/distance/random/circlesOverlap) + dirFromVector (8-way facing)
    audio.js     # music pool (9 tracks, looping + timed rotation) + boss track (crossfade,
                 #   volume persist) + familiar projectile SFX
  assets/
    fonts/  tiles/  music/  sfx/  backgrounds/
    sprites/
      player/  familiar/  enemies/  pickups/  projectiles/
      ui/        # menu_button.png, upgrade_card.png, health_bar.png
      upgrades/  # one 32x32 icon per upgrade id (see §7)
  README.md  CREDITS.md  AI_USAGE.md  PROJECT_HANDOFF.md  .gitignore
```

---

## 5. Current Implemented Features

* Main menu (Play, How to Play, Grimoire, High Scores, Settings) — **pixel-art button sprites**, vertically centered button block, footer hints pinned bottom-center
* Mode select (Tutorial / Endless / Back)
* Tutorial Run (10 waves → Wave-10 boss → Victory)
* Endless Mode (bosses every 10 waves, per-tier scaling, Tutorial→Endless carryover)
* Wave system with intermission banners + difficulty scaling
* Boss waves; **Elder Wisp** boss (wobble-follow, telegraphed dash, summons, HP bar); boss kill grants a free upgrade
* Larger scrolling world + player-following camera; clamped drops; non-overlapping drop placement (`findDropSpot`)
* Player movement, health, i-frames, 8-dir idle/walk/die animation
* Ghost cat familiar: follow + auto-attack, bolt piercing
* Familiar projectile visuals (random **rune** sprite pool, orb fallback)
* Familiar projectile **SFX**
* Familiar **ghost imprints** (distance-spaced fading afterimages)
* EXP motes (pulsing gold glow)
* Health flask pickups (heal **15**)
* Rare pickup: **Spirit Magnet** — on pickup, vacuums all dropped rewards toward the player for ~1.5s (base ~0.8% from normal kills, ~20% from bosses; normal-kill chance now scales with luck)
* Upgrade choices + per-upgrade caps; Spirit Recovery fallback when all maxed
* **Upgrade cards are sprite-skinned** (240×180 container) with **per-upgrade 32×32 icons** (glow, no disc) — see §6/§7
* **Phantom Pounce** evolution (choosable card, guaranteed slot once unlocked)
* **Spirit Imbued** mode (player-facing name; internal code still uses `frenzy*`)
* Spirit Link visual (ribbon between witch and familiar during Spirit Imbued)
* Dungeon tiled arena (wall-ring border + collision inset, seeded floor props)
* **Wisp enemy sprite integration** — 8-direction Float (4 frames, loops) + Attack (4 frames, cosmetic). Per-direction blob fallback + hit-flash.
* **HUD** — sprite-skinned health bar (colored fill + HP label drawn in-code in the well), score, XP bar + level, Spirit Imbued meter. Persistent top-center "Wave X" label removed (wave-start banner + pause label remain).
* Pause menu (stats + taken-upgrades panels, options centered at bottom)
* **Settings menu** — music volume slider, persisted
* Music: shared menu/play pool (9 tracks, looping + timed rotation) + dedicated boss track, with crossfade
* **High Scores screen: implemented** — top-10 Endless leaderboard from localStorage (`ff_highscores`)
* **Grimoire** — read-only glossary from Main Menu + Pause; two-level Upgrades/Evolutions accordion; **entry rows now show the upgrade's icon** (see §8)
* localStorage best wave/score (Endless) + top-10 high scores
* Asset fallback safety (missing sprite/sound → placeholder/silence, never crashes)

Remaining placeholder art: the **Elder Wisp boss** is sprite-driven in code but falls back to a drawn shape if its art isn't in place (see §6/§7). The **health flask** sprite loader is wired (`flask_idle.png`) with a drawn "+" fallback.

---

## 6. Most Recent Work Completed

### Feature / Task Completed

```txt
Large UI/pixel-art skinning + systems batch (2026-06-10 → 2026-06-11): wired all
core UI sprites and per-upgrade icons, implemented the High Scores screen,
reworked Lucky Paws, integrated the Elder Wisp boss sprite, overhauled music
behavior, and fixed two boot/runtime bugs.
```

### Files Changed (across the batch)

```txt
- src/ui.js       (UI sprites, icons, layout, High Scores screen, HUD declutter, text() stroke)
- src/game.js     (High Scores persistence, Lucky Paws rework, findDropSpot, flask/magnet tuning)
- src/enemies.js  (Elder Wisp boss sprite + dash/summon tuning; DEBUG_FORCE_BOSS flag)
- src/audio.js    (looping + rotation, POOL_COUNT=9, play()-rejection fix + logging)
- src/pickups.js  (Spirit Magnet sprite path)
```

### What Changed

```txt
UI SPRITES (ui.js, all with code-drawn fallbacks; ui.js now imports loadImage/getImage):
- Menu buttons: assets/sprites/ui/menu_button.png (175x37) drawn 1:1 for every menu
  item; selected item gets a gold glow; menu font reduced to 20 with a dark outline;
  button block vertically centered by item count; footer hints pinned bottom-center;
  label nudged (labelDY) to optically center caps in the frame.
- Upgrade card: assets/sprites/ui/upgrade_card.png (240x180) as the card container,
  drawn 1:1; card enlarged from 150->180 tall and internals re-spaced for breathing room.
- Health bar: assets/sprites/ui/health_bar.png (263x16) frame; the colored fill
  (green>50% / yellow>25% / red) and the HP label are drawn IN CODE inside the well
  (insets inX:3, inY:4 → 257x8 fill area). HP label sized 10 to fit the thin bar.

UPGRADE ICONS (ui.js):
- New data-driven drawUpgradeIcon(ctx, cx, cy, up, {size, glow}) helper. Icon path is
  DERIVED FROM the upgrade id: assets/sprites/upgrades/<id>.png (no new data field;
  upgrades.js untouched). Registered ONCE via a guard Set (no per-frame reload/spam).
- Cards: 48px icon with a soft purple glow that emanates from the icon shape (no solid
  disc). Grimoire entry rows: 22px icon, no glow. Missing/loading icon → glowing orb.
- text() helper gained optional stroke / strokeWidth (used for outlined HUD/menu text).

HIGH SCORES (game.js + ui.js):
- Top-10 Endless leaderboard in localStorage key "ff_highscores"
  ({score, wave, date}, sorted score-desc then wave-desc). Saved once per Endless death.
  Real drawHighScores() screen replaces the old "Coming Soon" placeholder. Tutorial excluded.

GAMEPLAY TUNING (game.js):
- Lucky Paws reworked to RARE-DROP-ONLY: removed the bonus-XP-mote roll; luck now scales
  flask + Spirit Magnet drop chances (LUCK_FLASK_STEP, LUCK_MAGNET_STEP).
- findDropSpot(): non-overlapping placement for dropped rewards (rings outward).
- Flask: FLASK_HEAL=15, FLASK_DROP_CHANCE=0.015 (Daniel's tuned values — preserve).

ELDER WISP BOSS SPRITE (enemies.js):
- 8-dir Float (4-frame loop) + state-driven Charge (telegraph=frame0, dashing=frame1),
  hit-flash, placeholder fallback. Dash telegraph is a scrolling chevron span; dash/summon
  pacing tuned (slower charge, staggered summons released one at a time).
- DEBUG_FORCE_BOSS flag added (boss every wave for testing). ** Currently TRUE — must be
  set FALSE for release. ** (see §10)

AUDIO (audio.js):
- Normal tracks now LOOP and rotate to a new random track only after
  NORMAL_TRACK_MIN_PLAY_SECONDS (240s), instead of reshuffling every song end.
- POOL_COUNT = 9 (Daniel has familiar_theme_01..09). MUST stay 9 — reverting to 3 caused
  random menu silence (picker could choose tracks it didn't know about).
- BUGFIX: a rejected play() no longer revokes the `unlocked` flag (that was poisoning all
  music while SFX kept working). Rejections now log a visible warning + retry on the next
  gesture; successful starts log "[audio] now playing ...".

BUGFIX (ui.js):
- Fixed a `fillColor` const redeclaration inside drawHUD (collided with the Spirit Imbued
  meter's variable) that was a SyntaxError → black screen at boot. Renamed to hpFillColor.
```

### Test Results

```txt
Daniel tested each step in-browser via Live Server (screenshots), confirmed working, and
requested iterative tweaks (menu centering, label centering, icon size + glow-without-disc,
HP text size, Grimoire icons) — all applied. Every changed JS file passed node --check.
This batch was committed/pushed by Daniel.
```

### Known Issues / Risks

```txt
- DEBUG_FORCE_BOSS in enemies.js is TRUE — boss spawns every wave. MUST be set false
  before any real build/submission. (Highest-priority TODO.)
- Card upgrade icons are 48px drawn from a 32px source (1.5x) with smoothing off — crisp
  but not a perfectly even pixel-double. If strict pixel art shows uneven widths, the size
  is a one-line tunable in the drawUpgradeIcon call: 64 = even 2x, 32 = even 1x.
- Grimoire fits 960x540 with one category open + one entry expanded; many more upgrades in
  one category could eventually need scrolling.
- Elder Wisp boss is sprite-driven but falls back to a drawn shape if its art isn't present.
- No outstanding bugs known.
```

### AI_USAGE.md Rows (repo format: | Date | Category | What was done | AI tool |)

```md
| 2026-06-10 | UI | Wired menu button, upgrade card, and health bar frame sprites with code-drawn fallbacks; rebalanced main menu layout | Claude |
| 2026-06-10 | Systems | Implemented top-10 Endless High Scores screen (localStorage ff_highscores) replacing placeholder | Claude |
| 2026-06-10 | Gameplay | Reworked Lucky Paws to rare-drop-only; luck scales flask/magnet drops; added non-overlapping drop placement | Claude |
| 2026-06-10 | Art/Enemies | Integrated Elder Wisp boss sprite (8-dir Float + Charge, chevron telegraph) with fallback; tuned dash/summons | Claude |
| 2026-06-10 | Audio | Looping + timed rotation for normal pool; fixed silent-music state poisoning on rejected play(); POOL_COUNT=9 | Claude |
| 2026-06-11 | UI | Per-upgrade 32x32 icons (data-driven, id-derived, glow no disc, orb fallback); 240x180 cards; HP label fit; Grimoire icons | Claude |
| 2026-06-11 | Bugfix | Fixed fillColor redeclaration in drawHUD that black-screened boot | Claude |
```

### Suggested Commit Message (already done this batch)

```bash
git add .
git commit -m "Add UI/upgrade-icon sprites, High Scores, boss sprite, audio fixes"
git push
```

---

## 7. Current Asset Notes

Sprites are single-row strips, sliced at draw time (`frameWidth = img.width / frames`). Directions: `n s e w ne nw se sw`. Missing assets fall back to drawn placeholders. **Filenames must be lowercase and exact** (itch.io is case-sensitive).

### Player

```txt
Path:   assets/sprites/player/witch_<anim>_<dir>.png
Anims:  idle (4 frames, loops), walk (6, loops), die (8, one-shot)
Dirs:   8-direction
Fallback: purple placeholder circle. "Hurt" = invulnerability flicker (no sprite).
```

### Familiar

```txt
Path:   assets/sprites/familiar/familiar_<anim>_<dir>.png
Anims:  idle (4 frames, loops; doubles as float/drift), attack (6, one-shot)
Dirs:   8-direction; spriteScale ~0.55
Projectiles: assets/sprites/projectiles/rune_01..14.png (RUNE_SCALE ~0.5);
             each bolt keeps one random rune for its lifetime; orb fallback.
Also:   distance-spaced ghost-imprint afterimages (visual only).
Fallback: drawn black-cat shape.
```

### Wisp Enemy

```txt
Directions: N S E W NE NW SE SW
Animations: Float 4 frames (loops), Attack 4 frames (loops while touching player; cosmetic)
Paths:
  assets/sprites/enemies/wisp_float_<dir>.png
  assets/sprites/enemies/wisp_attack_<dir>.png   (16 files total)
spriteScale: 1 (tunable in the Enemy constructor; visual only — hitbox is radius 13)
Facing: via shared dirFromVector(dx, dy) in utils.js (octant-based, vertical-first diagonals)
Fallback: red blob + white hit-flash, per direction.
```

### Elder Wisp Boss

```txt
Animations: Float (4-frame loop) + Charge (2 frames: telegraph=0, dashing=1)
Paths:
  assets/sprites/enemies/elder_wisp_float_<dir>.png    (4 frames each)
  assets/sprites/enemies/elder_wisp_charge_<dir>.png   (2 frames each)
Dirs:   8-direction; spriteScale tunable in the Boss constructor (art authored ~116x116)
State:  normal → faces the player; charge → faces the dash vector.
Fallback: drawn placeholder shape + hit-flash. Dash telegraph = scrolling chevrons.
```

### UI Sprites

```txt
assets/sprites/ui/menu_button.png    175x37  (drawn 1:1 per menu item; selected = gold glow)
assets/sprites/ui/upgrade_card.png   240x180 (level-up card container; text/icon drawn on top)
assets/sprites/ui/health_bar.png     263x16  (gold frame + dark well; inner fill area ~257x8,
                                       insets inX:3 inY:4; colored fill + HP text drawn in code)
All UI sprites have code-drawn fallbacks (removing a PNG cleanly reverts to the old look).
```

### Upgrade Icons

```txt
Path:   assets/sprites/upgrades/<id>.png   (32x32, one per upgrade id)
Drawn:  48px on cards (with glow), 22px in the Grimoire (no glow); orb fallback if missing.
Id-derived, so the upgrade data owns the path with no extra field.
Files (BY ID — note display name vs id differences):
  sharper_spirit_claws.png
  restless_wisp.png
  spirit_heart.png
  magnet_charm.png
  ghost_pounce.png
  frenzy_focus.png        ← "Spirit Focus" (id is frenzy_focus)
  lucky_paws.png
  phantom_pounce.png      ← evolution
  spirit_recovery.png     ← optional (emergency-heal offer); orb fallback if absent
```

### Pickups

```txt
EXP mote:      assets/sprites/pickups/mote_idle.png  (gold glow halo; gold-orb fallback)
Health flask:  assets/sprites/pickups/flask_idle.png (heal 15; green-orb "+" fallback)
Spirit Magnet: assets/sprites/pickups/spirit_magnet.png (pulsing golden-orange ring fallback)
```

### Music

```txt
Normal shared pool (9 tracks, looping + timed rotation):
- assets/music/familiar_theme_01.mp3 ... familiar_theme_09.mp3
Boss music:
- assets/music/boss_theme.mp3
Config (audio.js): POOL_COUNT=9 (MUST stay 9), MUSIC_EXT="mp3", FADE_MS=700,
  NORMAL_TRACK_MIN_PLAY_SECONDS=240.
Behavior: tracks LOOP and rotate after the min-play time; crossfade between tracks;
  autoplay-gated until first user gesture; rejected play() logs + retries on next gesture.
Volume: localStorage key "ff_musicVolume" (0-100, default 60), live via Settings slider.
```

### SFX

```txt
Familiar projectile SFX:
- assets/sfx/familiar_projectile.wav  (throttled, autoplay-gated, 4-voice pool; missing = silent)
- SFX_VOLUME ~0.18 (independent of the music slider).
```

### Fonts / Tiles

```txt
Fonts: assets/fonts/darkrunes-arcanum.ttf (titles), neatpixels-standard.ttf (body)
Tiles: assets/tiles/Main_Dungeon.png (32px 4x4 wall+floor), assets/tiles/floor_props.png
```

---

## 8. Upgrade System Summary

Data-driven in `upgrades.js`. Each upgrade: `{ id, name, description, tag, maxLevel, apply(game) }` plus glossary fields `maxedStat` (short maxed value shown inline in the Grimoire) and `evolutionNotes` (only where the upgrade feeds an evolution). Levels are tracked on `game.upgradeLevels`. Upgrade icons are derived from `id` (see §7) — no icon field in the data.

Current upgrades:

```txt
- Sharper Spirit Claws  (attack,   max 5)  damage +1        (MAXED +5)
- Restless Wisp         (speed,    max 5)  cooldown -15%    (MAXED -56%)
- Spirit Heart          (survival, max 3)  max health +20   (MAXED +60)
- Magnet Charm          (utility,  max 4)  pickup range     (MAXED +220 range)
- Ghost Pounce          (attack,   max 3)  pierce +1        (MAXED +3)
- Spirit Focus          (frenzy,   max 3)  Spirit Imbued charges faster (MAXED +3 per mote)
                         (id = frenzy_focus)
- Lucky Paws            (utility,  max 3)  raises luck → higher flask + Spirit Magnet drop
                         chances (rare-drop-only; no longer grants bonus XP motes)
- Spirit Recovery       (fallback reward; heals; offered only when all maxed; NOT in the Grimoire)
```

Current evolution:

```txt
Phantom Pounce — bolts pierce +2 and deal +2 damage, turn gold, banner fires.
Choosable card with a guaranteed offer slot once unlocked.
```

Phantom Pounce unlock condition (from code):

```txt
Sharper Spirit Claws maxed (Lv. 5) AND Ghost Pounce maxed (Lv. 3).
```

Important:

* Do not change upgrade balance unless Daniel asks.
* Keep future upgrade/glossary work data-driven. New upgrade → add to `UPGRADES`
  with `maxedStat` (+ `evolutionNotes` if relevant) and it appears in the offers,
  the Grimoire, AND (if a matching `assets/sprites/upgrades/<id>.png` exists) the
  icon — automatically.
* Player-facing term is **"Spirit Imbued"**; internal variables/ids are
  intentionally still named `frenzy*` (e.g. the `frenzy_focus` id) — do not rename.

---

## 9. Current State Machine Notes

Current states (`game.js`):

```txt
MAIN_MENU, MODE_SELECT, HOW_TO_PLAY, GRIMOIRE,
ENDLESS_PLACEHOLDER, HIGHSCORES_PLACEHOLDER, SETTINGS_PLACEHOLDER,
PLAYING, PAUSED, CONFIRM_QUIT, LEVEL_UP, DYING, GAME_OVER, VICTORY
```

Important menu return behavior:

```txt
- Grimoire opens from Main Menu OR Pause; grimoireReturn sends Back to the
  correct source. Levels (Current x/y) are shown only when opened from Pause.
- Settings opens from Main Menu OR Pause; settingsReturn sends Back to the source.
- Pause options: Resume / Grimoire / Settings / Main Menu (Main Menu asks to confirm).
```

Legacy/unused state names (cleanup candidates):

```txt
- HIGHSCORES_PLACEHOLDER: name is now legacy — it is the FUNCTIONAL High Scores screen
  (top-10 Endless leaderboard), no longer a placeholder.
- SETTINGS_PLACEHOLDER: name is legacy — it is the FUNCTIONAL Settings screen
  (music volume slider).
- ENDLESS_PLACEHOLDER: defined but never entered (Mode Select goes straight into
  startGame("endless")). Safe to remove during cleanup.
```

---

## 10. Current Backlog / Likely Next Tasks

### TOP PRIORITY — Release flag

```txt
Set DEBUG_FORCE_BOSS = false in enemies.js before any build/submission. It currently
forces a boss every wave for testing.
```

### Option A — Audio / Game-Feel Polish

```txt
Add more SFX (pickup, enemy hit, level-up, boss spawn) using the existing
autoplay-gated, voice-pool pattern in audio.js.
```

### Option B — Final Jam Polish

```txt
itch build checklist, README/CREDITS/AI_USAGE cleanup, remove dead
ENDLESS_PLACEHOLDER state, verify zip-at-root packaging, confirm all asset
filenames are lowercase/exact for itch's case-sensitive server.
```

### Option C — Remaining Art / Visual Tidy

```txt
- Confirm/lock the Elder Wisp boss art (the last big drawn placeholder if its sprite
  files aren't yet in place).
- Optional: reuse drawUpgradeIcon in the pause "taken upgrades" panel for consistency.
- Optional: card icon size 48 -> 64 for an even 2x scale (re-space the card if so).
- Optional: a menu_button_selected.png (175x37) to replace the code glow on selection.
```

### Enemy-scaling note (for when a 2nd enemy is added)

```txt
There is currently ONE Enemy (Wisp) class + a separate Boss class. When adding
more enemy types, prefer a data-driven ENEMY_TYPES table (keyed by type) where
each entry owns its spriteScale, sprite key, frame counts, and base stats —
mirroring the UPGRADES table. Use a subclass only for genuinely different
behavior. Per-enemy size = a field that enemy owns (spriteScale is visual;
radius is the hitbox), never a global.
```

Recommended next task:

```txt
First, the one-line DEBUG_FORCE_BOSS = false safety flip. After that, Option B
(final jam polish) is the natural direction since the major feature/art work is
largely done. Claude should present the options and let Daniel choose.
```

---

## 11. Important Scope Guardrails

Avoid adding: large new systems, inventory/shop systems, online leaderboards, complex procedural maps, multiple new enemy types at once, dialogue systems, massive upgrade trees, major balance rewrites without testing, external libraries, npm/build tooling.

Prefer: one feature at a time, visual polish, clarity improvements, safe fallback behavior, menu completion, audio/game-feel polish, final jam readiness.

---

## 12. First Response Required from Next Claude

When the next Claude session starts, respond with:

1. Confirmation that this handoff was read
2. A short summary of current project state
3. Any important risks/TODOs from the handoff (call out DEBUG_FORCE_BOSS)
4. A small option list for what Daniel could do next
5. Ask Daniel what he wants to work on next

Do not start coding immediately.
