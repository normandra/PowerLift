/**
 * Modal dialogs: Hybrid Workout Logger, Bodyweight Logger, and Create Training Block.
 */

import { api } from "./api.js";
import {
  REACTION_EMOJIS,
  avatarHtml,
  companionArtHtml,
  epleyClient,
  escapeHtml,
  fmtKg,
  fmtRelativeTime,
  fmtShortDate,
  mroundClient,
  showToast,
  state,
  todayIso,
} from "./state.js";

export function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

export function mountModal(innerHtml, onMount) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet" role="dialog" aria-modal="true">
        ${innerHtml}
      </div>
    </div>
  `;
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  const closeBtn = root.querySelector("[data-close-modal]");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (onMount) onMount(root);
}

function computeClientDayTarget(card, dateStr) {
  const dash = state.cache.dashboard;
  if (!dash || !card || !card.has_target || !card.today_target) return null;
  if (dateStr === dash.time.today_date) return card.today_target.target;
  const start = new Date(dash.block.start_date + "T00:00:00");
  const cur = new Date(dateStr + "T00:00:00");
  const dur = Math.max(1, dash.block.duration_days);
  const day = Math.max(1, Math.min(dur, Math.round((cur - start) / 86400000) + 1));
  if (card.plan_type === "linear" && card.start_weight != null && card.goal_weight != null) {
    const raw = card.start_weight + (card.goal_weight - card.start_weight) * ((day - 1) / Math.max(dur - 1, 1));
    return mroundClient(raw, card.increment || 2.5);
  }
  return card.today_target.target;
}

export function openLogWorkoutModal(preselectedExerciseId = null, onSaved = null) {
  const dash = state.cache.dashboard;
  const block = state.activeBlockDetail?.block || dash?.block;
  const cards = dash?.today_cards || [];
  const allExercises = state.activeBlockDetail?.exercises || cards.map((c) => ({
    id: c.block_exercise_id,
    name: c.name,
    default_increment: c.default_increment || 2.5,
  }));
  const exercises = allExercises.filter((e) => e.is_tracked !== false);

  if (!block || !allExercises.length) {
    showToast("Create or select a training block first.", true);
    return;
  }
  if (!exercises.length) {
    showToast("All lifts are paused — enable tracking in Setup.", true);
    return;
  }

  const initialExId = preselectedExerciseId || exercises[0].id;
  let setsExpanded = false;
  let setRows = [{ weight: "", reps: 5, rpe: "" }];

  const getCard = (exId) => cards.find((c) => String(c.block_exercise_id) === String(exId));

  mountModal(
    `
      <div class="row-between">
        <h3 style="margin:0;font-size:18px;">Log Workout</h3>
        <button class="btn-ghost btn-sm" data-close-modal aria-label="Close">✕</button>
      </div>

      <form id="log-workout-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="grid-2">
          <div class="form-field">
            <label for="lw-ex">Exercise</label>
            <select id="lw-ex">
              ${exercises
                .map(
                  (ex) =>
                    `<option value="${escapeHtml(ex.id)}" ${String(ex.id) === String(initialExId) ? "selected" : ""}>${escapeHtml(ex.name)}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="form-field">
            <label for="lw-date">Date</label>
            <input id="lw-date" type="date" value="${escapeHtml(todayIso())}" required />
          </div>
        </div>

        <div id="lw-target-banner" class="card-subtle small"></div>

        <div class="grid-2">
          <div class="form-field">
            <label for="lw-weight">Working Weight (kg)</label>
            <input id="lw-weight" type="number" step="0.25" min="0" placeholder="e.g. 60" />
            <div class="row-inline" id="lw-quick-btns" style="margin-top:4px;flex-wrap:wrap;"></div>
          </div>
          <div class="form-field">
            <label for="lw-1rm">1RM / Top Single (kg, optional)</label>
            <input id="lw-1rm" type="number" step="0.25" min="0" placeholder="Optional" />
          </div>
        </div>

        <div>
          <button type="button" id="lw-toggle-sets" class="btn btn-secondary btn-sm">
            + Expand Sets × Reps (auto Epley 1RM)
          </button>
        </div>

        <div id="lw-sets-panel" hidden class="card-subtle" style="display:none;flex-direction:column;gap:8px;">
          <div class="row-between">
            <span class="small muted">Sets × Reps</span>
            <button type="button" id="lw-add-set" class="btn btn-mint btn-sm">+ Add Set</button>
          </div>
          <div id="lw-sets-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
          <div id="lw-sets-summary" class="small muted"></div>
        </div>

        <div id="lw-eval-preview" class="small"></div>

        <div class="form-field">
          <label for="lw-notes">Notes (optional)</label>
          <input id="lw-notes" type="text" placeholder="How did it feel? Bar speed, cues..." maxlength="300" />
        </div>

        <button type="submit" class="btn btn-primary btn-block" id="lw-submit">Save Workout</button>
      </form>
      ${
        (dash?.recent_logs?.length || 0) > 0
          ? `<button type="button" class="btn btn-ghost btn-sm" id="lw-manage-logs" style="align-self:center;color:var(--text-muted);">Manage past logs…</button>`
          : ""
      }
    `,
    (root) => {
      const exSel = root.querySelector("#lw-ex");
      const dateIn = root.querySelector("#lw-date");
      const wwIn = root.querySelector("#lw-weight");
      const oneRmIn = root.querySelector("#lw-1rm");
      const banner = root.querySelector("#lw-target-banner");
      const quickBtns = root.querySelector("#lw-quick-btns");
      const toggleSetsBtn = root.querySelector("#lw-toggle-sets");
      const setsPanel = root.querySelector("#lw-sets-panel");
      const setsRowsEl = root.querySelector("#lw-sets-rows");
      const setsSummaryEl = root.querySelector("#lw-sets-summary");
      const addSetBtn = root.querySelector("#lw-add-set");
      const evalEl = root.querySelector("#lw-eval-preview");
      let manualWorkingWeight = false;

      const refreshPreview = () => {
        const exId = exSel.value;
        const card = getCard(exId);
        const inc = card?.increment || 2.5;
        const tVal = computeClientDayTarget(card, dateIn.value || todayIso());

        const selectedExObj = exercises.find((e) => String(e.id) === String(exId));
        const art = companionArtHtml(card?.slug || card?.name || selectedExObj?.name || "", "md");
        if (card && card.has_target && card.today_target) {
          banner.innerHTML = `
            <div class="row-between" style="gap:10px;">
              <div class="row-inline" style="gap:10px;min-width:0;">
                ${art}
                <div style="min-width:0;">
                  <div><strong>${escapeHtml(card.name)}</strong> target: <strong style="color:var(--mint)">${escapeHtml(fmtKg(tVal))}</strong></div>
                  <div class="muted">${escapeHtml(card.today_target.prescription)}</div>
                </div>
              </div>
            </div>
          `;
          quickBtns.innerHTML = `
            <button type="button" class="btn btn-secondary btn-sm" data-set-w="${Math.max(0, tVal - inc)}">-${inc}</button>
            <button type="button" class="btn btn-mint btn-sm" data-set-w="${tVal}">Target ${fmtKg(tVal, "")}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-set-w="${tVal + inc}">+${inc}</button>
          `;
          for (const b of quickBtns.querySelectorAll("[data-set-w]")) {
            b.addEventListener("click", () => {
              manualWorkingWeight = true;
              wwIn.value = b.getAttribute("data-set-w");
              refreshPreview();
            });
          }
        } else {
          banner.innerHTML = `
            <div class="row-inline" style="gap:10px;">
              ${art}
              <span class="muted">No target configured for ${escapeHtml(card?.name || selectedExObj?.name || "this lift")} yet (still logs normally!).</span>
            </div>
          `;
          quickBtns.innerHTML = "";
        }

        let topSetW = null;
        let bestEst = null;
        let vol = 0;
        if (setsExpanded) {
          for (const r of setRows) {
            const w = Number(r.weight);
            const reps = Number(r.reps);
            if (w > 0 && reps > 0) {
              if (topSetW === null || w > topSetW) topSetW = w;
              const est = epleyClient(w, reps);
              if (bestEst === null || est > bestEst) bestEst = est;
              vol += w * reps;
            }
          }
          if (topSetW !== null && !manualWorkingWeight) {
            wwIn.value = String(topSetW);
          }
          setsSummaryEl.innerHTML = topSetW
            ? `Top: <strong>${fmtKg(topSetW)}</strong> · Est. 1RM (Epley): <strong style="color:var(--amber)">${fmtKg(bestEst)}</strong> · Vol: <strong>${fmtKg(Math.round(vol))}</strong>`
            : `Enter weight & reps to auto-calculate Est. 1RM and volume.`;
        }

        const wwVal = wwIn.value !== "" ? Number(wwIn.value) : topSetW;
        const ormVal = oneRmIn.value !== "" ? Number(oneRmIn.value) : bestEst;
        const metricVal = card?.target_metric === "one_rm" ? (ormVal ?? wwVal) : (wwVal ?? ormVal);

        if (tVal != null && metricVal != null && !Number.isNaN(metricVal)) {
          const delta = Math.round((metricVal - tVal) * 100) / 100;
          if (delta > 0) {
            evalEl.innerHTML = `<span class="badge badge-beat">🔥 Beats target by +${fmtKg(delta)}</span>`;
          } else if (delta === 0) {
            evalEl.innerHTML = `<span class="badge badge-hit">✅ Right on target</span>`;
          } else {
            evalEl.innerHTML = `<span class="badge badge-missed">⚡ ${fmtKg(delta)} vs target</span>`;
          }
        } else {
          evalEl.innerHTML = "";
        }
      };

      const renderSets = () => {
        setsRowsEl.innerHTML = setRows
          .map(
            (r, idx) => `
            <div class="set-row" data-set-idx="${idx}">
              <input type="number" step="0.25" min="0" placeholder="kg" value="${escapeHtml(r.weight)}" data-field="weight" />
              <input type="number" step="1" min="1" placeholder="reps" value="${escapeHtml(r.reps)}" data-field="reps" />
              <input type="number" step="0.5" min="1" max="10" placeholder="RPE" value="${escapeHtml(r.rpe)}" data-field="rpe" />
              <button type="button" class="btn-ghost btn-sm" data-rm-set="${idx}" aria-label="Remove set">✕</button>
            </div>
          `
          )
          .join("");
        for (const rowEl of setsRowsEl.querySelectorAll(".set-row")) {
          const idx = Number(rowEl.getAttribute("data-set-idx"));
          for (const inp of rowEl.querySelectorAll("input")) {
            inp.addEventListener("input", () => {
              setRows[idx][inp.getAttribute("data-field")] = inp.value;
              refreshPreview();
            });
          }
          const rmBtn = rowEl.querySelector("[data-rm-set]");
          rmBtn.addEventListener("click", () => {
            if (setRows.length > 1) {
              setRows.splice(idx, 1);
              renderSets();
              refreshPreview();
            }
          });
        }
      };

      toggleSetsBtn.addEventListener("click", () => {
        setsExpanded = !setsExpanded;
        setsPanel.hidden = !setsExpanded;
        setsPanel.style.display = setsExpanded ? "flex" : "none";
        toggleSetsBtn.textContent = setsExpanded
          ? "− Hide Sets × Reps"
          : "+ Expand Sets × Reps (auto Epley 1RM)";
        if (setsExpanded && !setRows[0].weight) {
          const card = getCard(exSel.value);
          const defW = wwIn.value || card?.today_target?.target || "";
          setRows[0].weight = defW;
        }
        renderSets();
        refreshPreview();
      });

      addSetBtn.addEventListener("click", () => {
        const prev = setRows[setRows.length - 1] || { weight: "", reps: 5, rpe: "" };
        setRows.push({ weight: prev.weight, reps: prev.reps, rpe: prev.rpe });
        renderSets();
        refreshPreview();
      });

      exSel.addEventListener("change", () => {
        const card = getCard(exSel.value);
        if (card?.today_target?.target && !manualWorkingWeight) {
          wwIn.value = String(card.today_target.target);
        }
        refreshPreview();
      });
      dateIn.addEventListener("change", refreshPreview);
      wwIn.addEventListener("input", () => {
        manualWorkingWeight = wwIn.value !== "";
        refreshPreview();
      });
      oneRmIn.addEventListener("input", refreshPreview);

      const initCard = getCard(initialExId);
      if (initCard?.today_target?.target) {
        wwIn.value = String(initCard.today_target.target);
      }
      refreshPreview();

      root.querySelector("#lw-manage-logs")?.addEventListener("click", () => {
        openLogHistoryModal(exSel.value, onSaved);
      });

      root.querySelector("#log-workout-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const setsClean = setsExpanded
          ? setRows
              .filter((r) => Number(r.weight) > 0 && Number(r.reps) > 0)
              .map((r) => ({
                weight: Number(r.weight),
                reps: Number(r.reps),
                ...(r.rpe !== "" ? { rpe: Number(r.rpe) } : {}),
              }))
          : null;

        const payload = {
          block_exercise_id: String(exSel.value),
          log_date: dateIn.value || todayIso(),
          working_weight: wwIn.value !== "" ? Number(wwIn.value) : null,
          one_rm: oneRmIn.value !== "" ? Number(oneRmIn.value) : null,
          sets: setsClean,
          notes: root.querySelector("#lw-notes").value.trim(),
        };

        try {
          const saved = await api.logWorkout(block.id, payload);
          closeModal();
          showToast(saved.is_pr ? `🏆 PR! Logged ${saved.exercise_name}` : `Logged ${saved.exercise_name}`);
          if (onSaved) await onSaved();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  );
}

export function openBodyweightModal(onSaved = null) {
  const dash = state.cache.dashboard;
  const block = state.activeBlockDetail?.block || dash?.block;
  if (!block) return;
  const bwCard = dash?.bodyweight_card;
  const suggested = bwCard?.latest_log?.weight ?? bwCard?.today_target ?? 68.0;

  mountModal(
    `
      <div class="row-between">
        <h3 style="margin:0;font-size:18px;">Log Bodyweight</h3>
        <button class="btn-ghost btn-sm" data-close-modal>✕</button>
      </div>
      <form id="bw-form" style="display:flex;flex-direction:column;gap:12px;">
        ${
          bwCard?.today_target != null
            ? `<div class="card-subtle small">Today's target: <strong style="color:var(--mint)">${fmtKg(bwCard.today_target)}</strong></div>`
            : ""
        }
        <div class="grid-2">
          <div class="form-field">
            <label for="bw-date">Date</label>
            <input id="bw-date" type="date" value="${escapeHtml(todayIso())}" required />
          </div>
          <div class="form-field">
            <label for="bw-weight">Bodyweight (kg)</label>
            <input id="bw-weight" type="number" step="0.1" min="25" max="350" value="${escapeHtml(suggested)}" required />
          </div>
        </div>
        <div class="form-field">
          <label for="bw-notes">Notes (optional)</label>
          <input id="bw-notes" type="text" placeholder="Morning weigh-in..." />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Save Bodyweight</button>
      </form>
    `,
    (root) => {
      root.querySelector("#bw-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api.logBodyweight(block.id, {
            log_date: root.querySelector("#bw-date").value,
            weight: Number(root.querySelector("#bw-weight").value),
            notes: root.querySelector("#bw-notes").value.trim(),
          });
          closeModal();
          showToast("Bodyweight logged!");
          if (onSaved) await onSaved();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  );
}

export function openCreateBlockModal(onDone) {
  const exercises = [
    { name: "Squat", default_increment: 2.5 },
    { name: "Bench", default_increment: 2.5 },
    { name: "Deadlift", default_increment: 2.5 },
  ];
  const extras = [
    { name: "OHP", default_increment: 1.25 },
    { name: "Pullup", default_increment: 1.25 },
    { name: "Row", default_increment: 1.25 },
  ];

  mountModal(
    `
      <div class="row-between">
        <h3 style="margin:0;font-size:18px;">New Training Block</h3>
        <button class="btn-ghost btn-sm" data-close-modal>✕</button>
      </div>
      <form id="cb-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-field">
          <label for="cb-name">Block Name</label>
          <input id="cb-name" type="text" required value="Strength Block" />
        </div>
        <div class="grid-3">
          <div class="form-field">
            <label for="cb-start">Start Date</label>
            <input id="cb-start" type="date" required value="${escapeHtml(todayIso())}" />
          </div>
          <div class="form-field">
            <label for="cb-weeks">Weeks</label>
            <input id="cb-weeks" type="number" min="1" max="52" value="14" required />
          </div>
          <div class="form-field">
            <label for="cb-goal">Sessions / wk</label>
            <input id="cb-goal" type="number" min="1" max="14" value="3" required />
          </div>
        </div>

        <label class="row-inline small" style="cursor:pointer;">
          <input type="checkbox" id="cb-bw" checked style="width:auto;" />
          <span>Track bodyweight target curve (0.1 kg steps)</span>
        </label>

        <div class="form-field">
          <label>Tracked Exercises (Big 3 by default)</label>
          <div id="cb-ex-list" style="display:flex;flex-direction:column;gap:6px;"></div>
          <div class="row-inline" style="flex-wrap:wrap;margin-top:4px;">
            ${extras
              .map(
                (x) =>
                  `<button type="button" class="pill-btn" data-add-preset="${escapeHtml(x.name)}" data-inc="${x.default_increment}">+ ${escapeHtml(x.name)}</button>`
              )
              .join("")}
          </div>
          <div class="row-inline" style="margin-top:6px;">
            <input id="cb-custom-ex" type="text" placeholder="Custom lift (e.g. RDL, Dip)" />
            <button type="button" id="cb-add-custom" class="btn btn-secondary btn-sm">Add</button>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block">Create Block</button>
      </form>
    `,
    (root) => {
      const listEl = root.querySelector("#cb-ex-list");
      const renderExList = () => {
        listEl.innerHTML = exercises
          .map(
            (ex, i) => `
            <div class="row-between card-subtle" style="padding:8px 10px;">
              <span><strong>${escapeHtml(ex.name)}</strong> <span class="muted small">(step ${ex.default_increment} kg)</span></span>
              ${
                exercises.length > 1
                  ? `<button type="button" class="btn-ghost btn-sm" data-rm-ex="${i}">✕</button>`
                  : ""
              }
            </div>
          `
          )
          .join("");
        for (const btn of listEl.querySelectorAll("[data-rm-ex]")) {
          btn.addEventListener("click", () => {
            exercises.splice(Number(btn.getAttribute("data-rm-ex")), 1);
            renderExList();
          });
        }
      };
      renderExList();

      for (const btn of root.querySelectorAll("[data-add-preset]")) {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-add-preset");
          const inc = Number(btn.getAttribute("data-inc"));
          if (!exercises.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
            exercises.push({ name, default_increment: inc });
            renderExList();
          }
        });
      }

      root.querySelector("#cb-add-custom").addEventListener("click", () => {
        const inp = root.querySelector("#cb-custom-ex");
        const val = inp.value.trim();
        if (val && !exercises.some((x) => x.name.toLowerCase() === val.toLowerCase())) {
          exercises.push({ name: val, default_increment: 2.5 });
          inp.value = "";
          renderExList();
        }
      });

      root.querySelector("#cb-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const detail = await api.createBlock({
            name: root.querySelector("#cb-name").value.trim(),
            start_date: root.querySelector("#cb-start").value,
            duration_weeks: Number(root.querySelector("#cb-weeks").value),
            weekly_session_goal: Number(root.querySelector("#cb-goal").value),
            track_bodyweight: root.querySelector("#cb-bw").checked,
            exercises,
          });
          closeModal();
          showToast(`Block "${detail.block.name}" created!`);
          if (onDone) await onDone(detail.block.id);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  );
}

function buildGroupedCheers(unreadIdSnapshot) {
  const groups = [];
  const byLog = new Map();
  for (const item of state.cheers?.items || []) {
    const key = String(item.workout_log_id);
    let grp = byLog.get(key);
    if (!grp) {
      grp = {
        workout_log_id: key,
        exercise_name: item.exercise_name || "Lift",
        exercise_slug: item.exercise_slug || "lift",
        primary_weight: item.primary_weight,
        log_date: item.log_date,
        reactor_name: item.reactor_name || "Partner",
        reactor_color: item.reactor_color || "#2DD4BF",
        latest_created_at: item.created_at,
        emojiSet: new Set(),
        hasNew: false,
      };
      byLog.set(key, grp);
      groups.push(grp);
    }
    if (item.emoji) grp.emojiSet.add(item.emoji);
    if (unreadIdSnapshot.has(String(item.id))) grp.hasNew = true;
  }

  return groups.map((g) => ({
    ...g,
    emojis: [...g.emojiSet].sort((a, b) => {
      const ia = REACTION_EMOJIS.indexOf(a);
      const ib = REACTION_EMOJIS.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }),
  }));
}

export function openCheersModal(actions) {
  const unreadIdSnapshot = new Set(
    (state.cheers?.items || []).filter((i) => i.isUnread).map((i) => String(i.id))
  );

  const renderCheers = () => {
    const groups = buildGroupedCheers(unreadIdSnapshot);
    const bodyHtml = groups.length
      ? `
        <div style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;">
          ${groups
            .map((g) => {
              const art = companionArtHtml(g.exercise_slug || g.exercise_name, "sm");
              const weightPart = g.primary_weight != null ? ` · ${escapeHtml(fmtKg(g.primary_weight))}` : "";
              const datePart = g.log_date ? ` · ${escapeHtml(fmtShortDate(g.log_date))}` : "";
              return `
                <div class="card-subtle cheer-item ${g.hasNew ? "is-new" : ""}">
                  ${art || avatarHtml(g.reactor_name, g.reactor_color)}
                  <div style="min-width:0;flex:1;">
                    <div class="row-between" style="gap:6px;">
                      <div style="font-size:13.5px;min-width:0;">
                        <strong>${escapeHtml(g.reactor_name)}</strong>
                        <span class="muted"> reacted </span>
                        <span class="cheer-emoji-row">${g.emojis.map(escapeHtml).join(" ")}</span>
                      </div>
                      ${g.hasNew ? `<span class="cheer-new-pill">New</span>` : ""}
                    </div>
                    <div class="row-between small dim" style="margin-top:2px;gap:8px;">
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        your ${escapeHtml(g.exercise_name)}${weightPart}${datePart}
                      </span>
                      <span style="flex-shrink:0;">${escapeHtml(fmtRelativeTime(g.latest_created_at))}</span>
                    </div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `
      : `
        <div class="card-subtle small muted" style="line-height:1.5;">
          No partner cheers yet. When your partner reacts with emojis in their <strong>Partner</strong> tab,
          they appear right here and on your <strong>Today</strong> lift cards.
        </div>
      `;

    mountModal(
      `
        <div class="row-between">
          <div>
            <h3 style="margin:0;font-size:18px;">Partner Cheers</h3>
            <div class="small muted">Emoji reactions on your recent lifts</div>
          </div>
          <div class="row-inline" style="gap:6px;">
            <button type="button" class="btn btn-secondary btn-sm" id="ch-refresh">Refresh</button>
            <button type="button" class="btn-ghost btn-sm" data-close-modal aria-label="Close">✕</button>
          </div>
        </div>
        ${bodyHtml}
      `,
      (root) => {
        if (actions?.markCheersSeen) actions.markCheersSeen();
        root.querySelector("#ch-refresh")?.addEventListener("click", async () => {
          const btn = root.querySelector("#ch-refresh");
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Checking…";
          }
          try {
            await actions?.refreshCheers?.();
            for (const item of state.cheers?.items || []) {
              if (item.isUnread) unreadIdSnapshot.add(String(item.id));
            }
            renderCheers();
          } catch (err) {
            showToast(err.message || "Could not refresh cheers", true);
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Refresh";
            }
          }
        });
      }
    );
  };

  renderCheers();
}

export function openLogHistoryModal(initialExId = null, onChanged = null) {
  let filterExId = initialExId ? String(initialExId) : "all";

  const renderHistory = () => {
    const dash = state.cache.dashboard;
    const allLogs = dash?.recent_logs || [];
    const exercises = (state.activeBlockDetail?.exercises || []).filter((e) => e.is_tracked !== false);
    if (filterExId !== "all" && !exercises.some((e) => String(e.id) === filterExId)) {
      filterExId = "all";
    }

    const filtered =
      filterExId === "all"
        ? allLogs
        : allLogs.filter((l) => String(l.block_exercise_id) === filterExId);

    const pillsHtml = [
      `<button type="button" class="pill-btn ${filterExId === "all" ? "active" : ""}" data-lh-filter="all">All (${allLogs.length})</button>`,
      ...exercises.map((e) => {
        const cnt = allLogs.filter((l) => String(l.block_exercise_id) === String(e.id)).length;
        return `<button type="button" class="pill-btn ${filterExId === String(e.id) ? "active" : ""}" data-lh-filter="${escapeHtml(e.id)}">${escapeHtml(e.name)} (${cnt})</button>`;
      }),
    ].join("");

    const rowsHtml = filtered.length
      ? filtered
          .map((l) => {
            const val = l.working_weight ?? l.one_rm ?? l.estimated_1rm;
            return `
              <div class="card-subtle row-between" style="gap:10px;padding:10px 12px;">
                <div style="min-width:0;">
                  <div style="font-size:13.5px;">
                    <strong>${escapeHtml(l.exercise_name)}</strong>
                    <span class="num"> ${escapeHtml(fmtKg(val))}</span>
                    ${l.is_pr ? ` <span class="badge badge-pr">🏆 PR</span>` : ""}
                  </div>
                  <div class="dim small num">
                    Day ${l.day_number} · ${escapeHtml(l.log_date)}
                    ${l.one_rm || l.estimated_1rm ? ` · 1RM ${escapeHtml(fmtKg(l.one_rm || l.estimated_1rm))}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  data-lh-del="${escapeHtml(l.id)}"
                  style="color:var(--crimson);flex-shrink:0;"
                >
                  Delete
                </button>
              </div>
            `;
          })
          .join("")
      : `<div class="muted small">No recent entries match this filter.</div>`;

    mountModal(
      `
        <div class="row-between">
          <div>
            <h3 style="margin:0;font-size:18px;">Log History</h3>
            <div class="small muted">Review or permanently remove recent entries</div>
          </div>
          <button type="button" class="btn-ghost btn-sm" data-close-modal aria-label="Close">✕</button>
        </div>
        <div class="pill-scroll">${pillsHtml}</div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto;">
          ${rowsHtml}
        </div>
      `,
      (root) => {
        for (const btn of root.querySelectorAll("[data-lh-filter]")) {
          btn.addEventListener("click", () => {
            filterExId = btn.getAttribute("data-lh-filter") || "all";
            renderHistory();
          });
        }

        for (const btn of root.querySelectorAll("[data-lh-del]")) {
          btn.addEventListener("click", async () => {
            const logId = btn.getAttribute("data-lh-del");
            const log = allLogs.find((x) => String(x.id) === String(logId));
            const val = log ? log.working_weight ?? log.one_rm ?? log.estimated_1rm : null;
            const label = log ? `${log.exercise_name} (${fmtKg(val)}) on ${log.log_date}` : "this entry";
            if (!window.confirm(`Permanently delete ${label}? This removes the workout entry from your history.`)) {
              return;
            }
            btn.disabled = true;
            try {
              await api.deleteWorkout(logId);
              showToast("Workout entry deleted");
              if (onChanged) await onChanged();
              renderHistory();
            } catch (err) {
              btn.disabled = false;
              showToast(err.message || "Could not delete entry", true);
            }
          });
        }
      }
    );
  };

  renderHistory();
}
