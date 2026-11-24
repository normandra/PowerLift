/**
 * Shareable Progress Card Image Exporter (Instagram Story 9:16 & WhatsApp/IG Square 1:1).
 * Atelier Iron look: Fraunces display serif + Plus Jakarta Sans + JetBrains Mono on curated pigments.
 */

import { mountModal } from "./modals.js";
import { THEMES, companionImageSrc, escapeHtml, fmtDelta, fmtKg, showToast, state } from "./state.js";

const CARD_PALETTES = {
  // Coral Dark / Terracotta Ink
  default: {
    bg: "#0D0C0E",
    card: "#161419",
    card2: "#211D26",
    border: "rgba(246,241,232,0.10)",
    primary: "#FF644E",
    primaryGlow: "rgba(255,100,78,0.20)",
    secondary: "#4FD1B5",
    secondaryGlow: "rgba(79,209,181,0.13)",
    text: "#F6F1E8",
    muted: "#A69E94",
    dim: "#766F68",
    green: "#38D69A",
    amber: "#F4B860",
  },
  // Blue / Cobalt Cyanotype
  blue: {
    bg: "#080D1A",
    card: "#10192D",
    card2: "#182542",
    border: "rgba(160,200,255,0.14)",
    primary: "#5294FF",
    primaryGlow: "rgba(82,148,255,0.24)",
    secondary: "#56D2FF",
    secondaryGlow: "rgba(86,210,255,0.15)",
    text: "#EEF4FF",
    muted: "#9DB0D2",
    dim: "#6B7EA3",
    green: "#38D69A",
    amber: "#F4B860",
  },
  // Pink / Rose Risograph
  pink: {
    bg: "#150A14",
    card: "#221221",
    card2: "#301A2E",
    border: "rgba(255,190,225,0.15)",
    primary: "#F56EB3",
    primaryGlow: "rgba(245,110,179,0.24)",
    secondary: "#FFB4D9",
    secondaryGlow: "rgba(255,180,217,0.14)",
    text: "#FDF2F7",
    muted: "#D6A9C6",
    dim: "#9A6F8C",
    green: "#38D69A",
    amber: "#F4B860",
  },
};

const FONT_DISPLAY = '"Fraunces", "Iowan Old Style", "New York", Georgia, serif';
const FONT_SANS = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const BIG3_ORDER = ["squat", "bench", "deadlift"];

const imageCache = new Map();

function loadImageCached(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

let fontsSettled = false;

/** Waits for the card fonts (max ~300ms so offline never hangs). Resolves true when fully loaded. */
async function ensureCardFonts() {
  if (fontsSettled || !document.fonts) return true;
  const full = Promise.all(
    [
      '800 48px "Fraunces"',
      '700 24px "Plus Jakarta Sans"',
      '800 24px "Plus Jakarta Sans"',
      '600 20px "Plus Jakarta Sans"',
      '700 20px "JetBrains Mono"',
      '500 20px "JetBrains Mono"',
    ].map((f) => document.fonts.load(f).catch(() => null))
  )
    .then(() => (document.fonts.ready ? document.fonts.ready : null))
    .then(() => {
      fontsSettled = true;
      return true;
    })
    .catch(() => true);
  const guard = new Promise((resolve) => setTimeout(() => resolve(false), 300));
  return Promise.race([full, guard]).then((ok) => {
    if (!ok) ensureCardFonts.late = full;
    return ok;
  });
}

function setLetterSpacing(ctx, px) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
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

function fitText(ctx, text, maxW) {
  const s = String(text ?? "");
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
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

/** Risograph dot-grid backdrop. */
function drawDotGrid(ctx, x, y, w, h, step = 18, alpha = 0.07) {
  ctx.save();
  ctx.fillStyle = `rgba(246,241,232,${alpha})`;
  for (let gy = y + step / 2; gy < y + h; gy += step) {
    for (let gx = x + step / 2; gx < x + w; gx += step) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Companion PNG inside a slightly tilted, cream-matted rounded sticker frame. */
function drawSticker(ctx, img, x, y, size, pal, label = "", rotDeg = -2) {
  const r = Math.round(size * 0.22);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  fillRoundedCard(ctx, -size / 2, -size / 2, size, size, r, pal.card2);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (img) {
    ctx.save();
    roundRectPath(ctx, -size / 2, -size / 2, size, size, r);
    ctx.clip();
    const iw = img.naturalWidth || img.width || size;
    const ih = img.naturalHeight || img.height || size;
    const scale = Math.max(size / iw, size / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = pal.primary;
    ctx.font = `800 ${Math.round(size * 0.5)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(label || "?").charAt(0).toUpperCase(), 0, 2);
  }
  roundRectPath(ctx, -size / 2, -size / 2, size, size, r);
  ctx.strokeStyle = "rgba(246,241,232,0.88)";
  ctx.lineWidth = Math.max(3, size * 0.032);
  ctx.stroke();
  ctx.restore();
}

/** Pill with mono text. Returns drawn width. align: "left" anchors x at left edge, "right" at right edge. */
function drawPill(ctx, x, y, h, text, color, pal, align = "left", fontPx = 18) {
  ctx.font = `700 ${fontPx}px ${FONT_MONO}`;
  setLetterSpacing(ctx, 1);
  const w = ctx.measureText(text).width + h * 0.9;
  const px = align === "right" ? x - w : x;
  fillRoundedCard(ctx, px, y, w, h, h / 2, pal.card2, pal.border);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, px + w / 2, y + h / 2 + 1);
  setLetterSpacing(ctx, 0);
  return w;
}

function currentValueOf(card) {
  const m = card?.latest_metric_log ?? card?.latest_log;
  if (!m) return null;
  return card.target_metric === "one_rm" ? m.one_rm ?? m.estimated_1rm ?? null : m.working_weight ?? null;
}

function evBadgeOf(card, pal) {
  const ev = card?.latest_eval;
  if (!ev) return null;
  const text =
    ev.status === "beat"
      ? `BEAT ${fmtDelta(ev.delta)}`.toUpperCase()
      : ev.status === "hit"
      ? "HIT"
      : String(fmtDelta(ev.delta) || "MISSED").toUpperCase();
  return { text, color: ev.hit ? pal.green : pal.primary };
}

/** Big-3 first (Squat → Bench → Deadlift). Falls back to the first 3 cards for legacy non-powerlifting blocks. */
function pickPowerliftCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const big = BIG3_ORDER.map((slug) => list.find((c) => String(c.slug).toLowerCase() === slug)).filter(Boolean);
  return big.length ? big : list.slice(0, 3);
}

/** Draws "<number><unit>" with display serif; shrinks to fit maxW. Baseline is alphabetic. */
function drawBigWeight(ctx, val, x, baseY, size, pal, color, maxW) {
  const num = fmtKg(val, "");
  let s = size;
  let numW = 0;
  let unitW = 0;
  const hasUnit = num !== "—";
  for (let i = 0; i < 12; i++) {
    ctx.font = `800 ${s}px ${FONT_DISPLAY}`;
    numW = ctx.measureText(num).width;
    ctx.font = `600 ${Math.round(s * 0.36)}px ${FONT_SANS}`;
    unitW = hasUnit ? ctx.measureText(" kg").width : 0;
    if (numW + unitW <= maxW) break;
    s = Math.round(s * 0.92);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${s}px ${FONT_DISPLAY}`;
  ctx.fillStyle = color;
  ctx.fillText(num, x, baseY);
  if (hasUnit) {
    ctx.font = `600 ${Math.round(s * 0.36)}px ${FONT_SANS}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText(" kg", x + numW, baseY);
  }
  return s;
}

/**
 * Target curve vs logged actuals. `mini` gives a compact panel chart (3 y-ticks, W1/Wn x-labels, glowing line).
 */
function drawCanvasChart(ctx, box, exChart, totalDays, currentDay, pal, opts = {}) {
  const { mini = false, show1Rm = true } = opts;
  const { x, y, w, h } = box;
  const targetSeries = exChart?.target_series || [];
  const actuals = exChart?.actual_points || [];
  const dur = Math.max(2, totalDays || 98);

  const vals = [];
  for (const t of targetSeries) vals.push(t.target);
  for (const a of actuals) {
    if (a.metric_value != null) vals.push(a.metric_value);
    if (show1Rm && (a.one_rm ?? a.estimated_1rm) != null) vals.push(a.one_rm ?? a.estimated_1rm);
  }

  const labelPx = mini ? (opts.labelPx || 16) : 22;
  const pad = mini
    ? { l: Math.round(labelPx * 2.9), r: 14, t: 12, b: Math.round(labelPx * 2) }
    : { l: 74, r: 24, t: 28, b: 44 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  if (!vals.length) {
    ctx.save();
    drawDotGrid(ctx, x + pad.l, y + pad.t, pw, ph, 18, 0.05);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${labelPx + 2}px ${FONT_MONO}`;
    ctx.fillStyle = pal.dim;
    ctx.fillText("NO LOGS YET", x + pad.l + pw / 2, y + pad.t + ph / 2);
    ctx.restore();
    return;
  }

  let yMin = Math.min(...vals);
  let yMax = Math.max(...vals);
  if (yMin === yMax) {
    yMin = Math.max(0, yMin - 5);
    yMax += 5;
  }
  const span = yMax - yMin;
  yMin = Math.max(0, yMin - span * 0.12);
  yMax = yMax + span * 0.12;

  const xOf = (d) => x + pad.l + ((Math.max(1, Math.min(dur, d)) - 1) / Math.max(dur - 1, 1)) * pw;
  const yOf = (v) => y + pad.t + ph - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * ph;

  // Dot-grid backdrop
  drawDotGrid(ctx, x + pad.l, y + pad.t, pw, ph, mini ? 16 : 20, mini ? 0.06 : 0.05);

  // Grid lines + Y labels
  const ticks = mini ? 2 : 4;
  ctx.font = `600 ${labelPx}px ${FONT_MONO}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= ticks; i++) {
    const val = yMin + ((yMax - yMin) * i) / ticks;
    const py = yOf(val);
    ctx.strokeStyle = "rgba(246,241,232,0.08)";
    ctx.lineWidth = mini ? 1.2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x + pad.l, py);
    ctx.lineTo(x + w - pad.r, py);
    ctx.stroke();
    ctx.fillStyle = pal.dim;
    ctx.fillText(`${Math.round(val)}`, x + pad.l - (mini ? 8 : 14), py);
  }

  // Week ticks on X axis
  ctx.textBaseline = "top";
  ctx.fillStyle = pal.dim;
  const lastWk = Math.ceil(dur / 7);
  if (mini) {
    ctx.textAlign = "left";
    ctx.fillText("W1", x + pad.l, y + h - pad.b + 10);
    ctx.textAlign = "right";
    ctx.fillText(`W${lastWk}`, x + w - pad.r, y + h - pad.b + 10);
  } else {
    ctx.textAlign = "center";
    const step = dur > 70 ? 14 : 7;
    for (let d = 1; d <= dur; d += step) {
      const wk = Math.floor((d - 1) / 7) + 1;
      ctx.fillText(`W${wk}`, xOf(d), y + h - pad.b + 12);
    }
  }

  // Current day marker
  if (currentDay >= 1 && currentDay <= dur) {
    const tx = xOf(currentDay);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(244,184,96,0.5)";
    ctx.lineWidth = mini ? 1.6 : 2;
    ctx.beginPath();
    ctx.moveTo(tx, y + pad.t);
    ctx.lineTo(tx, y + h - pad.b);
    ctx.stroke();
    ctx.restore();
  }

  // Target curve dashed
  if (targetSeries.length > 1) {
    ctx.save();
    ctx.setLineDash(mini ? [9, 7] : [12, 9]);
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = mini ? 3 : 4;
    ctx.lineCap = "round";
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

  // 1RM overlay line (full charts only)
  if (show1Rm && !mini) {
    const ormPts = actuals.filter((a) => (a.one_rm ?? a.estimated_1rm) != null);
    if (ormPts.length > 1) {
      ctx.save();
      ctx.strokeStyle = pal.amber;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = "round";
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

  // Actual working line with soft area + glow
  const validActuals = actuals.filter((a) => a.metric_value != null);
  if (validActuals.length > 1) {
    const baseY = y + pad.t + ph;
    const fillGrad = ctx.createLinearGradient(0, y + pad.t, 0, baseY);
    fillGrad.addColorStop(0, pal.secondaryGlow.replace(/[\d.]+\)$/, "0.32)"));
    fillGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.beginPath();
    validActuals.forEach((a, i) => {
      const px = xOf(a.day);
      const py = yOf(a.metric_value);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(xOf(validActuals[validActuals.length - 1].day), baseY);
    ctx.lineTo(xOf(validActuals[0].day), baseY);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = pal.secondary;
    ctx.lineWidth = mini ? 4.5 : 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = pal.secondary;
    ctx.shadowBlur = mini ? 10 : 14;
    ctx.beginPath();
    validActuals.forEach((a, i) => {
      const px = xOf(a.day);
      const py = yOf(a.metric_value);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }

  // Actual dots (+ halo on the latest)
  const dotR = mini ? 7 : 9;
  validActuals.forEach((a, idx) => {
    const px = xOf(a.day);
    const py = yOf(a.metric_value);
    const col = a.hit ? pal.green : pal.primary;
    if (idx === validActuals.length - 1) {
      ctx.beginPath();
      ctx.arc(px, py, dotR + (mini ? 8 : 10), 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = mini ? 3 : 3;
    ctx.stroke();
  });
}

function drawFooter(ctx, W, H, pad, displayName, pal, sbdTotal = null) {
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
  ctx.font = `800 32px ${FONT_DISPLAY}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("PairLift", pad + 58, fy + 19);

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  if (sbdTotal != null) {
    const totalStr = fmtKg(sbdTotal);
    ctx.font = `800 30px ${FONT_DISPLAY}`;
    const tw = ctx.measureText(totalStr).width;
    ctx.fillStyle = pal.primary;
    ctx.fillText(totalStr, W - pad, fy + 19);
    ctx.font = `700 18px ${FONT_MONO}`;
    setLetterSpacing(ctx, 2);
    ctx.fillStyle = pal.muted;
    ctx.fillText("SBD TOTAL", W - pad - tw - 18, fy + 20);
    setLetterSpacing(ctx, 0);
  } else {
    ctx.font = `600 22px ${FONT_SANS}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText(
      fitText(ctx, displayName ? `${displayName} · Training Block` : "Training Block", W - pad * 2 - 260),
      W - pad,
      fy + 19
    );
  }
}

/** Editorial header; returns y just below the progress bar. */
function drawHeader(ctx, W, pad, isStory, mode, block, time, pal) {
  let y = isStory ? pad + 12 : pad - 6;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${isStory ? 22 : 20}px ${FONT_MONO}`;
  setLetterSpacing(ctx, 3);
  ctx.fillStyle = pal.primary;
  ctx.fillText(mode === "spotlight" ? "LIFT SPOTLIGHT" : "POWERLIFTING BLOCK PROGRESS", pad, y + 6);
  setLetterSpacing(ctx, 0);

  const pillText = `DAY ${time.day_number}/${time.total_days} · W${time.week_number}`;
  const pillH = isStory ? 46 : 42;
  ctx.font = `700 ${isStory ? 20 : 18}px ${FONT_MONO}`;
  drawPill(ctx, W - pad, y - 6, pillH, pillText, pal.secondary, pal, "right", isStory ? 20 : 18);

  y += isStory ? 50 : 44;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const titleSize = isStory ? 66 : 50;
  ctx.font = `800 ${titleSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = pal.text;
  ctx.fillText(fitText(ctx, block.name, W - pad * 2), pad, y);

  y += Math.round(titleSize * 1.18);
  ctx.font = `500 ${isStory ? 21 : 19}px ${FONT_MONO}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(`${block.start_date} → ${time.end_date}  ·  ${time.pct_elapsed}% COMPLETE`, pad, y);

  y += isStory ? 40 : 34;
  drawProgressBar(ctx, pad, y, W - pad * 2, isStory ? 14 : 12, time.pct_elapsed, pal);
  return y + (isStory ? 14 : 12);
}

function drawStatsStrip(ctx, pad, W, y, h, stats, pal, compact) {
  const gap = compact ? 14 : 18;
  const tw = (W - pad * 2 - gap * 3) / 4;
  const tiles = [
    { label: "HIT RATE", val: stats.hit_rate_pct != null ? `${stats.hit_rate_pct}%` : "—", color: pal.green },
    { label: "STREAK", val: `${stats.streak_weeks} wk${stats.streak_weeks === 1 ? "" : "s"}`, color: pal.secondary },
    { label: "SESSIONS", val: `${stats.sessions_logged}`, color: pal.text },
    { label: "PRs HIT", val: `${stats.total_prs}`, color: pal.amber },
  ];
  tiles.forEach((t, idx) => {
    const tx = pad + idx * (tw + gap);
    fillRoundedCard(ctx, tx, y, tw, h, 22, pal.card, pal.border);
    // hairline accent bar
    fillRoundedCard(ctx, tx + 20, y, 34, 4, 2, t.color);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `700 ${compact ? 15 : 17}px ${FONT_MONO}`;
    setLetterSpacing(ctx, 1.5);
    ctx.fillStyle = pal.muted;
    ctx.fillText(t.label, tx + 20, y + (compact ? 20 : 26));
    setLetterSpacing(ctx, 0);
    ctx.font = `800 ${compact ? 36 : 44}px ${FONT_DISPLAY}`;
    ctx.fillStyle = t.color;
    ctx.fillText(fitText(ctx, t.val, tw - 32), tx + 20, y + (compact ? 46 : 58));
  });
}

function drawInfoRow(ctx, pad, W, y, h, label, value, pal, valueColor) {
  fillRoundedCard(ctx, pad, y, W - pad * 2, h, 20, pal.card, pal.border);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 19px ${FONT_MONO}`;
  setLetterSpacing(ctx, 2);
  ctx.fillStyle = pal.muted;
  ctx.fillText(label, pad + 28, y + h / 2 + 1);
  setLetterSpacing(ctx, 0);
  ctx.textAlign = "right";
  ctx.font = `800 32px ${FONT_DISPLAY}`;
  ctx.fillStyle = valueColor;
  ctx.fillText(value, W - pad - 28, y + h / 2 + 1);
}

function panelBase(ctx, x, y, w, h, pal) {
  fillRoundedCard(ctx, x, y, w, h, 28, pal.card, pal.border);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 28);
  ctx.clip();
  const aura = ctx.createRadialGradient(x + 90, y + 50, 10, x + 90, y + 50, Math.min(w, 420));
  aura.addColorStop(0, pal.primaryGlow);
  aura.addColorStop(1, "transparent");
  ctx.fillStyle = aura;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function goalLine(c) {
  return c.has_target ? `Goal ${fmtKg(c.goal_weight)}  ·  ${c.pct_to_goal}%` : "Open goal";
}

/** Story: wide lift panel = left info column (~44%) + right mini target-vs-actual chart (~56%). */
function drawStoryLiftPanel(ctx, c, img, exChart, box, charts, pal) {
  const { x, y, w, h } = box;
  panelBase(ctx, x, y, w, h, pal);

  const leftW = Math.round(w * 0.44);
  const px = x + 30;
  const sticker = 112;
  const fixed = sticker + 64 + 24 + 14; // sticker + weight cap + goal text + bar
  const gap = Math.max(14, Math.min(80, (h - 64 - fixed) / 3));

  const sy = y + 32;
  drawSticker(ctx, img, px, sy, sticker, pal, c.name);

  const nx = px + sticker + 22;
  const nameMaxW = x + leftW - nx - 4;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `800 44px ${FONT_DISPLAY}`;
  ctx.fillStyle = pal.text;
  ctx.fillText(fitText(ctx, c.name, nameMaxW), nx, sy + 4);

  const badge = evBadgeOf(c, pal);
  if (badge) drawPill(ctx, nx, sy + 68, 38, badge.text, badge.color, pal, "left", 17);
  else drawPill(ctx, nx, sy + 68, 38, c.has_target ? "ON PLAN" : "OPEN", pal.muted, pal, "left", 17);

  const weightBase = sy + sticker + gap + 64;
  drawBigWeight(ctx, currentValueOf(c), px, weightBase, 88, pal, pal.secondary, leftW - 30 - 20);

  const goalTop = weightBase + gap;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `600 23px ${FONT_SANS}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(goalLine(c), px, goalTop);

  if (c.has_target) drawProgressBar(ctx, px, goalTop + 24 + gap * 0.7, leftW - 30 - 24, 14, c.pct_to_goal, pal);

  // Right: mini chart
  const rx = x + leftW;
  const ry = y + 20;
  const rw = w - leftW - 20;
  const rh = h - 40;
  fillRoundedCard(ctx, rx, ry, rw, rh, 22, "rgba(0,0,0,0.26)", pal.border);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 15px ${FONT_MONO}`;
  setLetterSpacing(ctx, 1.5);
  ctx.fillStyle = pal.dim;
  ctx.fillText("TARGET vs ACTUAL", rx + 22, ry + 20);
  ctx.textAlign = "right";
  ctx.fillText("┄ PLAN   ● LOGGED", rx + rw - 22, ry + 20);
  setLetterSpacing(ctx, 0);
  drawCanvasChart(
    ctx,
    { x: rx + 6, y: ry + 44, w: rw - 12, h: rh - 52 },
    exChart,
    charts.duration_days,
    charts.current_day,
    pal,
    { mini: true, labelPx: 17 }
  );
}

/** Square: tall lift column — sticker + name, big weight, goal/%, bar, and mini chart in the lower half. */
function drawSquareLiftColumn(ctx, c, img, exChart, box, charts, pal) {
  const { x, y, w, h } = box;
  panelBase(ctx, x, y, w, h, pal);
  const px = x + 22;
  const innerW = w - 44;
  const sticker = 84;

  drawSticker(ctx, img, px, y + 24, sticker, pal, c.name);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `800 31px ${FONT_DISPLAY}`;
  ctx.fillStyle = pal.text;
  ctx.fillText(fitText(ctx, c.name, innerW - sticker - 14), px + sticker + 14, y + 36);
  const badge = evBadgeOf(c, pal);
  ctx.font = `700 16px ${FONT_MONO}`;
  setLetterSpacing(ctx, 1);
  ctx.fillStyle = badge ? badge.color : pal.dim;
  ctx.fillText(
    fitText(ctx, badge ? badge.text : c.has_target ? "ON PLAN" : "OPEN", innerW - sticker - 14),
    px + sticker + 14,
    y + 78
  );
  setLetterSpacing(ctx, 0);

  const baseY = y + 24 + sticker + 66;
  drawBigWeight(ctx, currentValueOf(c), px, baseY, 60, pal, pal.secondary, innerW);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `600 19px ${FONT_SANS}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(fitText(ctx, goalLine(c), innerW), px, baseY + 16);
  if (c.has_target) drawProgressBar(ctx, px, baseY + 52, innerW, 10, c.pct_to_goal, pal);

  const cy = baseY + 76;
  const ch = y + h - 14 - cy;
  if (ch >= 120) {
    fillRoundedCard(ctx, x + 12, cy, w - 24, ch, 18, "rgba(0,0,0,0.26)", pal.border);
    drawCanvasChart(
      ctx,
      { x: x + 12, y: cy + 4, w: w - 24, h: ch - 8 },
      exChart,
      charts.duration_days,
      charts.current_day,
      pal,
      { mini: true, labelPx: 14 }
    );
  }
}

function drawEmptyLifts(ctx, pad, W, y, h, pal) {
  fillRoundedCard(ctx, pad, y, W - pad * 2, Math.min(h, 360), 28, pal.card, pal.border);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 40px ${FONT_DISPLAY}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("No lifts tracked yet", W / 2, y + Math.min(h, 360) / 2 - 22);
  ctx.font = `600 22px ${FONT_SANS}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("Turn Squat, Bench or Deadlift on in Setup", W / 2, y + Math.min(h, 360) / 2 + 28);
}

async function renderShareCardToCanvas(canvas, opts) {
  const { format, mode, exerciseSlug, themeId, includeBodyweight } = opts;
  const dash = state.cache.dashboard;
  const charts = state.cache.charts;
  if (!canvas || !dash || !charts) return;

  const { block, time, today_cards, bodyweight_card, stats } = dash;
  const fontsOk = await ensureCardFonts();
  if (!fontsOk && ensureCardFonts.late && opts.onFontsLate) ensureCardFonts.late.then(() => opts.onFontsLate());

  const spotlightCard =
    mode === "spotlight" ? today_cards.find((c) => c.slug === exerciseSlug) || today_cards[0] || null : null;
  const visibleCards = mode === "spotlight" ? [] : pickPowerliftCards(today_cards);
  const imgSources = (mode === "spotlight" ? [spotlightCard] : visibleCards).filter(Boolean);
  const images = await Promise.all(
    imgSources.map((c) => loadImageCached(companionImageSrc(c.slug || c.name, state.companion, false)))
  );
  const imgBySlug = new Map(imgSources.map((c, i) => [c.slug, images[i]]));

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

  const g1 = ctx.createRadialGradient(W * 0.88, H * 0.08, 20, W * 0.88, H * 0.08, W * 0.7);
  g1.addColorStop(0, pal.primaryGlow);
  g1.addColorStop(1, "transparent");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W * 0.1, H * 0.92, 20, W * 0.1, H * 0.92, W * 0.7);
  g2.addColorStop(0, pal.secondaryGlow);
  g2.addColorStop(1, "transparent");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  const displayName = state.user?.display_name || "Lifter";
  let y = drawHeader(ctx, W, pad, isStory, mode, block, time, pal);
  const footerTop = H - pad - 44 - (isStory ? 34 : 26);
  let sbdTotal = null;

  if (mode === "spotlight") {
    y += isStory ? 40 : 24;
    const card = spotlightCard;
    const exChart =
      (charts.exercises || []).find((e) => e.slug === (card?.slug || exerciseSlug)) || charts.exercises?.[0];
    const img = card ? imgBySlug.get(card.slug) : null;
    const artSize = isStory ? 104 : 76;
    const titleX = pad + artSize + 24;

    drawSticker(ctx, img, pad + 4, y, artSize, pal, card?.name || "L");

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `800 ${isStory ? 56 : 46}px ${FONT_DISPLAY}`;
    ctx.fillStyle = pal.text;
    ctx.fillText(fitText(ctx, card ? card.name : "Lift", W - pad - titleX - 220), titleX, y + 6);

    const metricVal = currentValueOf(card);
    const latest1Rm =
      card?.latest_1rm ?? (card?.latest_log ? card.latest_log.one_rm ?? card.latest_log.estimated_1rm : null);

    const badge = evBadgeOf(card, pal);
    if (badge) drawPill(ctx, W - pad, y + 6, 44, badge.text, badge.color, pal, "right", 20);

    y += artSize + (isStory ? 36 : 22);

    // 4 Spotlight Stat Tiles
    const tileGap = 20;
    const tileW = (W - pad * 2 - tileGap) / 2;
    const tileH = isStory ? 150 : 98;
    const spotlightTiles = [
      { label: "CURRENT", val: fmtKg(metricVal), color: pal.secondary },
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
      fillRoundedCard(ctx, tx + 26, ty, 36, 4, 2, t.color);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `700 ${isStory ? 18 : 16}px ${FONT_MONO}`;
      setLetterSpacing(ctx, 1.5);
      ctx.fillStyle = pal.muted;
      ctx.fillText(t.label, tx + 26, ty + (isStory ? 28 : 20));
      setLetterSpacing(ctx, 0);
      ctx.font = `800 ${isStory ? 56 : 40}px ${FONT_DISPLAY}`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.val, tx + 26, ty + (isStory ? 62 : 46));
    });

    y += tileH * 2 + tileGap + (isStory ? 34 : 20);

    // Progress bar to goal
    if (card?.has_target) {
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `600 ${isStory ? 24 : 21}px ${FONT_SANS}`;
      ctx.fillStyle = pal.muted;
      ctx.fillText(`Goal Progress (${fmtKg(card.start_weight)} → ${fmtKg(card.goal_weight)})`, pad, y);
      ctx.textAlign = "right";
      ctx.font = `800 ${isStory ? 28 : 24}px ${FONT_DISPLAY}`;
      ctx.fillStyle = pal.text;
      ctx.fillText(`${card.pct_to_goal}%`, W - pad, y - 2);
      y += isStory ? 40 : 34;
      drawProgressBar(ctx, pad, y, W - pad * 2, 16, card.pct_to_goal, pal);
      y += isStory ? 42 : 34;
    }

    // Chart card filling remaining space above footer
    const chartH = Math.max(isStory ? 290 : 180, footerTop - y);
    fillRoundedCard(ctx, pad, y, W - pad * 2, chartH, 28, pal.card, pal.border);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `700 ${isStory ? 26 : 22}px ${FONT_DISPLAY}`;
    ctx.fillStyle = pal.text;
    ctx.fillText("Target Curve vs Logged Lifts", pad + 28, y + 22);
    ctx.textAlign = "right";
    ctx.font = `600 ${isStory ? 17 : 15}px ${FONT_MONO}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText("┄ TARGET   ● ACTUAL", W - pad - 28, y + 28);
    drawCanvasChart(
      ctx,
      { x: pad + 18, y: y + (isStory ? 62 : 52), w: W - pad * 2 - 36, h: chartH - (isStory ? 78 : 62) },
      exChart,
      charts.duration_days,
      charts.current_day,
      pal,
      { show1Rm: true, mini: false }
    );
  } else {
    // ALL 3 LIFTS (powerlifting summary)
    const bwRow = includeBodyweight && bodyweight_card?.enabled && bodyweight_card.latest_log;
    const bwStr = bwRow
      ? bodyweight_card.goal
        ? `${fmtKg(bodyweight_card.latest_log.weight)}  (Goal ${fmtKg(bodyweight_card.goal)})`
        : fmtKg(bodyweight_card.latest_log.weight)
      : "";

    const slugSet = new Set(visibleCards.map((c) => String(c.slug).toLowerCase()));
    if (BIG3_ORDER.every((s) => slugSet.has(s))) {
      const vals = BIG3_ORDER.map((s) => currentValueOf(visibleCards.find((c) => String(c.slug).toLowerCase() === s)));
      if (vals.every((v) => v != null && !Number.isNaN(Number(v)))) {
        sbdTotal = vals.reduce((a, b) => a + Number(b), 0);
      }
    }
    const chartFor = (c) => (charts.exercises || []).find((e) => e.slug === c.slug) || null;

    if (isStory) {
      y += 34;
      const statH = 112;
      drawStatsStrip(ctx, pad, W, y, statH, stats, pal, true);
      y += statH + 28;

      const rowH = 78;
      const bwSpace = bwRow ? rowH + 22 : 0;
      const avail = footerTop - y - bwSpace;
      if (!visibleCards.length) {
        drawEmptyLifts(ctx, pad, W, y, avail, pal);
        y += Math.min(avail, 360) + 22;
      } else {
        const n = visibleCards.length;
        const gapP = 22;
        const panelH = Math.min(n >= 3 ? 440 : n === 2 ? 560 : 640, Math.floor((avail - gapP * (n - 1)) / n));
        y += Math.max(0, Math.floor((avail - (n * panelH + gapP * (n - 1))) / 2));
        visibleCards.forEach((c, i) => {
          drawStoryLiftPanel(
            ctx,
            c,
            imgBySlug.get(c.slug),
            chartFor(c),
            { x: pad, y: y + i * (panelH + gapP), w: W - pad * 2, h: panelH },
            charts,
            pal
          );
        });
        y += n * panelH + (n - 1) * gapP + 22;
      }
      if (bwRow) drawInfoRow(ctx, pad, W, y, rowH, "BODYWEIGHT", bwStr, pal, pal.text);
    } else {
      y += 26;
      const statH = 92;
      drawStatsStrip(ctx, pad, W, y, statH, stats, pal, true);
      y += statH + 22;

      const rowH = 68;
      const hasRow = bwRow || (stats.total_kg_lifted != null && visibleCards.length);
      const rowSpace = hasRow ? rowH + 18 : 0;
      const avail = footerTop - y - rowSpace;
      if (!visibleCards.length) {
        drawEmptyLifts(ctx, pad, W, y, avail, pal);
      } else {
        const n = visibleCards.length;
        const gapC = 18;
        const colW = (W - pad * 2 - gapC * (n - 1)) / n;
        const colH = Math.min(avail, 560);
        visibleCards.forEach((c, i) => {
          drawSquareLiftColumn(
            ctx,
            c,
            imgBySlug.get(c.slug),
            chartFor(c),
            { x: pad + i * (colW + gapC), y, w: colW, h: colH },
            charts,
            pal
          );
        });
        y += colH + 18;
        if (bwRow) {
          drawInfoRow(ctx, pad, W, y, rowH, "BODYWEIGHT", bwStr, pal, pal.text);
        } else if (hasRow) {
          drawInfoRow(
            ctx,
            pad,
            W,
            y,
            rowH,
            "TOTAL WEIGHT LIFTED",
            fmtKg(Math.round(stats.total_kg_lifted || 0)),
            pal,
            pal.primary
          );
        }
      }
    }
  }

  drawFooter(ctx, W, H, pad, displayName, pal, sbdTotal);
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
  let mode = initialOpts.mode || "summary"; // "summary" (All 3 Lifts) | "spotlight" (Single Lift)
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
            <button type="button" class="btn btn-sm" data-sh-mode="summary" style="flex:1;">All 3 Lifts</button>
            <button type="button" class="btn btn-sm" data-sh-mode="spotlight" style="flex:1;">Single Lift</button>
          </div>
        </div>
      </div>

      <div class="grid-2" style="align-items:end;">
        <div class="form-field" id="sh-ex-wrap" ${mode === "spotlight" ? "" : "hidden"}>
          <label for="sh-ex">Single Lift</label>
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

      let renderSeq = 0;
      let currentRenderPromise = Promise.resolve();

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
        const seq = ++renderSeq;
        const optsSnap = { format, mode, exerciseSlug, themeId, includeBodyweight };
        currentRenderPromise = (async () => {
          if (seq !== renderSeq) return;
          await renderShareCardToCanvas(canvas, {
            ...optsSnap,
            onFontsLate: () => {
              if (seq === renderSeq && canvas.isConnected) {
                currentRenderPromise = renderShareCardToCanvas(canvas, optsSnap);
              }
            },
          });
        })();
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
        await currentRenderPromise;
        const blob = await canvasToBlob(canvas);
        if (!blob) return;
        triggerDownload(blob);
        showToast("Progress image downloaded!");
      });

      root.querySelector("#sh-share").addEventListener("click", async () => {
        await currentRenderPromise;
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
        await currentRenderPromise;
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
