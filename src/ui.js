/* =========================================================================
   ui.js — everything drawn ON TOP of the game world: title, HUD, the
   level-up / upgrade screen, and game over.

   Each function takes the canvas context (ctx) plus the data it needs.
   No game logic lives here — just drawing.
   ========================================================================= */

const GOLD = "#f4d58d";
const PURPLE = "#9b6cff";
const RED = "#e2536b";
const DIM = "rgba(244, 213, 141, 0.65)";
const CREAM = "#f3e7c6";
const MENU_BG = "#140d24"; // dark purple

// --- Shared helpers -------------------------------------------------------
function text(ctx, str, x, y, { size = 24, color = GOLD, align = "center", font = "Cinzel, Georgia, serif", weight = "700" } = {}) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
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

  text(ctx, title, w / 2, h * 0.24, { size: 52, color: GOLD });

  const startY = h * 0.46;
  const lineH = 50;
  const boxW = 380, boxH = 42;

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
      size: 28,
      color: selected ? GOLD : CREAM,
      weight: selected ? "700" : "500",
    });
  });

  footerLines.forEach((line, i) => {
    text(ctx, line, w / 2, h - 64 + i * 22, { size: 15, color: DIM, weight: "500" });
  });
}

// --- PLACEHOLDER ("Coming Soon") screen -----------------------------------
export function drawPlaceholder(ctx, w, h, title) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, title, w / 2, h / 2 - 30, { size: 48, color: GOLD });
  text(ctx, "Coming Soon", w / 2, h / 2 + 20, { size: 24, color: CREAM, weight: "500" });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press Esc or Backspace to return", w / 2, h - 60, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

// --- HOW TO PLAY ----------------------------------------------------------
// Single-screen instructions (Option A): everything fits at 960x540.
export function drawHowToPlay(ctx, w, h) {
  ctx.fillStyle = MENU_BG;
  ctx.fillRect(0, 0, w, h);

  text(ctx, "HOW TO PLAY", w / 2, 50, { size: 40, color: GOLD });

  const headX = 150;  // left margin for section headings
  const bodyX = 172;  // slight indent for body lines

  const controls = [
    "Move:  WASD / Arrow Keys",
    "Confirm:  Enter / Space",
    "Frenzy:  Space  (when the Frenzy meter is full)",
    "Back / Pause:  Esc / Backspace",
    "Restart:  R  (after Game Over or Victory)",
  ];

  const survive = [
    "Your ghost cat familiar attacks automatically — no aiming needed.",
    "Dodge enemies and position yourself so the cat can hit them.",
    "Defeated enemies drop EXP motes — collect them to level up.",
    "Leveling up lets you pick an upgrade (maxed ones stop appearing).",
    "Touching enemies hurts you; grab health flasks to recover.",
    "Frenzy makes the cat fire faster — save it for swarms or the boss.",
    "Tutorial Run is 10 waves; clear them and defeat the Wave 10 boss to win.",
  ];

  text(ctx, "CONTROLS", headX, 92, { size: 20, color: GOLD, align: "left" });
  controls.forEach((line, i) => {
    text(ctx, line, bodyX, 120 + i * 24, { size: 16, color: CREAM, align: "left", weight: "500" });
  });

  text(ctx, "HOW TO SURVIVE", headX, 264, { size: 20, color: GOLD, align: "left" });
  survive.forEach((line, i) => {
    text(ctx, line, bodyX, 292 + i * 24, { size: 16, color: CREAM, align: "left", weight: "500" });
  });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press Esc or Backspace to return", w / 2, h - 30, { size: 16, color: PURPLE, weight: "500" });
  ctx.globalAlpha = 1;
}

// --- IN-GAME HUD ----------------------------------------------------------
export function drawHUD(ctx, w, h, state) {
  // Health bar (top-left).
  const barX = 16, barY = 16, barW = 260, barH = 22;
  const pct = Math.max(0, state.health / state.maxHealth);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

  ctx.fillStyle = pct > 0.5 ? "#5ad17a" : pct > 0.25 ? "#e6c34a" : RED;
  ctx.fillRect(barX, barY, barW * pct, barH);

  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  text(ctx, `HP ${Math.ceil(state.health)} / ${state.maxHealth}`, barX + barW / 2, barY + barH / 2, { size: 14, color: "#0d0b1c", weight: "700" });

  // Score (top-right).
  text(ctx, `Score: ${state.score}`, w - 16, 27, { size: 20, color: GOLD, align: "right" });

  // Wave label (top-center) — placeholder until Phase 6.
  text(ctx, `Wave ${state.wave}`, w / 2, 27, { size: 20, color: DIM });

  // XP bar (bottom center) + level.
  const xpW = 600, xpH = 14;
  const xpX = (w - xpW) / 2, xpY = h - 30;
  const xpPct = state.xpToNext > 0 ? Math.max(0, Math.min(1, state.xp / state.xpToNext)) : 0;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(xpX - 2, xpY - 2, xpW + 4, xpH + 4);

  ctx.fillStyle = PURPLE;
  ctx.fillRect(xpX, xpY, xpW * xpPct, xpH);

  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(xpX, xpY, xpW, xpH);

  text(ctx, `Lv ${state.level}`, xpX - 12, xpY + xpH / 2, { size: 16, color: GOLD, align: "right" });

  // Familiar Frenzy meter (just above the XP bar).
  const frW = 300, frH = 12;
  const frX = (w - frW) / 2, frY = h - 52;

  let frPct, fillColor, leftLabel, leftColor;
  if (state.frenzyActive) {
    frPct = Math.max(0, state.frenzyTimer / state.frenzyDuration); // drains
    fillColor = GOLD;
    leftLabel = "FRENZY!";
    leftColor = GOLD;
  } else {
    frPct = Math.min(1, state.frenzyCharge / state.frenzyMax);
    fillColor = "#c77dff";
    leftLabel = "Frenzy";
    leftColor = DIM;
  }

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(frX - 2, frY - 2, frW + 4, frH + 4);
  ctx.fillStyle = fillColor;
  ctx.fillRect(frX, frY, frW * frPct, frH);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(frX, frY, frW, frH);

  text(ctx, leftLabel, frX - 12, frY + frH / 2, { size: 13, color: leftColor, align: "right" });

  // Pulsing "ready" prompt when the meter is full and not yet active.
  if (!state.frenzyActive && frPct >= 1) {
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
    ctx.globalAlpha = pulse;
    text(ctx, "SPACE: FRENZY!", w / 2, frY - 14, { size: 15, color: PURPLE });
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

  text(ctx, "LEVEL UP!", w / 2, h * 0.22, { size: 48, color: GOLD });
  const subtitle = offers.length > 1 ? "Choose an upgrade" : "New power gained";
  text(ctx, subtitle, w / 2, h * 0.22 + 42, { size: 20, color: DIM, weight: "500" });

  const cardW = 280, cardH = 188, gap = 28;
  const totalW = offers.length * cardW + (offers.length - 1) * gap;
  let x = (w - totalW) / 2;
  const y = h / 2 - cardH / 2 + 16;

  offers.forEach((up, i) => {
    drawCard(ctx, x, y, cardW, cardH, up, i, offers.length);
    x += cardW + gap;
  });
}

function drawCard(ctx, x, y, cw, ch, up, i, count) {
  // Card body + border.
  ctx.fillStyle = "#1b1830";
  roundRect(ctx, x, y, cw, ch, 10);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, cw, ch, 10);
  ctx.stroke();

  // Simple icon: a glowing purple orb (placeholder for an upgrade sprite).
  ctx.save();
  ctx.shadowColor = PURPLE;
  ctx.shadowBlur = 16;
  ctx.fillStyle = PURPLE;
  ctx.beginPath();
  ctx.arc(x + cw / 2, y + 46, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  text(ctx, up.name, x + cw / 2, y + 88, { size: 22, color: GOLD });

  // Level indicator (real upgrades only; the fallback reward has no level).
  if (up.maxLevel !== undefined) {
    text(ctx, `Lv. ${up.level} / ${up.maxLevel}`, x + cw / 2, y + 114, { size: 15, color: PURPLE, weight: "700" });
  }

  text(ctx, up.description, x + cw / 2, y + 138, { size: 16, color: DIM, weight: "500" });

  const prompt = count > 1 ? `Press ${i + 1}` : "Press ENTER";
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, prompt, x + cw / 2, y + ch - 22, { size: 16, color: PURPLE });
  ctx.globalAlpha = 1;
}

// --- WAVE BANNER (during the between-wave intermission) -------------------
export function drawWaveBanner(ctx, w, h, wave, timer, isBoss = false) {
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.save();
  ctx.globalAlpha = pulse;
  text(ctx, `WAVE ${wave}`, w / 2, h / 2 - 20, { size: 52, color: GOLD });
  ctx.globalAlpha = 1;
  if (isBoss) {
    text(ctx, "Boss Incoming: Elder Wisp", w / 2, h / 2 + 32, { size: 24, color: RED, weight: "700" });
  } else {
    text(ctx, "Get ready...", w / 2, h / 2 + 30, { size: 22, color: DIM, weight: "500" });
  }
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

  text(ctx, "TUTORIAL COMPLETE!", w / 2, 70, { size: 44, color: GOLD });
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
    text(ctx, "ENDLESS RUN OVER", w / 2, h / 2 - 78, { size: 48, color: RED });
    text(ctx, `Wave reached: ${info.wave}`, w / 2, h / 2 - 18, { size: 24, color: GOLD });
    text(ctx, `Score: ${info.score}`, w / 2, h / 2 + 14, { size: 20, color: CREAM, weight: "500" });
    text(ctx, `Bosses defeated: ${info.bossesDefeated}`, w / 2, h / 2 + 42, { size: 18, color: DIM, weight: "500" });
    text(ctx, `Best wave: ${info.bestWave}      Best score: ${info.bestScore}`, w / 2, h / 2 + 70, { size: 16, color: DIM, weight: "500" });

    ctx.globalAlpha = pulse;
    text(ctx, "R: new endless run      Esc: main menu", w / 2, h / 2 + 114, { size: 18, color: PURPLE });
    ctx.globalAlpha = 1;
    return;
  }

  text(ctx, "GAME OVER", w / 2, h / 2 - 50, { size: 56, color: RED });
  text(ctx, `Final Score: ${info.score}`, w / 2, h / 2 + 10, { size: 24, color: GOLD });
  text(ctx, `Reached Wave ${info.wave}`, w / 2, h / 2 + 44, { size: 20, color: DIM, weight: "500" });

  ctx.globalAlpha = pulse;
  text(ctx, "R: try again      Esc: main menu", w / 2, h / 2 + 90, { size: 20, color: PURPLE });
  ctx.globalAlpha = 1;
}
