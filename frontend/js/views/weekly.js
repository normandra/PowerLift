/**
 * Weekly Check-In view: Week pill selector, weekly scorecard, and per-lift weekly breakdown.
 */

import { openShareModal } from "../share.js";
import { companionArtHtml, escapeHtml, fmtKg, state, statusBadge } from "../state.js";

export function renderWeeklyView(containerEl, actions) {
  const wk = state.cache.weekly;
  if (!state.activeBlockId || !wk) {
    containerEl.innerHTML = `<div class="card muted">Select or create a training block to view weekly stats.</div>`;
    return;
  }

  const weekPills = [];
  for (let w = 1; w <= wk.total_weeks; w++) {
    weekPills.push(
      `<button type="button" class="pill-btn num ${w === wk.week_number ? "active" : ""}" data-week="${w}">W${w}${w === wk.current_week ? " •" : ""}</button>`
    );
  }

  const rowsHtml = (wk.exercises || [])
    .map(
      (ex) => `
      <tr>
        <td><div class="row-inline" style="gap:8px;">${companionArtHtml(ex.exercise_name, "sm")}<strong>${escapeHtml(ex.exercise_name)}</strong></div></td>
        <td class="num muted">${ex.week_target != null ? escapeHtml(fmtKg(ex.week_target)) : "—"}</td>
        <td class="num">${ex.best_working_weight != null ? `<strong>${escapeHtml(fmtKg(ex.best_working_weight))}</strong>` : "—"}</td>
        <td class="num muted">${ex.best_one_rm != null ? escapeHtml(fmtKg(ex.best_one_rm)) : "—"}</td>
        <td>${statusBadge(ex.status, ex.delta)}</td>
      </tr>
    `
    )
    .join("");
  const tableRowsHtml =
    rowsHtml ||
    `<tr><td colspan="5" class="muted small" style="padding:18px 8px;text-align:center;">All lifts are paused — enable tracking in Setup to see weekly results here.</td></tr>`;

  containerEl.innerHTML = `
    <div class="card" style="display:flex;flex-direction:column;gap:10px;">
      <div class="row-between" style="flex-wrap:wrap;gap:8px;">
        <div>
          <h3 class="section-title" style="margin:0;">Week ${wk.week_number} Check-In</h3>
          <div class="small muted num">${escapeHtml(wk.week_start)} → ${escapeHtml(wk.week_end)} (Days ${wk.start_day}–${wk.end_day})</div>
        </div>
        <div class="row-inline">
          <span class="badge ${wk.met_session_goal ? "badge-hit" : "badge-waiting"} num">
            ${wk.sessions_count} / ${wk.weekly_session_goal} sessions
          </span>
          <button type="button" class="btn btn-mint btn-sm" id="w-share-card">Share Card</button>
        </div>
      </div>
      <div class="pill-scroll">${weekPills.join("")}</div>
    </div>

    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between">
        <div>
          <div style="font-weight:700;font-size:15.5px;">Weekly Scorecard</div>
          <div class="dim small">${escapeHtml(wk.plan_name)}</div>
        </div>
        ${
          wk.bodyweight_target_end != null
            ? `<div class="small muted">BW avg: <strong style="color:var(--text)">${wk.bodyweight_avg != null ? escapeHtml(fmtKg(wk.bodyweight_avg)) : "—"}</strong> / ${escapeHtml(fmtKg(wk.bodyweight_target_end))}</div>`
            : ""
        }
      </div>

      <div class="milestone-grid">
        <div class="stat-tile">
          <div class="dim small">Targets Hit</div>
          <div class="stat-tile-val num" style="color:var(--green);">${wk.targets_hit} <span class="small muted">/ ${wk.targets_hit + wk.targets_missed}</span></div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Hit Rate</div>
          <div class="stat-tile-val num">${wk.hit_rate_pct != null ? `${wk.hit_rate_pct}%` : "—"}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Weekly Volume</div>
          <div class="stat-tile-val num">${escapeHtml(fmtKg(Math.round(wk.total_volume)))}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Streak</div>
          <div class="stat-tile-val num" style="color:var(--mint);">${wk.streak_weeks} wk${wk.streak_weeks === 1 ? "" : "s"}</div>
        </div>
      </div>

      ${
        wk.prs.length
          ? `<div class="small">🏆 <strong>Weekly PRs:</strong> ${wk.prs.map((p) => `${escapeHtml(p.exercise_name)} ${escapeHtml(fmtKg(p.working_weight || p.one_rm))}`).join(", ")}</div>`
          : ""
      }
    </div>

    <div class="card">
      <div class="section-head">
        <h3 class="section-title">Weekly Lift Breakdown</h3>
        <span class="small muted">Best set vs week-end target</span>
      </div>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Week Target</th>
              <th>Best Working</th>
              <th>Best 1RM</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  containerEl.querySelector("#w-share-card").addEventListener("click", () => {
    openShareModal({ mode: "summary" });
  });

  for (const btn of containerEl.querySelectorAll("[data-week]")) {
    btn.addEventListener("click", () => {
      actions.selectWeek(Number(btn.getAttribute("data-week")));
    });
  }
}
