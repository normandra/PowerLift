/**
 * Partner view: Single tab unlocked when signed in with Google & linked to a partner.
 * Combines % to Goal comparison vs you, Partner Charts tab, and Recent Lifts + 1-tap Emoji Reactions.
 */

import { renderBodyweightChart, renderTargetVsActualChart } from "../charts.js";
import {
  REACTION_EMOJIS,
  avatarHtml,
  companionArtHtml,
  escapeHtml,
  fmtKg,
  showToast,
  state,
  statusBadge,
} from "../state.js";

export function renderPartnerView(containerEl, actions) {
  if (!state.cloud.signedIn || !state.partner.linked) {
    containerEl.innerHTML = `<div class="card muted">Link a partner in Setup to view their progress charts and react to their recent lifts.</div>`;
    return;
  }

  const partnerProf = state.partner.profile || {};
  const overview = state.partner.overview;

  if (state.partner.loading && !overview) {
    containerEl.innerHTML = `
      <div class="card row-between">
        <div class="row-inline">
          ${avatarHtml(partnerProf.display_name, partnerProf.avatar_color, true)}
          <div>
            <strong>${escapeHtml(partnerProf.display_name || "Partner")}</strong>
            <div class="small muted">Loading training block &amp; charts…</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (!overview || !overview.block || !overview.dashboard || !overview.charts) {
    containerEl.innerHTML = `
      <div class="card hero-card row-between" style="flex-wrap:wrap;gap:12px;">
        <div class="row-inline">
          ${avatarHtml(partnerProf.display_name, partnerProf.avatar_color, true)}
          <div>
            <h3 style="margin:0;">${escapeHtml(partnerProf.display_name || "Partner")}</h3>
            <div class="small muted">No active training block synced yet.</div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="p-refresh">Refresh</button>
      </div>
    `;
    containerEl.querySelector("#p-refresh").addEventListener("click", actions.refreshPartner);
    return;
  }

  const { profile, block, dashboard, charts, reactionsByLogId } = overview;
  const pComp = profile.companion || "cat";
  const { time, today_cards, stats, recent_logs } = dashboard;
  const myDash = state.cache.dashboard;
  const myCardsBySlug = new Map((myDash?.today_cards || []).map((c) => [String(c.slug), c]));

  const exercises = charts.exercises || [];
  const hasBw = Boolean(charts.bodyweight?.enabled);
  const tabs = [
    ...exercises.map((ex) => ({ slug: ex.slug, label: ex.name })),
    ...(hasBw ? [{ slug: "__bodyweight__", label: "Bodyweight" }] : []),
  ];

  if (!state.partner.selectedChartSlug || !tabs.some((t) => t.slug === state.partner.selectedChartSlug)) {
    state.partner.selectedChartSlug = tabs[0]?.slug || null;
  }

  const isBw = state.partner.selectedChartSlug === "__bodyweight__";
  const selectedEx = !isBw ? exercises.find((e) => e.slug === state.partner.selectedChartSlug) : null;

  const compareCardsHtml = today_cards
    .map((pc) => {
      const mine = myCardsBySlug.get(String(pc.slug));
      const pPct = Math.max(0, Math.min(100, Number(pc.pct_to_goal || 0)));
      const pLatest = pc.latest_metric_log
        ? pc.target_metric === "one_rm"
          ? pc.latest_metric_log.one_rm ?? pc.latest_metric_log.estimated_1rm
          : pc.latest_metric_log.working_weight
        : null;
      const myPct = mine ? Math.max(0, Math.min(100, Number(mine.pct_to_goal || 0))) : null;
      const myLatest = mine?.latest_metric_log
        ? mine.target_metric === "one_rm"
          ? mine.latest_metric_log.one_rm ?? mine.latest_metric_log.estimated_1rm
          : mine.latest_metric_log.working_weight
        : null;

      return `
        <div class="card-subtle partner-compare-card">
          <div class="row-between">
            <div class="row-inline" style="gap:8px;">
              ${companionArtHtml(pc.slug || pc.name, "sm", pComp)}
              <strong>${escapeHtml(pc.name)}</strong>
            </div>
            ${pc.latest_eval ? statusBadge(pc.latest_eval.status, pc.latest_eval.delta) : ""}
          </div>

          <div class="partner-compare-row">
            <div class="row-between small">
              <span>${escapeHtml(profile.display_name || "Partner")}: <strong class="num">${escapeHtml(fmtKg(pLatest))}</strong></span>
              <span class="num muted">${pc.has_target ? `${pc.pct_to_goal}% to ${fmtKg(pc.goal_weight)}` : "No target"}</span>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width:${pPct}%;"></div></div>
          </div>

          ${
            mine
              ? `
                <div class="partner-compare-row">
                  <div class="row-between small muted">
                    <span>You: <strong style="color:var(--text);" class="num">${escapeHtml(fmtKg(myLatest))}</strong></span>
                    <span class="num">${mine.has_target ? `${mine.pct_to_goal}% to ${fmtKg(mine.goal_weight)}` : "No target"}</span>
                  </div>
                  <div class="progress-track"><div class="progress-fill compare-mine-fill" style="width:${myPct}%;"></div></div>
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  const recentHtml = recent_logs?.length
    ? recent_logs
        .map((l) => {
          const rxMap = reactionsByLogId?.[String(l.id)] || {};
          return `
            <div class="card-subtle" style="display:flex;flex-direction:column;gap:8px;">
              <div class="row-between" style="flex-wrap:wrap;gap:8px;">
                <div class="row-inline" style="gap:10px;min-width:0;">
                  ${companionArtHtml(l.exercise_slug || l.exercise_name, "sm", pComp)}
                  <div style="min-width:0;">
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
                </div>
                ${l.evaluation ? statusBadge(l.evaluation.status, l.evaluation.delta) : ""}
              </div>

              <div class="reaction-row">
                ${REACTION_EMOJIS.map((em) => {
                  const info = rxMap[em] || { count: 0, reactedByMe: false };
                  return `
                    <button
                      type="button"
                      class="reaction-chip ${info.reactedByMe ? "active" : ""}"
                      data-react-log="${escapeHtml(l.id)}"
                      data-react-owner="${escapeHtml(profile.id)}"
                      data-react-emoji="${escapeHtml(em)}"
                    >
                      <span>${em}</span>
                      ${info.count > 0 ? `<span class="num">${info.count}</span>` : ""}
                    </button>
                  `;
                }).join("")}
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="muted small">No recent lifts logged in this block yet.</div>`;

  containerEl.innerHTML = `
    <div class="card hero-card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between" style="flex-wrap:wrap;gap:10px;">
        <div class="row-inline">
          ${avatarHtml(profile.display_name, profile.avatar_color, true)}
          <div>
            <div class="small muted">Linked Partner · ${escapeHtml(dashboard.plan?.plan_name || "Training Block")}</div>
            <h2 style="margin:2px 0 0;font-size:20px;letter-spacing:-0.02em;">
              ${escapeHtml(profile.display_name || "Partner")} — ${escapeHtml(block.name)}
            </h2>
          </div>
        </div>
        <div class="row-inline" style="flex-wrap:wrap;">
          <span class="badge badge-plan num">Day ${time.day_number} / ${time.total_days}</span>
          <span class="badge badge-on_pace num">Week ${time.week_number} / ${time.total_weeks}</span>
          <button type="button" class="btn btn-secondary btn-sm" id="p-refresh">${state.partner.loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      <div>
        <div class="row-between small muted" style="margin-bottom:5px;">
          <span>${escapeHtml(block.start_date)} → ${escapeHtml(time.end_date)}</span>
          <span class="num">${time.days_remaining} days left (${time.pct_elapsed}%)</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${time.pct_elapsed}%"></div></div>
      </div>

      <div class="milestone-grid">
        <div class="stat-tile">
          <div class="dim small">Goal Progress</div>
          <div class="stat-tile-val num" style="color:var(--mint);">${stats.avg_pct_to_goal}%</div>
          ${myDash ? `<div class="dim small num">You: ${myDash.stats.avg_pct_to_goal}%</div>` : ""}
        </div>
        <div class="stat-tile">
          <div class="dim small">Target Hit Rate</div>
          <div class="stat-tile-val num" style="color:var(--green);">${stats.hit_rate_pct != null ? `${stats.hit_rate_pct}%` : "—"}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Weekly Streak</div>
          <div class="stat-tile-val num" style="color:var(--coral);">${stats.streak_weeks} wk${stats.streak_weeks === 1 ? "" : "s"}</div>
        </div>
        <div class="stat-tile">
          <div class="dim small">Sessions · PRs</div>
          <div class="stat-tile-val num">${stats.sessions_logged} · ${stats.total_prs} 🏆</div>
        </div>
      </div>
    </div>

    ${
      today_cards.length
        ? `
          <section class="card" style="display:flex;flex-direction:column;gap:10px;">
            <div class="section-head" style="margin-bottom:0;">
              <h3 class="section-title">Lift Comparison (% to Goal)</h3>
              <span class="small muted">${escapeHtml(profile.display_name || "Partner")} vs You</span>
            </div>
            <div class="grid-3">${compareCardsHtml}</div>
          </section>
        `
        : ""
    }

    <section class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between" style="flex-wrap:wrap;gap:8px;">
        <h3 class="section-title" style="margin:0;">${escapeHtml(profile.display_name || "Partner")}'s Charts</h3>
        ${
          !isBw
            ? `
              <label class="row-inline small muted" style="cursor:pointer;">
                <input type="checkbox" id="p-toggle-1rm" ${state.partner.showOneRmOverlay ? "checked" : ""} style="width:auto;" />
                <span>Show 1RM / Est. 1RM</span>
              </label>
            `
            : ""
        }
      </div>

      <div class="pill-scroll">
        ${tabs
          .map(
            (t) =>
              `<button type="button" class="pill-btn ${t.slug === state.partner.selectedChartSlug ? "active" : ""}" data-p-chart="${escapeHtml(t.slug)}" style="display:inline-flex;align-items:center;gap:6px;">${t.slug !== "__bodyweight__" ? companionArtHtml(t.slug, "xs", pComp) : ""}<span>${escapeHtml(t.label)}</span></button>`
          )
          .join("")}
      </div>

      ${
        !isBw && selectedEx
          ? `
            <div class="card-subtle row-inline" style="gap:12px;">
              ${companionArtHtml(selectedEx.slug || selectedEx.name, "md", pComp)}
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

      <div id="p-chart-canvas"></div>

      <div class="row-inline small muted" style="flex-wrap:wrap;gap:14px;">
        ${
          isBw
            ? `<span><span style="color:#9AA5B8;">---</span> Daily Bodyweight Target</span><span><span style="color:#34D399;">●</span> On track</span><span><span style="color:var(--coral);">●</span> Off pace</span>`
            : `<span><span style="color:#9AA5B8;">---</span> Target Curve</span><span><span style="color:#34D399;">●</span> Hit / Beat</span><span><span style="color:var(--coral);">●</span> Missed</span>${state.partner.showOneRmOverlay ? `<span><span style="color:#FBBF24;">—</span> 1RM / Est. 1RM</span>` : ""}`
        }
      </div>
    </section>

    <section class="card" style="display:flex;flex-direction:column;gap:10px;">
      <div class="section-head" style="margin-bottom:0;">
        <h3 class="section-title">Recent Lifts &amp; Reactions</h3>
        <span class="small muted">Tap an emoji to cheer them on</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">${recentHtml}</div>
    </section>
  `;

  const canvas = containerEl.querySelector("#p-chart-canvas");
  if (isBw) {
    renderBodyweightChart(canvas, charts.bodyweight, charts.duration_days, charts.current_day);
  } else if (selectedEx) {
    renderTargetVsActualChart(canvas, selectedEx, charts.duration_days, charts.current_day, state.partner.showOneRmOverlay);
  }

  containerEl.querySelector("#p-refresh").addEventListener("click", actions.refreshPartner);

  for (const btn of containerEl.querySelectorAll("[data-p-chart]")) {
    btn.addEventListener("click", () => {
      state.partner.selectedChartSlug = btn.getAttribute("data-p-chart");
      actions.renderCurrentTab();
    });
  }

  const ormChk = containerEl.querySelector("#p-toggle-1rm");
  if (ormChk) {
    ormChk.addEventListener("change", () => {
      state.partner.showOneRmOverlay = ormChk.checked;
      actions.renderCurrentTab();
    });
  }

  for (const btn of containerEl.querySelectorAll("[data-react-log]")) {
    btn.addEventListener("click", async () => {
      const logId = btn.getAttribute("data-react-log");
      const ownerId = btn.getAttribute("data-react-owner");
      const emoji = btn.getAttribute("data-react-emoji");

      const rxMap = overview.reactionsByLogId[logId] || (overview.reactionsByLogId[logId] = {});
      const prev = rxMap[emoji] ? { ...rxMap[emoji] } : { count: 0, reactedByMe: false };
      const nextReacted = !prev.reactedByMe;

      rxMap[emoji] = {
        count: Math.max(0, prev.count + (nextReacted ? 1 : -1)),
        reactedByMe: nextReacted,
      };
      actions.renderCurrentTab();

      try {
        await actions.togglePartnerReaction(logId, ownerId, emoji, prev.reactedByMe);
      } catch (err) {
        rxMap[emoji] = prev;
        actions.renderCurrentTab();
        showToast(err.message || "Could not update reaction", true);
      }
    });
  }
}
