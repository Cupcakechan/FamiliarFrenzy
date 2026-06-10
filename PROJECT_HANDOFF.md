# Familiar Frenzy — Handoff for Next Claude Session

> Living document. Update §5, §6, §7, §8, §9 whenever something changes so the
> next session starts with an accurate picture. Last updated: 2026-06-09.

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
  size). Work from the synced/uploaded files, not from stale copies.
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

Editing style: surgical edits over full rewrites; group tunable constants; deliver full updated files via the file tool, built from Daniel’s current versions to avoid clobbering his local tweaks (e.g. sprite scales, projectile counts).

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

Modes: **Tutorial Run** (10 waves → Wave-10 boss → Victory) and **Endless Mode** (bosses every 10 waves, per-tier scaling, localStorage best wave/score). The world is larger than the 960×540 screen (2400×1344) with a player-following camera.

---

## 4. Current Architecture

```txt
familiar-frenzy/
  index.html
  style.css
  src/
    main.js      # entry point, canvas setup, delta-time game loop, font preload, initAudio
    game.js      # main state machine + gameplay orchestration; world/camera; arena tiles;
                 #   run logic; drop & collection logic; all screen wiring
    input.js     # keyboard input and one-frame ("pressed this frame") presses
    player.js    # witch movement, health, animation, wall clamp/collision, death anim
    familiar.js  # ghost cat: follow, auto-attacks, projectile (Bolt) behavior, attack visuals,
                 #   ghost imprints, rune projectile sprites
    enemies.js   # Enemy (Cursed Wisp) + Boss (Elder Wisp) + WaveManager + scaling
    pickups.js   # EXP motes, health flasks, Spirit Magnet
    upgrades.js  # upgrade definitions, caps, offer selection, fallback reward, evolution data,
                 #   getGrimoireEntries()
    ui.js        # menus, HUD, upgrade cards, pause, boss bar, victory, game over, settings, Grimoire
    assets.js    # safe image loading with graceful fallback (null until loaded)
    utils.js     # math helpers (clamp/lerp/distance/random/circlesOverlap) + dirFromVector (8-way facing)
    audio.js     # music pool + boss track (crossfade, volume persist) + familiar projectile SFX
  assets/
    fonts/  tiles/  sprites/  backgrounds/  sfx/  music/
  README.md  CREDITS.md  AI_USAGE.md  PROJECT_HANDOFF.md  .gitignore
```

---

## 5. Current Implemented Features

* Main menu (Play, How to Play, Grimoire, High Scores, Settings)
* Mode select (Tutorial / Endless / Back)
* Tutorial Run (10 waves → Wave-10 boss → Victory)
* Endless Mode (bosses every 10 waves, per-tier scaling, Tutorial→Endless carryover)
* Wave system with intermission banners + difficulty scaling
* Boss waves; **Elder Wisp** boss (wobble-follow, telegraphed dash, summons, HP bar); boss kill grants a free upgrade
* Larger scrolling world + player-following camera; clamped drops
* Player movement, health, i-frames, 8-dir idle/walk/die animation
* Ghost cat familiar: follow + auto-attack, bolt piercing
* Familiar projectile visuals (random **rune** sprite pool, orb fallback)
* Familiar projectile **SFX**
* Familiar **ghost imprints** (distance-spaced fading afterimages)
* EXP motes (pulsing gold glow)
* Health flask pickups (heal 25)
* Rare pickup: **Spirit Magnet** — implemented; on pickup, vacuums all dropped rewards toward the player for ~1.5s (0.8% from normal kills, 20% from bosses)
* Upgrade choices + per-upgrade caps; Spirit Recovery fallback when all maxed
* **Phantom Pounce** evolution (choosable card, guaranteed slot once unlocked)
* **Spirit Imbued** mode (player-facing name; internal code still uses `frenzy*`)
* Spirit Link visual (ribbon between witch and familiar during Spirit Imbued)
* Dungeon tiled arena (wall-ring border + collision inset, seeded floor props)
* **Wisp enemy sprite integration: implemented** — 8-direction Float (4 frames, loops) + Attack (4 frames, loops while touching the player; cosmetic only). Per-direction blob fallback + hit-flash.
* Pause menu (stats + taken-upgrades panels, options centered at bottom)
* **Settings menu: implemented** — music volume slider, persisted
* Music: shared menu/play pool + dedicated boss track, with crossfade
* **High Scores screen: placeholder** ("Coming Soon")
* **Grimoire: implemented** — read-only glossary from Main Menu + Pause; two-level Upgrades/Evolutions accordion (see §8)
* localStorage best wave/score (Endless)
* Asset fallback safety (missing sprite/sound → placeholder/silence, never crashes)

Still placeholder art: the **Elder Wisp boss** and the **health flask** are drawn shapes.

---

## 6. Most Recent Work Completed

### Feature / Task Completed

```txt
Upgrade Grimoire (read-only glossary) + several follow-up refinements, ending with
a Phantom Pounce unlock-requirement change.
```

### Files Changed

```txt
- src/game.js
- src/ui.js
- src/upgrades.js
```

### What Changed

```txt
- Added a read-only Grimoire reachable from Main Menu and Pause, with a return-
  target so Back goes to the correct source screen.
- Reworked it into a two-level accordion: top level = "Upgrades" and "Evolutions"
  category headers (opening one closes the other); inside, each entry expands to
  its detail (one open at a time).
- Detail shows Effect with the maxed value inlined, e.g.
  "Effect: Familiar damage +1 (MAXED +5)"; a "Current Lv. x/y" line when opened
  from Pause; and an "Evolution" line only where it applies. Evolutions show
  effect only. Spirit Recovery is excluded from the glossary.
- Renamed the screen + menu entries from "Upgrade Grimoire" to just "Grimoire".
- Pause menu relaid out: run stats (left) + taken upgrades (right) top-aligned,
  options moved to a centered list near the bottom.
- Glossary data is data-driven in upgrades.js via getGrimoireEntries(), reading
  maxedStat (+ evolutionNotes only where an upgrade feeds an evolution).
- Phantom Pounce now requires BOTH Sharper Spirit Claws (Lv.5) AND Ghost Pounce
  (Lv.3) maxed; both prerequisite notes read "Required for Phantom Pounce
  (must be maxed)."
```

### Test Results

```txt
Daniel tested in-browser via Live Server (screenshots), confirmed working, and
requested iterative tweaks (inline MAXED text, "Grimoire" rename, pause layout,
Phantom Pounce requirement) — all applied. Every changed JS file passed
node --check.
```

### Known Issues / Risks

```txt
- Grimoire fits 960x540 with one category open + one entry expanded; if many more
  upgrades are added to one category, it may eventually need scrolling.
- Elder Wisp boss and health flask are still drawn placeholders (no sprite).
- No outstanding bugs known.
```

### AI_USAGE.md Row (repo format: | Date | Category | What was done | AI tool |)

```md
| 2026-06-09 | UI/Systems | Grimoire glossary from Main Menu + Pause: two-level Upgrades/Evolutions accordion, inline MAXED stat in Effect, current level from Pause, Spirit Recovery excluded, renamed to "Grimoire"; Phantom Pounce now requires Ghost Pounce maxed | Claude |
```

### Suggested Commit Message

```bash
git add .
git commit -m "Add Grimoire glossary and tighten Phantom Pounce requirement"
git push
```

---

## 7. Current Asset Notes

Sprites are single-row strips, sliced at draw time (`frameWidth = img.width / frames`). Directions: `n s e w ne nw se sw`. Missing assets fall back to drawn placeholders.

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
Animations: Float 4 frames (loops), Attack 4 frames (loops while touching player; cosmetic only)
Paths:
  assets/sprites/enemies/wisp_float_<dir>.png
  assets/sprites/enemies/wisp_attack_<dir>.png   (16 files total)
spriteScale: 1 (tunable in the Enemy constructor; visual only — hitbox is radius 13)
Facing: via shared dirFromVector(dx, dy) in utils.js (octant-based, vertical-first diagonals)
Fallback: red blob + white hit-flash, per direction.
```

### Pickups

```txt
EXP mote:      assets/sprites/pickups/mote_idle.png  (gold glow halo; gold-orb fallback)
Health flask:  assets/sprites/pickups/flask_idle.png (heal 25; green-orb "+" fallback — currently placeholder)
Spirit Magnet: assets/sprites/pickups/spirit_magnet.png (pulsing golden-orange ring fallback)
```

### Music

```txt
Normal shared pool:
- assets/music/familiar_theme_01.mp3
- assets/music/familiar_theme_02.mp3
- assets/music/familiar_theme_03.mp3
Boss music:
- assets/music/boss_theme.mp3
Behavior: crossfade between tracks; autoplay-gated until first user gesture.
Volume: localStorage key "ff_musicVolume" (0-100, default 60), live via Settings slider.
```

### SFX

```txt
Familiar projectile SFX:
- assets/sfx/familiar_projectile.wav  (throttled, autoplay-gated, voice pool; missing file = silent)
```

### Fonts / Tiles

```txt
Fonts: assets/fonts/darkrunes-arcanum.ttf (titles), neatpixels-standard.ttf (body)
Tiles: assets/tiles/Main_Dungeon.png (32px 4x4 wall+floor), assets/tiles/floor_props.png
```

---

## 8. Upgrade System Summary

Data-driven in `upgrades.js`. Each upgrade: `{ id, name, description, tag, maxLevel, apply(game) }` plus glossary fields `maxedStat` (short maxed value shown inline in the Grimoire) and `evolutionNotes` (only where the upgrade feeds an evolution). Levels are tracked on `game.upgradeLevels`.

Current upgrades:

```txt
- Sharper Spirit Claws  (attack,   max 5)  damage +1        (MAXED +5)
- Restless Wisp         (speed,    max 5)  cooldown -15%    (MAXED -56%)
- Spirit Heart          (survival, max 3)  max health +20   (MAXED +60)
- Magnet Charm          (utility,  max 4)  pickup range     (MAXED +220 range)
- Ghost Pounce          (attack,   max 3)  pierce +1        (MAXED +3)
- Spirit Focus          (frenzy,   max 3)  Spirit Imbued charges faster (MAXED +3 per mote)
- Lucky Paws            (utility,  max 3)  better drops     (MAXED +3 luck)
- Spirit Recovery       (fallback reward; heals 25; offered only when all maxed; NOT in the Grimoire)
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
  with `maxedStat` (+ `evolutionNotes` if relevant) and it appears in both the
  offers and the Grimoire automatically.
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

Known dead/unused states:

```txt
- ENDLESS_PLACEHOLDER: defined but never entered (Mode Select goes straight into
  startGame("endless")). Safe to remove during cleanup.
- SETTINGS_PLACEHOLDER: the name is legacy — it is the FUNCTIONAL Settings screen
  (music volume slider), not a placeholder.
- HIGHSCORES_PLACEHOLDER: genuine placeholder ("Coming Soon").
```

---

## 10. Current Backlog / Likely Next Tasks

### Option A — Enemy / Boss Visual Integration

```txt
Give the Elder Wisp boss a real sprite (it's the most visible remaining
placeholder), following the same 8-dir + fallback pattern the Wisp now uses.
```

### Option B — Menu Completion

```txt
Build the High Scores screen (the last placeholder menu) — e.g. show the
localStorage best Endless wave/score that's already tracked.
```

### Option C — Audio / Game-Feel Polish

```txt
Add more SFX (pickup, enemy hit, level-up, boss spawn) using the existing
autoplay-gated, voice-pool pattern in audio.js.
```

### Option D — Pickup / Flask Art

```txt
Wire the health-flask sprite (flask_idle.png) and any remaining pickup art; the
loaders already support it with fallbacks.
```

### Option E — Final Jam Polish

```txt
itch build checklist, README/CREDITS/AI_USAGE cleanup, remove dead
ENDLESS_PLACEHOLDER state, verify zip-at-root packaging.
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
Option A (Elder Wisp boss sprite) is the natural follow-on to the just-completed
Wisp sprite work and removes the most obvious remaining placeholder. Option B
(High Scores) is an equally safe, contained menu-completion task. Claude should
present both and let Daniel choose.
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
3. Any important risks/TODOs from the handoff
4. A small option list for what Daniel could do next
5. Ask Daniel what he wants to work on next

Do not start coding immediately.
