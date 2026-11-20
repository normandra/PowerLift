/**
 * Setup view: Appearance themes, Profile & Data Backup (local mode), Training Blocks, and Plan Builder.
 */

import { IS_LOCAL_MODE, api } from "../api.js";
import { openCreateBlockModal } from "../modals.js";
import { THEMES, avatarHtml, escapeHtml, fmtKg, renderCompanionPickerCardsHtml, showToast, state, todayIso } from "../state.js";

const GOOGLE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#34A853" d="M12 24c2.75 0 5.06-.91 6.75-2.46l-3.3-2.56c-.91.61-2.08.97-3.45.97-2.65 0-4.9-1.79-5.7-4.2H2.51v2.64A12 12 0 0 0 12 24z"/><path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.46a5.52 5.52 0 0 1-2.4 3.63l3.3 2.56c1.93-1.78 3.14-4.41 3.14-8.22z"/><path fill="#FBBC05" d="M5.92 14.35a7.2 7.2 0 0 1 0-4.7V7.01H2.51a12 12 0 0 0 0 9.98l3.41-2.64z"/><path fill="#EA4335" d="M12 4.75c1.5 0 2.84.52 3.9 1.52l2.92-2.92C17.05 1.7 14.74.75 12 .75A12 12 0 0 0 2.51 7.01l3.41 2.64C6.72 7.24 9.15 4.75 12 4.75z"/></svg>`;

function defaultWeightsForSlug(slug) {
  if (slug === "squat") return { start: 60, goal: 120, inc: 2.5 };
  if (slug === "bench") return { start: 50, goal: 100, inc: 2.5 };
  if (slug === "deadlift") return { start: 80, goal: 160, inc: 2.5 };
  if (slug === "ohp") return { start: 30, goal: 60, inc: 1.25 };
  if (slug === "pullup") return { start: 10, goal: 25, inc: 1.25 };
  if (slug === "row") return { start: 40, goal: 70, inc: 1.25 };
  return { start: 40, goal: 80, inc: 2.5 };
}

export function renderSetupView(containerEl, actions) {
  const blkDetail = state.activeBlockDetail;
  const presets = state.planPresets || [];
  const blocks = state.blocks || [];

  const myPlan = blkDetail?.plan || null;
  const exercises = blkDetail?.exercises || [];

  const appearanceSection = `
    <section class="card" style="display:flex;flex-direction:column;gap:10px;">
      <div class="row-between">
        <h3 class="section-title" style="margin:0;">Appearance</h3>
        <span class="small muted">Saved to this device</span>
      </div>
      <div class="theme-picker" role="radiogroup" aria-label="Color theme">
        ${THEMES.map(
          (t) => `
            <button type="button" class="theme-card ${state.theme === t.id ? "active" : ""}" data-theme-pick="${escapeHtml(t.id)}" role="radio" aria-checked="${state.theme === t.id}">
              <span class="theme-dots">
                <span class="theme-dot" style="background:${escapeHtml(t.primary)};"></span>
                <span class="theme-dot" style="background:${escapeHtml(t.secondary)};"></span>
              </span>
              <span style="font-weight:700;font-size:13.5px;">${escapeHtml(t.label)}</span>
            </button>
          `
        ).join("")}
      </div>
      <div style="margin-top:4px;">
        <div class="row-between" style="margin-bottom:8px;">
          <span style="font-weight:700;font-size:13.5px;">Lifting Companion</span>
          <span class="small muted">Cute guide on Squat, Bench &amp; Deadlift</span>
        </div>
        ${renderCompanionPickerCardsHtml(state.companion)}
      </div>
    </section>
  `;

  const cloudStatusBadge = state.cloud.syncing
    ? `<span class="badge badge-plan">Syncing…</span>`
    : state.cloud.signedIn
    ? `<span class="badge badge-hit">Cloud Synced</span>`
    : `<span class="badge badge-waiting">Offline Only</span>`;

  const syncTimeLabel = state.cloud.lastSyncedAt
    ? `Last synced ${new Date(state.cloud.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Auto-syncs every workout & edit";

  const cloudAccountSection = IS_LOCAL_MODE
    ? `
      <section class="card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="row-between" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">Cloud Account &amp; Backup</h3>
            <div class="small muted">${
              state.cloud.signedIn
                ? `${escapeHtml(state.cloud.email || "Google Account")} · ${escapeHtml(syncTimeLabel)}`
                : "Sign in with Google to back up local data, sync across devices &amp; link a partner"
            }</div>
          </div>
          ${cloudStatusBadge}
        </div>
        ${
          state.cloud.signedIn
            ? `
              <div class="row-inline" style="flex-wrap:wrap;">
                <button type="button" class="btn btn-mint btn-sm" id="s-sync-now" ${state.cloud.syncing ? "disabled" : ""}>${state.cloud.syncing ? "Syncing…" : "Sync Now"}</button>
                <button type="button" class="btn btn-ghost btn-sm" id="s-cloud-signout">Sign Out</button>
              </div>
            `
            : `
              <div>
                <button type="button" class="btn btn-google btn-sm" id="s-google-signin">
                  ${GOOGLE_ICON_SVG}
                  <span>Sign in with Google</span>
                </button>
              </div>
            `
        }
      </section>
    `
    : "";

  const partnerLinkSection =
    IS_LOCAL_MODE && state.cloud.signedIn
      ? `
      <section class="card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="row-between" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">Partner Link</h3>
            <div class="small muted">${
              state.partner.linked
                ? "Unlocks the Partner tab to view their charts &amp; react to lifts"
                : "Link 1:1 with your partner to compare progress &amp; cheer on lifts"
            }</div>
          </div>
          <span class="badge ${state.partner.linked ? "badge-hit" : "badge-waiting"}">
            ${state.partner.linked ? "Linked" : "Not Linked"}
          </span>
        </div>

        ${
          state.partner.linked && state.partner.profile
            ? `
              <div class="card-subtle row-between" style="flex-wrap:wrap;gap:10px;">
                <div class="row-inline">
                  ${avatarHtml(state.partner.profile.display_name, state.partner.profile.avatar_color)}
                  <div>
                    <strong>${escapeHtml(state.partner.profile.display_name)}</strong>
                    <div class="small muted">Open the Partner tab to view charts &amp; recent lifts</div>
                  </div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm" id="s-unlink-partner" style="color:var(--crimson);">Unlink</button>
              </div>
            `
            : `
              <div class="grid-2">
                <div class="invite-box">
                  <div class="small muted"><strong>Share your invite code</strong></div>
                  ${
                    state.partner.inviteCode
                      ? `
                        <div class="row-between">
                          <span class="code-chip">${escapeHtml(state.partner.inviteCode)}</span>
                          <button type="button" class="btn btn-secondary btn-sm" id="s-copy-invite">Copy</button>
                        </div>
                        <div class="dim small">Ask your partner to enter this code in their Setup tab.</div>
                      `
                      : `
                        <button type="button" class="btn btn-mint btn-sm" id="s-gen-invite">Generate Invite Code</button>
                        <div class="dim small">Creates a 6-character code valid for 7 days.</div>
                      `
                  }
                </div>

                <form id="s-claim-invite-form" class="card-subtle" style="display:flex;flex-direction:column;gap:8px;">
                  <label for="s-invite-input" class="small muted"><strong>Have your partner's code?</strong></label>
                  <div class="row-inline">
                    <input id="s-invite-input" type="text" placeholder="e.g. A7K9P2" maxlength="10" style="text-transform:uppercase;letter-spacing:0.08em;" required />
                    <button type="submit" class="btn btn-primary btn-sm" style="white-space:nowrap;">Link</button>
                  </div>
                </form>
              </div>
            `
        }
      </section>
    `
      : "";

  const backupSection = IS_LOCAL_MODE
    ? `
      <section class="card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="row-between" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">Profile & Data Backup</h3>
            <div class="small muted">Stored locally in your browser · UUID-ready for future cloud sync</div>
          </div>
          <span class="badge badge-on_pace">Offline Ready</span>
        </div>

        <form id="local-profile-form" class="row-inline">
          <input id="lp-name" type="text" value="${escapeHtml(state.user?.display_name || "")}" placeholder="Display Name" maxlength="40" required />
          <button type="submit" class="btn btn-secondary btn-sm" style="white-space:nowrap;">Save Name</button>
        </form>

        <div class="row-inline" style="flex-wrap:wrap;">
          <button type="button" class="btn btn-mint btn-sm" id="s-export-backup">Export Backup (.json)</button>
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;">
            Import Backup (.json)
            <input type="file" id="s-import-backup" accept=".json,application/json" hidden />
          </label>
          <button type="button" class="btn btn-secondary btn-sm" id="s-load-sample">Load Sample Block</button>
          <button type="button" class="btn btn-ghost btn-sm" id="s-reset-data" style="color:var(--crimson);">Reset Data</button>
        </div>
      </section>
    `
    : "";

  const blocksSection = `
    <section class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between">
        <h3 class="section-title" style="margin:0;">Training Blocks</h3>
        <button class="btn btn-primary btn-sm" id="s-create-blk">+ New Block</button>
      </div>
      ${
        blocks.length
          ? `<div style="display:flex;flex-direction:column;gap:8px;">
              ${blocks
                .map(
                  (b) => `
                  <div class="card-subtle row-between" style="flex-wrap:wrap;gap:8px;${String(b.id) === String(state.activeBlockId) ? "border-color:var(--coral);" : ""}">
                    <div>
                      <strong>${escapeHtml(b.name)}</strong>
                      <div class="small muted num">${escapeHtml(b.start_date)} · ${Math.round(b.duration_days / 7)} weeks · ${b.exercise_count} lifts</div>
                    </div>
                    <div class="row-inline">
                      <span class="badge ${b.status === "active" ? "badge-on_pace" : "badge-waiting"}">${escapeHtml(b.status)}</span>
                      ${
                        String(b.id) !== String(state.activeBlockId)
                          ? `<button class="btn btn-secondary btn-sm" data-pick-block="${escapeHtml(b.id)}">Open</button>`
                          : `<span class="small muted">Active</span>`
                      }
                      <button class="btn btn-ghost btn-sm" data-toggle-archive="${escapeHtml(b.id)}" data-status="${escapeHtml(b.status)}">
                        ${b.status === "active" ? "Archive" : "Restore"}
                      </button>
                    </div>
                  </div>
                `
                )
                .join("")}
            </div>`
          : `<div class="muted small">No training blocks yet. Create one to begin!</div>`
      }
    </section>
  `;

  let selectedPlanType = myPlan?.plan_type || "linear";
  const targetByExId = new Map((myPlan?.targets || []).map((t) => [String(t.block_exercise_id), t]));

  const planSection = blkDetail
    ? `
      <section class="card" style="display:flex;flex-direction:column;gap:14px;">
        <div class="row-between" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">Training Plan — ${escapeHtml(blkDetail.block.name)}</h3>
            <div class="small muted">Configure your progression model and daily targets for each lift.</div>
          </div>
        </div>

        <form id="plan-form" style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-field">
            <label for="pf-plan-type">Training Setup / Preset</label>
            <select id="pf-plan-type">
              ${presets
                .map(
                  (p) =>
                    `<option value="${escapeHtml(p.id)}" ${p.id === selectedPlanType ? "selected" : ""}>${escapeHtml(p.title)}</option>`
                )
                .join("")}
            </select>
            <div id="pf-plan-desc" class="small muted"></div>
          </div>

          ${
            blkDetail.block.track_bodyweight
              ? `
                <div class="card-subtle" style="display:flex;flex-direction:column;gap:8px;">
                  <div style="font-weight:700;font-size:13.5px;">Bodyweight Target Curve (0.1 kg daily target)</div>
                  <div class="grid-2">
                    <div class="form-field">
                      <label for="pf-bw-start">Start BW (kg)</label>
                      <input id="pf-bw-start" type="number" step="0.1" value="${escapeHtml(myPlan?.bodyweight_start ?? "")}" placeholder="e.g. 68.4" />
                    </div>
                    <div class="form-field">
                      <label for="pf-bw-goal">Goal BW (kg)</label>
                      <input id="pf-bw-goal" type="number" step="0.1" value="${escapeHtml(myPlan?.bodyweight_goal ?? "")}" placeholder="e.g. 66.0" />
                    </div>
                  </div>
                </div>
              `
              : ""
          }

          <div id="pf-exercises" style="display:flex;flex-direction:column;gap:10px;">
            ${exercises
              .map((ex) => {
                const existing = targetByExId.get(String(ex.id));
                const defs = defaultWeightsForSlug(ex.slug);
                const sw = existing ? existing.start_weight : defs.start;
                const gw = existing ? existing.goal_weight : defs.goal;
                const inc = existing ? existing.increment : ex.default_increment || defs.inc;
                const metric = existing ? existing.target_metric : "working_weight";
                const exPlan = existing ? existing.plan_type : selectedPlanType;
                const cfg = existing?.config || {};
                return `
                  <div class="card-subtle" data-ex-target="${escapeHtml(ex.id)}" style="display:flex;flex-direction:column;gap:10px;">
                    <div class="row-between" style="flex-wrap:wrap;gap:8px;">
                      <strong>${escapeHtml(ex.name)}</strong>
                      <div class="row-inline">
                        <select data-field="plan_type" style="width:auto;padding:5px 8px;font-size:12.5px;">
                          ${presets
                            .map(
                              (p) =>
                                `<option value="${escapeHtml(p.id)}" ${p.id === exPlan ? "selected" : ""}>${escapeHtml(p.title)}</option>`
                            )
                            .join("")}
                        </select>
                        <select data-field="target_metric" style="width:auto;padding:5px 8px;font-size:12.5px;">
                          <option value="working_weight" ${metric === "working_weight" ? "selected" : ""}>Target Working Wt</option>
                          <option value="one_rm" ${metric === "one_rm" ? "selected" : ""}>Target 1RM</option>
                        </select>
                      </div>
                    </div>

                    <div class="grid-3">
                      <div class="form-field">
                        <label>Start (kg)</label>
                        <input type="number" step="0.25" min="0" data-field="start_weight" value="${escapeHtml(sw)}" required />
                      </div>
                      <div class="form-field">
                        <label>Goal (kg)</label>
                        <input type="number" step="0.25" min="0" data-field="goal_weight" value="${escapeHtml(gw)}" required />
                      </div>
                      <div class="form-field">
                        <label>Rounding (kg)</label>
                        <input type="number" step="0.25" min="0.1" data-field="increment" value="${escapeHtml(inc)}" required />
                      </div>
                    </div>

                    <div class="grid-2" data-extra-fields>
                      <div class="form-field" data-only="531" ${exPlan === "531" ? "" : "hidden"}>
                        <label>Training Max (kg, optional)</label>
                        <input type="number" step="0.5" data-field="training_max" value="${escapeHtml(cfg.training_max ?? "")}" placeholder="Auto 90% of start" />
                      </div>
                      <div class="form-field" data-only="531" ${exPlan === "531" ? "" : "hidden"}>
                        <label>Cycle Bump / 4 wks (kg)</label>
                        <input type="number" step="0.5" data-field="cycle_increment" value="${escapeHtml(cfg.cycle_increment ?? 2.5)}" />
                      </div>
                      <div class="form-field" data-only="1rm_everyday" ${exPlan === "1rm_everyday" ? "" : "hidden"}>
                        <label>Daily Min Start (kg)</label>
                        <input type="number" step="0.5" data-field="daily_min_start" value="${escapeHtml(cfg.daily_min_start ?? "")}" placeholder="Auto 85%" />
                      </div>
                      <div class="form-field" data-only="1rm_everyday" ${exPlan === "1rm_everyday" ? "" : "hidden"}>
                        <label>Daily Min Goal (kg)</label>
                        <input type="number" step="0.5" data-field="daily_min_goal" value="${escapeHtml(cfg.daily_min_goal ?? "")}" placeholder="Auto 90%" />
                      </div>
                      <div class="form-field" data-only="gzclp" ${exPlan === "gzclp" ? "" : "hidden"}>
                        <label>Weekly Step (kg)</label>
                        <input type="number" step="0.5" data-field="weekly_increment" value="${escapeHtml(cfg.weekly_increment ?? inc)}" />
                      </div>
                      <div class="form-field" data-only="gzclp" ${exPlan === "gzclp" ? "" : "hidden"}>
                        <label>Rep Scheme</label>
                        <input type="text" data-field="rep_scheme" value="${escapeHtml(cfg.rep_scheme ?? "5×3+")}" />
                      </div>
                      <div class="form-field" data-only="custom" style="grid-column:1 / -1;" ${exPlan === "custom" ? "" : "hidden"}>
                        <label>Weekly Targets (comma-separated kg, e.g. 50, 52.5, 55, 60)</label>
                        <input type="text" data-field="weekly_targets" value="${escapeHtml((cfg.weekly_targets || []).join(", "))}" />
                      </div>
                    </div>

                    <div class="row-between small">
                      <span class="muted" data-preview-out></span>
                      <button type="button" class="btn btn-ghost btn-sm" data-preview-ex="${escapeHtml(ex.id)}">Preview Targets</button>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>

          <button type="submit" class="btn btn-primary btn-block">Save Plan & Targets</button>
        </form>
      </section>
    `
    : "";

  containerEl.innerHTML = `
    ${appearanceSection}
    ${cloudAccountSection}
    ${partnerLinkSection}
    ${backupSection}
    ${blocksSection}
    ${planSection}
  `;

  for (const btn of containerEl.querySelectorAll("[data-theme-pick]")) {
    btn.addEventListener("click", () => {
      actions.setTheme(btn.getAttribute("data-theme-pick"));
    });
  }

  for (const btn of containerEl.querySelectorAll("[data-companion-pick]")) {
    btn.addEventListener("click", () => {
      actions.setCompanion(btn.getAttribute("data-companion-pick"));
    });
  }

  if (IS_LOCAL_MODE) {
    const sGoogleBtn = containerEl.querySelector("#s-google-signin");
    if (sGoogleBtn) {
      sGoogleBtn.addEventListener("click", async () => {
        sGoogleBtn.disabled = true;
        sGoogleBtn.querySelector("span").textContent = "Redirecting…";
        try {
          await actions.signInWithGoogle();
        } catch (err) {
          sGoogleBtn.disabled = false;
          sGoogleBtn.querySelector("span").textContent = "Sign in with Google";
          showToast(err.message || "Google sign-in failed", true);
        }
      });
    }

    const sSyncBtn = containerEl.querySelector("#s-sync-now");
    if (sSyncBtn) {
      sSyncBtn.addEventListener("click", actions.syncCloudNow);
    }

    const sSignOutBtn = containerEl.querySelector("#s-cloud-signout");
    if (sSignOutBtn) {
      sSignOutBtn.addEventListener("click", actions.signOutCloud);
    }

    const sGenInv = containerEl.querySelector("#s-gen-invite");
    if (sGenInv) {
      sGenInv.addEventListener("click", actions.generatePartnerInvite);
    }

    const sCopyInv = containerEl.querySelector("#s-copy-invite");
    if (sCopyInv) {
      sCopyInv.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(state.partner.inviteCode || "");
          showToast("Invite code copied!");
        } catch {
          showToast(`Invite code: ${state.partner.inviteCode}`);
        }
      });
    }

    const sClaimForm = containerEl.querySelector("#s-claim-invite-form");
    if (sClaimForm) {
      sClaimForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = containerEl.querySelector("#s-invite-input").value.trim();
        if (!code) return;
        await actions.claimPartnerInvite(code);
      });
    }

    const sUnlink = containerEl.querySelector("#s-unlink-partner");
    if (sUnlink) {
      sUnlink.addEventListener("click", async () => {
        if (!window.confirm("Unlink from your partner? Your own workout data stays intact.")) return;
        await actions.unlinkPartner();
      });
    }

    containerEl.querySelector("#local-profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = containerEl.querySelector("#lp-name").value.trim();
      if (!name) return;
      try {
        const res = await api.updateProfile({ display_name: name });
        state.user = res.user;
        showToast("Display name updated!");
        actions.refreshShell();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    containerEl.querySelector("#s-export-backup").addEventListener("click", async () => {
      try {
        const data = await api.exportBackup();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pairlift-backup-${todayIso()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Backup exported!");
      } catch (err) {
        showToast(err.message, true);
      }
    });

    containerEl.querySelector("#s-import-backup").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await api.importBackup(JSON.parse(text));
        state.user = res.user;
        state.blocks = res.blocks;
        state.activeBlockId = null;
        showToast("Backup restored!");
        await actions.bootstrapAfterLogin();
      } catch (err) {
        showToast(err.message || "Invalid backup file", true);
      }
    });

    containerEl.querySelector("#s-load-sample").addEventListener("click", async () => {
      try {
        const res = await api.demoLogin({ display_name: state.user?.display_name });
        state.user = res.user;
        state.blocks = res.blocks;
        showToast("Sample block ready!");
        await actions.refreshAllBlocks();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    containerEl.querySelector("#s-reset-data").addEventListener("click", async () => {
      if (!window.confirm("Erase all local PairLift blocks and workout logs on this device?")) return;
      await api.resetLocalData();
      state.user = null;
      state.blocks = [];
      state.activeBlockId = null;
      state.activeBlockDetail = null;
      state.cache = { dashboard: null, weekly: null, charts: null };
      showToast("Local data cleared");
      actions.refreshShell();
    });
  }

  containerEl.querySelector("#s-create-blk").addEventListener("click", () => openCreateBlockModal(actions.selectBlock));

  for (const btn of containerEl.querySelectorAll("[data-pick-block]")) {
    btn.addEventListener("click", () => actions.selectBlock(btn.getAttribute("data-pick-block")));
  }

  for (const btn of containerEl.querySelectorAll("[data-toggle-archive]")) {
    btn.addEventListener("click", async () => {
      const bid = btn.getAttribute("data-toggle-archive");
      const curStatus = btn.getAttribute("data-status");
      const nextStatus = curStatus === "active" ? "archived" : "active";
      try {
        await api.updateBlock(bid, { status: nextStatus });
        showToast(nextStatus === "archived" ? "Block archived" : "Block restored");
        await actions.refreshAllBlocks();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  const planForm = containerEl.querySelector("#plan-form");
  if (planForm) {
    const masterSelect = planForm.querySelector("#pf-plan-type");
    const descEl = planForm.querySelector("#pf-plan-desc");
    const updateDesc = () => {
      const p = presets.find((x) => x.id === masterSelect.value);
      descEl.textContent = p ? p.short_summary : "";
    };
    updateDesc();

    const syncExtraFields = (cardEl, ptype) => {
      for (const el of cardEl.querySelectorAll("[data-only]")) {
        el.hidden = el.getAttribute("data-only") !== ptype;
      }
    };

    masterSelect.addEventListener("change", () => {
      updateDesc();
      const newType = masterSelect.value;
      const preset = presets.find((x) => x.id === newType);
      for (const cardEl of planForm.querySelectorAll("[data-ex-target]")) {
        const pSel = cardEl.querySelector('[data-field="plan_type"]');
        pSel.value = newType;
        if (preset?.default_metric) {
          cardEl.querySelector('[data-field="target_metric"]').value = preset.default_metric;
        }
        syncExtraFields(cardEl, newType);
      }
    });

    const readCardPayload = (cardEl) => {
      const ptype = cardEl.querySelector('[data-field="plan_type"]').value;
      const cfg = {};
      if (ptype === "531") {
        const tm = cardEl.querySelector('[data-field="training_max"]').value;
        const ci = cardEl.querySelector('[data-field="cycle_increment"]').value;
        if (tm !== "") cfg.training_max = Number(tm);
        if (ci !== "") cfg.cycle_increment = Number(ci);
      } else if (ptype === "1rm_everyday") {
        const ms = cardEl.querySelector('[data-field="daily_min_start"]').value;
        const mg = cardEl.querySelector('[data-field="daily_min_goal"]').value;
        if (ms !== "") cfg.daily_min_start = Number(ms);
        if (mg !== "") cfg.daily_min_goal = Number(mg);
      } else if (ptype === "gzclp") {
        const wi = cardEl.querySelector('[data-field="weekly_increment"]').value;
        const rs = cardEl.querySelector('[data-field="rep_scheme"]').value.trim();
        if (wi !== "") cfg.weekly_increment = Number(wi);
        if (rs) cfg.rep_scheme = rs;
      } else if (ptype === "custom") {
        const raw = cardEl.querySelector('[data-field="weekly_targets"]').value;
        const nums = raw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n) && n > 0);
        if (nums.length) cfg.weekly_targets = nums;
      }
      return {
        block_exercise_id: String(cardEl.getAttribute("data-ex-target")),
        plan_type: ptype,
        target_metric: cardEl.querySelector('[data-field="target_metric"]').value,
        start_weight: Number(cardEl.querySelector('[data-field="start_weight"]').value),
        goal_weight: Number(cardEl.querySelector('[data-field="goal_weight"]').value),
        increment: Number(cardEl.querySelector('[data-field="increment"]').value),
        config: cfg,
      };
    };

    for (const cardEl of planForm.querySelectorAll("[data-ex-target]")) {
      const exSel = cardEl.querySelector('[data-field="plan_type"]');
      exSel.addEventListener("change", () => syncExtraFields(cardEl, exSel.value));

      const prevBtn = cardEl.querySelector("[data-preview-ex]");
      const prevOut = cardEl.querySelector("[data-preview-out]");
      prevBtn.addEventListener("click", async () => {
        try {
          const item = readCardPayload(cardEl);
          const res = await api.previewPlan(blkDetail.block.id, item);
          prevOut.innerHTML = `D1: <strong>${escapeHtml(res.day_1?.prescription)}</strong> · Mid: <strong>${escapeHtml(fmtKg(res.midpoint?.target))}</strong> · End: <strong>${escapeHtml(fmtKg(res.final?.target))}</strong>`;
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    planForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targets = Array.from(planForm.querySelectorAll("[data-ex-target]"), readCardPayload);
      const bwStartEl = planForm.querySelector("#pf-bw-start");
      const bwGoalEl = planForm.querySelector("#pf-bw-goal");

      try {
        await api.saveMyPlan(blkDetail.block.id, {
          plan_type: masterSelect.value,
          bodyweight_start: bwStartEl && bwStartEl.value !== "" ? Number(bwStartEl.value) : null,
          bodyweight_goal: bwGoalEl && bwGoalEl.value !== "" ? Number(bwGoalEl.value) : null,
          targets,
        });
        showToast("Training plan saved!");
        await actions.refreshActiveBlock();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }
}
