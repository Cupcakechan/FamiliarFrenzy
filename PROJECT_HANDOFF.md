# Familiar Frenzy — Project Handoff

Last updated: **2026-06-11 (release-prep pass)** — rewritten from the verified current
repo state, not from the previous handoff.

---

## 1. Purpose of This Document

This is the living source of truth for continuing **Familiar Frenzy**, Daniel's
browser-based top-down survival arena game for **AI Browser Game Jam 3**. Read it fully
before suggesting or changing anything. Update it at the end of any session that
completes work.

---

## 2. Ground Rules for Working With Daniel

* Tech stack: **plain HTML / CSS / JS + HTML5 Canvas, ES modules. No frameworks, no
  npm, no TypeScript, no build tools.** Runs locally via VS Code **Live Server**.
  **Python is NOT available** on Daniel's machine — never suggest Python commands.
* Repo access in the Claude project context is **review-only** and may reflect the
  last push, not the working copy. The `assets/` folder may be excluded from sync.
  **When exact file contents matter, ask Daniel to upload the current files** before
  delivering edits.
* Deliver **entire updated files** via the file tool (no diffs/snippets as the main
  delivery), built from Daniel's current uploaded versions.
* Every changed JS file must pass `node --check`. Confirm this in the delivery.
* **Never clobber Daniel's locally tuned values.** Known tuned values to preserve:
  * `familiar.js`: `RUNE_COUNT 14`, `RUNE_SCALE 0.5`, `spriteScale 0.55`
  * `enemies.js`: Elder Wisp boss `spriteScale = 2`
  * `game.js`: `FLASK_HEAL 15`, `FLASK_DROP_CHANCE 0.015`
  * `audio.js`: `POOL_COUNT 9` (NEVER lower — see §8), `SFX_VOLUME 0.18`
  * `ui.js`: `TITLE_OFFSET_X -13` (optical centering of the title banner)
* Options/plan before non-trivial coding; wait for Daniel's go-ahead. Small, clearly
  specified tweaks may be done directly. Single-value tweaks are often best handed
  back as "change line N to X."
* After completed work: files changed, what changed, test steps, risks, node --check
  confirmation, ready-to-paste `AI_USAGE.md` row, git checkpoint block (NO `cd` lines).
  Daniel tests first and decides when to commit — **never commit for him**.
* Git block format:

```bash
git add .
git commit -m "Describe completed tested feature"
git push
```

---

## 3. Game Summary & Current Feature Set

Player controls a young witch (move/dodge/collect only); her ghost cat **familiar**
auto-attacks. Wave survival, EXP motes → level-ups → upgrades, boss every 10 waves.
Tutorial mode ends after Wave 10 (Victory, can carry into Endless); Endless runs until
death with per-tier scaling and a top-10 leaderboard.

All major systems are implemented and tested:

* Main Menu (background + title-banner art), Mode Select (background art, text title),
  How to Play, Grimoire, Settings (music volume, persisted), High Scores
* Full wave system + Elder Wisp boss (sprite-driven, telegraphed dash, staggered
  summons, boss HP bar at y=84); boss kill grants a free upgrade
* 2400×1344 world, player-following camera, tiled dungeon arena + wall collision,
  seeded floor props
* Player: 8-dir idle/walk/die sprites, i-frames, death animation
* Familiar: 8-dir idle/attack sprites, ghost imprints, rune projectile pool, pierce,
  projectile SFX; **Phantom Pounce** evolution (choosable, guaranteed slot)
* Pickups: EXP motes (glow), health flasks (heal 15), rare Spirit Magnet (vacuum)
* Upgrades: data-driven pool with caps, sprite-skinned cards + per-id 32×32 icons,
  Spirit Recovery fallback; Grimoire reads the same data
* **Spirit Imbued** mode (player-facing name; internals still `frenzy*` — intentional)
  with Spirit Link ribbon
* **HUD (reworked 2026-06-11):** thin frameless **XP strip flush along the top edge**
  (full width, Vampire-Survivors style); **HP bar (263×24 frame sprite)** top-left with
  in-well label; **Spirit Imbued bar (263×24 frame sprite)** docked directly below it
  (in-well label; dark text over gold while active); Score + `Lv` stacked top-right;
  "SPACE: SPIRIT IMBUED!" prompt pulses centered under the bar cluster.
  Shared `drawSkinnedBar()` helper: well insets 3px (x) / 4px (y), dark well backing →
  fill → frame on top; fallbacks match sprite sizes so layout never shifts.
* **High Scores with arcade initials (2026-06-11):** a qualifying Endless death enters
  `NAME_ENTRY` (Up/Down letter, Left/Right slot, **Enter/Esc confirm — deliberately NOT
  Space**, to avoid accidental confirm while mashing). Entries: `{name, score, wave,
  date}` in localStorage `ff_highscores`, top 10, score-desc/wave-desc. Old entries
  without names display `—`. Personal bests (`ff_bestEndlessWave/Score`) still update
  immediately on every Endless death regardless of qualification.
* Audio: see §8 (rebuilt 2026-06-11).
* Asset fallback safety everywhere: missing art/sound → placeholder/silence, never a crash.

---

## 4. Architecture / File Map

```txt
familiar-frenzy/
  index.html
  style.css                  # page frame; responsive canvas shrink on small screens
  package_itch.bat           # itch.io packaging script (see §10) — NOT shipped in the zip
  ITCH_RELEASE_CHECKLIST.md  # release steps (see §10) — NOT shipped in the zip
  src/
    main.js      # entry, canvas, dt loop, font preload, initAudio
    game.js      # state machine (incl. NAME_ENTRY), world/camera, drops/collection,
                 #   high-score persistence (updateEndlessBests / qualifiesForTop10 /
                 #   saveHighScore), music-context sync, screen wiring
    input.js     # keyboard (held + one-frame presses)
    player.js    # witch
    familiar.js  # ghost cat + bolts
    enemies.js   # Wisp + Elder Wisp boss + WaveManager + scaling; DEBUG_FORCE_BOSS here
    pickups.js   # motes, flasks, Spirit Magnet
    upgrades.js  # upgrade data + offers + getGrimoireEntries()
    ui.js        # all screens/HUD; drawMenu(art {bg,title}), drawSkinnedBar,
                 #   drawNameEntry, TITLE_SCALE / TITLE_OFFSET_X tunables
    assets.js    # loadImage/getImage with graceful fallback
    utils.js     # math helpers + dirFromVector
    audio.js     # dual-deck music player + projectile SFX (see §8)
  assets/
    fonts/  tiles/  music/  sfx/
    backgrounds/
      background_main.png    # 960×540 main-menu + mode-select backdrop, drawn 1:1
    sprites/
      player/ familiar/ enemies/ pickups/ projectiles/ upgrades/
      ui/
        menu_button.png      # 175×37
        upgrade_card.png     # 240×180
        health_bar.png       # 263×24, transparent well at (3,4) 257×16
        spirit_bar.png       # 263×24, same well template
        xp_bar.png           # 600×24 — NO LONGER USED (XP is a code-drawn strip);
                             #   safe to delete
        title_main.png       # title banner, drawn 1:1 centered at y=100
  README.md  CREDITS.md  AI_USAGE.md  PROJECT_HANDOFF.md  .gitignore
  builds/                    # packaging output (gitignored, never committed)
```

**HUD bar sprite template:** all bar frames share one construction — gold pixel border,
TRANSPARENT inner well inset 3px left/right and 4px top/bottom. Code draws dark backing
→ colored fill → frame on top. The helper reads each sprite's native size, so
re-authoring a bar at a new width needs no code change.

**Menu art:** `drawMenu(..., art = { bg, title })`. Main Menu passes both; Mode Select
passes `{ bg: true }` only. Title draws at native size × `TITLE_SCALE` (INTEGER only),
centered with midpoint y=100, nudged by `TITLE_OFFSET_X` (currently −13 because the
lettering is baked 13px right of the file's center).

---

## 5. Sprite Conventions (unchanged)

Player: 8 dirs, single-row strips — idle 4 / walk 6 / die 8 frames,
`assets/sprites/player/witch_<anim>_<dir>.png`. Familiar: 8 dirs, idle 4 (loops, doubles
as float) / attack 6 (one-shot), `assets/sprites/familiar/familiar_<anim>_<dir>.png`,
drawn at `spriteScale 0.55`. Wisp: 8-dir float/attack strips. Elder Wisp: 8-dir float
(4) + charge (2, state-driven), `spriteScale 2`. Frame width always computed at runtime
(`img.width / frameCount`). Upgrade icons derived from id:
`assets/sprites/upgrades/<id>.png` (32×32).

Pixel-art rules learned the hard way: only INTEGER scales; author art on a true uniform
pixel grid (PixelLab sometimes outputs wobbly pseudo-pixel art — verify); trim
transparent margins or accept that the code centers the file, not the lettering.

---

## 6. Most Recent Work Completed (2026-06-11, this session)

```txt
1. HUD bar skinning + layout rework: drawSkinnedBar helper; new 263×24 health/spirit
   frames (transparent-well template); XP moved to a 6px frameless top-edge strip;
   Spirit bar docked under HP; Score+Lv stacked top-right; boss bar y 58→84 so it
   clears the corner cluster; LEVEL UP! subtitle spacing +34→+48.
2. Arcade initials high-score entry: NAME_ENTRY state, qualification check, name field
   in entries, Name column in the High Scores table.
3. Main-menu background (960×540) + title banner wired via drawMenu art flags, with
   TITLE_SCALE / TITLE_OFFSET_X tunables; Mode Select gets the background too.
4. audio.js REBUILT (see §8) to permanently fix AbortError-induced silence.
5. Release prep: package_itch.bat, ITCH_RELEASE_CHECKLIST.md, this handoff rewrite,
   builds/ added to .gitignore, README publishing note.
```

All JS passed `node --check`; Daniel tested each step in-browser and committed
incrementally.

---

## 7. Upgrade System (unchanged this session)

Data-driven in `upgrades.js` — see the table there. Upgrades: Sharper Spirit Claws (5),
Restless Wisp (5), Spirit Heart (3), Magnet Charm (4), Ghost Pounce (3), Spirit Focus
(3, id `frenzy_focus`), Lucky Paws (3, rare-drop-only). Evolution: Phantom Pounce
(requires Claws 5 + Pounce 3). Spirit Recovery is the all-maxed fallback (not in
Grimoire). New upgrade → add to `UPGRADES` with `maxedStat` (+ `evolutionNotes` if it
feeds an evolution) and offers/Grimoire/icon all pick it up automatically. Do not
rename internal `frenzy*` identifiers.

---

## 8. Audio System (REBUILT 2026-06-11 — read before touching)

`audio.js` uses **two persistent decks + a generation counter**:

* Transitions swap the active deck; incoming gets src+play, outgoing fades down.
* Every transition bumps `transitionGen`; all async callbacks (play promises, fade
  frames, deferred pauses) self-discard if stale.
* `pause()` NEVER interrupts a pending `play()` — it waits for the deck's play promise
  to settle and skips if the deck was reactivated. This eliminated the AbortError →
  permanent-silence failure of the old design.
* Error triage: only `NotAllowedError` (genuine autoplay block) arms retry-on-gesture.
  `AbortError`/load hiccups are logged and ignored — **do not "fix" by treating them as
  autoplay blocks; that was the original bug.**

Invariants: **`POOL_COUNT = 9`** (familiar_theme_01..09 — lowering it caused random
menu silence once); shared normal pool for menus+gameplay; boss track interrupts and
returns; 240s loop-then-rotate; volume persisted in `ff_musicVolume`. Public API
unchanged: initAudio / setMusicContext / setMusicVolume / getMusicVolume / stopMusic /
playFamiliarProjectileSfx. SFX: 4-voice round-robin, volume 0.18, 60ms throttle.

---

## 9. State Machine

```txt
MAIN_MENU, MODE_SELECT, HOW_TO_PLAY, GRIMOIRE,
ENDLESS_PLACEHOLDER, HIGHSCORES_PLACEHOLDER, SETTINGS_PLACEHOLDER,
PLAYING, PAUSED, CONFIRM_QUIT, LEVEL_UP, DYING, NAME_ENTRY, GAME_OVER, VICTORY
```

Flow notes: `DYING → (endless + qualifies top-10) → NAME_ENTRY → GAME_OVER`, else
straight to `GAME_OVER`. Grimoire/Settings open from Main Menu OR Pause with return
targets. Quitting an Endless run via Pause → Main Menu intentionally records nothing.

Legacy names (cleanup candidates, all functional or dead):
`HIGHSCORES_PLACEHOLDER` (functional High Scores), `SETTINGS_PLACEHOLDER` (functional
Settings), `ENDLESS_PLACEHOLDER` (dead — never entered; `drawPlaceholder()` in ui.js is
its only consumer; both safe to remove together).

---

## 10. Release / Publishing Workflow (NEW)

* **Debug flag status: `DEBUG_FORCE_BOSS = false` — verified in `src/enemies.js` on
  2026-06-11.** Always re-verify from code before packaging; never trust this doc alone.
* **Package:** double-click **`package_itch.bat`** (project root). It validates required
  files, stages runtime files into `builds\package\`, zips them with `index.html` at
  the ZIP ROOT, and self-verifies the zip. Output: **`builds\familiar-frenzy-itch.zip`**.
* ZIP includes: index.html, style.css, src/, assets/, README.md, CREDITS.md,
  AI_USAGE.md. Excludes (by never staging them): .git, .gitignore, PROJECT_HANDOFF.md,
  ITCH_RELEASE_CHECKLIST.md, package_itch.bat, builds/.
* **Checklist:** follow **`ITCH_RELEASE_CHECKLIST.md`** top-to-bottom for every upload
  (local test → flag check → filename case check → package → itch settings: Kind HTML,
  "played in browser", viewport 960×540 → on-page retest).
* `builds/` is in `.gitignore` — never commit packaging output.
* itch.io is case-sensitive: asset filenames on disk must exactly match the paths in
  code (all code paths are lowercase_with_underscores).

---

## 11. Current Backlog / Scope Guardrails

Open items (none are blockers):

```txt
- Title banner re-export: current title_main.png art occupies only the middle 320×120
  of its 640×120 canvas and has a non-uniform pixel grid (PixelLab wobble). Re-author on
  a true uniform grid, wider/shorter (~640×130 at 1× or ~320×70 at TITLE_SCALE 2),
  ceiling 720×150. Code adapts automatically; reset TITLE_OFFSET_X for new art.
- README.md refresh: the status sections are stale (say audio is a stub, High Scores
  placeholder, enemy sprites pending). The publishing section is current.
- Optional polish: more SFX (pickup / enemy hit / level-up / boss spawn) via the
  existing voice-pool pattern; legacy state-name cleanup + ENDLESS_PLACEHOLDER removal;
  delete unused assets/sprites/ui/xp_bar.png; selected-button sprite.
- Audio soak: the rebuilt player passed initial testing; one long Endless session with
  the console open is good extra confidence before submission.
- Balance watch: xpToNext grows linearly (+3/level) — deep Endless runs may level-up
  very frequently. Only touch if Daniel reports it feels choppy.
```

Guardrails: no large new systems, online leaderboards, new enemy types in bulk,
external libraries, npm/build tooling, or balance rewrites without testing. Prefer one
feature at a time and jam readiness. When a 2nd enemy type is added, prefer a
data-driven ENEMY_TYPES table over subclasses.

---

## 12. First Response Required from Next Claude

1. Confirm this handoff was read.
2. Briefly summarize current state.
3. Verify `DEBUG_FORCE_BOSS` from `src/enemies.js` (do not trust this doc) and report it.
4. Note any stale-looking handoff items.
5. Offer a short option list of next tasks and ask Daniel what he wants to do.

Do not start coding immediately.
