/**
 * Shareable Progress Card Image Exporter (Instagram Story 9:16 & WhatsApp/IG Square 1:1).
 */

import { mountModal } from "./modals.js";
import { THEMES, escapeHtml, fmtDelta, fmtKg, showToast, state } from "./state.js";

const CARD_PALETTES = {
  default: {
    bg: "#0B0D11",
    card: "#141821",
    card2: "#1C2230",
    border: "rgba(255,255,255,0.10)",
    primary: "#FF6B57",
    primaryGlow: "rgba(255,107,87,0.22)",
    secondary: "#2DD4BF",
    secondaryGlow: "rgba(45,212,191,0.16)",
    text: "#F3F6FC",
    muted: "#9AA5B8",
    green: "#34D399",
    amber: "#FBBF24",
  },
  blue: {
    bg: "#070D19",
    card: "#0E172A",
    card2: "#16223B",
    border: "rgba(148,197,255,0.15)",
    primary: "#3B82F6",
    primaryGlow: "rgba(59,130,246,0.25)",
    secondary: "#38BDF8",
    secondaryGlow: "rgba(56,189,248,0.18)",
    text: "#EFF6FF",
    muted: "#9DB4D4",
    green: "#34D399",
    amber: "#FBBF24",
  },
  pink: {
    bg: "#140912",
    card: "#21101F",
    card2: "#2E172C",
    border: "rgba(249,168,212,0.16)",
    primary: "#F472B6",
    primaryGlow: "rgba(244,114,182,0.25)",
    secondary: "#F9A8D4",
    secondaryGlow: "rgba(192,132,252,0.18)",
    text: "#FDF2F8",
    muted: "#D6A9C6",
    green: "#34D399",
    amber: "#FBBF24",
  },
};

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif';

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function fillRoundedCard(ctx, x, y, w, h, r, fill, stroke = null) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawProgressBar(ctx, x, y, w, h, pct, pal) {
  fillRoundedCard(ctx, x, y, w, h, h / 2, "rgba(255,255,255,0.08)");
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  if (clamped > 0) {
    const fw = Math.max(h, (w * clamped) / 100);
    const grad = ctx.createLinearGradient(x, y, x + fw, y);
    grad.addColorStop(0, pal.primary);
    grad.addColorStop(1, pal.secondary);
    fillRoundedCard(ctx, x, y, fw, h, h / 2, grad);
  }
}

function drawCanvasChart(ctx, box, exChart, totalDays, currentDay, pal, show1Rm = true) {
  const { x, y, w, h } = box;
  const targetSeries = exChart?.target_series || [];
  const actuals = exChart?.actual_points || [];
  const dur = Math.max(2, totalDays || 98);

  const vals = [];
  for (const t of targetSeries) vals.push(t.target);
  for (const a of actuals) {
    if (a.metric_value != null) vals.push(a.metric_value);
    if (show1Rm && (a.one_rm ?? a.estimated_1rm) != null) {
      vals.push(a.one_rm ?? a.estimated_1rm);
    }
  }
  let yMin = vals.length ? Math.min(...vals) : 0;
  let yMax = vals.length ? Math.max(...vals) : 100;
  if (yMin === yMax) {
    yMin = Math.max(0, yMin - 5);
    yMax += 5;
  }
  const span = yMax - yMin;
  yMin = Math.max(0, yMin - span * 0.12);
  yMax = yMax + span * 0.12;

  const pad = { l: 74, r: 24, t: 28, b: 44 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const xOf = (d) => x + pad.l + ((Math.max(1, Math.min(dur, d)) - 1) / Math.max(dur - 1, 1)) * pw;
  const yOf = (v) => y + pad.t + ph - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * ph;

  // Grid lines + Y labels
  ctx.font = `600 22px ${FONT_STACK}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const val = yMin + ((yMax - yMin) * i) / 4;
    const py = yOf(val);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + pad.l, py);
    ctx.lineTo(x + w - pad.r, py);
    ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.fillText(`${Math.round(val)}`, x + pad.l - 14, py);
  }

  // Week ticks on X axis
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = dur > 70 ? 14 : 7;
  for (let d = 1; d <= dur; d += step) {
    const px = xOf(d);
    const wk = Math.floor((d - 1) / 7) + 1;
    ctx.fillStyle = pal.muted;
    ctx.fillText(`W${wk}`, px, y + h - pad.b + 12);
  }

  // Current day marker
  if (currentDay >= 1 && currentDay <= dur) {
    const tx = xOf(currentDay);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(251,191,36,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, y + pad.t);
    ctx.lineTo(tx, y + h - pad.b);
    ctx.stroke();
    ctx.restore();
  }

  // Target curve dashed
  if (targetSeries.length > 1) {
    ctx.save();
    ctx.setLineDash([12, 9]);
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 4;
    ctx.beginPath();
    targetSeries.forEach((t, i) => {
      const px = xOf(t.day);
      const py = yOf(t.target);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }

  // 1RM overlay line
  if (show1Rm) {
    const ormPts = actuals.filter((a) => (a.one_rm ?? a.estimated_1rm) != null);
    if (ormPts.length > 1) {
      ctx.save();
      ctx.strokeStyle = pal.amber;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ormPts.forEach((a, i) => {
        const px = xOf(a.day);
        const py = yOf(a.one_rm ?? a.estimated_1rm);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  // Actual working line
  const validActuals = actuals.filter((a) => a.metric_value != null);
  if (validActuals.length > 1) {
    ctx.strokeStyle = pal.secondary;
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    validActuals.forEach((a, i) => {
      const px = xOf(a.day);
      const py = yOf(a.metric_value);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // Actual dots
  for (const a of validActuals) {
    const px = xOf(a.day);
    const py = yOf(a.metric_value);
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.fillStyle = a.hit ? pal.green : pal.primary;
    ctx.fill();
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawFooter(ctx, W, H, pad, displayName, pal) {
  const fy = H - pad - 44;
  // Mini barbell emblem
  ctx.fillStyle = pal.text;
  roundRectPath(ctx, pad, fy + 15, 42, 8, 4);
  ctx.fill();
  ctx.fillStyle = pal.primary;
  roundRectPath(ctx, pad + 4, fy + 4, 9, 30, 4);
  ctx.fill();
  ctx.fillStyle = pal.secondary;
  roundRectPath(ctx, pad + 29, fy + 4, 9, 30, 4);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `800 28px ${FONT_STACK}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("PairLift", pad + 56, fy + 19);

  ctx.textAlign = "right";
  ctx.font = `600 24px ${FONT_STACK}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(displayName ? `${displayName} · Training Block` : "Training Block", W - pad, fy + 19);
}

function renderShareCardToCanvas(canvas, opts) {
  const { format, mode, exerciseSlug, themeId, includeBodyweight } = opts;
  const dash = state.cache.dashboard;
  const charts = state.cache.charts;
  if (!canvas || !dash || !charts) return;

  const isStory = format === "story";
  const W = 1080;
  const H = isStory ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  const pal = CARD_PALETTES[themeId] || CARD_PALETTES.default;
  const pad = 64;

  // Background + ambient radial glows
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  const g1 = ctx.createRadialGradient(W * 0.88, H * 0.1, 20, W * 0.88, H * 0.1, W * 0.65);
  g1.addColorStop(0, pal.primaryGlow);
  g1.addColorStop(1, "transparent");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W * 0.12, H * 0.9, 20, W * 0.12, H * 0.9, W * 0.65);
  g2.addColorStop(0, pal.secondaryGlow);
  g2.addColorStop(1, "transparent");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  const { block, time, today_cards, bodyweight_card, stats } = dash;
  const displayName = state.user?.display_name || "Lifter";

  // Header
  let y = pad + 12;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 24px ${FONT_STACK}`;
  ctx.fillStyle = pal.primary;
  ctx.fillText(
    mode === "spotlight" ? "LIFT SPOTLIGHT" : "TRAINING BLOCK PROGRESS",
    pad,
    y
  );

  // Day/Week Pill on top right
  const pillText = `Day ${time.day_number}/${time.total_days} · W${time.week_number}`;
  ctx.font = `700 24px ${FONT_STACK}`;
  const pillW = ctx.measureText(pillText).width + 44;
  fillRoundedCard(ctx, W - pad - pillW, y - 8, pillW, 48, 24, pal.card2, pal.border);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pal.secondary;
  ctx.fillText(pillText, W - pad - pillW / 2, y + 16);

  y += 42;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `800 ${isStory ? 56 : 46}px ${FONT_STACK}`;
  ctx.fillStyle = pal.text;
  ctx.fillText(block.name, pad, y, W - pad * 2);

  y += isStory ? 74 : 60;
  ctx.font = `600 24px ${FONT_STACK}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(`${block.start_date} → ${time.end_date}  ·  ${time.pct_elapsed}% complete`, pad, y);

  y += 42;
  drawProgressBar(ctx, pad, y, W - pad * 2, 14, time.pct_elapsed, pal);
  y += isStory ? 44 : 32;

  if (mode === "spotlight") {
    const card = today_cards.find((c) => c.slug === exerciseSlug) || today_cards[0];
    const exChart = (charts.exercises || []).find((e) => e.slug === (card?.slug || exerciseSlug)) || charts.exercises?.[0];

    // Lift Title + Status Pill
    ctx.font = `800 ${isStory ? 48 : 38}px ${FONT_STACK}`;
    ctx.fillStyle = pal.text;
    ctx.fillText(card ? card.name : "Lift", pad, y);

    const metricLog = card?.latest_metric_log ?? card?.latest_log;
    const latestVal = metricLog
      ? card?.target_metric === "one_rm"
        ? metricLog.one_rm ?? metricLog.estimated_1rm
        : metricLog.working_weight
      : null;
    const latest1Rm =
      card?.latest_1rm ??
      (card?.latest_log ? card.latest_log.one_rm ?? card.latest_log.estimated_1rm : null);

    if (card?.latest_eval) {
      const ev = card.latest_eval;
      const evLabel =
        ev.status === "beat"
          ? `Beat ${fmtDelta(ev.delta)}`
          : ev.status === "hit"
          ? "On Target"
          : `${fmtDelta(ev.delta)}`;
      ctx.font = `700 24px ${FONT_STACK}`;
      const ew = ctx.measureText(evLabel).width + 40;
      fillRoundedCard(ctx, W - pad - ew, y + 2, ew, 44, 22, pal.card2, pal.border);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = ev.hit ? pal.green : pal.primary;
      ctx.fillText(evLabel, W - pad - ew / 2, y + 24);
    }

    y += isStory ? 74 : 58;

    // 4 Spotlight Stat Tiles
    const tileGap = 20;
    const tileW = (W - pad * 2 - tileGap) / 2;
    const tileH = isStory ? 155 : 122;
    const spotlightTiles = [
      { label: "CURRENT", val: fmtKg(latestVal), color: pal.secondary },
      { label: "GOAL", val: fmtKg(card?.goal_weight), color: pal.primary },
      { label: "TODAY'S TARGET", val: fmtKg(card?.today_target?.target), color: pal.text },
      { label: "1RM / EST. 1RM", val: fmtKg(latest1Rm), color: pal.amber },
    ];
    spotlightTiles.forEach((t, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const tx = pad + col * (tileW + tileGap);
      const ty = y + row * (tileH + tileGap);
      fillRoundedCard(ctx, tx, ty, tileW, tileH, 24, pal.card, pal.border);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `700 21px ${FONT_STACK}`;
      ctx.fillStyle = pal.muted;
      ctx.fillText(t.label, tx + 26, ty + 24);
      ctx.font = `800 ${isStory ? 46 : 38}px ${FONT_STACK}`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.val, tx + 26, ty + (isStory ? 66 : 56));
    });

    y += tileH * 2 + tileGap + (isStory ? 34 : 24);

    // Progress bar to goal
    if (card?.has_target) {
      ctx.textAlign = "left";
      ctx.font = `600 24px ${FONT_STACK}`;
      ctx.fillStyle = pal.muted;
      ctx.fillText(`Goal Progress (${fmtKg(card.start_weight)} → ${fmtKg(card.goal_weight)})`, pad, y);
      ctx.textAlign = "right";
      ctx.fillStyle = pal.text;
      ctx.fillText(`${card.pct_to_goal}%`, W - pad, y);
      y += 38;
      drawProgressBar(ctx, pad, y, W - pad * 2, 16, card.pct_to_goal, pal);
      y += 42;
    }

    // Chart Card filling remaining space above footer
    const footerSpace = 110;
    const chartH = Math.max(290, H - y - footerSpace - pad);
    fillRoundedCard(ctx, pad, y, W - pad * 2, chartH, 28, pal.card, pal.border);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `700 24px ${FONT_STACK}`;
    ctx.fillStyle = pal.text;
    ctx.fillText("Target Curve vs Logged Lifts", pad + 28, y + 24);

    ctx.textAlign = "right";
    ctx.font = `600 20px ${FONT_STACK}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText("--- Target   ● Actual", W - pad - 28, y + 28);

    drawCanvasChart(
      ctx,
      { x: pad + 18, y: y + 66, w: W - pad * 2 - 36, h: chartH - 84 },
      exChart,
      charts.duration_days,
      charts.current_day,
      pal,
      true
    );
  } else {
    // BLOCK SUMMARY MODE
    const statGap = 18;
    const statW = (W - pad * 2 - statGap * 3) / 4;
    const statH = isStory ? 140 : 122;
    const statTiles = [
      { label: "HIT RATE", val: stats.hit_rate_pct != null ? `${stats.hit_rate_pct}%` : "—", color: pal.green },
      { label: "STREAK", val: `${stats.streak_weeks} wk${stats.streak_weeks === 1 ? "" : "s"}`, color: pal.secondary },
      { label: "SESSIONS", val: `${stats.sessions_logged}`, color: pal.text },
      { label: "PRs HIT", val: `${stats.total_prs}`, color: pal.amber },
    ];
    statTiles.forEach((t, idx) => {
      const tx = pad + idx * (statW + statGap);
      fillRoundedCard(ctx, tx, y, statW, statH, 22, pal.card, pal.border);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `700 18px ${FONT_STACK}`;
      ctx.fillStyle = pal.muted;
      ctx.fillText(t.label, tx + 20, y + 22);
      ctx.font = `800 ${isStory ? 40 : 34}px ${FONT_STACK}`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.val, tx + 20, y + (isStory ? 62 : 54));
    });

    y += statH + (isStory ? 32 : 24);

    // Lift cards grid (2 columns)
    const maxLifts = isStory ? 4 : 4;
    const visibleCards = today_cards.slice(0, maxLifts);
    const colGap = 20;
    const liftW = (W - pad * 2 - colGap) / 2;
    const liftH = isStory ? 215 : 166;

    visibleCards.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const lx = pad + col * (liftW + colGap);
      const ly = y + row * (liftH + colGap);
      fillRoundedCard(ctx, lx, ly, liftW, liftH, 24, pal.card, pal.border);

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `800 28px ${FONT_STACK}`;
      ctx.fillStyle = pal.text;
      ctx.fillText(c.name, lx + 24, ly + 22);

      ctx.textAlign = "right";
      ctx.font = `700 22px ${FONT_STACK}`;
      ctx.fillStyle = pal.primary;
      ctx.fillText(c.has_target ? `${c.pct_to_goal}%` : "Open", lx + liftW - 24, ly + 26);

      const metricLog = c.latest_metric_log ?? c.latest_log;
      const curVal = metricLog
        ? c.target_metric === "one_rm"
          ? metricLog.one_rm ?? metricLog.estimated_1rm
          : metricLog.working_weight
        : null;
      ctx.textAlign = "left";
      ctx.font = `800 ${isStory ? 40 : 34}px ${FONT_STACK}`;
      ctx.fillStyle = pal.secondary;
      ctx.fillText(fmtKg(curVal), lx + 24, ly + (isStory ? 72 : 62));

      if (c.has_target) {
        ctx.font = `600 21px ${FONT_STACK}`;
        ctx.fillStyle = pal.muted;
        ctx.fillText(`Goal ${fmtKg(c.goal_weight)}`, lx + 24, ly + (isStory ? 124 : 104));
        drawProgressBar(ctx, lx + 24, ly + liftH - 38, liftW - 48, 12, c.pct_to_goal, pal);
      }
    });

    const rowsUsed = Math.ceil(visibleCards.length / 2);
    y += rowsUsed * (liftH + colGap) + (isStory ? 16 : 6);

    // Optional Bodyweight Summary Row
    if (includeBodyweight && bodyweight_card?.enabled && bodyweight_card.latest_log) {
      const bwH = 82;
      fillRoundedCard(ctx, pad, y, W - pad * 2, bwH, 20, pal.card, pal.border);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = `700 24px ${FONT_STACK}`;
      ctx.fillStyle = pal.muted;
      ctx.fillText("Bodyweight", pad + 26, y + bwH / 2);

      ctx.textAlign = "right";
      ctx.font = `800 28px ${FONT_STACK}`;
      ctx.fillStyle = pal.text;
      const bwStr = bodyweight_card.goal
        ? `${fmtKg(bodyweight_card.latest_log.weight)}  (Goal ${fmtKg(bodyweight_card.goal)})`
        : fmtKg(bodyweight_card.latest_log.weight);
      ctx.fillText(bwStr, W - pad - 26, y + bwH / 2);
      y += bwH + 22;
    }

    // In Story 9:16 mode, draw a spotlight chart in the remaining space!
    const footerSpace = 110;
    const availH = H - y - footerSpace - pad;
    if (isStory && availH >= 280 && charts.exercises?.length) {
      const topEx = charts.exercises.find((e) => (e.actual_points || []).length > 0) || charts.exercises[0];
      fillRoundedCard(ctx, pad, y, W - pad * 2, availH, 28, pal.card, pal.border);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `700 25px ${FONT_STACK}`;
      ctx.fillStyle = pal.text;
      ctx.fillText(`${topEx.name} — Target Curve vs Actuals`, pad + 28, y + 24);
      drawCanvasChart(
        ctx,
        { x: pad + 18, y: y + 66, w: W - pad * 2 - 36, h: availH - 84 },
        topEx,
        charts.duration_days,
        charts.current_day,
        pal,
        true
      );
    } else if (!isStory) {
      // Total volume pill in bottom area if space permits
      const rem = H - y - footerSpace - pad;
      if (rem >= 76) {
        fillRoundedCard(ctx, pad, y, W - pad * 2, 74, 20, pal.card, pal.border);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = `700 22px ${FONT_STACK}`;
        ctx.fillStyle = pal.muted;
        ctx.fillText("Total Weight Lifted This Block", pad + 26, y + 37);
        ctx.textAlign = "right";
        ctx.font = `800 28px ${FONT_STACK}`;
        ctx.fillStyle = pal.primary;
        ctx.fillText(fmtKg(Math.round(stats.total_kg_lifted)), W - pad - 26, y + 37);
      }
    }
  }

  drawFooter(ctx, W, H, pad, displayName, pal);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export function openShareModal(initialOpts = {}) {
  const dash = state.cache.dashboard;
  if (!dash || !state.cache.charts) {
    showToast("Open a training block first to share progress.", true);
    return;
  }
  const exercises = dash.today_cards || [];
  let format = initialOpts.format || "story"; // "story" | "square"
  let mode = initialOpts.mode || "summary"; // "summary" | "spotlight"
  let exerciseSlug = initialOpts.exerciseSlug || exercises[0]?.slug || "";
  let themeId = initialOpts.themeId || state.theme || "default";
  let includeBodyweight = false;

  mountModal(
    `
      <div class="row-between">
        <h3 style="margin:0;font-size:18px;">Share Block Progress</h3>
        <button class="btn-ghost btn-sm" data-close-modal aria-label="Close">✕</button>
      </div>

      <div class="grid-2">
        <div class="form-field">
          <label>Format</label>
          <div class="row-inline" style="background:var(--surface-2);padding:3px;border-radius:10px;">
            <button type="button" class="btn btn-sm" data-sh-fmt="story" style="flex:1;">Story (9:16)</button>
            <button type="button" class="btn btn-sm" data-sh-fmt="square" style="flex:1;">Square (1:1)</button>
          </div>
        </div>
        <div class="form-field">
          <label>Card Style</label>
          <div class="row-inline" style="background:var(--surface-2);padding:3px;border-radius:10px;">
            <button type="button" class="btn btn-sm" data-sh-mode="summary" style="flex:1;">Summary</button>
            <button type="button" class="btn btn-sm" data-sh-mode="spotlight" style="flex:1;">Lift</button>
          </div>
        </div>
      </div>

      <div class="grid-2" style="align-items:end;">
        <div class="form-field" id="sh-ex-wrap" ${mode === "spotlight" ? "" : "hidden"}>
          <label for="sh-ex">Spotlight Lift</label>
          <select id="sh-ex">
            ${exercises
              .map(
                (ex) =>
                  `<option value="${escapeHtml(ex.slug)}" ${ex.slug === exerciseSlug ? "selected" : ""}>${escapeHtml(ex.name)}</option>`
              )
              .join("")}
          </select>
        </div>

        <div class="form-field">
          <label>Card Theme</label>
          <div class="theme-pill-group">
            ${THEMES.map(
              (t) => `
                <button type="button" class="theme-pill-btn" data-sh-theme="${escapeHtml(t.id)}">
                  <span class="theme-dot" style="width:10px;height:10px;background:${escapeHtml(t.primary)};"></span>
                  <span>${escapeHtml(t.id === "default" ? "Coral" : t.label)}</span>
                </button>
              `
            ).join("")}
          </div>
        </div>
      </div>

      ${
        dash.bodyweight_card?.enabled
          ? `
            <label class="row-inline small" style="cursor:pointer;">
              <input type="checkbox" id="sh-bw" style="width:auto;" />
              <span>Include bodyweight on card</span>
            </label>
          `
          : ""
      }

      <div class="share-preview-box">
        <canvas id="share-canvas" class="share-canvas"></canvas>
      </div>

      <div class="grid-3">
        <button type="button" class="btn btn-primary btn-sm" id="sh-share">Share</button>
        <button type="button" class="btn btn-secondary btn-sm" id="sh-download">Download PNG</button>
        <button type="button" class="btn btn-mint btn-sm" id="sh-copy">Copy Image</button>
      </div>
    `,
    (root) => {
      const canvas = root.querySelector("#share-canvas");
      const exWrap = root.querySelector("#sh-ex-wrap");
      const exSel = root.querySelector("#sh-ex");
      const bwChk = root.querySelector("#sh-bw");

      const redraw = () => {
        for (const b of root.querySelectorAll("[data-sh-fmt]")) {
          const active = b.getAttribute("data-sh-fmt") === format;
          b.className = `btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`;
        }
        for (const b of root.querySelectorAll("[data-sh-mode]")) {
          const active = b.getAttribute("data-sh-mode") === mode;
          b.className = `btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`;
        }
        for (const b of root.querySelectorAll("[data-sh-theme]")) {
          b.classList.toggle("active", b.getAttribute("data-sh-theme") === themeId);
        }
        exWrap.hidden = mode !== "spotlight";
        renderShareCardToCanvas(canvas, {
          format,
          mode,
          exerciseSlug,
          themeId,
          includeBodyweight,
        });
      };

      for (const b of root.querySelectorAll("[data-sh-fmt]")) {
        b.addEventListener("click", () => {
          format = b.getAttribute("data-sh-fmt");
          redraw();
        });
      }
      for (const b of root.querySelectorAll("[data-sh-mode]")) {
        b.addEventListener("click", () => {
          mode = b.getAttribute("data-sh-mode");
          redraw();
        });
      }
      for (const b of root.querySelectorAll("[data-sh-theme]")) {
        b.addEventListener("click", () => {
          themeId = b.getAttribute("data-sh-theme");
          redraw();
        });
      }
      exSel.addEventListener("change", () => {
        exerciseSlug = exSel.value;
        redraw();
      });
      if (bwChk) {
        bwChk.addEventListener("change", () => {
          includeBodyweight = bwChk.checked;
          redraw();
        });
      }

      const fileName = () => {
        const slug = (dash.block.name || "block").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return `pairlift-${slug}-${format}.png`;
      };

      const triggerDownload = (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };

      root.querySelector("#sh-download").addEventListener("click", async () => {
        const blob = await canvasToBlob(canvas);
        if (!blob) return;
        triggerDownload(blob);
        showToast("Progress image downloaded!");
      });

      root.querySelector("#sh-share").addEventListener("click", async () => {
        const blob = await canvasToBlob(canvas);
        if (!blob) return;
        const file = new File([blob], fileName(), { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: `${dash.block.name} — PairLift`,
              text: `Day ${dash.time.day_number}/${dash.time.total_days} of ${dash.block.name}`,
            });
            showToast("Shared!");
            return;
          } catch (err) {
            if (err && err.name === "AbortError") return;
          }
        }
        triggerDownload(blob);
        showToast("Downloaded PNG — ready to post to Instagram or WhatsApp!");
      });

      root.querySelector("#sh-copy").addEventListener("click", async () => {
        const blob = await canvasToBlob(canvas);
        if (!blob) return;
        if (navigator.clipboard && window.ClipboardItem) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            showToast("Image copied to clipboard!");
            return;
          } catch {
            // fall through to download fallback
          }
        }
        triggerDownload(blob);
        showToast("Clipboard unavailable — downloaded PNG instead.");
      });

      redraw();
    }
  );
}
