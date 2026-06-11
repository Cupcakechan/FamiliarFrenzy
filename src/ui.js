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
loadImage("upgrade_card", "assets/sprites/ui/upgrade_card.png"); // 240x150 level-up card container
// HUD bar frames. All three share one construction: a gold pixel border with a
// TRANSPARENT inner well (well inset = 3px left/right, 4px top/bottom). The
// code draws a dark well backing + colored fill, then the frame ON TOP, so the
// border always stays crisp over the fill. Sizes are read from each image at
// draw time, so re-authoring a bar at a new width needs no code change.
loadImage("health_bar", "assets/sprites/ui/health_bar.png"); // 263x24 HP bar frame
loadImage("xp_bar", "assets/sprites/ui/xp_bar.png");         // 600x24 XP bar frame
loadImage("spirit_bar", "assets/sprites/ui/spirit_bar.png"); // 600x24 Spirit Imbued frame

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

// --- MENUS ----------------------------------------------------------------
// Generic vertical menu: title + highlighted option list + footer hints.
export function drawMenu(ctx, w, h, title, items, selectedIndex, footerLines = []) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  // Faint moon backdrop for flavor.
  ctx.save();
  ctx.fillStyle = "rgba(244, 213, 141, 0.08)";
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.40, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  text(ctx, title, w / 2, h * 0.24, { size: 52, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

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

  items.forEach((item, i) => {
    const y = startY + i * lineH;
    const selected = i === selectedIndex;
    const bx = Math.round(w / 2 - bw / 2);
    const by = Math.round(y - bh / 2);

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

// --- HIGH SCORES (Endless only) ------------------------------------------
// entries = array of { score, wave, date }, already sorted best-first.
export function drawHighScores(ctx, w, h, entries) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "High Scores", w / 2, 58, { size: 42, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, "Endless Mode", w / 2, 92, { size: 16, color: DIM, weight: "500" });

  // Friendly empty state when no Endless run has been recorded yet.
  if (!entries || entries.length === 0) {
    text(ctx, "No runs yet.", w / 2, h / 2 - 12, { size: 24, color: CREAM, weight: "500" });
    text(ctx, "Survive Endless Mode to record a score.", w / 2, h / 2 + 22, { size: 16, color: DIM, weight: "500" });
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = pulse;
    text(ctx, "Press Esc or Backspace to return", w / 2, h - 40, { size: 16, color: PURPLE, weight: "500" });
    ctx.globalAlpha = 1;
    return;
  }

  // Table layout (4 columns: rank / score / wave / date).
  const tableX = (w - 660) / 2;
  const rankX = tableX + 18;
  const scoreX = tableX + 110;
  const waveX = tableX + 360;
  const dateX = tableX + 500;
  const headerY = 132;
  const rowH = 30;

  text(ctx, "#",     rankX,  headerY, { size: 14, color: DIM, align: "left", weight: "700" });
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
    text(ctx, `${e.score}`,       scoreX, y, { size: 16, color, align: "left", weight });
    text(ctx, `${e.wave}`,        waveX,  y, { size: 16, color, align: "left", weight });
    text(ctx, `${e.date || "—"}`, dateX,  y, { size: 16, color, align: "left", weight });
  });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press Esc or Backspace to return", w / 2, h - 32, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

// --- SETTINGS -------------------------------------------------------------
// Music volume slider. Left/Right adjusts; Esc/Backspace returns.
export function drawSettings(ctx, w, h, musicVolume) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "SETTINGS", w / 2, h * 0.22, { size: 48, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  const sliderW = 420, sliderH = 10;
  const sx = (w - sliderW) / 2;
  const sy = h * 0.46;
  const pct = Math.max(0, Math.min(1, musicVolume / 100));

  text(ctx, "Music Volume", w / 2, sy - 34, { size: 22, color: CREAM, weight: "500" });

  // Track + filled portion + border.
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(sx - 2, sy - 2, sliderW + 4, sliderH + 4);
  ctx.fillStyle = "rgba(244, 213, 141, 0.20)";
  ctx.fillRect(sx, sy, sliderW, sliderH);
  ctx.fillStyle = PURPLE;
  ctx.fillRect(sx, sy, sliderW * pct, sliderH);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx, sy, sliderW, sliderH);

  // Knob.
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(sx + sliderW * pct, sy + sliderH / 2, 9, 0, Math.PI * 2);
  ctx.fill();

  // Value readout.
  text(ctx, `${Math.round(musicVolume)}%`, w / 2, sy + 38, { size: 20, color: GOLD });

  text(ctx, "Left / Right: adjust volume", w / 2, h - 80, { size: 16, color: DIM, weight: "500" });
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Esc / Backspace: back", w / 2, h - 50, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

// --- HOW TO PLAY ----------------------------------------------------------
// Single-screen instructions (Option A): everything fits at 960x540.
export function drawHowToPlay(ctx, w, h) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "HOW TO PLAY", w / 2, h * 0.20, { size: 40, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  const controls = [
    "Move:  WASD / Arrow Keys",
    "Confirm:  Enter / Space",
    "Spirit Imbued:  Space  (when the meter is full)",
    "Back / Pause:  Esc / Backspace",
    "Restart:  R  (after Game Over or Victory)",
  ];

  // Center the CONTROLS block (heading + lines) vertically, nudged slightly
  // below middle to balance the title up top. Lines are center-aligned.
  const lineH = 36;
  const headingGap = 16;
  const blockH = lineH + headingGap + controls.length * lineH;
  let y = (h - blockH) / 2 + 40;

  text(ctx, "CONTROLS", w / 2, y, { size: 22, color: GOLD });
  y += lineH + headingGap;
  controls.forEach((line) => {
    text(ctx, line, w / 2, y, { size: 18, color: CREAM, weight: "500" });
    y += lineH;
  });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press Esc or Backspace to return", w / 2, h - 40, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

// --- UPGRADE GRIMOIRE -----------------------------------------------------
// Read-only glossary, organized as two collapsible categories. `rows` comes
// from game.grimoireRows() — a flat list of navigable rows:
//   { type: "category", key, label, open, count }
//   { type: "entry", entry, open }        // only when its category is open
//   { type: "back" }
// `selectedIndex` is the highlighted row. `levels` = { id: ownedLevel } when
// opened from Pause (adds a "Current" line for upgrades), else null.
export function drawGrimoire(ctx, w, h, rows, selectedIndex, levels) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "GRIMOIRE", w / 2, 46, { size: 34, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

  const catX = 180;          // category header left edge
  const entryX = 212;        // entry name (indented under a category)
  const detailX = 240;       // detail label (indented under an entry)
  const valX = detailX + 124; // detail value column (wide gap → no overlap)
  const rightX = w - 180;    // right-aligned cap / tag
  let y = 100;

  rows.forEach((row, i) => {
    const selected = i === selectedIndex;

    if (row.type === "category") {
      const arrow = row.open ? "v " : "> ";
      text(ctx, `${arrow}${row.label}`, catX, y, {
        size: 22, color: selected ? GOLD : CREAM, align: "left", weight: "700",
      });
      text(ctx, `${row.count}`, rightX, y, { size: 14, color: DIM, align: "right", weight: "500" });
      y += 34;
      return;
    }

    if (row.type === "back") {
      text(ctx, `${selected ? "> " : "  "}Back`, catX, y + 6, {
        size: 20, color: selected ? GOLD : CREAM, align: "left", weight: selected ? "700" : "500",
      });
      y += 30;
      return;
    }

    // Entry row (indented under its open category).
    const e = row.entry;
    drawUpgradeIcon(ctx, entryX - 16, y, e, { size: 22, glow: false });
    const prefix = row.open ? "v " : (selected ? "> " : "  ");
    text(ctx, `${prefix}${e.name}`, entryX, y, {
      size: 18, color: selected ? GOLD : CREAM, align: "left", weight: selected ? "700" : "500",
    });
    if (e.kind === "evolution") {
      text(ctx, "EVOLUTION", rightX, y, { size: 12, color: GOLD, align: "right", weight: "700" });
    } else if (e.maxLevel !== undefined) {
      text(ctx, `Max Lv. ${e.maxLevel}`, rightX, y, { size: 12, color: DIM, align: "right", weight: "500" });
    }
    y += 26;

    // Expanded detail block (display-only; one open entry per category).
    if (row.open) {
      const effectVal = e.maxedStat ? `${e.effect}  (MAXED ${e.maxedStat})` : e.effect;
      const detail = [["Effect:", effectVal]];
      // Evolutions show effect only; upgrades also show current level + note.
      if (e.kind !== "evolution") {
        if (levels && e.maxLevel !== undefined) {
          detail.push(["Current:", `Lv. ${levels[e.id] || 0} / ${e.maxLevel}`]);
        }
        if (e.evolutionNotes) detail.push(["Evolution:", e.evolutionNotes]);
      }
      detail.forEach(([label, val]) => {
        text(ctx, label, detailX, y, { size: 14, color: GOLD, align: "left", weight: "700" });
        text(ctx, val, valX, y, { size: 14, color: CREAM, align: "left", weight: "500", maxWidth: rightX - valX });
        y += 20;
      });
      y += 6;
    }
  });

  text(ctx, "Up / Down: move      Enter: expand / collapse      Esc / Backspace: back",
    w / 2, h - 24, { size: 14, color: DIM, weight: "500" });
}

// --- IN-GAME HUD ----------------------------------------------------------

// --- Skinned-bar tunables (shared by HP / XP / Spirit Imbued) -------------
const BAR_WELL_X = 3;            // transparent well inset from left/right edges
const BAR_WELL_Y = 4;            // transparent well inset from top/bottom edges
const BAR_WELL_BG = "#0d0b1c";   // dark backing drawn behind the transparent well
const BAR_FALLBACK_W = 600;      // code-drawn fallback size for XP/Spirit bars
const BAR_FALLBACK_H = 24;       //   (matches the sprites so layout never shifts)
const HP_FALLBACK_W = 263;       // code-drawn fallback size for the HP bar
const HP_LABEL_SIZE = 12;        // "HP x / y" font size inside the 16px-tall well

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

export function drawHUD(ctx, w, h, state) {
  // Health bar (top-left).
  const pct = Math.max(0, state.health / state.maxHealth);
  const hpFillColor = pct > 0.5 ? "#5ad17a" : pct > 0.25 ? "#e6c34a" : RED;
  const hp = drawSkinnedBar(ctx, "health_bar", 16, 16, pct, hpFillColor, HP_FALLBACK_W, BAR_FALLBACK_H);
  text(ctx, `HP ${Math.ceil(state.health)} / ${state.maxHealth}`, hp.x + hp.w / 2, hp.y + hp.h / 2, { size: HP_LABEL_SIZE, color: CREAM, weight: "700", stroke: "#0d0b1c", strokeWidth: 2 });

  // Score (top-right).
  text(ctx, `Score: ${state.score}`, w - 16, 27, { size: 20, color: GOLD, align: "right" });

  // XP bar (bottom center) + level. Positioned by the sprite's known 600x24
  // size (the fallback matches it, so missing art doesn't shift the layout).
  const xpX = (w - BAR_FALLBACK_W) / 2, xpY = h - 40;
  const xpPct = state.xpToNext > 0 ? Math.max(0, Math.min(1, state.xp / state.xpToNext)) : 0;
  const xp = drawSkinnedBar(ctx, "xp_bar", xpX, xpY, xpPct, PURPLE, BAR_FALLBACK_W, BAR_FALLBACK_H);
  text(ctx, `Lv ${state.level}`, xp.x - 12, xp.y + xp.h / 2, { size: 16, color: GOLD, align: "right" });

  // Spirit Imbued meter (just above the XP bar).
  const frX = (w - BAR_FALLBACK_W) / 2, frY = xpY - BAR_FALLBACK_H - 8;

  let frPct, fillColor, leftLabel, leftColor;
  if (state.frenzyActive) {
    frPct = Math.max(0, state.frenzyTimer / state.frenzyDuration); // drains
    fillColor = GOLD;
    leftLabel = "SPIRIT IMBUED!";
    leftColor = GOLD;
  } else {
    frPct = Math.min(1, state.frenzyCharge / state.frenzyMax);
    fillColor = "#c77dff";
    leftLabel = "Spirit Imbued";
    leftColor = DIM;
  }

  const fr = drawSkinnedBar(ctx, "spirit_bar", frX, frY, frPct, fillColor, BAR_FALLBACK_W, BAR_FALLBACK_H);
  text(ctx, leftLabel, fr.x - 12, fr.y + fr.h / 2, { size: 13, color: leftColor, align: "right" });

  // Pulsing "ready" prompt when the meter is full and not yet active.
  if (!state.frenzyActive && frPct >= 1) {
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
    ctx.globalAlpha = pulse;
    text(ctx, "SPACE: SPIRIT IMBUED!", w / 2, fr.y - 14, { size: 15, color: PURPLE });
    ctx.globalAlpha = 1;
  }
}

// --- LEVEL-UP / UPGRADE SCREEN -------------------------------------------
// offers = array of upgrade objects { name, description, ... }.
// Confirm: ENTER takes the first card; number keys pick a slot when there
// are multiple (built in now so adding cards later needs no UI rewrite).
export function drawUpgradeScreen(ctx, w, h, offers) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.86)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "LEVEL UP!", w / 2, h * 0.20, { size: 38, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  const subtitle = offers.length > 1 ? "Choose an upgrade" : "New power gained";
  text(ctx, subtitle, w / 2, h * 0.20 + 48, { size: 18, color: DIM, weight: "500" });

  const cardW = 240, cardH = 180, gap = 24;
  const totalW = offers.length * cardW + (offers.length - 1) * gap;
  let x = (w - totalW) / 2;
  const y = h / 2 - cardH / 2 + 16;

  offers.forEach((up, i) => {
    drawCard(ctx, x, y, cardW, cardH, up, i, offers.length);
    x += cardW + gap;
  });
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

  text(ctx, up.description, x + cw / 2, y + 138, { size: 14, color: DIM, weight: "500", maxWidth: cw - 24 });

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
    text(ctx, "Boss Incoming: Elder Wisp", w / 2, h / 2 + 32, { size: 24, color: RED, weight: "700" });
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
  const x = (w - barW) / 2, y = 58;
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

// --- PAUSE MENU -----------------------------------------------------------
export function drawPauseMenu(ctx, w, h, info, items, selectedIndex) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.88)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "PAUSED", w / 2, 60, { size: 44, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });

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
  const startY = h - 196;
  const lineH = 40;
  items.forEach((item, i) => {
    const selected = i === selectedIndex;
    const y = startY + i * lineH;
    text(ctx, `${selected ? "> " : "  "}${item}`, w / 2, y, {
      size: 26,
      color: selected ? GOLD : CREAM,
      weight: selected ? "700" : "500",
    });
  });

  text(ctx, "Esc / P: Resume      Enter: select", w / 2, h - 28, { size: 15, color: DIM, weight: "500" });
}

// --- CONFIRM QUIT (Main Menu from Pause) ---------------------------------
export function drawConfirmQuit(ctx, w, h, items, selectedIndex) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.92)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "Return to Main Menu?", w / 2, h / 2 - 70, { size: 34, color: GOLD, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, "Current run will be lost.", w / 2, h / 2 - 28, { size: 18, color: CREAM, weight: "500" });

  items.forEach((item, i) => {
    const selected = i === selectedIndex;
    const y = h / 2 + 24 + i * 44;
    text(ctx, `${selected ? "> " : "  "}${item}`, w / 2, y, {
      size: 26,
      color: selected ? GOLD : CREAM,
      weight: selected ? "700" : "500",
    });
  });

  text(ctx, "Esc / Backspace: cancel", w / 2, h - 28, { size: 15, color: DIM, weight: "500" });
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

  // Menu options.
  const startY = 280;
  const lineH = 50;
  const boxW = 420, boxH = 42;

  items.forEach((item, i) => {
    const y = startY + i * lineH;
    const selected = i === selectedIndex;

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

  text(ctx, "Up / Down: move      Enter / Space: select", w / 2, h - 34, { size: 15, color: DIM, weight: "500" });
}

// --- GAME OVER ------------------------------------------------------------
export function drawGameOver(ctx, w, h, info) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.82)";
  ctx.fillRect(0, 0, w, h);

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);

  if (info.endless) {
    text(ctx, "ENDLESS RUN OVER", w / 2, h / 2 - 78, { size: 48, color: RED, font: TITLE_FONT, maxWidth: w - 100 });
    text(ctx, `Wave reached: ${info.wave}`, w / 2, h / 2 - 18, { size: 24, color: GOLD });
    text(ctx, `Score: ${info.score}`, w / 2, h / 2 + 14, { size: 20, color: CREAM, weight: "500" });
    text(ctx, `Bosses defeated: ${info.bossesDefeated}`, w / 2, h / 2 + 42, { size: 18, color: DIM, weight: "500" });
    text(ctx, `Best wave: ${info.bestWave}      Best score: ${info.bestScore}`, w / 2, h / 2 + 70, { size: 16, color: DIM, weight: "500" });

    ctx.globalAlpha = pulse;
    text(ctx, "R: new endless run      Esc: main menu", w / 2, h / 2 + 114, { size: 18, color: PURPLE });
    ctx.globalAlpha = 1;
    return;
  }

  text(ctx, "GAME OVER", w / 2, h / 2 - 50, { size: 56, color: RED, font: TITLE_FONT, maxWidth: w - 100 });
  text(ctx, `Final Score: ${info.score}`, w / 2, h / 2 + 10, { size: 24, color: GOLD });
  text(ctx, `Reached Wave ${info.wave}`, w / 2, h / 2 + 44, { size: 20, color: DIM, weight: "500" });

  ctx.globalAlpha = pulse;
  text(ctx, "R: try again      Esc: main menu", w / 2, h / 2 + 90, { size: 20, color: PURPLE });
  ctx.globalAlpha = 1;
}
