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

// --- TITLE SCREEN ---------------------------------------------------------
export function drawTitle(ctx, w, h) {
  ctx.fillStyle = "#0d0b1c";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.fillStyle = "rgba(244, 213, 141, 0.10)";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 - 30, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  text(ctx, "FAMILIAR FRENZY", w / 2, h / 2 - 70, { size: 56, color: GOLD });
  text(ctx, "A witch survives. Her cat does the fighting.", w / 2, h / 2 - 20, { size: 20, color: DIM, weight: "500" });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press ENTER to begin", w / 2, h / 2 + 60, { size: 26, color: PURPLE });
  ctx.globalAlpha = 1;

  text(ctx, "Move: WASD / Arrow Keys", w / 2, h - 50, { size: 16, color: DIM, weight: "500" });
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

  const cardW = 280, cardH = 170, gap = 28;
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

  text(ctx, up.name, x + cw / 2, y + 96, { size: 22, color: GOLD });
  text(ctx, up.description, x + cw / 2, y + 124, { size: 16, color: DIM, weight: "500" });

  const prompt = count > 1 ? `Press ${i + 1}` : "Press ENTER";
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, prompt, x + cw / 2, y + ch - 22, { size: 16, color: PURPLE });
  ctx.globalAlpha = 1;
}

// --- GAME OVER ------------------------------------------------------------
export function drawGameOver(ctx, w, h, state) {
  ctx.fillStyle = "rgba(8, 7, 18, 0.82)";
  ctx.fillRect(0, 0, w, h);

  text(ctx, "GAME OVER", w / 2, h / 2 - 50, { size: 56, color: RED });
  text(ctx, `Final Score: ${state.score}`, w / 2, h / 2 + 10, { size: 24, color: GOLD });

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
  ctx.globalAlpha = pulse;
  text(ctx, "Press R to try again", w / 2, h / 2 + 70, { size: 24, color: PURPLE });
  ctx.globalAlpha = 1;
}
