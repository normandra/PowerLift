/**
 * Charts view: Single-user Target Curve vs Actuals (+ 1RM overlay), Bodyweight chart, and Share Lift Card.
 */

import { renderBodyweightChart, renderTargetVsActualChart } from "../charts.js";
import { openShareModal } from "../share.js";
import { companionArtHtml, escapeHtml, state } from "../state.js";

export function renderProgressView(containerEl, actions) {
  const charts = state.cache.charts;
  if (!state.activeBlockId || !charts) {
    containerEl.innerHTML = `<div class="card muted">Select or create a training block to view progress charts.</div>`;
    return;
  }

  const exercises = charts.exercises || [];
  const hasBw = Boolean(charts.bodyweight?.enabled);
  const tabs = [
    ...exercises.map((ex) => ({ slug: ex.slug, label: ex.name })),
    ...(hasBw ? [{ slug: "__bodyweight__", label: "Bodyweight" }] : []),
  ];

  if (!tabs.length) {
    containerEl.innerHTML = `
      <div class="card" style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
        <h3 class="section-title" style="margin:0;">Strength &amp; Target Curves</h3>
        <div class="small muted">All lifts and bodyweight tracking are paused. Past logs are safe — turn tracking back on in Setup to see charts again.</div>
        <button type="button" class="btn btn-primary btn-sm" id="c-open-setup">Manage in Setup</button>
      </div>
    `;
    containerEl.querySelector("#c-open-setup").addEventListener("click", () => actions.switchTab("setup"));
    return;
  }

  if (!state.selectedChartSlug || !tabs.some((t) => t.slug === state.selectedChartSlug)) {
    state.selectedChartSlug = tabs[0]?.slug || null;
  }

  const isBw = state.selectedChartSlug === "__bodyweight__";
  const selectedEx = !isBw ? exercises.find((e) => e.slug === state.selectedChartSlug) : null;

  containerEl.innerHTML = `
    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between" style="flex-wrap:wrap;gap:8px;">
        <h3 class="section-title" style="margin:0;">Strength & Target Curves</h3>
        <div class="row-inline" style="flex-wrap:wrap;">
          ${
            !isBw
              ? `
                <label class="row-inline small muted" style="cursor:pointer;">
                  <input type="checkbox" id="toggle-1rm" ${state.showOneRmOverlay ? "checked" : ""} style="width:auto;" />
                  <span>Show 1RM / Est. 1RM</span>
                </label>
              `
              : ""
          }
          <button type="button" class="btn btn-mint btn-sm" id="c-share-card">Share Image</button>
        </div>
      </div>

      <div class="pill-scroll">
        ${tabs
          .map(
            (t) =>
              `<button type="button" class="pill-btn ${t.slug === state.selectedChartSlug ? "active" : ""}" data-chart-slug="${escapeHtml(t.slug)}" style="display:inline-flex;align-items:center;gap:6px;">${t.slug !== "__bodyweight__" ? companionArtHtml(t.slug, "xs") : ""}<span>${escapeHtml(t.label)}</span></button>`
          )
          .join("")}
      </div>

      ${
        !isBw && selectedEx
          ? `
            <div class="card-subtle row-inline" style="gap:12px;">
              ${companionArtHtml(selectedEx.slug || selectedEx.name, "md")}
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:15px;">${escapeHtml(selectedEx.name)}</div>
                <div class="small muted">${
                  selectedEx.has_target
                    ? `Target curve: ${escapeHtml(String(selectedEx.start_weight))} kg → ${escapeHtml(String(selectedEx.goal_weight))} kg`
                    : "Actual logged lifts"
                }</div>
              </div>
            </div>
          `
          : ""
      }

      <div id="chart-canvas"></div>

      <div class="row-inline small muted" style="flex-wrap:wrap;gap:14px;">
        ${
          isBw
            ? `<span><span style="color:#9AA5B8;">---</span> Daily Bodyweight Target</span><span><span style="color:#34D399;">●</span> On track</span><span><span style="color:var(--coral);">●</span> Off pace</span>`
            : `<span><span style="color:#9AA5B8;">---</span> Target Curve</span><span><span style="color:#34D399;">●</span> Hit / Beat</span><span><span style="color:var(--coral);">●</span> Missed</span>${state.showOneRmOverlay ? `<span><span style="color:#FBBF24;">—</span> 1RM / Est. 1RM</span>` : ""}`
        }
      </div>
    </div>
  `;

  const canvas = containerEl.querySelector("#chart-canvas");
  if (isBw) {
    renderBodyweightChart(canvas, charts.bodyweight, charts.duration_days, charts.current_day);
  } else {
    renderTargetVsActualChart(canvas, selectedEx, charts.duration_days, charts.current_day, state.showOneRmOverlay);
  }

  containerEl.querySelector("#c-share-card").addEventListener("click", () => {
    openShareModal({
      mode: isBw ? "summary" : "spotlight",
      exerciseSlug: selectedEx?.slug || exercises[0]?.slug,
    });
  });

  for (const btn of containerEl.querySelectorAll("[data-chart-slug]")) {
    btn.addEventListener("click", () => {
      state.selectedChartSlug = btn.getAttribute("data-chart-slug");
      actions.renderCurrentTab();
    });
  }

  const ormToggle = containerEl.querySelector("#toggle-1rm");
  if (ormToggle) {
    ormToggle.addEventListener("change", () => {
      state.showOneRmOverlay = ormToggle.checked;
      actions.renderCurrentTab();
    });
  }
}
