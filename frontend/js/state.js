/**
 * Shared client state, theme switching, XSS escaping, formatting, and toast notifications.
 */

export const THEMES = [
  { id: "default", label: "Coral Dark", primary: "#FF6B57", secondary: "#2DD4BF", metaColor: "#111318" },
  { id: "blue", label: "Blue", primary: "#3B82F6", secondary: "#38BDF8", metaColor: "#070D19" },
  { id: "pink", label: "Pink", primary: "#F472B6", secondary: "#F9A8D4", metaColor: "#140912" },
];

export const COMPANIONS = [
  { id: "cat", label: "Cat", preview: "./assets/companions/cat-squat.gif" },
  { id: "dog", label: "Dog", preview: "./assets/companions/dog-squat.gif" },
  { id: "gorilla", label: "Gorilla", preview: "./assets/companions/gorilla-squat.gif" },
];

export const REACTION_EMOJIS = ["🔥", "💪", "👏", "🏆", "❤️"];

const VALID_THEME_IDS = new Set(THEMES.map((t) => t.id));
const VALID_COMPANION_IDS = new Set(COMPANIONS.map((c) => c.id));
const initialTheme = localStorage.getItem("pairlift_theme");
const initialCompanion = localStorage.getItem("pairlift_companion");

export const state = {
  user: null,
  blocks: [],
  activeBlockId: localStorage.getItem("pairlift_block_id") || null,
  activeBlockDetail: null,
  activeTab: "today",
  theme: VALID_THEME_IDS.has(initialTheme) ? initialTheme : "default",
  companion: VALID_COMPANION_IDS.has(initialCompanion) ? initialCompanion : "cat",
  selectedWeek: null,
  selectedChartSlug: null,
  showOneRmOverlay: true,
  planPresets: [],
  cloud: {
    available: true,
    signedIn: false,
    email: null,
    authUserId: null,
    syncing: false,
    lastSyncedAt: null,
    error: null,
  },
  partner: {
    linked: false,
    profile: null,
    inviteCode: null,
    inviteExpiresAt: null,
    overview: null,
    selectedChartSlug: null,
    showOneRmOverlay: true,
    recentLimit: 3,
    loading: false,
  },
  cheers: {
    items: [],
    unreadCount: 0,
    loading: false,
  },
  cache: {
    dashboard: null,
    weekly: null,
    charts: null,
  },
};

export function applyCompanion(companionId) {
  const safeId = VALID_COMPANION_IDS.has(companionId) ? companionId : "cat";
  state.companion = safeId;
  localStorage.setItem("pairlift_companion", safeId);
  return safeId;
}

export function canonicalLiftKey(slugOrName) {
  const s = String(slugOrName || "").trim().toLowerCase();
  if (s.includes("squat")) return "squat";
  if (s.includes("bench")) return "bench";
  if (s.includes("deadlift")) return "deadlift";
  return null;
}

export function companionImageSrc(slugOrName, companionId = state.companion, animated = true) {
  const liftKey = canonicalLiftKey(slugOrName);
  if (!liftKey) return null;
  const safeId = VALID_COMPANION_IDS.has(companionId) ? companionId : "cat";
  const ext = animated ? "gif" : "png";
  return `./assets/companions/${safeId}-${liftKey}.${ext}`;
}

export function companionArtHtml(slugOrName, size = "lg", companionId = state.companion) {
  const src = companionImageSrc(slugOrName, companionId, true);
  if (!src) return "";
  const compObj = COMPANIONS.find((c) => c.id === (VALID_COMPANION_IDS.has(companionId) ? companionId : "cat"));
  const liftKey = canonicalLiftKey(slugOrName);
  const alt = `${compObj ? compObj.label : "Cat"} ${liftKey || ""}`.trim();
  return `<img class="companion-art companion-art-${escapeHtml(size)}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

export function renderCompanionPickerCardsHtml(activeCompanionId = state.companion) {
  const active = VALID_COMPANION_IDS.has(activeCompanionId) ? activeCompanionId : "cat";
  return `
    <div class="companion-picker" role="radiogroup" aria-label="Lifting companion">
      ${COMPANIONS.map(
        (c) => `
          <button type="button" class="companion-card ${c.id === active ? "active" : ""}" data-companion-pick="${escapeHtml(c.id)}" role="radio" aria-checked="${c.id === active}">
            <img src="${escapeHtml(c.preview)}" alt="${escapeHtml(c.label)}" />
            <span style="font-weight:700;font-size:13.5px;">${escapeHtml(c.label)}</span>
          </button>
        `
      ).join("")}
    </div>
  `;
}

export function applyTheme(themeId) {
  const safeId = VALID_THEME_IDS.has(themeId) ? themeId : "default";
  state.theme = safeId;
  localStorage.setItem("pairlift_theme", safeId);
  if (safeId === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = safeId;
  }
  const themeObj = THEMES.find((t) => t.id === safeId);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && themeObj) {
    meta.setAttribute("content", themeObj.metaColor);
  }
  return safeId;
}

export function renderThemePillGroupHtml(activeThemeId = state.theme) {
  return `
    <div class="theme-pill-group" role="group" aria-label="Theme">
      ${THEMES.map(
        (t) => `
          <button type="button" class="theme-pill-btn ${t.id === activeThemeId ? "active" : ""}" data-theme-pick="${escapeHtml(t.id)}">
            <span class="theme-dot" style="width:10px;height:10px;background:${escapeHtml(t.primary)};"></span>
            <span>${escapeHtml(t.id === "default" ? "Coral" : t.label)}</span>
          </button>
        `
      ).join("")}
    </div>
  `;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtKg(val, suffix = " kg") {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "—";
  const num = Number(val);
  const s = Number.isInteger(num) ? String(num) : String(Number(num.toFixed(2)));
  return suffix ? `${s}${suffix}` : s;
}

export function fmtDelta(val) {
  if (val === null || val === undefined) return "";
  const num = Number(val);
  if (num > 0) return `+${fmtKg(num)}`;
  if (num === 0) return "On target";
  return `${fmtKg(num)}`;
}

export function statusBadge(status, delta = null) {
  if (status === "beat") {
    return `<span class="badge badge-beat">🔥 Beat ${escapeHtml(fmtDelta(delta))}</span>`;
  }
  if (status === "hit") {
    return `<span class="badge badge-hit">✅ Hit</span>`;
  }
  if (status === "missed") {
    return `<span class="badge badge-missed">⚡ ${escapeHtml(fmtDelta(delta))}</span>`;
  }
  if (status === "on_track") {
    return `<span class="badge badge-on_track">✅ On track</span>`;
  }
  if (status === "off_pace") {
    return `<span class="badge badge-off_pace">⚡ Off pace</span>`;
  }
  if (status === "1rm_only") {
    return `<span class="badge badge-on_pace">1RM Logged</span>`;
  }
  if (status === "logged") {
    return `<span class="badge badge-on_pace">Logged</span>`;
  }
  return `<span class="badge badge-waiting">Open</span>`;
}

export function avatarHtml(name, color = "#FF6B57", large = false) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const safeColor = /^#[0-9A-Fa-f]{3,8}$/.test(color || "") ? color : "#FF6B57";
  return `<span class="avatar ${large ? "avatar-lg" : ""}" style="background:${safeColor}">${escapeHtml(initial)}</span>`;
}

export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtShortDate(isoDate) {
  if (!isoDate) return "";
  const parts = String(isoDate).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return String(isoDate);
  const [y, m, day] = parts;
  const target = new Date(y, m - 1, day);
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayMid - target) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return "";
  const ms = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ms)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function mroundClient(value, inc) {
  const step = Number(inc);
  if (!step || step <= 0) return Math.round(value * 100) / 100;
  return Math.round(value / step) * step;
}

export function epleyClient(weight, reps) {
  if (!weight || weight <= 0) return 0;
  if (!reps || reps <= 1) return mroundClient(weight, 0.5);
  return mroundClient(weight * (1 + reps / 30), 0.5);
}

export function showToast(message, optsOrIsError = false) {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const opts =
    typeof optsOrIsError === "boolean"
      ? { type: optsOrIsError ? "error" : "info" }
      : optsOrIsError || {};
  const type = opts.type || "info";
  const duration =
    typeof opts.duration === "number" ? opts.duration : type === "cheer" || type === "error" ? 4200 : 2600;

  while (root.children.length >= 2) {
    root.firstElementChild.remove();
  }

  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " error" : type === "cheer" ? " cheer" : ""}`;
  el.setAttribute("role", "status");

  const textSpan = document.createElement("span");
  textSpan.textContent = String(message || "");
  el.appendChild(textSpan);

  if (type === "cheer" && typeof opts.onClick === "function") {
    const actionSpan = document.createElement("span");
    actionSpan.className = "toast-action";
    actionSpan.textContent = "View";
    el.appendChild(actionSpan);
  }

  let removed = false;
  const dismiss = () => {
    if (removed) return;
    removed = true;
    el.classList.add("toast-leaving");
    setTimeout(() => {
      el.remove();
    }, 220);
  };

  el.addEventListener("click", () => {
    const cb = opts.onClick;
    dismiss();
    if (typeof cb === "function") cb();
  });

  root.appendChild(el);
  setTimeout(dismiss, Math.max(220, duration - 220));
}
