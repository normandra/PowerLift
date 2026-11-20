/**
 * Today view: Active block hero + Share Card button, Today's Targets, Bodyweight, Block Stats, Recent Logs.
 */

import { api } from "../api.js";
import { openBodyweightModal, openCreateBlockModal, openLogWorkoutModal } from "../modals.js";
import { openShareModal } from "../share.js";
import { escapeHtml, fmtKg, showToast, state, statusBadge } from "../state.js";

export function renderTodayView(containerEl, actions) {
  const dash = state.cache.dashboard;
  if (!state.activeBlockId || !dash) {
    containerEl.innerHTML = `
      <div class="card hero-card" style="display:flex;flex-direction:column;gap:12px;">
        <h2 style="margin:0;">Welcome, ${escapeHtml(state.user?.display_name)}!</h2>
        <p class="muted" style="margin:0;">Create your first training block (e.g. 14 weeks), pick the lifts you want to track (Squat, Bench, Deadlift by default), and configure your daily strength targets.</p>
        <div>
          <button class="btn btn-primary" id="t-create-blk">Create Training Block</button>
        </div>
      </div>
    `;
    containerEl.querySelector("#t-create-blk").addEventListener("click", () => openCreateBlockModal(actions.selectBlock));
    return;
  }

  const { block, time, has_plan, today_cards, bodyweight_card, stats, recent_logs } = dash;

  const setupPlanBanner = !has_plan
    ? `
      <div class="card" style="border-color:var(--accent-border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <strong>Set up your training plan for this block</strong>
          <div class="muted small">Choose Linear, 5/3/1, 1RM Everyday, GZCLP, or Custom targets so PairLift tracks your daily goals.</div>
        </div>
        <button class="btn btn-primary btn-sm" id="t-setup-plan">Set Up Plan</button>
      </div>
    `
    : "";

  const todayCardsHtml = today_cards
    .map(
      (c) => `
      <div class="lift-card">
        <div class="row-between">
          <div>
            <div style="font-weight:700;font-size:16px;">${escapeHtml(c.name)}</div>
            <div class="dim small">
              ${c.today_target ? escapeHtml(c.today_target.phase) : "No target configured"}
            </div>
          </div>
          ${
            c.today_eval
              ? statusBadge(c.today_eval.status, c.today_eval.delta)
              : c.latest_eval
              ? statusBadge(c.latest_eval.status, c.latest_eval.delta)
              : `<span class="badge badge-unlogged">${c.logged_this_week ? "Logged this wk" : "Open"}</span>`
          }
        </div>

        <div class="row-between" style="align-items:flex-end;">
          <div>
            <div class="dim small">Today's Target (${c.target_metric === "one_rm" ? "1RM" : "Working"})</div>
            <div class="lift-target-val num" style="color:var(--mint);">
              ${c.today_target ? escapeHtml(fmtKg(c.today_target.target)) : "—"}
            </div>
            ${
              c.today_target
                ? `<div class="small muted">${escapeHtml(c.today_target.prescription)}</div>`
                : ""
            }
          </div>
          <button class="btn btn-primary btn-sm" data-log-ex="${c.block_exercise_id}">Log</button>
        </div>

        ${
          c.has_target
            ? `
              <div>
                <div class="row-between small muted" style="margin-bottom:4px;">
                  <span>${escapeHtml(fmtKg(c.start_weight))} → ${escapeHtml(fmtKg(c.goal_weight))}</span>
                  <span class="num">${c.pct_to_goal}%</span>
                </div>
                <div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, c.pct_to_goal))}%"></div></div>
              </div>
            `
            : ""
        }

        ${
          c.latest_log
            ? `<div class="small muted">Latest: <strong style="color:var(--text)">${escapeHtml(fmtKg(c.latest_log.working_weight ?? c.latest_log.one_rm ?? c.latest_log.estimated_1rm))}</strong> on ${escapeHtml(c.latest_log.log_date)}${c.latest_log.one_rm || c.latest_log.estimated_1rm ? ` · 1RM ${escapeHtml(fmtKg(c.latest_log.one_rm || c.latest_log.estimated_1rm))}` : ""}</div>`
            : `<div class="small dim">Tap Log whenever you train ${escapeHtml(c.name)}</div>`
        }
      </div>
    `
    )
    .join("");

  const bwHtml = bodyweight_card.enabled
    ? `
      <div class="card row-between" style="flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-weight:700;">Bodyweight Check-in</div>
          <div class="small muted">
            ${
              bodyweight_card.today_target != null
                ? `Today's target: <strong style="color:var(--mint)">${escapeHtml(fmtKg(bodyweight_card.today_target))}</strong> (${escapeHtml(fmtKg(bodyweight_card.start))} → ${escapeHtml(fmtKg(bodyweight_card.goal))})`
                : `Track your bodyweight curve in Setup → My Training Plan`
            }
          </div>
          ${
            bodyweight_card.latest_log
              ? `<div class="small" style="margin-top:4px;">Latest: <strong>${escapeHtml(fmtKg(bodyweight_card.latest_log.weight))}</strong> on ${escapeHtml(bodyweight_card.latest_log.log_date)} ${bodyweight_card.evaluation ? statusBadge(bodyweight_card.evaluation.status) : ""}</div>`
              : ""
          }
        </div>
        <button class="btn btn-secondary btn-sm" id="t-log-bw">Log BW</button>
      </div>
    `
    : "";

  const recentLogsHtml = recent_logs?.length
    ? `
      <section class="card" style="display:flex;flex-direction:column;gap:10px;">
        <div class="section-head" style="margin-bottom:0;">
          <h3 class="section-title">Recent Sessions</h3>
          <span class="small muted">Latest logged lifts</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${recent_logs
            .slice(0, 6)
            .map(
              (l) => `
              <div class="card-subtle row-between" style="flex-wrap:wrap;gap:8px;">
                <div>
                  <div>
                    <strong>${escapeHtml(l.exercise_name)}</strong>
                    <span class="num"> ${escapeHtml(fmtKg(l.working_weight ?? l.one_rm ?? l.estimated_1rm))}</span>
                    ${l.is_pr ? ` <span class="badge badge-pr">🏆 PR</span>` : ""}
                  </div>
                  <div class="dim small num">
                    Day ${l.day_number} · ${escapeHtml(l.log_date)}
                    ${l.one_rm || l.estimated_1rm ? ` · 1RM ${escapeHtml(fmtKg(l.one_rm || l.estimated_1rm))}` : ""}
                    ${l.notes ? ` · ${escapeHtml(l.notes)}` : ""}
                  </div>
                </div>
                <div class="row-inline">
                  ${l.evaluation ? statusBadge(l.evaluation.status, l.evaluation.delta) : ""}
                  <button type="button" class="btn-ghost btn-sm" data-del-log="${l.id}" aria-label="Delete log" title="Delete log">✕</button>
                </div>
              </div>
            `
            )
            .join("")}
        </div>
      </section>
    `
    : "";

  containerEl.innerHTML = `
    <div class="card hero-card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between" style="flex-wrap:wrap;gap:8px;">
        <div>
          <div class="small muted">${escapeHtml(dash.plan?.plan_name || "Training Block")}</div>
          <h2 style="margin:2px 0 0;font-size:21px;letter-spacing:-0.02em;">${escapeHtml(block.name)}</h2>
        </div>
        <div class="row-inline" style="flex-wrap:wrap;">
          <span class="badge badge-plan num">Day ${time.day_number} / ${time.total_days}</span>
          <span class="badge badge-on_pace num">Week ${time.week_number} / ${time.total_weeks}</span>
          <button type="button" class="btn btn-mint btn-sm" id="t-share-card">Share Card</button>
        </div>
      </div>

      <div>
        <div class="row-between small muted" style="margin-bottom:5px;">
          <span>${escapeHtml(block.start_date)} → ${escapeHtml(time.end_date)}</span>
          <span class="num">${time.days_remaining} days left (${time.pct_elapsed}%)</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${time.pct_elapsed}%"></div></div>
      </div>
    </div>

    ${setupPlanBanner}

    <section>
      <div class="section-head">
        <h3 class="section-title">Today's Targets</h3>
        <span class="small muted">Sparse logging — train on your schedule</span>
      </div>
      <div class="grid-2">${todayCardsHtml}</div>
    </section>

    ${bwHtml}

    <section class="card">
      <div class="section-head">
        <h3 class="section-title">Block Stats</h3>
        <span class="small muted">${stats.avg_pct_to_goal}% avg to goal</span>
      </div>
      <div class="milestone-grid">
        <div class="stat-tile">
          <div class="dim small">Total Lifted</div>
          <div class="stat-tile-val num" style="color:var(--coral);">${escapeHtml(fmtKg(Math.round(stats.total_kg_lifted)))}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Weekly Streak</div>
          <div class="stat-tile-val num" style="color:var(--mint);">${stats.streak_weeks} wk${stats.streak_weeks === 1 ? "" : "s"}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Target Hit Rate</div>
          <div class="stat-tile-val num" style="color:var(--green);">${stats.hit_rate_pct != null ? `${stats.hit_rate_pct}%` : "—"}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Block PRs Hit</div>
          <div class="stat-tile-val num" style="color:var(--amber);">${stats.total_prs}</div>
        </div>
      </div>
    </section>

    ${recentLogsHtml}
  `;

  containerEl.querySelector("#t-share-card").addEventListener("click", () => {
    openShareModal({ mode: "summary" });
  });

  for (const btn of containerEl.querySelectorAll("[data-log-ex]")) {
    btn.addEventListener("click", () => {
      const exId = btn.getAttribute("data-log-ex");
      openLogWorkoutModal(exId, actions.refreshActiveBlock);
    });
  }

  for (const btn of containerEl.querySelectorAll("[data-del-log]")) {
    btn.addEventListener("click", async () => {
      const logId = btn.getAttribute("data-del-log");
      try {
        await api.deleteWorkout(logId);
        showToast("Log deleted");
        await actions.refreshActiveBlock();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  const bwBtn = containerEl.querySelector("#t-log-bw");
  if (bwBtn) {
    bwBtn.addEventListener("click", () => openBodyweightModal(actions.refreshActiveBlock));
  }

  const setupBtn = containerEl.querySelector("#t-setup-plan");
  if (setupBtn) {
    setupBtn.addEventListener("click", () => actions.switchTab("setup"));
  }
}
