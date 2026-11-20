/**
 * Interactive SVG charts for single-user PairLift:
 *  1) Target Curve vs Sparse Actuals (+ optional 1RM overlay)
 *  2) Bodyweight Target Curve vs Actuals
 */

import { escapeHtml, fmtDelta, fmtKg } from "./state.js";

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    primary: cs.getPropertyValue("--coral").trim() || "#FF6B57",
    secondary: cs.getPropertyValue("--mint").trim() || "#2DD4BF",
    violet: cs.getPropertyValue("--violet").trim() || "#A78BFA",
  };
}

function niceRange(values, padRatio = 0.08) {
  const clean = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v))).map(Number);
  if (!clean.length) return [0, 100];
  let min = Math.min(...clean);
  let max = Math.max(...clean);
  if (min === max) {
    min = Math.max(0, min - 5);
    max = max + 5;
  }
  const span = max - min;
  return [Math.max(0, min - span * padRatio), max + span * padRatio];
}

function attachPointTooltips(containerEl, points) {
  const tooltip = containerEl.querySelector(".chart-tooltip");
  if (!tooltip) return;
  const dots = containerEl.querySelectorAll("[data-pt-idx]");
  const hide = () => {
    tooltip.hidden = true;
  };
  for (const dot of dots) {
    const show = () => {
      const idx = Number(dot.getAttribute("data-pt-idx"));
      const pt = points[idx];
      if (!pt) return;
      tooltip.innerHTML = pt.html;
      tooltip.hidden = false;
      const box = containerEl.getBoundingClientRect();
      const dotRect = dot.getBoundingClientRect();
      const left = Math.min(box.width - 170, Math.max(8, dotRect.left - box.left - 70));
      const top = Math.max(8, dotRect.top - box.top - 74);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    dot.addEventListener("mouseenter", show);
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      show();
    });
    dot.addEventListener("mouseleave", hide);
  }
  containerEl.addEventListener("click", hide);
}

export function renderTargetVsActualChart(containerEl, exerciseChart, totalDays, currentDay, show1Rm) {
  if (!containerEl) return;
  const targetSeries = exerciseChart?.target_series || [];
  const actuals = exerciseChart?.actual_points || [];
  const duration = Math.max(2, totalDays || 98);

  if (!targetSeries.length && !actuals.length) {
    containerEl.innerHTML = `<div class="card-subtle muted small">No target curve or logs for this exercise yet.</div>`;
    return;
  }

  const allVals = [];
  for (const t of targetSeries) {
    allVals.push(t.target);
    if (t.secondary_target !== null && t.secondary_target !== undefined) {
      allVals.push(t.secondary_target);
    }
  }
  for (const a of actuals) {
    if (a.metric_value !== null && a.metric_value !== undefined) allVals.push(a.metric_value);
    if (show1Rm) {
      const orm = a.one_rm ?? a.estimated_1rm;
      if (orm !== null && orm !== undefined) allVals.push(orm);
    }
  }

  const [yMin, yMax] = niceRange(allVals, 0.1);
  const W = 680;
  const H = 290;
  const pad = { l: 48, r: 18, t: 20, b: 34 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  const xOf = (d) => pad.l + ((Math.max(1, Math.min(duration, d)) - 1) / Math.max(duration - 1, 1)) * pw;
  const yOf = (v) => pad.t + ph - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * ph;

  let gridHtml = "";
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yOf(val);
    gridHtml += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
    gridHtml += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" fill="#6C778C" font-size="11">${escapeHtml(fmtKg(Math.round(val * 10) / 10, ""))}</text>`;
  }

  const weekStep = duration > 70 ? 14 : 7;
  for (let d = 1; d <= duration; d += weekStep) {
    const x = xOf(d);
    const wk = Math.floor((d - 1) / 7) + 1;
    gridHtml += `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${H - pad.b}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`;
    gridHtml += `<text x="${x}" y="${H - 12}" text-anchor="middle" fill="#6C778C" font-size="11">W${wk}</text>`;
  }

  let todayHtml = "";
  if (currentDay >= 1 && currentDay <= duration) {
    const tx = xOf(currentDay);
    todayHtml = `
      <line x1="${tx}" y1="${pad.t}" x2="${tx}" y2="${H - pad.b}" stroke="rgba(251,191,36,0.45)" stroke-width="1.5" stroke-dasharray="3 4"/>
      <text x="${tx}" y="${pad.t - 5}" text-anchor="middle" fill="#FBBF24" font-size="10.5" font-weight="700">Day ${currentDay}</text>
    `;
  }

  const tc = themeColors();
  let secPathHtml = "";
  const secPts = targetSeries.filter((t) => t.secondary_target !== null && t.secondary_target !== undefined);
  if (secPts.length > 1) {
    const dAttr = secPts.map((t, i) => `${i === 0 ? "M" : "L"}${xOf(t.day).toFixed(1)},${yOf(t.secondary_target).toFixed(1)}`).join(" ");
    secPathHtml = `<path d="${dAttr}" fill="none" stroke="${escapeHtml(tc.violet)}" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.7"/>`;
  }

  let targetPathHtml = "";
  if (targetSeries.length > 1) {
    const dAttr = targetSeries
      .map((t, i) => `${i === 0 ? "M" : "L"}${xOf(t.day).toFixed(1)},${yOf(t.target).toFixed(1)}`)
      .join(" ");
    targetPathHtml = `<path d="${dAttr}" fill="none" stroke="#9AA5B8" stroke-width="2" stroke-dasharray="6 5"/>`;
  }

  let actualLineHtml = "";
  const validActuals = actuals.filter((a) => a.metric_value !== null && a.metric_value !== undefined);
  if (validActuals.length > 1) {
    const dAttr = validActuals
      .map((a, i) => `${i === 0 ? "M" : "L"}${xOf(a.day).toFixed(1)},${yOf(a.metric_value).toFixed(1)}`)
      .join(" ");
    actualLineHtml = `<path d="${dAttr}" fill="none" stroke="${escapeHtml(tc.secondary)}" stroke-width="2.5"/>`;
  }

  let oneRmLineHtml = "";
  if (show1Rm) {
    const ormPts = actuals.filter((a) => (a.one_rm ?? a.estimated_1rm) != null);
    if (ormPts.length > 1) {
      const dAttr = ormPts
        .map((a, i) => `${i === 0 ? "M" : "L"}${xOf(a.day).toFixed(1)},${yOf(a.one_rm ?? a.estimated_1rm).toFixed(1)}`)
        .join(" ");
      oneRmLineHtml = `<path d="${dAttr}" fill="none" stroke="#FBBF24" stroke-width="1.8" opacity="0.85"/>`;
    }
  }

  const tooltipPts = [];
  let dotsHtml = "";
  for (const a of actuals) {
    const cx = xOf(a.day);
    const orm = a.one_rm ?? a.estimated_1rm;
    if (a.metric_value !== null && a.metric_value !== undefined) {
      const cy = yOf(a.metric_value);
      const col = a.hit === null || a.hit === undefined ? tc.secondary : a.hit ? "#34D399" : tc.primary;
      const idx = tooltipPts.length;
      tooltipPts.push({
        html: `
          <div><strong>Day ${a.day}</strong> <span class="muted">(${escapeHtml(a.date)})</span></div>
          <div>Logged: <strong>${escapeHtml(fmtKg(a.metric_value))}</strong></div>
          ${a.target !== null && a.target !== undefined ? `<div>Target: ${escapeHtml(fmtKg(a.target))} (${escapeHtml(fmtDelta(a.delta))})</div>` : ""}
          ${orm != null ? `<div>1RM / Est: ${escapeHtml(fmtKg(orm))}</div>` : ""}
        `,
      });
      dotsHtml += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${escapeHtml(col)}" stroke="#0B0D11" stroke-width="2" data-pt-idx="${idx}" style="cursor:pointer"/>`;
      if (show1Rm && orm != null) {
        const oy = yOf(orm);
        dotsHtml += `<circle cx="${cx.toFixed(1)}" cy="${oy.toFixed(1)}" r="3.5" fill="#FBBF24" opacity="0.9"/>`;
      }
    } else if (show1Rm && orm != null) {
      const idx = tooltipPts.length;
      tooltipPts.push({
        html: `
          <div><strong>Day ${a.day}</strong> <span class="muted">(${escapeHtml(a.date)})</span></div>
          <div>1RM / Est: <strong>${escapeHtml(fmtKg(orm))}</strong></div>
        `,
      });
      const oy = yOf(orm);
      dotsHtml += `<circle cx="${cx.toFixed(1)}" cy="${oy.toFixed(1)}" r="4.5" fill="#FBBF24" stroke="#0B0D11" stroke-width="1.5" data-pt-idx="${idx}" style="cursor:pointer"/>`;
    }
  }

  containerEl.innerHTML = `
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Target vs actual chart">
        ${gridHtml}
        ${todayHtml}
        ${secPathHtml}
        ${targetPathHtml}
        ${actualLineHtml}
        ${oneRmLineHtml}
        ${dotsHtml}
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;
  attachPointTooltips(containerEl, tooltipPts);
}

export function renderBodyweightChart(containerEl, bwSeries, totalDays, currentDay) {
  if (!containerEl) return;
  const targetSeries = bwSeries?.target_series || [];
  const actuals = bwSeries?.actual_points || [];
  const duration = Math.max(2, totalDays || 98);

  if (!targetSeries.length && !actuals.length) {
    containerEl.innerHTML = `<div class="card-subtle muted small">No bodyweight logs or targets yet.</div>`;
    return;
  }

  const allVals = [
    ...targetSeries.map((t) => t.target),
    ...actuals.map((a) => a.weight),
  ];
  const [yMin, yMax] = niceRange(allVals, 0.15);
  const W = 680;
  const H = 250;
  const pad = { l: 48, r: 18, t: 20, b: 34 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  const xOf = (d) => pad.l + ((Math.max(1, Math.min(duration, d)) - 1) / Math.max(duration - 1, 1)) * pw;
  const yOf = (v) => pad.t + ph - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * ph;

  let gridHtml = "";
  for (let i = 0; i <= 4; i++) {
    const val = yMin + ((yMax - yMin) * i) / 4;
    const y = yOf(val);
    gridHtml += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
    gridHtml += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" fill="#6C778C" font-size="11">${val.toFixed(1)}</text>`;
  }

  let targetPath = "";
  if (targetSeries.length > 1) {
    const dAttr = targetSeries.map((t, i) => `${i === 0 ? "M" : "L"}${xOf(t.day).toFixed(1)},${yOf(t.target).toFixed(1)}`).join(" ");
    targetPath = `<path d="${dAttr}" fill="none" stroke="#9AA5B8" stroke-width="2" stroke-dasharray="6 5"/>`;
  }

  const tc = themeColors();
  let actualPath = "";
  if (actuals.length > 1) {
    const dAttr = actuals.map((a, i) => `${i === 0 ? "M" : "L"}${xOf(a.day).toFixed(1)},${yOf(a.weight).toFixed(1)}`).join(" ");
    actualPath = `<path d="${dAttr}" fill="none" stroke="${escapeHtml(tc.primary)}" stroke-width="2.5"/>`;
  }

  const tooltipPts = [];
  let dotsHtml = "";
  for (const a of actuals) {
    const idx = tooltipPts.length;
    tooltipPts.push({
      html: `
        <div><strong>Day ${a.day}</strong> (${escapeHtml(a.date)})</div>
        <div>Bodyweight: <strong>${escapeHtml(fmtKg(a.weight))}</strong></div>
        ${a.target != null ? `<div>Target: ${escapeHtml(fmtKg(a.target))}</div>` : ""}
      `,
    });
    dotsHtml += `<circle cx="${xOf(a.day).toFixed(1)}" cy="${yOf(a.weight).toFixed(1)}" r="5" fill="${a.on_track ? "#34D399" : escapeHtml(tc.primary)}" stroke="#0B0D11" stroke-width="2" data-pt-idx="${idx}" style="cursor:pointer"/>`;
  }

  const tx = currentDay >= 1 && currentDay <= duration ? xOf(currentDay) : null;
  const todayLine = tx ? `<line x1="${tx}" y1="${pad.t}" x2="${tx}" y2="${H - pad.b}" stroke="rgba(251,191,36,0.45)" stroke-width="1.5" stroke-dasharray="3 4"/>` : "";

  containerEl.innerHTML = `
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bodyweight chart">
        ${gridHtml}
        ${todayLine}
        ${targetPath}
        ${actualPath}
        ${dotsHtml}
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;
  attachPointTooltips(containerEl, tooltipPts);
}

const SPARK_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseUtcDateMs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatShortDate(iso) {
  const ms = parseUtcDateMs(iso);
  if (Number.isNaN(ms)) return String(iso || "");
  const d = new Date(ms);
  return `${SPARK_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function shiftIsoDays(iso, deltaDays) {
  const ms = parseUtcDateMs(iso);
  const base = Number.isNaN(ms) ? Date.now() : ms;
  const d = new Date(base + deltaDays * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function renderLiftSparklineHtml(exChart, todayDateStr, uniqueKey = "lift") {
  const pts = (exChart?.actual_points || []).filter(
    (p) => p.metric_value !== null && p.metric_value !== undefined && !Number.isNaN(Number(p.metric_value))
  );
  if (!pts.length) return "";

  const slugAttr = escapeHtml(exChart.slug || "");
  const cutoffStr = shiftIsoDays(todayDateStr, -14);
  const recent14 = pts.filter((p) => String(p.date || "") >= cutoffStr);

  if (pts.length === 1) {
    const only = pts[0];
    return `
      <button type="button" class="sparkline-box" data-open-chart="${slugAttr}" title="View full chart">
        <div class="sparkline-head">
          <span class="dim">${recent14.length ? "Last 2 wks" : "Recent"} · 1 session</span>
          <span class="spark-gain spark-gain-flat">${escapeHtml(fmtKg(only.metric_value))}</span>
        </div>
        <svg class="sparkline-svg" viewBox="0 0 240 42" role="img" aria-label="Single session trend">
          <line x1="6" y1="21" x2="232" y2="21" stroke="rgba(255,255,255,0.14)" stroke-width="1.5" stroke-dasharray="4 4"/>
          <circle cx="119" cy="21" r="4" fill="#2DD4BF" stroke="#0B0D11" stroke-width="1.5"/>
        </svg>
        <div class="sparkline-foot">
          <span>${escapeHtml(formatShortDate(only.date))} · ${escapeHtml(fmtKg(only.metric_value))}</span>
          <span>Log 1 more session to track gains</span>
        </div>
      </button>
    `;
  }

  const series = recent14.length >= 2 ? recent14 : pts.slice(-6);
  const windowLabel = recent14.length >= 2 ? "Last 2 wks" : "Recent";
  const first = series[0];
  const last = series[series.length - 1];
  const firstVal = Number(first.metric_value);
  const lastVal = Number(last.metric_value);
  const gain = Math.round((lastVal - firstVal) * 100) / 100;
  const pct = firstVal > 0 ? Math.round((gain / firstVal) * 1000) / 10 : null;

  let strokeCol = "#2DD4BF";
  let badgeClass = "spark-gain-flat";
  let badgeText = "▸ 0 kg (0%)";
  if (gain > 0) {
    strokeCol = "#34D399";
    badgeClass = "spark-gain-up";
    badgeText = `▲ +${fmtKg(gain)}${pct !== null ? ` (+${pct}%)` : ""}`;
  } else if (gain < 0) {
    strokeCol = "#F87171";
    badgeClass = "spark-gain-down";
    badgeText = `▼ ${fmtKg(gain)}${pct !== null ? ` (${pct}%)` : ""}`;
  }

  const W = 240;
  const H = 52;
  const pad = { l: 6, r: 8, t: 8, b: 8 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  const vals = series.map((p) => Number(p.metric_value));
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const rawSpan = rawMax - rawMin;
  const yMin = rawSpan < 1 ? rawMin - 2.5 : rawMin - rawSpan * 0.18;
  const yMax = rawSpan < 1 ? rawMax + 2.5 : rawMax + rawSpan * 0.18;
  const yOf = (v) => pad.t + ph - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * ph;

  const firstMs = parseUtcDateMs(first.date);
  const lastMs = parseUtcDateMs(last.date);
  const msSpan = !Number.isNaN(firstMs) && !Number.isNaN(lastMs) ? lastMs - firstMs : 0;

  const coords = series.map((p, idx) => {
    let xFrac;
    if (msSpan > 0) {
      const ms = parseUtcDateMs(p.date);
      xFrac = Number.isNaN(ms) ? idx / Math.max(series.length - 1, 1) : (ms - firstMs) / msSpan;
    } else {
      xFrac = idx / Math.max(series.length - 1, 1);
    }
    return {
      x: pad.l + xFrac * pw,
      y: yOf(Number(p.metric_value)),
    };
  });

  const lineD = coords.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  const bottomY = (H - pad.b).toFixed(1);
  const areaD = `${lineD} L${coords[coords.length - 1].x.toFixed(1)},${bottomY} L${coords[0].x.toFixed(1)},${bottomY} Z`;
  const baselineY = yOf(firstVal).toFixed(1);
  const gradId = `spark-grad-${String(uniqueKey || slugAttr || "lift").replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const dotsHtml = coords
    .map((pt, idx) =>
      idx === coords.length - 1
        ? `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="${strokeCol}" stroke="#0B0D11" stroke-width="1.5"/>`
        : `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2.6" fill="${strokeCol}" opacity="0.85"/>`
    )
    .join("");

  return `
    <button type="button" class="sparkline-box" data-open-chart="${slugAttr}" title="View full chart">
      <div class="sparkline-head">
        <span class="dim">${windowLabel} · ${series.length} sessions</span>
        <span class="spark-gain ${badgeClass}">${escapeHtml(badgeText)}</span>
      </div>
      <svg class="sparkline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(exChart.name || "Lift")} recent progression">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${strokeCol}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${strokeCol}" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <line x1="${pad.l}" y1="${baselineY}" x2="${W - pad.r}" y2="${baselineY}" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="3 3"/>
        <path d="${areaD}" fill="url(#${gradId})"/>
        <path d="${lineD}" fill="none" stroke="${strokeCol}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dotsHtml}
      </svg>
      <div class="sparkline-foot">
        <span class="num">${escapeHtml(formatShortDate(first.date))} · ${escapeHtml(fmtKg(firstVal))}</span>
        <span class="num">${escapeHtml(formatShortDate(last.date))} · ${escapeHtml(fmtKg(lastVal))}</span>
      </div>
    </button>
  `;
}
