/* =========================================================================
   ui.js — everything drawn ON TOP of the game world: title screen, HUD,
   game-over screen, and (Phase 4) the XP bar + "LEVEL UP!" flash.

   Each function takes the canvas context (ctx) plus the data it needs.
   No game logic lives here — just drawing.
   ========================================================================= */

const GOLD = "#f4d58d";
const PURPLE = "#9b6cff";
const RED = "#e2536b";
const DIM = "rgba(244, 213, 141, 0.65)";

// --- Shared text helper ---------------------------------------------------
function text(ctx, str, x, y, { size = 24, color = GOLD, align = "center", font = "Cinzel, Georgia, serif", weight = "700" } = {}) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(str, x, y);
}

// --- TITLE SCREEN ---------------------------------------------------------
export function drawTitle(ctx, w, h) {
  ctx.fillStyle = "#0d0b1c";
  ctx.fillRect(0, 0, w, h);

  // A faint moon behind the title.
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

  // Wave label (top-center) — placeholder, real waves arrive in Phase 6.
  text(ctx, `Wave ${state.wave}`, w / 2, 27, { size: 20, color: DIM });

  // --- XP BAR (bottom center) + level -------------------------------------
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

// --- "LEVEL UP!" FLASH ----------------------------------------------------
// timer counts down from `duration` to 0. We fade out and drift upward.
export function drawLevelUpFlash(ctx, w, h, timer, duration) {
  const t = Math.max(0, timer / duration); // 1 → 0
  ctx.save();
  ctx.globalAlpha = Math.min(1, t * 1.6);   // fade out near the end
  const y = h * 0.30 - (1 - t) * 24;        // drift up slightly as it fades
  text(ctx, "LEVEL UP!", w / 2, y, { size: 42, color: GOLD });
  ctx.restore();
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
