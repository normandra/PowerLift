/**
 * Today view: Active block hero + Share Card button, Today's Targets, Bodyweight, Block Stats, Recent Logs.
 */

import { renderLiftSparklineHtml } from "../charts.js";
import { openBodyweightModal, openCreateBlockModal, openLogWorkoutModal } from "../modals.js";
import { openShareModal } from "../share.js";
import {
  REACTION_EMOJIS,
  companionArtHtml,
  escapeHtml,
  fmtKg,
  fmtShortDate,
  state,
  statusBadge,
} from "../state.js";

function liftCheerSummary(card, incomingCheers) {
  if (!incomingCheers?.length) return null;
  const latestIds = new Set(
    [card.latest_log?.id, card.latest_metric_log?.id].filter(Boolean).map(String)
  );

  let matched = incomingCheers.filter((ch) => latestIds.has(String(ch.workout_log_id)));
  let isOnLatest = matched.length > 0;

  if (!matched.length) {
    const firstByEx = incomingCheers.find(
      (ch) => ch.block_exercise_id && String(ch.block_exercise_id) === String(card.block_exercise_id)
    );
    if (!firstByEx) return null;
    matched = incomingCheers.filter((ch) => String(ch.workout_log_id) === String(firstByEx.workout_log_id));
  }

  const emojiSet = new Set(matched.map((m) => m.emoji).filter(Boolean));
  const emojis = [...emojiSet].sort((a, b) => {
    const ia = REACTION_EMOJIS.indexOf(a);
    const ib = REACTION_EMOJIS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  if (!emojis.length) return null;
  return {
    emojis,
    reactorName: matched[0].reactor_name || "Partner",
    hasUnread: matched.some((m) => m.isUnread),
    isOnLatest,
    cheerLogDate: matched[0].log_date || null,
  };
}

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

  const { block, time, has_plan, today_cards, bodyweight_card, stats } = dash;
  const incomingCheers = state.cheers?.items || [];
  const chartList = state.cache.charts?.exercises || [];
  const chartsByExId = new Map(chartList.map((e) => [String(e.block_exercise_id), e]));
  const chartsBySlug = new Map(chartList.map((e) => [String(e.slug), e]));

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
    .map((c, idx) => {
      const exChart = chartsByExId.get(String(c.block_exercise_id)) || chartsBySlug.get(String(c.slug)) || null;
      return `
      <div class="lift-card">
        <div class="row-between">
          <div class="lift-card-head">
            ${companionArtHtml(c.slug || c.name, "lg")}
            <div style="min-width:0;">
              <div class="lift-name">${escapeHtml(c.name)}</div>
              <div class="dim small">
                ${c.today_target ? escapeHtml(c.today_target.phase) : "No target configured"}
              </div>
            </div>
          </div>
          ${
            c.today_eval && c.today_eval.hit !== null && c.today_eval.hit !== undefined
              ? statusBadge(c.today_eval.status, c.today_eval.delta)
              : c.latest_eval
              ? statusBadge(c.latest_eval.status, c.latest_eval.delta)
              : c.today_eval
              ? statusBadge(c.today_eval.status, c.today_eval.delta)
              : c.latest_1rm !== null && c.latest_1rm !== undefined
              ? statusBadge("1rm_only")
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

        ${renderLiftSparklineHtml(exChart, time.today_date, c.slug || idx)}

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
          c.latest_metric_log
            ? `<div class="small muted">Latest: <strong style="color:var(--text)">${escapeHtml(fmtKg(c.target_metric === "one_rm" ? (c.latest_metric_log.one_rm ?? c.latest_metric_log.estimated_1rm) : c.latest_metric_log.working_weight))}</strong> on ${escapeHtml(c.latest_metric_log.log_date)}${c.latest_1rm !== null && c.latest_1rm !== undefined ? ` · 1RM ${escapeHtml(fmtKg(c.latest_1rm))}` : ""}</div>`
            : c.latest_1rm !== null && c.latest_1rm !== undefined && c.latest_log
            ? `<div class="small muted">Latest 1RM: <strong style="color:var(--text)">${escapeHtml(fmtKg(c.latest_1rm))}</strong> on ${escapeHtml(c.latest_log.log_date)}</div>`
            : c.latest_log
            ? `<div class="small muted">Latest: <strong style="color:var(--text)">Logged</strong> on ${escapeHtml(c.latest_log.log_date)}</div>`
            : `<div class="small dim">Tap Log whenever you train ${escapeHtml(c.name)}</div>`
        }
        ${(() => {
          const cheer = liftCheerSummary(c, incomingCheers);
          if (!cheer) return "";
          const when = !cheer.isOnLatest && cheer.cheerLogDate ? ` · ${fmtShortDate(cheer.cheerLogDate)}` : "";
          return `
            <div>
              <button type="button" class="lift-cheer-pill ${cheer.hasUnread ? "has-unread" : ""}" data-open-cheers>
                <span class="lift-cheer-emojis">${cheer.emojis.map(escapeHtml).join(" ")}</span>
                <span>from ${escapeHtml(cheer.reactorName)}${escapeHtml(when)}</span>
              </button>
            </div>
          `;
        })()}
      </div>
    `;
    })
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

  containerEl.innerHTML = `
    <div class="card hero-card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between" style="flex-wrap:wrap;gap:8px;">
        <div>
          <div class="small muted">${escapeHtml(dash.plan?.plan_name || "Training Block")}</div>
          <h2 class="hero-title">${escapeHtml(block.name)}</h2>
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
      ${
        today_cards.length
          ? `<div class="grid-2">${todayCardsHtml}</div>`
          : `
            <div class="card-subtle" style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
              <div>
                <div style="font-weight:700;font-size:14.5px;">All lifts are paused</div>
                <div class="small muted">Past logs and targets are safe. Turn tracking back on for any lift in Setup.</div>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="t-manage-lifts">Manage in Setup</button>
            </div>
          `
      }
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

  for (const btn of containerEl.querySelectorAll("[data-open-cheers]")) {
    btn.addEventListener("click", () => {
      actions.openCheers?.();
    });
  }

  const bwBtn = containerEl.querySelector("#t-log-bw");
  if (bwBtn) {
    bwBtn.addEventListener("click", () => openBodyweightModal(actions.refreshActiveBlock));
  }

  const manageLiftsBtn = containerEl.querySelector("#t-manage-lifts");
  if (manageLiftsBtn) {
    manageLiftsBtn.addEventListener("click", () => actions.switchTab("setup"));
  }

  const setupBtn = containerEl.querySelector("#t-setup-plan");
  if (setupBtn) {
    setupBtn.addEventListener("click", () => actions.switchTab("setup"));
  }

  for (const btn of containerEl.querySelectorAll("[data-open-chart]")) {
    btn.addEventListener("click", () => {
      const slug = btn.getAttribute("data-open-chart");
      if (slug) state.selectedChartSlug = slug;
      actions.switchTab("progress");
    });
  }
}
