/* =========================================================================
   ui.js — everything drawn ON TOP of the game world: title, HUD, the
   level-up / upgrade screen, and game over.

   Each function takes the canvas context (ctx) plus the data it needs.
   No game logic lives here — just drawing.
   ========================================================================= */

import { loadImage, getImage } from "./assets.js";

const GOLD = "#f4d58d";
const PURPLE = "#9b6cff";
const RED = "#e2536b";
const DIM = "rgba(244, 213, 141, 0.65)";
const CREAM = "#f3e7c6";
const MENU_BG = "#140d24"; // dark purple

// Fonts: a decorative rune face for big dramatic titles, and a clean pixel
// font for everything else (menus, HUD, descriptions, prompts, stats).
const TITLE_FONT = "'Darkrunes Arcanum', Georgia, serif";
const BODY_FONT = "'Neatpixels Standard', Georgia, serif";

// Menu button container sprite (175x37). Missing/loading -> the menu falls back
// to the original code-drawn highlight box, so removing the PNG reverts cleanly.
loadImage("menu_button", "assets/sprites/ui/menu_button.png");
loadImage("background_main", "assets/backgrounds/background_main.png"); // 960x540 main-menu backdrop, drawn 1:1
loadImage("title_main", "assets/sprites/ui/title_main.png");            // title banner, drawn 1:1 centered (native size read at draw time)
loadImage("upgrade_card", "assets/sprites/ui/upgrade_card.png"); // 240x150 level-up card container
// HUD bar frames. All three share one construction: a gold pixel border with a
// TRANSPARENT inner well (well inset = 3px left/right, 4px top/bottom). The
// code draws a dark well backing + colored fill, then the frame ON TOP, so the
// border always stays crisp over the fill. Sizes are read from each image at
// draw time, so re-authoring a bar at a new width needs no code change.
loadImage("health_bar", "assets/sprites/ui/health_bar.png"); // 263x24 HP bar frame
loadImage("spirit_bar", "assets/sprites/ui/spirit_bar.png"); // 263x24 Spirit Imbued frame (docked under HP)
loadImage("spirit_crystal", "assets/sprites/ui/spirit_crystal.png"); // small crystal icon; code-drawn gem fallback

// --- Shared helpers -------------------------------------------------------
// Pass `maxWidth` to auto-shrink the font (proportionally, never squished) so
// long titles always fit the canvas instead of clipping off the edges.
function text(ctx, str, x, y, { size = 24, color = GOLD, align = "center", font = BODY_FONT, weight = "700", maxWidth, stroke = null, strokeWidth = 3 } = {}) {
  ctx.fillStyle = color;
  let fontSize = size;
  ctx.font = `${weight} ${fontSize}px ${font}`;
  if (maxWidth) {
    const measured = ctx.measureText(str).width;
    if (measured > maxWidth) {
      fontSize = Math.max(1, Math.floor(size * (maxWidth / measured)));
      ctx.font = `${weight} ${fontSize}px ${font}`;
    }
  }
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  // Optional contrasting outline (drawn under the fill) so text stays legible
  // over any background — e.g. the HP label sitting over the emptied bar track.
  if (stroke) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round"; // rounded corners instead of spikes on the outline
    ctx.strokeText(str, x, y);
  }
  ctx.fillText(str, x, y);
}

// Rounded-rectangle path (arcTo works in every browser).
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Spirit Crystal icon. Draws spirit_crystal.png centered at (cx, cy) at 2*r
// tall if present; otherwise a code-drawn faceted gem (icy violet). Reused by
// the summary screens now and the Closet in Phase 2.
export function drawCrystalIcon(ctx, cx, cy, r) {
  const img = getImage("spirit_crystal");
  if (img && img.width > 0) {
    const dh = r * 2;
    const dw = (img.width / img.height) * dh;
    ctx.drawImage(img, Math.round(cx - dw / 2), Math.round(cy - r), dw, dh);
    return;
  }
  ctx.save();
  // Gem body (diamond).
  ctx.fillStyle = "#8be0ff";
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.8, cy - r * 0.15);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.8, cy - r * 0.15);
  ctx.closePath();
  ctx.fill();
  // Top facet highlight.
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.8, cy - r * 0.15);
  ctx.lineTo(cx - r * 0.8, cy - r * 0.15);
  ctx.closePath();
  ctx.fill();
  // Thin violet outline for definition on light/dark alike.
  ctx.strokeStyle = "rgba(123, 92, 255, 0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.8, cy - r * 0.15);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.8, cy - r * 0.15);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// Centered "[gem] <str>" group: the gem sits just left of the text, the whole
// group optically centered on `cx`. Used for the run-summary crystal line.
function crystalLine(ctx, cx, y, str, { size = 16, color = GOLD } = {}) {
  ctx.font = `700 ${size}px ${BODY_FONT}`;
  const tw = ctx.measureText(str).width;
  const r = size * 0.62;          // gem half-height (enlarged)
  const gap = 8;
  // textBaseline is "middle", which sits the caps slightly above y; nudge the
  // gem up a touch so it lines up with the lettering rather than looking low.
  const iconY = y - size * 0.06;
  const groupW = r * 2 + gap + tw;
  const left = cx - groupW / 2;
  drawCrystalIcon(ctx, left + r, iconY, r);
  text(ctx, str, left + r * 2 + gap, y, { size, color, align: "left", weight: "700" });
}

// --- MENUS ----------------------------------------------------------------
// Generic vertical menu: title + highlighted option list + footer hints.
export function drawMenu(ctx, w, h, title, items, selectedIndex, footerLines = [], art = {}) {
  // art = { bg: bool, title: bool } — which menu-art pieces to use. The main
  // menu uses both; Mode Select uses only the background (keeps its text
  // title). Missing files always fall back to the code-drawn versions.
  const bg = art.bg ? getImage("background_main") : null;
  if (bg && bg.width > 0) {
    ctx.drawImage(bg, 0, 0, w, h);
  } else {
    ctx.fillStyle = MENU_BG;
    ctx.fillRect(0, 0, w, h);

    // Faint moon backdrop for flavor.
    ctx.save();
    ctx.fillStyle = "rgba(244, 213, 141, 0.08)";
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.40, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Title: the main menu draws the banner sprite centered with its midpoint at
  // y 100 (the band above the button block). TITLE_SCALE must stay an INTEGER
  // (1, 2, 3...) or the pixels blur. TITLE_OFFSET_X optically centers the
  // lettering: in the current art the text mass sits 13px right of the file's
  // center, so we nudge left. Falls back to the drawn text title — also used
  // by every other menu.
  const TITLE_SCALE = 1;
  const TITLE_OFFSET_X = -13;
  const card = art.title ? getImage("title_main") : null;
  if (card && card.width > 0) {
    const dw = card.width * TITLE_SCALE;
    const dh = card.height * TITLE_SCALE;
    const tx = Math.round((w - dw) / 2 + TITLE_OFFSET_X);
    const ty = Math.round(100 - dh / 2);
    ctx.drawImage(card, tx, ty, dw, dh);
  } else {
    text(ctx, title, w / 2, h * 0.24, { size: 52, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  }

  // Vertically center the whole button block in the space below the title, so
  // menus with different item counts stay balanced instead of crammed low.
  const lineH = 54;
  const startY = h * 0.58 - ((items.length - 1) * lineH) / 2;
  const labelDY = 2; // caps with "middle" baseline read slightly high; nudge down

  // Button container sprite, drawn 1:1 for crisp pixels. Falls back to the
  // original code-drawn highlight box if the sprite isn't present.
  const btn = getImage("menu_button");
  const hasBtn = btn && btn.width > 0;
  const bw = hasBtn ? btn.width : 380;
  const bh = hasBtn ? btn.height : 42;

  const zones = []; // clickable rect per item (mouse hit-testing in game.js)
  items.forEach((item, i) => {
    const y = startY + i * lineH;
    const selected = i === selectedIndex;
    const bx = Math.round(w / 2 - bw / 2);
    const by = Math.round(y - bh / 2);
    zones.push({ x: bx, y: by, w: bw, h: bh, index: i });

    if (hasBtn) {
      // Same container for every item; the selected one gets a gold glow halo.
      ctx.save();
      if (selected) {
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 14;
      }
      ctx.drawImage(btn, bx, by, bw, bh);
      ctx.restore();
    } else if (selected) {
      // Fallback: the original highlight box on the selected item.
      ctx.fillStyle = "rgba(244, 213, 141, 0.14)";
      roundRect(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, bw, bh, 8);
      ctx.stroke();
    }

    // Smaller label, high-contrast over the purple fill (cream/gold + a dark
    // outline), auto-shrunk so it always stays inside the button frame.
    text(ctx, item, w / 2, y + labelDY, {
      size: 20,
      color: selected ? GOLD : CREAM,
      weight: "700",
      stroke: "#0d0b1c",
      strokeWidth: 3,
      maxWidth: bw - 30,
    });
  });

  // Footer hints pinned near the bottom center (last line ~h-40, earlier lines
  // stacked above) so they don't crowd the buttons.
  footerLines.forEach((line, i) => {
    const fy = h - 40 - (footerLines.length - 1 - i) * 22;
    text(ctx, line, w / 2, fy, { size: 15, color: DIM, weight: "500" });
  });

  return zones; // game.js hit-tests these for menu clicks/hover
}

// --- PLACEHOLDER ("Coming Soon") screen -----------------------------------
export function drawPlaceholder(ctx, w, h, title) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, title, w / 2, h / 2 - 30, { size: 48, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, "Coming Soon", w / 2, h / 2 + 20, { size: 24, color: CREAM, weight: "500" });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press Esc or Backspace to return", w / 2, h - 60, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

// Shared centred "Back" button for the High Scores + Settings screens. Mirrors
// the Wardrobe's Back styling so every screen exits the same way. `active`
// = selected/hovered (gold box). Returns its hit rect ({...index:0}) for the
// mouse handler. cy is the button's vertical centre.
function drawCenteredBack(ctx, w, cy, active) {
  if (active) {
    ctx.fillStyle = "rgba(244, 213, 141, 0.14)";
    roundRect(ctx, w / 2 - 90, cy - 20, 180, 40, 8); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5;
    roundRect(ctx, w / 2 - 90, cy - 20, 180, 40, 8); ctx.stroke();
  }
  text(ctx, "Back", w / 2, cy, { size: 20, color: active ? GOLD : DIM, weight: "700" });
  return { x: w / 2 - 90, y: cy - 20, w: 180, h: 40, index: 0 };
}

// --- HIGH SCORES (Casual + Cursed tabs) ---------------------------------
// boards = { endless: [...], cursed: [...] }, each an array of { name, score, wave,
// date } already sorted best-first. activeTab = "endless" | "cursed". tabHover = the
// tab the mouse is over, or null. backHover = Back button hovered. Returns clickable
// zones: index 0 = Back, index 1 = Casual tab, index 2 = Cursed tab.
export function drawHighScores(ctx, w, h, boards, activeTab = "endless", tabHover = null, backHover = false) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "High Scores", w / 2, 58, { size: 42, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  // Tabs: Casual | Cursed. Click a tab or press Left/Right (A/D) to switch; the
  // active board fills the table below. Underline marks the active tab.
  const tabY = 96;
  const tabDefs = [
    { id: "endless", label: "Casual", cx: w / 2 - 78, index: 1 },
    { id: "cursed",  label: "Cursed",  cx: w / 2 + 78, index: 2 },
  ];
  const tabZones = [];
  for (const t of tabDefs) {
    const active = activeTab === t.id;
    const hovered = tabHover === t.id;
    text(ctx, t.label, t.cx, tabY, {
      size: 18,
      color: active ? GOLD : hovered ? CREAM : DIM,
      weight: active ? "700" : "500",
    });
    if (active) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.cx - 42, tabY + 15);
      ctx.lineTo(t.cx + 42, tabY + 15);
      ctx.stroke();
    }
    tabZones.push({ x: t.cx - 56, y: tabY - 15, w: 112, h: 30, index: t.index });
  }

  const entries = (activeTab === "cursed" ? boards.cursed : boards.endless) || [];

  // Friendly empty state when the active board has no runs yet.
  if (entries.length === 0) {
    const modeLabel = activeTab === "cursed" ? "Cursed" : "Casual";
    text(ctx, "No runs yet.", w / 2, h / 2 - 12, { size: 24, color: CREAM, weight: "500" });
    text(ctx, `Survive ${modeLabel} Mode to record a score.`, w / 2, h / 2 + 22, { size: 16, color: DIM, weight: "500" });
    return { zones: [drawCenteredBack(ctx, w, h - 40, backHover), ...tabZones] };
  }

  // Table layout (5 columns: rank / name / score / wave / date).
  const tableX = (w - 660) / 2;
  const rankX = tableX + 18;
  const nameX = tableX + 70;
  const scoreX = tableX + 190;
  const waveX = tableX + 380;
  const dateX = tableX + 500;
  const headerY = 138;
  const rowH = 30;

  text(ctx, "#",     rankX,  headerY, { size: 14, color: DIM, align: "left", weight: "700" });
  text(ctx, "Name",  nameX,  headerY, { size: 14, color: DIM, align: "left", weight: "700" });
  text(ctx, "Score", scoreX, headerY, { size: 14, color: DIM, align: "left", weight: "700" });
  text(ctx, "Wave",  waveX,  headerY, { size: 14, color: DIM, align: "left", weight: "700" });
  text(ctx, "Date",  dateX,  headerY, { size: 14, color: DIM, align: "left", weight: "700" });

  ctx.strokeStyle = "rgba(244, 213, 141, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tableX, headerY + 14);
  ctx.lineTo(tableX + 660, headerY + 14);
  ctx.stroke();

  entries.slice(0, 10).forEach((e, i) => {
    const y = headerY + 34 + i * rowH;
    const color = i === 0 ? GOLD : CREAM;     // rank 1 highlighted gold
    const weight = i === 0 ? "700" : "500";
    text(ctx, `${i + 1}`,         rankX,  y, { size: 16, color, align: "left", weight });
    text(ctx, `${e.name || "—"}`, nameX,  y, { size: 16, color, align: "left", weight });
    text(ctx, `${e.score}`,       scoreX, y, { size: 16, color, align: "left", weight });
    text(ctx, `${e.wave}`,        waveX,  y, { size: 16, color, align: "left", weight });
    text(ctx, `${e.date || "—"}`, dateX,  y, { size: 16, color, align: "left", weight });
  });

  return { zones: [drawCenteredBack(ctx, w, h - 40, backHover), ...tabZones] };
}

// --- SETTINGS -------------------------------------------------------------
// Music volume slider. Left/Right adjusts; Esc/Backspace returns.
// One labeled volume slider row. `selected` highlights the active row.
function drawVolumeSlider(ctx, w, label, value, sy, selected) {
  const sliderW = 420, sliderH = 10;
  const sx = (w - sliderW) / 2;
  const pct = Math.max(0, Math.min(1, value / 100));

  text(ctx, label, w / 2, sy - 30, { size: 22, color: selected ? GOLD : CREAM, weight: "500" });

  // Track + filled portion + border.
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(sx - 2, sy - 2, sliderW + 4, sliderH + 4);
  ctx.fillStyle = "rgba(244, 213, 141, 0.20)";
  ctx.fillRect(sx, sy, sliderW, sliderH);
  ctx.fillStyle = selected ? PURPLE : "rgba(155, 108, 255, 0.45)";
  ctx.fillRect(sx, sy, sliderW * pct, sliderH);
  ctx.strokeStyle = selected ? GOLD : "rgba(244, 213, 141, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(sx, sy, sliderW, sliderH);

  // Knob.
  ctx.fillStyle = selected ? GOLD : "rgba(244, 213, 141, 0.5)";
  ctx.beginPath();
  ctx.arc(sx + sliderW * pct, sy + sliderH / 2, 9, 0, Math.PI * 2);
  ctx.fill();

  // Value readout.
  text(ctx, `${Math.round(value)}%`, w / 2, sy + 32, { size: 18, color: selected ? GOLD : DIM });

  // Track rect: x/w give the value-map range (and horizontal hit range); y/h are a
  // generous vertical band so the track + knob are easy to grab with the mouse.
  return { x: sx, y: sy - 14, w: sliderW, h: 36 };
}

// One labeled On/Off accessibility row. The active side is emphasized; the layout
// mirrors the slider's label-above style so the two row types sit consistently.
function drawToggleRow(ctx, w, label, isOn, sy, selected) {
  text(ctx, label, w / 2, sy - 14, { size: 22, color: selected ? GOLD : CREAM, weight: "500" });
  const offColor = !isOn ? (selected ? GOLD : CREAM) : DIM;
  const onColor  =  isOn ? (selected ? GOLD : CREAM) : DIM;
  text(ctx, "Off", w / 2 - 36, sy + 16, { size: 20, color: offColor, weight: !isOn ? "700" : "500" });
  text(ctx, "/",   w / 2,      sy + 16, { size: 20, color: DIM });
  text(ctx, "On",  w / 2 + 36, sy + 16, { size: 20, color: onColor,  weight:  isOn ? "700" : "500" });

  // Off / On hit rects (centred on the two labels). Click Off → false, On → true.
  const half = 28, top = sy, boxH = 34;
  return {
    off: { x: w / 2 - 36 - half, y: top, w: half * 2, h: boxH },
    on:  { x: w / 2 + 36 - half, y: top, w: half * 2, h: boxH },
  };
}

export function drawSettings(ctx, w, h, musicVolume, sfxVolume, reducedFlash, highVisWarnings, selectedIndex = 0) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "SETTINGS", w / 2, h * 0.16, { size: 48, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  // Four rows: two volume sliders, then two accessibility toggles. Spaced to sit
  // comfortably at 540px without crowding the footer (no other UI is resized).
  const musicRect = drawVolumeSlider(ctx, w, "Music Volume", musicVolume, h * 0.34, selectedIndex === 0);
  const sfxRect   = drawVolumeSlider(ctx, w, "SFX Volume",   sfxVolume,   h * 0.52, selectedIndex === 1);
  const flashT    = drawToggleRow(ctx, w, "Reduced Flash Effects",    reducedFlash,    h * 0.70, selectedIndex === 2);
  const highVisT  = drawToggleRow(ctx, w, "High Visibility Warnings", highVisWarnings, h * 0.81, selectedIndex === 3);

  // Back row — selectable like the Grimoire/Bestiary Back (keyboard index 4 /
  // mouse click), so the screen exits without needing Esc.
  const backRect = drawCenteredBack(ctx, w, h * 0.93, selectedIndex === 4);

  // Hit zones for the mouse: sliders (drag/click), toggles (click Off/On), Back.
  return {
    sliders: [ { ...musicRect, row: 0 }, { ...sfxRect, row: 1 } ],
    toggles: [ { ...flashT, row: 2 }, { ...highVisT, row: 3 } ],
    back: backRect,
  };
}

// --- HOW TO PLAY ----------------------------------------------------------
// Single-screen instructions (Option A): everything fits at 960x540.
export function drawHowToPlay(ctx, w, h, backHover = false) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "HOW TO PLAY", w / 2, h * 0.20, { size: 40, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  // Action -> binding pairs. The ACTION is bolded in gold and right-aligned to
  // a center divider; the binding sits to its right in cream — so the two read
  // as a clean two-column key list instead of one run-on line.
  const controls = [
    ["Move", "WASD / Arrow Keys"],
    ["Confirm", "Enter / Space"],
    ["Spirit Imbued", "Space  (when the meter is full)"],
    ["Back / Pause", "Esc / Backspace"],
    ["Restart", "R  (after Game Over or Victory)"],
  ];

  // Center the CONTROLS block (heading + lines) vertically, nudged slightly
  // below middle to balance the title up top.
  const lineH = 36;
  const headingGap = 16;
  const blockH = lineH + headingGap + controls.length * lineH;
  let y = (h - blockH) / 2 + 40;

  text(ctx, "CONTROLS", w / 2, y, { size: 22, color: GOLD });
  y += lineH + headingGap;

  const labelRight = w / 2 - 16; // bold action labels right-aligned here
  const valueLeft = w / 2 + 16;  // bindings left-aligned here
  controls.forEach(([action, binding]) => {
    text(ctx, action, labelRight, y, { size: 18, color: GOLD, align: "right", weight: "700" });
    text(ctx, binding, valueLeft, y, { size: 18, color: CREAM, align: "left", weight: "500" });
    y += lineH;
  });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Esc / Backspace / click Back to return", w / 2, h - 76, { size: 14, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;

  return { zones: [drawCenteredBack(ctx, w, h - 40, backHover)] };
}

// --- UPGRADE GRIMOIRE -----------------------------------------------------
// Read-only glossary that now mirrors the Bestiary: a flat, SCROLLABLE list
// where the SELECTED entry auto-expands its detail inline (no extra keypress).
// Entries are grouped under non-interactive "UPGRADES" / "EVOLUTIONS" headers.
// `entries` is the flat navigable list [...upgrades, ...evolutions]; Back is
// index === entries.length. `upgradeCount` marks where the Evolutions group
// begins. `levels` = { id: ownedLevel } when opened from Pause (adds a
// "Current" line for upgrades), else null.
// Slim scrollbar (track + thumb) for the scrollable list panels. Thumb height
// reflects the visible fraction; its position reflects the scroll offset. Drawn
// only when the content overflows. Cue only — not draggable (the wheel scrolls);
// drag can come later alongside the Settings sliders.
function drawScrollbar(ctx, x, top, viewH, scroll, maxScroll, contentH) {
  const barW = 6;
  ctx.fillStyle = "rgba(244, 213, 141, 0.10)";
  roundRect(ctx, x, top, barW, viewH, 3);
  ctx.fill();
  const thumbH = Math.max(28, viewH * (viewH / contentH));
  const thumbY = top + (maxScroll > 0 ? scroll / maxScroll : 0) * (viewH - thumbH);
  ctx.fillStyle = "rgba(244, 213, 141, 0.55)";
  roundRect(ctx, x, thumbY, barW, thumbH, 3);
  ctx.fill();

  // Geometry the handler needs for drag hit-testing + mapping cursor → scroll.
  return { x, top, viewH, thumbY, thumbH, maxScroll };
}

export function drawGrimoire(ctx, w, h, entries, selectedIndex, levels, upgradeCount, scrollIn = 0, followSel = true) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "GRIMOIRE", w / 2, 46, { size: 34, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  // --- Layout metrics ---
  const leftX = 200;          // row content left edge
  const rightX = w - 200;     // tag / value right edge
  const iconSmall = 26;       // collapsed-row icon
  const iconBig = 46;         // expanded-row icon
  const compactH = 44;        // collapsed row height
  const headerH = 34;         // section header height
  const gap = 6;              // gap between rows
  const backIndex = entries.length;

  const viewTop = 78;
  const viewBottom = h - 40;
  const viewH = viewBottom - viewTop;

  // Detail label/value columns (used when an entry is expanded). The value
  // column starts past the WIDEST label so long labels ("Evolution:") never
  // collide with their value, measured with the font text() composes.
  const detailX = leftX + iconBig + 20;
  ctx.font = `700 14px ${BODY_FONT}`;
  const labelColW = Math.max(
    ctx.measureText("Effect:").width,
    ctx.measureText("Current:").width,
    ctx.measureText("Evolution:").width,
  ) + 16;
  const valX = detailX + labelColW;
  const buildDetail = (e) => {
    const effectVal = e.maxedStat ? `${e.effect}  (MAXED ${e.maxedStat})` : e.effect;
    const detail = [["Effect:", effectVal]];
    // Evolutions show effect only; upgrades also show current level + note.
    if (e.kind !== "evolution") {
      if (levels && e.maxLevel !== undefined) detail.push(["Current:", `Lv. ${levels[e.id] || 0} / ${e.maxLevel}`]);
      if (e.evolutionNotes) detail.push(["Evolution:", e.evolutionNotes]);
    }
    return detail.map(([label, val]) => ({
      label, lines: wrapText(ctx, val, rightX - valX, { size: 14, weight: "500", maxLines: 4 }),
    }));
  };

  // --- Pass 1: lay rows out in CONTENT space (headers + entries + Back). ---
  const rows = [];
  let cy = 0;
  const pushHeader = (label) => { rows.push({ kind: "header", label, y: cy, height: headerH }); cy += headerH; };
  const pushEntry = (e, ei) => {
    const expanded = ei === selectedIndex;
    let height = compactH;
    let detail = null;
    if (expanded) {
      detail = buildDetail(e);
      const total = detail.reduce((s, d) => s + d.lines.length * 18 + 6, 0);
      height = 46 + total + 14; // name row + detail block + padding
    }
    rows.push({ kind: "entry", ei, e, expanded, detail, y: cy, height });
    cy += height + gap;
  };

  pushHeader("UPGRADES");
  for (let ei = 0; ei < upgradeCount; ei++) pushEntry(entries[ei], ei);
  pushHeader("EVOLUTIONS");
  for (let ei = upgradeCount; ei < entries.length; ei++) pushEntry(entries[ei], ei);
  const backRow = { kind: "back", y: cy, height: 36 };
  rows.push(backRow);
  cy += backRow.height;
  const contentH = cy;

  // --- Scroll: follow the highlighted row (keyboard / open / click) or honour
  // the free wheel-scroll position. ---
  const maxScroll = Math.max(0, contentH - viewH);
  let scroll;
  if (followSel) {
    const selRow = rows.find((r) =>
      (r.kind === "entry" && r.ei === selectedIndex) || (r.kind === "back" && selectedIndex === backIndex)
    ) || backRow;
    scroll = 0;
    if (selRow.y < scroll) scroll = selRow.y;
    if (selRow.y + selRow.height > scroll + viewH) scroll = selRow.y + selRow.height - viewH;
  } else {
    scroll = scrollIn;
  }
  scroll = Math.max(0, Math.min(maxScroll, scroll));

  const zones = []; // clickable rect per entry/Back row (mouse hit-testing in game.js)

  // --- Draw, clipped to the viewport. ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, w, viewH);
  ctx.clip();

  for (const r of rows) {
    const ry = viewTop + r.y - scroll;
    if (ry + r.height < viewTop || ry > viewBottom) continue; // cull offscreen rows

    // Clickable rect for entry/Back rows (headers aren't selectable), clamped to the viewport.
    if (r.kind !== "header") {
      const zy = Math.max(viewTop, ry);
      const zBottom = Math.min(viewBottom, ry + r.height);
      if (zBottom > zy) zones.push({ x: leftX - 16, y: Math.round(zy), w: rightX - leftX + 32, h: Math.round(zBottom - zy), index: r.kind === "back" ? backIndex : r.ei });
    }

    if (r.kind === "header") {
      text(ctx, r.label, leftX, ry + r.height - 12, { size: 14, color: DIM, align: "left", weight: "700" });
      ctx.strokeStyle = "rgba(244, 213, 141, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftX, ry + r.height - 4);
      ctx.lineTo(rightX, ry + r.height - 4);
      ctx.stroke();
      continue;
    }

    if (r.kind === "back") {
      const sel = selectedIndex === backIndex;
      text(ctx, `${sel ? "> " : "  "}Back`, leftX, ry + 22, {
        size: 22, color: sel ? GOLD : CREAM, align: "left", weight: sel ? "700" : "500",
      });
      continue;
    }

    // Entry row — selected entries always render expanded.
    const e = r.e;
    if (r.expanded) {
      ctx.fillStyle = "rgba(244, 213, 141, 0.07)";
      ctx.fillRect(leftX - 16, ry, rightX - leftX + 32, r.height - 6);
      ctx.strokeStyle = "rgba(244, 213, 141, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(leftX - 16, ry, rightX - leftX + 32, r.height - 6);

      drawUpgradeIcon(ctx, leftX + iconBig / 2, ry + 4 + iconBig / 2, e, { size: iconBig, glow: false });
      text(ctx, e.name, detailX, ry + 22, { size: 22, color: GOLD, align: "left", weight: "700" });
      if (e.kind === "evolution") {
        text(ctx, "EVOLUTION", rightX, ry + 20, { size: 12, color: GOLD, align: "right", weight: "700" });
      } else if (e.maxLevel !== undefined) {
        text(ctx, `Max Lv. ${e.maxLevel}`, rightX, ry + 20, { size: 12, color: DIM, align: "right", weight: "500" });
      }
      let dy = ry + 46;
      for (const d of r.detail) {
        text(ctx, d.label, detailX, dy, { size: 14, color: GOLD, align: "left", weight: "700" });
        d.lines.forEach((line, li) => {
          text(ctx, line, valX, dy + li * 18, { size: 14, color: CREAM, align: "left", weight: "500", maxWidth: rightX - valX });
        });
        dy += d.lines.length * 18 + 6;
      }
    } else {
      drawUpgradeIcon(ctx, leftX + iconSmall / 2, ry + compactH / 2 - 2, e, { size: iconSmall, glow: false });
      const nameX = leftX + iconSmall + 16;
      text(ctx, e.name, nameX, ry + compactH / 2 - 2, { size: 18, color: CREAM, align: "left", weight: "500" });
      if (e.kind === "evolution") {
        text(ctx, "EVOLUTION", rightX, ry + compactH / 2 - 2, { size: 12, color: GOLD, align: "right", weight: "700" });
      } else if (e.maxLevel !== undefined) {
        text(ctx, `Max Lv. ${e.maxLevel}`, rightX, ry + compactH / 2 - 2, { size: 12, color: DIM, align: "right", weight: "500" });
      }
    }
  }
  ctx.restore();

  // Scrollbar: slim right-side track + thumb, shown only when the list overflows.
  // Drag the thumb (or click the track) to scroll; the wheel also works.
  const scrollbar = maxScroll > 0 ? drawScrollbar(ctx, rightX + 16, viewTop, viewH, scroll, maxScroll, contentH) : null;

  return { zones, scroll, maxScroll, scrollbar }; // game.js stores scroll + scrollbar geometry
}

// --- BESTIARY -------------------------------------------------------------
// A list of creature rows with portraits. Unseen creatures (encounter-gated)
// draw as a black silhouette + "???" until the player has met them; the
// selected row shows its blurb beneath it. `entries` carry a `seen` flag and a
// resolved `img` (or null) supplied by game.js's draw call.
export function drawBestiary(ctx, w, h, entries, selectedIndex, scrollIn = 0, followSel = true) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "BESTIARY", w / 2, 46, { size: 34, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  const seenCount = entries.filter((e) => e.seen).length;
  text(ctx, `${seenCount} / ${entries.length} discovered`, w / 2, 74, { size: 14, color: DIM, weight: "500" });

  // --- Layout metrics ---
  const leftX = 200;       // row content left edge
  const rightX = w - 200;  // tag right edge
  const portrait = 40;     // collapsed-row icon box
  const compactH = 54;     // collapsed row height
  const bigArt = 110;      // expanded artwork box
  const gap = 8;           // gap between rows
  const backIndex = entries.length;

  // Viewport: clipped + SCROLLABLE so the screen never overflows as the roster
  // grows. Rows flow top-to-bottom (no fixed bottom panel — that was what put
  // the old "Back" on top of the detail box), and we scroll to keep the
  // selected (expanded) row in view.
  const viewTop = 94;
  const viewBottom = h - 40;
  const viewH = viewBottom - viewTop;

  // --- Pass 1: lay rows out in CONTENT space (measuring expanded heights). ---
  const rows = [];
  let cy = 0;
  entries.forEach((e, i) => {
    const expanded = i === selectedIndex;
    let height = compactH;
    let blurbLines = null;
    if (expanded) {
      const textX = leftX + bigArt + 22;
      const blurb = e.seen ? e.blurb : "Not yet encountered. Venture deeper to reveal this creature.";
      blurbLines = wrapText(ctx, blurb, rightX - textX, { size: 16, weight: "500", maxLines: 4 });
      const textBlock = 30 + 6 + blurbLines.length * 22;
      height = Math.max(bigArt, textBlock) + 24;
    }
    rows.push({ kind: "entry", i, e, expanded, blurbLines, y: cy, height });
    cy += height + gap;
  });
  const backRow = { kind: "back", i: backIndex, y: cy, height: 40 };
  rows.push(backRow);
  cy += backRow.height;
  const contentH = cy;

  // --- Scroll: follow the highlighted row (keyboard / open / click) or honour
  // the free wheel-scroll position. ---
  const maxScroll = Math.max(0, contentH - viewH);
  let scroll;
  if (followSel) {
    const selRow = rows.find((r) => r.i === selectedIndex) || backRow;
    scroll = 0;
    if (selRow.y < scroll) scroll = selRow.y;
    if (selRow.y + selRow.height > scroll + viewH) scroll = selRow.y + selRow.height - viewH;
  } else {
    scroll = scrollIn;
  }
  scroll = Math.max(0, Math.min(maxScroll, scroll));

  const zones = []; // clickable rect per entry/Back row (mouse hit-testing in game.js)

  // --- Draw the rows, clipped to the viewport. ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, w, viewH);
  ctx.clip();

  for (const r of rows) {
    const ry = viewTop + r.y - scroll;
    if (ry + r.height < viewTop || ry > viewBottom) continue; // cull offscreen rows

    // Clickable rect for every visible row (entries + Back), clamped to the viewport.
    {
      const zy = Math.max(viewTop, ry);
      const zBottom = Math.min(viewBottom, ry + r.height);
      if (zBottom > zy) zones.push({ x: leftX - 16, y: Math.round(zy), w: rightX - leftX + 32, h: Math.round(zBottom - zy), index: r.i });
    }

    if (r.kind === "back") {
      const sel = selectedIndex === backIndex;
      text(ctx, `${sel ? "> " : "  "}Back`, leftX, ry + 20, {
        size: 22, color: sel ? GOLD : CREAM, align: "left", weight: sel ? "700" : "500",
      });
      continue;
    }

    if (r.expanded) {
      drawBestiaryExpanded(ctx, r.e, leftX, ry, rightX, r.height, bigArt, r.blurbLines);
    } else {
      drawBestiaryCompact(ctx, r.e, leftX, ry, rightX, portrait, compactH);
    }
  }
  ctx.restore();

  // Scrollbar: slim right-side track + thumb, shown only when the list overflows.
  // Drag the thumb (or click the track) to scroll; the wheel also works.
  const scrollbar = maxScroll > 0 ? drawScrollbar(ctx, rightX + 16, viewTop, viewH, scroll, maxScroll, contentH) : null;

  return { zones, scroll, maxScroll, scrollbar }; // game.js stores scroll + scrollbar geometry
}

// --- CURSES ARCHIVE (Cursed Mode) ----------------------------------------
// Mirrors the Bestiary: scrollable list, "N / M discovered" counter, a Back row,
// and the same follow-selection scroll. Each row shows the curse icon + name +
// blurb; undiscovered curses are blacked out (dark box + "?" and "???").
// entries = [{ id, name, blurb, seen, img }] in pool order.
// Returns { zones, scroll, maxScroll, scrollbar }.
export function drawCurses(ctx, w, h, entries, selectedIndex, scrollIn = 0, followSel = true) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "CURSES", w / 2, 46, { size: 34, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  const seenCount = entries.filter((e) => e.seen).length;
  text(ctx, `${seenCount} / ${entries.length} discovered`, w / 2, 74, { size: 14, color: DIM, weight: "500" });

  const leftX = 200;
  const rightX = w - 200;
  const iconBox = 64;       // native curse-icon size (1:1, crisp)
  const gap = 8;
  const backIndex = entries.length;
  const textX = leftX + iconBox + 22;

  const viewTop = 94;
  const viewBottom = h - 40;
  const viewH = viewBottom - viewTop;

  // Pass 1: lay rows out in content space (each sized to its wrapped blurb).
  const rows = [];
  let cy = 0;
  entries.forEach((e, i) => {
    const blurb = e.seen ? e.blurb : "Not yet discovered. Suffer this curse in a run to reveal it.";
    const blurbLines = wrapText(ctx, blurb, rightX - textX, { size: 16, weight: "500", maxLines: 3 });
    const textBlock = 30 + 6 + blurbLines.length * 22;
    const height = Math.max(iconBox, textBlock) + 16;
    rows.push({ kind: "entry", i, e, blurbLines, y: cy, height });
    cy += height + gap;
  });
  const backRow = { kind: "back", i: backIndex, y: cy, height: 40 };
  rows.push(backRow);
  cy += backRow.height;
  const contentH = cy;

  // Scroll: follow the highlighted row, or honour the free wheel position.
  const maxScroll = Math.max(0, contentH - viewH);
  let scroll;
  if (followSel) {
    const selRow = rows.find((r) => r.i === selectedIndex) || backRow;
    scroll = 0;
    if (selRow.y < scroll) scroll = selRow.y;
    if (selRow.y + selRow.height > scroll + viewH) scroll = selRow.y + selRow.height - viewH;
  } else {
    scroll = scrollIn;
  }
  scroll = Math.max(0, Math.min(maxScroll, scroll));

  const zones = [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, w, viewH);
  ctx.clip();

  for (const r of rows) {
    const ry = viewTop + r.y - scroll;
    if (ry + r.height < viewTop || ry > viewBottom) continue; // cull offscreen rows

    {
      const zy = Math.max(viewTop, ry);
      const zBottom = Math.min(viewBottom, ry + r.height);
      if (zBottom > zy) zones.push({ x: leftX - 16, y: Math.round(zy), w: rightX - leftX + 32, h: Math.round(zBottom - zy), index: r.i });
    }

    if (r.kind === "back") {
      const sel = selectedIndex === backIndex;
      text(ctx, `${sel ? "> " : "  "}Back`, leftX, ry + 20, {
        size: 22, color: sel ? GOLD : CREAM, align: "left", weight: sel ? "700" : "500",
      });
      continue;
    }

    drawCurseRow(ctx, r.e, leftX, ry, rightX, r.height, iconBox, textX, r.blurbLines, r.i === selectedIndex);
  }
  ctx.restore();

  const scrollbar = maxScroll > 0 ? drawScrollbar(ctx, rightX + 16, viewTop, viewH, scroll, maxScroll, contentH) : null;
  return { zones, scroll, maxScroll, scrollbar };
}

// One curse row: icon box (or blacked-out box + "?" if unseen) + name + wrapped
// blurb, inside a highlighted panel when selected.
function drawCurseRow(ctx, e, leftX, y, rightX, rowH, iconBox, textX, blurbLines, selected) {
  if (selected) {
    ctx.fillStyle = "rgba(244, 213, 141, 0.07)";
    ctx.fillRect(leftX - 16, y, rightX - leftX + 32, rowH - 6);
    ctx.strokeStyle = "rgba(244, 213, 141, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(leftX - 16, y, rightX - leftX + 32, rowH - 6);
  }

  const boxY = y + (rowH - iconBox) / 2 - 3;
  ctx.fillStyle = "rgba(244, 213, 141, 0.06)";
  ctx.fillRect(leftX, boxY, iconBox, iconBox);
  ctx.strokeStyle = selected ? GOLD : "rgba(244, 213, 141, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX, boxY, iconBox, iconBox);

  if (e.seen && e.img && e.img.width > 0) {
    ctx.save();
    ctx.imageSmoothingEnabled = false; // 64px art at 1:1, crisp
    const pad = 4;
    ctx.drawImage(e.img, leftX + pad, boxY + pad, iconBox - pad * 2, iconBox - pad * 2);
    ctx.restore();
  } else {
    // Blacked out until discovered.
    ctx.fillStyle = "#2b2540";
    ctx.fillRect(leftX + 1, boxY + 1, iconBox - 2, iconBox - 2);
    text(ctx, "?", leftX + iconBox / 2, boxY + iconBox / 2, { size: 30, color: "#5a5170", weight: "700" });
  }

  const name = e.seen ? e.name : "???";
  text(ctx, name, textX, y + 26, { size: 24, color: e.seen ? GOLD : DIM, align: "left", weight: "700" });
  blurbLines.forEach((line, li) => {
    text(ctx, line, textX, y + 56 + li * 22, { size: 16, color: e.seen ? CREAM : DIM, align: "left", weight: "500" });
  });
}

// Shared creature portrait: lit box + sprite (or silhouette if unseen, or "?" if
// no art). `animated` plays the idle loop (used in the big expanded view).
function drawCreaturePortrait(ctx, e, x, y, box, animated, highlighted) {
  ctx.fillStyle = "rgba(244, 213, 141, 0.06)";
  ctx.fillRect(x, y, box, box);
  ctx.strokeStyle = highlighted ? GOLD : "rgba(244, 213, 141, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, box, box);

  if (e.img && e.img.width > 0) {
    const frames = e.frames || 1;
    const fw = e.img.width / frames;
    const fh = e.img.height;
    const pad = Math.round(box * 0.16);
    const scale = Math.min((box - pad * 2) / fw, (box - pad * 2) / fh);
    const dw = fw * scale, dh = fh * scale;
    const dx = x + (box - dw) / 2;
    const dy = y + (box - dh) / 2;
    const frame = (animated && e.seen) ? Math.floor(performance.now() / 180) % frames : 0;
    const sx = frame * fw;
    if (e.seen) {
      ctx.drawImage(e.img, sx, 0, fw, fh, dx, dy, dw, dh);
    } else {
      // Silhouette via a scoped offscreen canvas (frame 0), so it can't tint
      // anything else on screen.
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.ceil(dw)); tmp.height = Math.max(1, Math.ceil(dh));
      const tctx = tmp.getContext("2d");
      tctx.drawImage(e.img, 0, 0, fw, fh, 0, 0, dw, dh);
      tctx.globalCompositeOperation = "source-atop";
      tctx.fillStyle = "#2b2540";
      tctx.fillRect(0, 0, dw, dh);
      ctx.drawImage(tmp, dx, dy);
    }
  } else {
    text(ctx, "?", x + box / 2, y + box / 2, { size: box * 0.55, color: e.seen ? CREAM : "rgba(244,213,141,0.5)", weight: "700" });
  }
}

// A collapsed creature row: small icon + name + ENEMY/BOSS tag.
function drawBestiaryCompact(ctx, e, leftX, y, rightX, portrait, rowH) {
  const boxY = y + (rowH - portrait) / 2;
  drawCreaturePortrait(ctx, e, leftX, boxY, portrait, false, false);
  const nameX = leftX + portrait + 18;
  const name = e.seen ? e.name : "???";
  text(ctx, name, nameX, y + rowH / 2 - 3, { size: 20, color: CREAM, align: "left", weight: "500" });
  text(ctx, e.kind.toUpperCase(), rightX, y + rowH / 2 - 3, {
    size: 13, color: e.kind === "Boss" ? RED : DIM, align: "right", weight: "700",
  });
}

// The selected creature, expanded: enlarged ANIMATED artwork + name + tag +
// wrapped blurb, all inside a highlighted panel that flows with the list.
function drawBestiaryExpanded(ctx, e, leftX, y, rightX, rowH, bigArt, blurbLines) {
  ctx.fillStyle = "rgba(244, 213, 141, 0.07)";
  ctx.fillRect(leftX - 16, y, rightX - leftX + 32, rowH - 6);
  ctx.strokeStyle = "rgba(244, 213, 141, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX - 16, y, rightX - leftX + 32, rowH - 6);

  const artY = y + (rowH - bigArt) / 2 - 3;
  drawCreaturePortrait(ctx, e, leftX, artY, bigArt, true, true);

  const textX = leftX + bigArt + 22;
  const name = e.seen ? e.name : "???";
  text(ctx, name, textX, y + 26, { size: 24, color: GOLD, align: "left", weight: "700" });
  text(ctx, e.kind.toUpperCase(), rightX, y + 24, {
    size: 13, color: e.kind === "Boss" ? RED : DIM, align: "right", weight: "700",
  });
  blurbLines.forEach((line, li) => {
    text(ctx, line, textX, y + 56 + li * 22, { size: 16, color: e.seen ? CREAM : DIM, align: "left", weight: "500" });
  });
}

// --- IN-GAME HUD ----------------------------------------------------------

// --- Skinned-bar tunables (shared by HP / Spirit Imbued) -------------------
const BAR_WELL_X = 3;            // transparent well inset from left/right edges
const BAR_WELL_Y = 4;            // transparent well inset from top/bottom edges
const BAR_WELL_BG = "#0d0b1c";   // dark backing drawn behind the transparent well
const BAR_FALLBACK_W = 263;      // code-drawn fallback size matching the sprites
const BAR_FALLBACK_H = 24;       //   (so missing art never shifts the layout)
const HP_LABEL_SIZE = 12;        // in-well label font size (16px-tall well)
const BAR_STACK_GAP = 6;         // vertical gap between HP and Spirit bars

// XP strip (Vampire Survivors-style): a thin frameless bar flush against the
// very top edge of the screen, full canvas width. Reads as screen chrome
// instead of a floating element, so it costs zero play-area readability.
const XP_STRIP_H = 6;            // strip thickness in px

// Draw one HUD bar using a frame sprite (gold border, TRANSPARENT well):
// dark well backing -> colored fill -> frame ON TOP, so the pixel border stays
// crisp over the fill. Missing/loading sprite -> the original code-drawn bar
// at the same size, so the layout never shifts. Returns the rect actually
// drawn so callers can position labels against it.
function drawSkinnedBar(ctx, spriteKey, x, y, pct, fillColor, fallbackW, fallbackH) {
  const frame = getImage(spriteKey);

  if (frame && frame.width > 0) {
    const barW = frame.width, barH = frame.height;
    const wellX = x + BAR_WELL_X, wellY = y + BAR_WELL_Y;
    const wellW = barW - BAR_WELL_X * 2, wellH = barH - BAR_WELL_Y * 2;
    ctx.fillStyle = BAR_WELL_BG;
    ctx.fillRect(wellX, wellY, wellW, wellH);
    ctx.fillStyle = fillColor;
    ctx.fillRect(wellX, wellY, Math.round(wellW * pct), wellH);
    ctx.drawImage(frame, x, y, barW, barH);
    return { x, y, w: barW, h: barH };
  }

  // --- Fallback: the original code-drawn bar ---
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 2, y - 2, fallbackW + 4, fallbackH + 4);
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, fallbackW * pct, fallbackH);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, fallbackW, fallbackH);
  return { x, y, w: fallbackW, h: fallbackH };
}

// Active-curse icon row (Cursed Mode), shared by the HUD and the pause screen.
// Draws curse icons left-to-right from (x, y) at `size` px each. Icons load from
// assets/sprites/curses/<id>.png; a missing one degrades to a small rune box with
// the curse's initial (never a crash). `curses` is [{ id, name }]. Returns row width.
const registeredCurseIcons = new Set();
function drawCurseIcons(ctx, curses, x, y, size = 32, gap = 6) {
  ctx.save();
  ctx.imageSmoothingEnabled = false; // 64px art -> 32px is a clean 0.5x; keep it crisp
  let cx = x;
  for (const c of curses) {
    const key = "curse_icon_" + c.id;
    if (!registeredCurseIcons.has(key)) {
      registeredCurseIcons.add(key);
      loadImage(key, "assets/sprites/curses/" + c.id + ".png");
    }
    const icon = getImage(key);
    if (icon && icon.width > 0) {
      ctx.drawImage(icon, Math.round(cx), Math.round(y), size, size);
    } else {
      // Fallback: a small rune box with the curse's initial.
      ctx.fillStyle = "rgba(40, 30, 60, 0.85)";
      roundRect(ctx, cx, y, size, size, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(200, 150, 255, 0.7)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, cx, y, size, size, 5);
      ctx.stroke();
      text(ctx, (c.name || "?")[0].toUpperCase(), cx + size / 2, y + size / 2, { size: 16, color: "#d2a0ff", weight: "700" });
    }
    cx += size + gap;
  }
  ctx.restore();
  return Math.max(0, cx - x - gap);
}

export function drawHUD(ctx, w, h, state) {
  // XP strip: thin, frameless, flush along the very top edge (VS-style).
  const xpPct = state.xpToNext > 0 ? Math.max(0, Math.min(1, state.xp / state.xpToNext)) : 0;
  ctx.fillStyle = BAR_WELL_BG;
  ctx.fillRect(0, 0, w, XP_STRIP_H);
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, 0, Math.round(w * xpPct), XP_STRIP_H);

  // Health bar (top-left), below the XP strip.
  const pct = Math.max(0, state.health / state.maxHealth);
  const hpFillColor = pct > 0.5 ? "#5ad17a" : pct > 0.25 ? "#e6c34a" : RED;
  const hp = drawSkinnedBar(ctx, "health_bar", 16, 16, pct, hpFillColor, BAR_FALLBACK_W, BAR_FALLBACK_H);
  text(ctx, `HP ${Math.ceil(state.health)} / ${state.maxHealth}`, hp.x + hp.w / 2, hp.y + hp.h / 2, { size: HP_LABEL_SIZE, color: CREAM, weight: "700", stroke: "#0d0b1c", strokeWidth: 2 });

  // Spirit Imbued meter, docked directly under the HP bar (corner cluster).
  let frPct, fillColor, frLabel, frLabelColor;
  if (state.frenzyActive) {
    frPct = Math.max(0, state.frenzyTimer / state.frenzyDuration); // drains
    fillColor = GOLD;
    frLabel = "SPIRIT IMBUED!";
    frLabelColor = "#0d0b1c"; // dark text over the bright gold fill
  } else {
    frPct = Math.min(1, state.frenzyCharge / state.frenzyMax);
    fillColor = "#c77dff";
    frLabel = "Spirit Imbued";
    frLabelColor = CREAM;
    if (frPct >= 1) {
      // READY: pulse the fill between lavender (199,125,255) and gold
      // (244,213,141) so the full bar visibly breathes.
      const t = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      const r = Math.round(199 + (244 - 199) * t);
      const g = Math.round(125 + (213 - 125) * t);
      const b = Math.round(255 + (141 - 255) * t);
      fillColor = `rgb(${r}, ${g}, ${b})`;
    }
  }

  const fr = drawSkinnedBar(ctx, "spirit_bar", 16, hp.y + hp.h + BAR_STACK_GAP, frPct, fillColor, BAR_FALLBACK_W, BAR_FALLBACK_H);
  text(ctx, frLabel, fr.x + fr.w / 2, fr.y + fr.h / 2, { size: HP_LABEL_SIZE, color: frLabelColor, weight: "700", stroke: state.frenzyActive ? null : "#0d0b1c", strokeWidth: 2 });

  // Pulsing "ready" prompt just below the corner cluster.
  if (!state.frenzyActive && frPct >= 1) {
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
    ctx.globalAlpha = pulse;
    text(ctx, "SPACE: SPIRIT IMBUED!", fr.x + fr.w / 2, fr.y + fr.h + 14, { size: 15, color: PURPLE });
    ctx.globalAlpha = 1;
  }

  // Score + level (top-right, stacked).
  text(ctx, `Score: ${state.score}`, w - 16, 27, { size: 20, color: GOLD, align: "right" });
  text(ctx, `Lv ${state.level}`, w - 16, 49, { size: 16, color: DIM, align: "right" });

  // Active curses (Cursed Mode): a small icon row in the bottom-left — clear of the
  // top cluster and free to grow rightward as more curses stack.
  if (state.curses && state.curses.length > 0) {
    drawCurseIcons(ctx, state.curses, 16, h - 48, 32, 6);
  }
}

// --- LEVEL-UP / UPGRADE SCREEN -------------------------------------------
// offers = array of upgrade objects { name, description, ... }.
// Confirm: ENTER takes the first card; number keys pick a slot when there
// are multiple (built in now so adding cards later needs no UI rewrite).
// `flash` (0..1) is the fading "just leveled up" celebration: 1 the instant the
// screen appears, decaying to 0. It pops the title and washes a soft gold bloom
// over the screen (a single fade — no strobe).
export function drawUpgradeScreen(ctx, w, h, offers, flash = 0, hoveredIndex = -1) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.86)";
  ctx.fillRect(0, 0, w, h);

  const titleSize = 38 * (1 + 0.22 * flash); // brief pop, settles to 38
  text(ctx, "LEVEL UP!", w / 2, h * 0.20, { size: titleSize, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  const subtitle = offers.length > 1 ? "Choose an upgrade" : "New power gained";
  text(ctx, subtitle, w / 2, h * 0.20 + 48, { size: 18, color: DIM, weight: "500" });

  const cardW = 240, cardH = 180, gap = 24;
  const totalW = offers.length * cardW + (offers.length - 1) * gap;
  let x = (w - totalW) / 2;
  const y = h / 2 - cardH / 2 + 16;

  const zones = []; // clickable rect per card (mouse hit-testing in game.js)
  offers.forEach((up, i) => {
    drawCard(ctx, x, y, cardW, cardH, up, i, offers.length);
    // Mouse hover outline — cards have no keyboard selection cursor, so this is
    // the only "which one will I pick" feedback before a click.
    if (i === hoveredIndex) {
      ctx.save();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 12;
      roundRect(ctx, x, y, cardW, cardH, 10);
      ctx.stroke();
      ctx.restore();
    }
    zones.push({ x, y, w: cardW, h: cardH, index: i });
    x += cardW + gap;
  });

  // Soft gold bloom from the title area, fading out — cards stay readable.
  if (flash > 0) {
    ctx.save();
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.62);
    g.addColorStop(0, `rgba(244, 213, 141, ${0.4 * flash})`);
    g.addColorStop(1, "rgba(244, 213, 141, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  return zones; // game.js hit-tests these for card clicks/hover
}

// Registered-once guard so each icon's loadImage() runs a single time (never
// per-frame, which would recreate the Image and spam the network/console).
const registeredIcons = new Set();

// Draws an upgrade's icon: a soft purple glow that emanates from the icon
// itself (no solid disc behind it), with the crisp PNG drawn on top at `size`.
// Falls back to a glowing orb only if the icon is missing/still loading. The
// path is derived from the upgrade id, so the data owns it with no extra field.
// opts: { size = 48, glow = true }
function drawUpgradeIcon(ctx, cx, cy, up, opts = {}) {
  const size = opts.size || 48;
  const glow = opts.glow !== false;

  const key = "upgrade_icon_" + up.id;
  if (!registeredIcons.has(key)) {
    registeredIcons.add(key);
    loadImage(key, "assets/sprites/upgrades/" + up.id + ".png");
  }
  const icon = getImage(key);

  if (icon && icon.width > 0) {
    ctx.save();
    ctx.imageSmoothingEnabled = false; // keep pixel art crisp
    const ix = Math.round(cx - size / 2), iy = Math.round(cy - size / 2);
    if (glow) {
      // Two soft passes make a magical afterglow shaped to the icon — no disc.
      ctx.shadowColor = "rgba(155, 108, 255, 0.85)";
      ctx.shadowBlur = 16;
      ctx.drawImage(icon, ix, iy, size, size);
      ctx.shadowBlur = 9;
      ctx.drawImage(icon, ix, iy, size, size);
    } else {
      ctx.drawImage(icon, ix, iy, size, size);
    }
    ctx.restore();
  } else {
    // Fallback placeholder orb (only appears if the icon is missing).
    ctx.save();
    if (glow) { ctx.shadowColor = PURPLE; ctx.shadowBlur = 16; }
    ctx.fillStyle = PURPLE;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(16, size / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Split a string into at most `maxLines` lines that each fit `maxWidth`,
// measured with the SAME font string text() composes — so wrapped lines render
// at full size instead of text() shrinking the whole string to fit one line.
// If the text needs more than maxLines, everything left is joined onto the
// final line (text()'s shrink-to-fit then acts as the safety net).
function wrapText(ctx, str, maxWidth, { size = 14, font = BODY_FONT, weight = "700", maxLines = 2 } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  const words = String(str).split(" ");
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const tryLine = line ? `${line} ${words[i]}` : words[i];
    if (!line || ctx.measureText(tryLine).width <= maxWidth) {
      line = tryLine;
    } else {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(" ");
        break;
      }
    }
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

function drawCard(ctx, x, y, cw, ch, up, i, count) {
  // Card body: sprite container if present (drawn 1:1, crisp), otherwise the
  // original code-drawn rounded rect as fallback.
  const card = getImage("upgrade_card");
  if (card && card.width > 0) {
    ctx.drawImage(card, Math.round(x), Math.round(y), cw, ch);
  } else {
    ctx.fillStyle = "#1b1830";
    roundRect(ctx, x, y, cw, ch, 10);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, cw, ch, 10);
    ctx.stroke();
  }

  // Upgrade icon (glow emanates from it), centered near the top.
  drawUpgradeIcon(ctx, x + cw / 2, y + 44, up, { size: 48 });

  text(ctx, up.name, x + cw / 2, y + 90, { size: 20, color: GOLD, maxWidth: cw - 24 });

  // Level indicator — or an "EVOLUTION" tag for one-time evolution upgrades.
  if (up.tag === "evolution") {
    text(ctx, "EVOLUTION", x + cw / 2, y + 114, { size: 14, color: GOLD, weight: "700" });
  } else if (up.maxLevel !== undefined) {
    text(ctx, `Lv. ${up.level} / ${up.maxLevel}`, x + cw / 2, y + 114, { size: 14, color: PURPLE, weight: "700" });
  }

  // Description: word-wrapped to up to two FULL-SIZE lines (the old single-
  // line draw shrank long descriptions into unreadable micro-text).
  const descLines = wrapText(ctx, up.description, cw - 24, { size: 13, weight: "500" });
  if (descLines.length === 1) {
    text(ctx, descLines[0], x + cw / 2, y + 138, { size: 14, color: DIM, weight: "500", maxWidth: cw - 24 });
  } else {
    text(ctx, descLines[0], x + cw / 2, y + 131, { size: 13, color: DIM, weight: "500", maxWidth: cw - 24 });
    text(ctx, descLines[1], x + cw / 2, y + 148, { size: 13, color: DIM, weight: "500", maxWidth: cw - 24 });
  }

  const prompt = count > 1 ? `Press ${i + 1}` : "Press ENTER";
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, prompt, x + cw / 2, y + ch - 16, { size: 15, color: PURPLE });
  ctx.globalAlpha = 1;
}

// --- WAVE BANNER (during the between-wave intermission) -------------------
export function drawWaveBanner(ctx, w, h, wave, timer, isBoss = false) {
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.save();
  ctx.globalAlpha = pulse;
  text(ctx, `WAVE ${wave}`, w / 2, h / 2 - 20, { size: 52, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  ctx.globalAlpha = 1;
  if (isBoss) {
    text(ctx, "Boss Incoming", w / 2, h / 2 + 32, { size: 24, color: RED, weight: "700" });
  } else {
    text(ctx, "Get ready...", w / 2, h / 2 + 30, { size: 22, color: DIM, weight: "500" });
  }
  ctx.restore();
}

// --- EVOLUTION BANNER (transient unlock notice) --------------------------
export function drawEvolutionBanner(ctx, w, h, text_, timer) {
  // Fade out over the last second.
  const alpha = Math.min(1, timer);
  const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 200);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "#f4d58d";
  ctx.shadowBlur = 18 * pulse;
  text(ctx, text_, w / 2, h * 0.30, { size: 26, color: GOLD, maxWidth: w - 80 });
  ctx.restore();
}

// --- BOSS HEALTH BAR ------------------------------------------------------
export function drawBossBar(ctx, w, h, boss) {
  const barW = 520, barH = 16;
  // y 84 clears the top-left HP + Spirit cluster (which ends at y 70).
  const x = (w - barW) / 2, y = 84;
  const pct = Math.max(0, boss.health / boss.maxHealth);

  text(ctx, boss.name.toUpperCase(), w / 2, y - 14, { size: 16, color: GOLD });

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);
  ctx.fillStyle = RED;
  ctx.fillRect(x, y, barW * pct, barH);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barW, barH);
}

// --- OFFSCREEN ENEMY INDICATORS (straggler finder) -----------------------
// The world is larger than the viewport, so when only a few enemies remain a
// cornered one (typically a backed-up Gutter Gecko) can sit fully off-screen.
// For each such straggler, draw a small gold chevron pinned just inside the
// screen edge, pointing toward it — so the player never has to wander the map
// hunting the last enemy. Gated to low counts so it stays invisible during
// normal swarms. Pure screen-space draw; `cam` is the camera's world top-left.
const STRAGGLER_MAX = 3;   // show only when this few (or fewer) enemies are alive
const CHEVRON_INSET = 30;  // px the chevron sits in from the screen edge
export function drawOffscreenIndicators(ctx, w, h, enemies, cam) {
  const alive = enemies.filter((e) => !e.dead);
  if (alive.length === 0 || alive.length > STRAGGLER_MAX) return;

  const cx = w / 2, cy = h / 2;
  const halfW = w / 2 - CHEVRON_INSET;
  const halfH = h / 2 - CHEVRON_INSET;
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);

  for (const e of alive) {
    const sx = e.x - cam.x;
    const sy = e.y - cam.y;
    if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) continue; // on-screen — no arrow

    const dx = sx - cx, dy = sy - cy;
    const ang = Math.atan2(dy, dx);
    // Project the center→enemy direction onto the inset-rectangle border so the
    // chevron rides the edge nearest the enemy.
    const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    const px = cx + dx * t;
    const py = cy + dy * t;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = GOLD;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 8;
    ctx.beginPath();      // arrowhead pointing along +x (toward the enemy)
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// --- PAUSE MENU -----------------------------------------------------------
export function drawPauseMenu(ctx, w, h, info, items, selectedIndex) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.88)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "PAUSED", w / 2, 60, { size: 44, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  // Active curses (Cursed runs): a centered icon row under the title.
  if (info.curses && info.curses.length > 0) {
    const cs = 32, cg = 8;
    const rowW = info.curses.length * cs + (info.curses.length - 1) * cg;
    text(ctx, "CURSES", w / 2, 100, { size: 14, color: PURPLE, weight: "700" });
    drawCurseIcons(ctx, info.curses, (w - rowW) / 2, 110, cs, cg);
  }

  // --- Run info: two columns, top-aligned ---
  const colTop = 150;
  const leftX = 150;
  const rightX = 540;

  // Left column: run stats (Mode lines up with "Upgrades:" on the right).
  const stats = [
    `Mode: ${info.mode}`,
    `Wave: ${info.wave}`,
    `Level: ${info.level}`,
    `Score: ${info.score}`,
    `Health: ${info.health} / ${info.maxHealth}`,
    `Spirit Imbued: ${info.frenzy}`,
  ];
  stats.forEach((line, i) => {
    text(ctx, line, leftX, colTop + i * 24, { size: 16, color: CREAM, align: "left", weight: "500" });
  });

  // Right column: upgrades taken + evolution.
  text(ctx, "Upgrades:", rightX, colTop, { size: 18, color: GOLD, align: "left" });
  if (info.upgrades.length === 0) {
    text(ctx, "- none yet", rightX, colTop + 28, { size: 15, color: DIM, align: "left", weight: "500" });
  } else {
    info.upgrades.forEach((u, i) => {
      text(ctx, `- ${u.name}  Lv. ${u.level} / ${u.maxLevel}`, rightX, colTop + 28 + i * 24, {
        size: 15, color: CREAM, align: "left", weight: "500",
      });
    });
  }
  const evoY = colTop + 28 + Math.max(1, info.upgrades.length) * 24 + 14;
  text(ctx, `Evolution: ${info.evolution}`, rightX, evoY, {
    size: 16, color: info.evolution === "None" ? DIM : GOLD, align: "left", weight: "700",
  });

  // --- Menu options: centered near the bottom ---
  const lineH = 36;
  const startY = h - 62 - (items.length - 1) * lineH; // anchor last row just above the footer; auto-fits any item count
  const zones = []; // clickable rect per item (mouse hit-testing in game.js)
  const bw = 360, bh = 32; // generous click band per row (lineH 36 leaves a small gap)
  items.forEach((item, i) => {
    const selected = i === selectedIndex;
    const y = startY + i * lineH;
    zones.push({ x: Math.round(w / 2 - bw / 2), y: Math.round(y - bh / 2), w: bw, h: bh, index: i });
    text(ctx, `${selected ? "> " : "  "}${item}`, w / 2, y, {
      size: 26,
      color: selected ? GOLD : CREAM,
      weight: selected ? "700" : "500",
    });
  });

  text(ctx, "Esc / P: Resume      Enter: select", w / 2, h - 28, { size: 15, color: DIM, weight: "500" });
  return zones; // game.js hit-tests these for pause-menu clicks/hover
}

// --- CONFIRM QUIT (Main Menu from Pause) ---------------------------------
export function drawConfirmQuit(ctx, w, h, items, selectedIndex) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.92)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "Return to Main Menu?", w / 2, h / 2 - 70, { size: 34, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, "Current run will be lost.", w / 2, h / 2 - 28, { size: 18, color: CREAM, weight: "500" });

  const zones = []; // clickable rect per item (mouse hit-testing in game.js)
  const bw = 300, bh = 38;
  items.forEach((item, i) => {
    const selected = i === selectedIndex;
    const y = h / 2 + 24 + i * 44;
    zones.push({ x: Math.round(w / 2 - bw / 2), y: Math.round(y - bh / 2), w: bw, h: bh, index: i });
    text(ctx, `${selected ? "> " : "  "}${item}`, w / 2, y, {
      size: 26,
      color: selected ? GOLD : CREAM,
      weight: selected ? "700" : "500",
    });
  });

  text(ctx, "Esc / Backspace: cancel", w / 2, h - 28, { size: 15, color: DIM, weight: "500" });
  return zones; // game.js hit-tests these for confirm-quit clicks/hover
}

// --- VICTORY --------------------------------------------------------------
export function drawVictory(ctx, w, h, summary, items, selectedIndex) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.88)";
  ctx.fillRect(0, 0, w, h);

  // Warm glow behind the title.
  ctx.save();
  ctx.fillStyle = "rgba(244, 213, 141, 0.10)";
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.30, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  text(ctx, "TUTORIAL COMPLETE!", w / 2, 70, { size: 44, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, "You defeated the Elder Wisp.", w / 2, 112, { size: 18, color: CREAM, weight: "500" });
  text(ctx, "Your familiar is ready for greater danger.", w / 2, 138, { size: 18, color: DIM, weight: "500" });

  // Run summary — two tidy rows of existing tracked data.
  const row1 = `Level ${summary.level}      Wave ${summary.wave} / ${summary.maxWaves}      Score ${summary.score}`;
  const row2 = `Enemies defeated ${summary.enemiesDefeated}      Upgrades ${summary.upgradesChosen}      Time ${summary.timeText}`;
  text(ctx, row1, w / 2, 186, { size: 17, color: GOLD, weight: "700" });
  text(ctx, row2, w / 2, 212, { size: 16, color: CREAM, weight: "500" });

  if (summary.crystalsEarned > 0) {
    crystalLine(ctx, w / 2, 238, `Spirit Crystals earned: ${summary.crystalsEarned}`, { size: 16, color: GOLD });
  }

  // Menu options.
  const startY = 280;
  const lineH = 50;
  const boxW = 420, boxH = 42;

  const zones = []; // clickable rect per item (mouse hit-testing in game.js)
  items.forEach((item, i) => {
    const y = startY + i * lineH;
    const selected = i === selectedIndex;
    zones.push({ x: Math.round(w / 2 - boxW / 2), y: Math.round(y - boxH / 2), w: boxW, h: boxH, index: i });

    if (selected) {
      ctx.fillStyle = "rgba(244, 213, 141, 0.14)";
      roundRect(ctx, w / 2 - boxW / 2, y - boxH / 2, boxW, boxH, 8);
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      roundRect(ctx, w / 2 - boxW / 2, y - boxH / 2, boxW, boxH, 8);
      ctx.stroke();
    }

    text(ctx, item, w / 2, y, {
      size: 24,
      color: selected ? GOLD : CREAM,
      weight: selected ? "700" : "500",
      maxWidth: boxW - 24,
    });
  });

  text(ctx, "Enter / Space: select", w / 2, h - 34, { size: 15, color: DIM, weight: "500" });
  return zones; // game.js hit-tests these for victory-menu clicks/hover
}

// --- GAME OVER ------------------------------------------------------------
// --- NAME ENTRY (arcade initials) ------------------------------------------
// Shown when a Casual run makes the top 10, before the Game Over screen.
// info = { score, wave, letters: ["A","A","A"], slot: 0..2 }.
const INITIAL_BOX = 64;   // size of each letter box
const INITIAL_GAP = 18;   // gap between boxes

// --- FAMILIAR TUTORIAL HINT BAR ---------------------------------------------
// Bottom-center dialogue bar for the ghost cat's tutorial lines (tutorial mode
// only). hint = { text, alpha }. Screen space; the HUD rework keeps this
// bottom strip free. The portrait reuses the familiar's idle sprite (frame 0,
// facing south), with the placeholder cat head as fallback.
export function drawFamiliarHint(ctx, w, h, hint) {
  if (!hint || hint.alpha <= 0) return;

  const panelW = 560, panelH = 64;
  const x = (w - panelW) / 2;
  const y = h - panelH - 16;
  const portrait = 44;

  ctx.save();
  ctx.globalAlpha = hint.alpha;

  ctx.fillStyle = "rgba(13, 11, 28, 0.88)";
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = "rgba(244, 213, 141, 0.65)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, panelW, panelH);

  // Portrait (familiar idle strip, frame 0).
  const px = x + 12, py = y + (panelH - portrait) / 2;
  const img = getImage("familiar_idle_s");
  if (img && img.width > 0) {
    const fw = img.width / 4; // idle strips are 4 frames
    const fh = img.height;
    const s = Math.min(portrait / fw, portrait / fh);
    const dw = fw * s, dh = fh * s;
    ctx.drawImage(img, 0, 0, fw, fh, px + (portrait - dw) / 2, py + (portrait - dh) / 2, dw, dh);
  } else {
    // Placeholder cat head (matches the familiar's fallback look).
    const cx = px + portrait / 2, cy = py + portrait / 2 + 3;
    ctx.fillStyle = "#1c1a26";
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - 10, cy - 6); ctx.lineTo(cx - 6, cy - 17); ctx.lineTo(cx - 2, cy - 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 2, cy - 8); ctx.lineTo(cx + 6, cy - 17); ctx.lineTo(cx + 10, cy - 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.arc(cx - 4, cy - 1, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4, cy - 1, 2, 0, Math.PI * 2); ctx.fill();
  }

  // Speaker label + line.
  const tx = x + 12 + portrait + 12;
  text(ctx, "Familiar", tx, y + 18, { size: 12, color: PURPLE, align: "left", weight: "700" });
  text(ctx, hint.text, tx, y + 42, { size: 16, color: CREAM, align: "left", maxWidth: panelW - (tx - x) - 14 });

  ctx.restore();
}

export function drawNameEntry(ctx, w, h, info) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.86)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "NEW HIGH SCORE!", w / 2, h / 2 - 130, { size: 44, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, `Score: ${info.score}      Wave: ${info.wave}`, w / 2, h / 2 - 76, { size: 20, color: CREAM, weight: "500" });
  text(ctx, "Enter your initials", w / 2, h / 2 - 44, { size: 16, color: DIM, weight: "500" });

  // Three letter boxes, the active one highlighted with up/down arrows.
  const totalW = 3 * INITIAL_BOX + 2 * INITIAL_GAP;
  const startX = (w - totalW) / 2;
  const boxY = h / 2 - INITIAL_BOX / 2 + 16;
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);

  for (let i = 0; i < 3; i++) {
    const x = startX + i * (INITIAL_BOX + INITIAL_GAP);
    const active = i === info.slot;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(x, boxY, INITIAL_BOX, INITIAL_BOX);
    ctx.strokeStyle = active ? GOLD : "rgba(244, 213, 141, 0.35)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(x, boxY, INITIAL_BOX, INITIAL_BOX);

    text(ctx, info.letters[i], x + INITIAL_BOX / 2, boxY + INITIAL_BOX / 2 + 2, { size: 40, color: active ? GOLD : CREAM });

    if (active) {
      // Code-drawn triangles (the pixel font has no arrow glyphs).
      const cx = x + INITIAL_BOX / 2;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = PURPLE;
      ctx.beginPath(); // up arrow above the box
      ctx.moveTo(cx, boxY - 18);
      ctx.lineTo(cx - 7, boxY - 8);
      ctx.lineTo(cx + 7, boxY - 8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath(); // down arrow below the box
      ctx.moveTo(cx, boxY + INITIAL_BOX + 18);
      ctx.lineTo(cx - 7, boxY + INITIAL_BOX + 8);
      ctx.lineTo(cx + 7, boxY + INITIAL_BOX + 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.globalAlpha = pulse;
  text(ctx, "Up/Down: letter      Left/Right: slot      Enter: confirm", w / 2, boxY + INITIAL_BOX + 52, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

export function drawGameOver(ctx, w, h, info) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.82)";
  ctx.fillRect(0, 0, w, h);

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);

  if (info.endless) {
    // Personal-best callout: a pulsing gold banner above the title when this
    // run beat a stored best (wave and/or score). Most players never noticed
    // their bests persist — this makes the achievement land.
    let titleY = h / 2 - 78;
    if (info.beatBestWave || info.beatBestScore) {
      titleY = h / 2 - 58;
      const bestMsg = (info.beatBestWave && info.beatBestScore) ? "NEW PERSONAL BEST!"
        : info.beatBestWave ? "NEW BEST WAVE!" : "NEW HIGH SCORE!";
      ctx.globalAlpha = pulse;
      text(ctx, bestMsg, w / 2, h / 2 - 116, { size: 30, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
      ctx.globalAlpha = 1;
    }

    text(ctx, "CASUAL RUN OVER", w / 2, titleY, { size: 44, color: RED, font: TITLE_FONT, maxWidth: w - 100 });

    // Run stats block.
    text(ctx, `Wave reached: ${info.wave}      Level: ${info.level}`, w / 2, h / 2 - 14, { size: 22, color: GOLD });
    text(ctx, `Score: ${info.score}`, w / 2, h / 2 + 14, { size: 20, color: CREAM, weight: "500" });
    text(ctx, `Enemies defeated: ${info.enemiesDefeated}      Bosses: ${info.bossesDefeated}`, w / 2, h / 2 + 40, { size: 16, color: DIM, weight: "500" });
    if (info.evolutions && info.evolutions.length) {
      text(ctx, `Evolutions: ${info.evolutions.join(", ")}`, w / 2, h / 2 + 62, { size: 16, color: PURPLE, weight: "500" });
    }
    text(ctx, `Best wave: ${info.bestWave}      Best score: ${info.bestScore}`, w / 2, h / 2 + 86, { size: 15, color: DIM, weight: "500" });

    if (info.crystalsEarned > 0) {
      crystalLine(ctx, w / 2, h / 2 + 106, `Spirit Crystals earned: ${info.crystalsEarned}`, { size: 16, color: GOLD });
    }

    ctx.globalAlpha = pulse;
    const py = h / 2 + 124;
    text(ctx, "R: new casual run", w / 2 - 130, py, { size: 18, color: PURPLE });
    text(ctx, "Esc: main menu",     w / 2 + 130, py, { size: 18, color: PURPLE });
    ctx.globalAlpha = 1;
    // Two click targets: index 0 = retry/new run (R), index 1 = main menu (Esc).
    return [
      { x: w / 2 - 260, y: py - 20, w: 250, h: 40, index: 0 },
      { x: w / 2 + 10,  y: py - 20, w: 250, h: 40, index: 1 },
    ];
  }

  text(ctx, "GAME OVER", w / 2, h / 2 - 50, { size: 56, color: RED, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, `Final Score: ${info.score}`, w / 2, h / 2 + 10, { size: 24, color: GOLD });
  text(ctx, `Reached Wave ${info.wave}`, w / 2, h / 2 + 44, { size: 20, color: DIM, weight: "500" });

  if (info.crystalsEarned > 0) {
    crystalLine(ctx, w / 2, h / 2 + 66, `Spirit Crystals earned: ${info.crystalsEarned}`, { size: 16, color: GOLD });
  }

  ctx.globalAlpha = pulse;
  const py = h / 2 + 90;
  text(ctx, "R: try again",   w / 2 - 120, py, { size: 20, color: PURPLE });
  text(ctx, "Esc: main menu", w / 2 + 120, py, { size: 20, color: PURPLE });
  ctx.globalAlpha = 1;
  // Two click targets: index 0 = retry (R), index 1 = main menu (Esc).
  return [
    { x: w / 2 - 250, y: py - 22, w: 240, h: 44, index: 0 },
    { x: w / 2 + 10,  y: py - 22, w: 240, h: 44, index: 1 },
  ];
}

// --- Main-menu crystal readout --------------------------------------------
// Wardrobe is now a main-menu item, so the old corner button is retired. This
// keeps an at-a-glance Spirit Crystal total in the top-right corner. Drawn
// SEPARATELY from drawMenu so it never disturbs the centred title/option stack.
export function drawCrystalTotal(ctx, w, h, crystals) {
  const cstr = `${crystals}`;
  ctx.font = `700 16px ${BODY_FONT}`;
  const tw = ctx.measureText(cstr).width;
  const rightX = w - 20;
  const cy = 28;
  text(ctx, cstr, rightX, cy, { size: 16, color: GOLD, align: "right", weight: "700" });
  drawCrystalIcon(ctx, rightX - tw - 12, cy - 1, 9);
}

// Full Closet screen: crystal total, an Outfits/Collars tab toggle, one row per
// item in the active tab (portrait, name, effect, owned/equipped/cost), then a
// Back row. `data` comes from Game.closetData().
export function drawCloset(ctx, w, h, data) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.92)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "WARDROBE", w / 2, 54, { size: 38, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  crystalLine(ctx, w / 2, 96, `Spirit Crystals: ${data.crystals}`, { size: 17, color: CREAM });

  // Tabs (Outfits | Familiars | Collars); A/D switches (hint in the footer).
  const tabLabels = ["Outfits", "Familiars", "Collars"];
  const tabY = 136, tabGap = 146, tabW = 124;
  const tabs = []; // clickable tab rects (mouse) — one per tab regardless of active state
  tabLabels.forEach((label, ti) => {
    const tx = w / 2 + (ti - 1) * tabGap; // three across, centered (left / center / right)
    const active = ti === data.tab;
    tabs.push({ x: tx - tabW / 2, y: tabY - 16, w: tabW, h: 32, tab: ti });
    if (active) {
      ctx.fillStyle = "rgba(244, 213, 141, 0.16)";
      roundRect(ctx, tx - tabW / 2, tabY - 16, tabW, 32, 8); ctx.fill();
      ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5;
      roundRect(ctx, tx - tabW / 2, tabY - 16, tabW, 32, 8); ctx.stroke();
    }
    text(ctx, label, tx, tabY, { size: 17, color: active ? GOLD : DIM, weight: "700" });
  });

  const rowsData = data.tab === 0 ? data.outfits : data.tab === 1 ? data.familiars : data.collars;
  const startY = 190;
  const rowH = 60;
  const boxW = 560, boxH = 52;
  const xL = w / 2 - boxW / 2;
  const xR = w / 2 + boxW / 2;

  const zones = []; // clickable row rects + Back (mouse hit-testing in game.js)
  rowsData.forEach((o, i) => {
    const cy = startY + i * rowH;
    const selected = i === data.index;
    zones.push({ x: xL, y: cy - boxH / 2, w: boxW, h: boxH, index: i });

    // Row box.
    if (selected) {
      ctx.fillStyle = "rgba(244, 213, 141, 0.14)";
      roundRect(ctx, xL, cy - boxH / 2, boxW, boxH, 10); ctx.fill();
      ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5;
      roundRect(ctx, xL, cy - boxH / 2, boxW, boxH, 10); ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      roundRect(ctx, xL, cy - boxH / 2, boxW, boxH, 10); ctx.fill();
    }

    // Portrait: idle-south frame 0 of the witch (outfits) or cat (collars),
    // a 4-frame strip. Falls back to the flat colour swatch if not loaded.
    const portrait = getImage(o.spriteKey);
    const pBox = 42;
    const pcx = xL + 18 + pBox / 2;
    if (portrait && portrait.width > 0) {
      const fw = portrait.width / 4; // idle = 4 frames
      const fh = portrait.height;
      const s = Math.min(pBox / fw, pBox / fh);
      const dw = fw * s, dh = fh * s;
      ctx.drawImage(portrait, 0, 0, fw, fh, pcx - dw / 2, cy - dh / 2, dw, dh);
    } else {
      const chip = 30;
      ctx.fillStyle = o.swatch;
      roundRect(ctx, pcx - chip / 2, cy - chip / 2, chip, chip, 6); ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)"; ctx.lineWidth = 1.5;
      roundRect(ctx, pcx - chip / 2, cy - chip / 2, chip, chip, 6); ctx.stroke();
    }

    // Name + effect description.
    const textX = xL + 18 + pBox + 12;
    text(ctx, o.name, textX, cy - 9, { size: 18, color: o.equipped ? GOLD : CREAM, align: "left", weight: "700" });
    text(ctx, o.desc, textX, cy + 12, { size: 13, color: DIM, align: "left", weight: "500" });

    // Right-side status.
    if (o.equipped) {
      text(ctx, "EQUIPPED", xR - 18, cy, { size: 15, color: GOLD, align: "right", weight: "700" });
    } else if (o.owned) {
      text(ctx, "Owned", xR - 18, cy, { size: 15, color: DIM, align: "right", weight: "700" });
    } else {
      const label = `Cost ${o.cost}`;
      ctx.font = `700 16px ${BODY_FONT}`;
      const lw = ctx.measureText(label).width;
      const col = o.affordable ? GOLD : RED;
      text(ctx, label, xR - 18, cy, { size: 16, color: col, align: "right", weight: "700" });
      drawCrystalIcon(ctx, xR - 18 - lw - 12, cy - 1, 9);
    }
  });

  // Back row.
  const backY = startY + rowsData.length * rowH + 2;
  const backSel = data.index === rowsData.length;
  if (backSel) {
    ctx.fillStyle = "rgba(244, 213, 141, 0.14)";
    roundRect(ctx, w / 2 - 90, backY - 20, 180, 40, 8); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5;
    roundRect(ctx, w / 2 - 90, backY - 20, 180, 40, 8); ctx.stroke();
  }
  text(ctx, "Back", w / 2, backY, { size: 20, color: backSel ? GOLD : DIM, weight: "700" });
  zones.push({ x: w / 2 - 90, y: backY - 20, w: 180, h: 40, index: rowsData.length });

  text(ctx, "A/D switch tab • Up/Down move • Enter • Esc back", w / 2, h - 24, { size: 14, color: DIM, weight: "500" });

  return { zones, tabs }; // game.js hit-tests rows/Back (zones) + the tab toggle (tabs)
}