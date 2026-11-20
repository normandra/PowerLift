/**
 * PairLift PWA entry point: single-user routing, state hydration, and shell rendering.
 */

import { IS_LOCAL_MODE, api } from "./api.js";
import { cloud } from "./cloud.js";
import { localStore } from "./localStore.js";
import { openCheersModal, openLogWorkoutModal } from "./modals.js";
import { openShareModal } from "./share.js";
import { applyCompanion, applyTheme, avatarHtml, escapeHtml, fmtKg, renderThemePillGroupHtml, showToast, state } from "./state.js";

const toastedCheerIds = new Set();
let lastResumeCheckAt = 0;
import { renderAuthView } from "./views/auth.js";
import { renderPartnerView } from "./views/partner.js";
import { renderProgressView } from "./views/progress.js";
import { renderSetupView } from "./views/setup.js";
import { renderTodayView } from "./views/today.js";
import { renderWeeklyView } from "./views/weekly.js";

const BASE_TABS = [
  {
    id: "today",
    label: "Today",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>`,
  },
  {
    id: "weekly",
    label: "Weekly",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  },
  {
    id: "progress",
    label: "Charts",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  },
  {
    id: "setup",
    label: "Setup",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/></svg>`,
  },
];

const PARTNER_TAB = {
  id: "partner",
  label: "Partner",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
};

function getVisibleTabs() {
  if (IS_LOCAL_MODE && state.cloud.signedIn && state.partner.linked) {
    return [BASE_TABS[0], BASE_TABS[1], BASE_TABS[2], PARTNER_TAB, BASE_TABS[3]];
  }
  return BASE_TABS;
}

function updateTopbarCheersBadge() {
  const btn = document.getElementById("btn-topbar-cheers");
  const badge = document.getElementById("topbar-cheers-badge");
  const count = state.cheers?.unreadCount || 0;
  if (btn) btn.classList.toggle("has-unread", count > 0);
  if (badge) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.hidden = count <= 0;
  }
}

function announceNewCheers(items, { fromRealtime = false } = {}) {
  const fresh = (items || []).filter(
    (x) => x.isUnread && !toastedCheerIds.has(String(x.id))
  );
  if (!fresh.length) return;
  for (const x of fresh) toastedCheerIds.add(String(x.id));

  if (fresh.length === 1 || fromRealtime) {
    const c = fresh[0];
    const wt = c.primary_weight != null ? ` (${fmtKg(c.primary_weight)})` : "";
    showToast(`${c.emoji} ${c.reactor_name} cheered your ${c.exercise_name}${wt}`, {
      type: "cheer",
      onClick: () => actions.openCheers(),
    });
  } else {
    showToast(`🎉 ${fresh.length} new cheers from ${fresh[0].reactor_name}!`, {
      type: "cheer",
      onClick: () => actions.openCheers(),
    });
  }
}

function ensureCheersRealtime() {
  if (IS_LOCAL_MODE && state.cloud.signedIn && state.partner.linked) {
    cloud
      .subscribeIncomingReactions(async (payload) => {
        try {
          await cloud.fetchIncomingReactions();
          updateTopbarCheersBadge();
          if (state.activeTab === "today") renderCurrentTab();
          if (payload?.eventType === "INSERT") {
            announceNewCheers(state.cheers.items, { fromRealtime: true });
          }
        } catch {
          // ignore transient realtime refresh errors
        }
      })
      .catch(() => {});
  } else {
    cloud.unsubscribeIncomingReactions().catch(() => {});
  }
}

async function loadBlockData(blockId) {
  if (!blockId) {
    state.activeBlockDetail = null;
    state.cache = { dashboard: null, weekly: null, charts: null };
    return;
  }
  const [detail, dashboard, weekly, charts] = await Promise.all([
    api.getBlock(blockId),
    api.getDashboard(blockId),
    api.getWeekly(blockId, state.selectedWeek),
    api.getCharts(blockId),
  ]);
  state.activeBlockDetail = detail;
  state.cache = { dashboard, weekly, charts };
  if (state.selectedWeek === null && weekly) {
    state.selectedWeek = weekly.current_week;
  }
}

function renderShell() {
  const root = document.getElementById("app");
  if (!state.user) {
    renderAuthView(root, async (authRes) => {
      state.user = authRes.user;
      state.blocks = authRes.blocks || [];
      await actions.bootstrapAfterLogin();
    });
    return;
  }

  const blocks = state.blocks || [];
  const tabs = getVisibleTabs();
  if (!tabs.some((t) => t.id === state.activeTab)) {
    state.activeTab = "today";
  }

  const navBtnsHtml = tabs.map(
    (t) => `
      <button type="button" class="nav-btn ${state.activeTab === t.id ? "active" : ""}" data-tab="${t.id}">
        ${t.icon}
        <span>${t.label}</span>
      </button>
    `
  ).join("");

  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img src="./icons/icon.svg" alt="PairLift" />
          <span>PairLift</span>
        </div>
        <nav class="sidebar-nav">${navBtnsHtml}</nav>
        <div class="sidebar-footer">
          ${renderThemePillGroupHtml(state.theme)}
          <div class="row-inline">
            ${avatarHtml(state.user.display_name, state.user.avatar_color)}
            <div style="min-width:0;flex:1;">
              <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(state.user.display_name)}</div>
              <div class="dim small">${IS_LOCAL_MODE ? (state.cloud.signedIn ? "Cloud Synced" : "Offline Ready") : `@${escapeHtml(state.user.username)}`}</div>
            </div>
          </div>
          ${
            IS_LOCAL_MODE
              ? ""
              : `<button type="button" class="btn btn-secondary btn-sm" id="btn-logout-desktop">Sign Out</button>`
          }
        </div>
      </aside>

      <div class="main-col">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand-mini">
              <img src="./icons/icon.svg" alt="PairLift" />
              <span>PairLift</span>
            </div>
            <div class="context-switchers">
              ${
                blocks.length
                  ? `<select class="select-pill" id="sel-block" aria-label="Active block">
                      ${blocks
                        .map(
                          (b) =>
                            `<option value="${escapeHtml(b.id)}" ${String(b.id) === String(state.activeBlockId) ? "selected" : ""}>${escapeHtml(b.name)}</option>`
                        )
                        .join("")}
                    </select>`
                  : ""
              }
              ${
                IS_LOCAL_MODE && state.cloud.signedIn && state.partner.linked
                  ? `<button type="button" class="btn-icon-pill ${state.cheers.unreadCount > 0 ? "has-unread" : ""}" id="btn-topbar-cheers" aria-label="Partner cheers" title="Partner cheers">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                      <span class="cheers-badge num" id="topbar-cheers-badge" ${state.cheers.unreadCount > 0 ? "" : "hidden"}>${state.cheers.unreadCount > 9 ? "9+" : state.cheers.unreadCount}</span>
                    </button>`
                  : ""
              }
              ${
                state.activeBlockId
                  ? `<button type="button" class="btn btn-mint btn-sm" id="btn-topbar-share">Share</button>`
                  : ""
              }
              ${
                IS_LOCAL_MODE
                  ? ""
                  : `<button type="button" class="btn btn-ghost btn-sm" id="btn-logout-mobile" title="Sign Out">Sign Out</button>`
              }
            </div>
          </div>
        </header>

        <main class="content" id="view-root"></main>
      </div>

      ${
        state.activeBlockId
          ? `<button type="button" class="fab-log" id="fab-log">+ Log Lift</button>`
          : ""
      }

      <nav class="bottom-nav ${tabs.length === 5 ? "has-partner" : ""}">${navBtnsHtml}</nav>
    </div>
  `;

  for (const btn of root.querySelectorAll("[data-tab]")) {
    btn.addEventListener("click", () => {
      actions.switchTab(btn.getAttribute("data-tab"));
    });
  }

  const selBlk = root.querySelector("#sel-block");
  if (selBlk) {
    selBlk.addEventListener("change", () => actions.selectBlock(selBlk.value));
  }

  const topCheers = root.querySelector("#btn-topbar-cheers");
  if (topCheers) {
    topCheers.addEventListener("click", () => actions.openCheers());
  }

  const topShare = root.querySelector("#btn-topbar-share");
  if (topShare) {
    topShare.addEventListener("click", () => openShareModal({ mode: "summary" }));
  }

  const fab = root.querySelector("#fab-log");
  if (fab) {
    fab.addEventListener("click", () => openLogWorkoutModal(null, actions.refreshActiveBlock));
  }

  const doLogout = async () => {
    await api.logout();
    state.user = null;
    state.blocks = [];
    state.activeBlockId = null;
    state.activeBlockDetail = null;
    state.cache = { dashboard: null, weekly: null, charts: null };
    renderShell();
  };

  const dOut = root.querySelector("#btn-logout-desktop");
  const mOut = root.querySelector("#btn-logout-mobile");
  if (dOut) dOut.addEventListener("click", doLogout);
  if (mOut) mOut.addEventListener("click", doLogout);

  for (const btn of root.querySelectorAll(".sidebar [data-theme-pick]")) {
    btn.addEventListener("click", () => {
      actions.setTheme(btn.getAttribute("data-theme-pick"));
    });
  }

  renderCurrentTab();
}

function renderCurrentTab() {
  const viewRoot = document.getElementById("view-root");
  if (!viewRoot) return;
  const tabs = getVisibleTabs();
  if (!tabs.some((t) => t.id === state.activeTab)) {
    state.activeTab = "today";
  }
  for (const btn of document.querySelectorAll("[data-tab]")) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === state.activeTab);
  }
  if (state.activeTab === "today") {
    renderTodayView(viewRoot, actions);
  } else if (state.activeTab === "weekly") {
    renderWeeklyView(viewRoot, actions);
  } else if (state.activeTab === "progress") {
    renderProgressView(viewRoot, actions);
  } else if (state.activeTab === "partner") {
    renderPartnerView(viewRoot, actions);
    if (state.cloud.signedIn && state.partner.linked && !state.partner.overview && !state.partner.loading) {
      actions.refreshPartner();
    }
  } else if (state.activeTab === "setup") {
    renderSetupView(viewRoot, actions);
  }
}

const actions = {
  switchTab(tabId) {
    state.activeTab = tabId;
    window.scrollTo(0, 0);
    renderCurrentTab();
  },
  setTheme(themeId) {
    applyTheme(themeId);
    renderShell();
  },
  setCompanion(companionId) {
    const safeId = applyCompanion(companionId);
    if (IS_LOCAL_MODE && state.user) {
      localStore.updateProfile({ companion: safeId }).catch(() => {});
    }
    renderShell();
  },
  async signInWithGoogle() {
    await cloud.signInWithGoogle();
  },
  async syncCloudNow() {
    try {
      await cloud.syncNow({ silent: false });
      await actions.refreshAllBlocks();
      if (state.partner.linked) {
        await cloud.fetchPartnerOverview().catch(() => {});
        await cloud.fetchIncomingReactions().catch(() => {});
      }
      ensureCheersRealtime();
      renderShell();
      announceNewCheers(state.cheers.items);
      showToast("Synced with Google Cloud backup!");
    } catch (err) {
      showToast(err.message || "Sync failed", true);
    }
  },
  async signOutCloud() {
    await cloud.signOut();
    if (state.activeTab === "partner") state.activeTab = "today";
    showToast("Signed out (local data kept on this device)");
    renderShell();
  },
  openCheers() {
    openCheersModal(actions);
  },
  markCheersSeen() {
    cloud.markAllCheersSeen();
    updateTopbarCheersBadge();
    if (state.activeTab === "today") renderCurrentTab();
  },
  async refreshCheers() {
    await cloud.fetchIncomingReactions();
    updateTopbarCheersBadge();
    if (state.activeTab === "today") renderCurrentTab();
  },
  async refreshPartner() {
    if (!state.cloud.signedIn || !state.partner.linked) return;
    state.partner.loading = true;
    renderCurrentTab();
    try {
      await cloud.fetchPartnerOverview();
    } catch (err) {
      showToast(err.message || "Could not refresh partner", true);
    } finally {
      state.partner.loading = false;
      renderCurrentTab();
    }
  },
  async generatePartnerInvite() {
    try {
      await cloud.createInviteCode();
      showToast("Invite code ready!");
      renderCurrentTab();
    } catch (err) {
      showToast(err.message || "Could not generate invite code", true);
    }
  },
  async claimPartnerInvite(code) {
    try {
      const p = await cloud.claimInviteCode(code);
      ensureCheersRealtime();
      showToast(`Linked with ${p?.display_name || "Partner"}!`);
      renderShell();
    } catch (err) {
      showToast(err.message || "Could not link partner", true);
    }
  },
  async unlinkPartner() {
    try {
      await cloud.unlinkPartner();
      if (state.activeTab === "partner") state.activeTab = "today";
      showToast("Partner unlinked");
      renderShell();
    } catch (err) {
      showToast(err.message || "Could not unlink partner", true);
    }
  },
  async togglePartnerReaction(workoutLogId, logOwnerId, emoji, currentlyReacted) {
    await cloud.toggleReaction(workoutLogId, logOwnerId, emoji, currentlyReacted);
  },
  refreshShell() {
    renderShell();
  },
  renderCurrentTab,
  async selectBlock(blockId) {
    state.blocks = await api.listBlocks();
    state.activeBlockId = blockId;
    state.selectedWeek = null;
    localStorage.setItem("pairlift_block_id", String(blockId));
    await loadBlockData(blockId);
    renderShell();
  },
  async selectWeek(weekNum) {
    state.selectedWeek = weekNum;
    if (state.activeBlockId) {
      state.cache.weekly = await api.getWeekly(state.activeBlockId, weekNum);
      renderCurrentTab();
    }
  },
  async refreshActiveBlock() {
    if (state.activeBlockId) {
      await loadBlockData(state.activeBlockId);
      renderCurrentTab();
    }
  },
  async refreshAllBlocks() {
    state.blocks = await api.listBlocks();
    if (!state.blocks.some((b) => String(b.id) === String(state.activeBlockId))) {
      const active = state.blocks.find((b) => b.status === "active") || state.blocks[0] || null;
      state.activeBlockId = active ? active.id : null;
      state.selectedWeek = null;
    }
    if (state.activeBlockId) {
      localStorage.setItem("pairlift_block_id", String(state.activeBlockId));
    } else {
      localStorage.removeItem("pairlift_block_id");
    }
    await loadBlockData(state.activeBlockId);
    renderShell();
  },
  async bootstrapAfterLogin() {
    state.blocks = await api.listBlocks();
    if (!state.planPresets.length) {
      state.planPresets = await api.planPresets();
    }
    if (!state.blocks.some((b) => String(b.id) === String(state.activeBlockId))) {
      const active = state.blocks.find((b) => b.status === "active") || state.blocks[0] || null;
      state.activeBlockId = active ? active.id : null;
      state.selectedWeek = null;
    }
    if (state.activeBlockId) {
      localStorage.setItem("pairlift_block_id", String(state.activeBlockId));
      await loadBlockData(state.activeBlockId);
    } else {
      localStorage.removeItem("pairlift_block_id");
      await loadBlockData(null);
    }
    renderShell();
  },
};

async function init() {
  applyTheme(state.theme);
  if (IS_LOCAL_MODE) {
    localStore.setMutationListener((evt) => cloud.handleLocalMutation(evt));
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  }
  try {
    state.planPresets = await api.planPresets().catch(() => []);
  } catch {
    // ignore
  }

  if (IS_LOCAL_MODE) {
    const { session, justSignedIn } = await cloud.initSession(async (event, nextSession) => {
      if (event === "SIGNED_IN" && nextSession) {
        try {
          await cloud.syncNow({ silent: true });
          const meRes = await api.me();
          state.user = meRes.user;
          state.blocks = meRes.blocks || [];
          await actions.bootstrapAfterLogin();
          if (state.partner.linked) {
            ensureCheersRealtime();
            announceNewCheers(state.cheers.items);
            cloud.fetchPartnerOverview().then(() => renderShell()).catch(() => {});
          }
        } catch {
          renderShell();
        }
      } else if (event === "SIGNED_OUT") {
        cloud.unsubscribeIncomingReactions().catch(() => {});
        renderShell();
      }
    });

    if (session) {
      try {
        await cloud.syncNow({ silent: !justSignedIn });
        if (justSignedIn) {
          showToast("Signed in with Google & backed up data!");
        }
      } catch (err) {
        if (justSignedIn) {
          showToast(err.message || "Signed in, sync pending", true);
        }
      }
    }
  }

  try {
    const meRes = await api.me();
    state.user = meRes.user;
    state.blocks = meRes.blocks || [];
    await actions.bootstrapAfterLogin();
    if (IS_LOCAL_MODE && state.cloud.signedIn && state.partner.linked) {
      ensureCheersRealtime();
      announceNewCheers(state.cheers.items);
      cloud.fetchPartnerOverview().then(() => {
        if (state.activeTab === "partner") renderCurrentTab();
      }).catch(() => {});
    }
  } catch {
    renderShell();
  }

  if (IS_LOCAL_MODE && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      if (!state.cloud.signedIn || !state.partner.linked) return;
      const now = Date.now();
      if (now - lastResumeCheckAt < 10000) return;
      lastResumeCheckAt = now;
      try {
        await cloud.fetchIncomingReactions();
        updateTopbarCheersBadge();
        if (state.activeTab === "today") renderCurrentTab();
        announceNewCheers(state.cheers.items);
      } catch {
        // ignore resume refresh failure
      }
    });
  }
}

init();
