/**
 * Shared client state, theme switching, XSS escaping, formatting, and toast notifications.
 */

export const THEMES = [
  { id: "default", label: "Coral Dark", primary: "#FF6B57", secondary: "#2DD4BF", metaColor: "#111318" },
  { id: "blue", label: "Blue", primary: "#3B82F6", secondary: "#38BDF8", metaColor: "#070D19" },
  { id: "pink", label: "Pink", primary: "#F472B6", secondary: "#F9A8D4", metaColor: "#140912" },
];

export const COMPANIONS = [
  { id: "cat", label: "Cat", preview: "./assets/companions/cat-squat.png" },
  { id: "dog", label: "Dog", preview: "./assets/companions/dog-squat.png" },
  { id: "gorilla", label: "Gorilla", preview: "./assets/companions/gorilla-squat.png" },
];

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

export function companionImageSrc(slugOrName, companionId = state.companion) {
  const liftKey = canonicalLiftKey(slugOrName);
  if (!liftKey) return null;
  const safeId = VALID_COMPANION_IDS.has(companionId) ? companionId : "cat";
  return `./assets/companions/${safeId}-${liftKey}.png`;
}

export function companionArtHtml(slugOrName, size = "lg", companionId = state.companion) {
  const src = companionImageSrc(slugOrName, companionId);
  if (!src) return "";
  const compObj = COMPANIONS.find((c) => c.id === (VALID_COMPANION_IDS.has(companionId) ? companionId : "cat"));
  const liftKey = canonicalLiftKey(slugOrName);
  const alt = `${compObj ? compObj.label : "Cat"} ${liftKey || ""}`.trim();
  return `<img class="companion-art companion-art-${escapeHtml(size)}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

export function renderCompanionPillGroupHtml(activeCompanionId = state.companion) {
  const active = VALID_COMPANION_IDS.has(activeCompanionId) ? activeCompanionId : "cat";
  return `
    <div class="companion-pill-group" role="group" aria-label="Lifting companion">
      ${COMPANIONS.map(
        (c) => `
          <button type="button" class="companion-pill-btn ${c.id === active ? "active" : ""}" data-companion-pick="${escapeHtml(c.id)}" title="${escapeHtml(c.label)} companion">
            <img src="${escapeHtml(c.preview)}" alt="" />
            <span>${escapeHtml(c.label)}</span>
          </button>
        `
      ).join("")}
    </div>
  `;
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

export function showToast(message, isError = false) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${isError ? "error" : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3800);
}
