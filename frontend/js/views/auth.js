/**
 * Welcome / Auth view:
 * - In offline/static mode (GitHub Pages): streamlined Name + Theme + Start Fresh / Sample Block / Restore Backup.
 * - In remote backend mode: Sign In / Create Account.
 */

import { IS_LOCAL_MODE, api } from "../api.js";
import { applyCompanion, applyTheme, escapeHtml, renderCompanionPillGroupHtml, renderThemePillGroupHtml, showToast, state } from "../state.js";

const SWATCHES = ["#FF6B57", "#3B82F6", "#F472B6", "#2DD4BF", "#FBBF24", "#A78BFA"];

export function renderAuthView(containerEl, onAuthenticated) {
  let mode = "login"; // remote mode only
  let selectedColor = SWATCHES[0];
  let localName = "";

  const renderLocalWelcome = () => {
    containerEl.innerHTML = `
      <div class="auth-screen">
        <div class="card auth-card">
          <div class="row-inline">
            <img src="./icons/icon.svg" alt="PairLift" style="width:44px;height:44px;border-radius:11px;" />
            <div>
              <h1 style="margin:0;font-size:22px;letter-spacing:-0.02em;">PairLift</h1>
              <div class="muted small">Powerlifting blocks, daily targets & share cards</div>
            </div>
          </div>

          <div class="form-field">
            <label for="local-name">Your Name (shown on exported Share Cards)</label>
            <input id="local-name" type="text" value="${escapeHtml(localName)}" placeholder="e.g. Norman" maxlength="40" />
          </div>

          <div class="form-field">
            <label>Badge Color</label>
            <div class="color-swatches">
              ${SWATCHES.map(
                (c) =>
                  `<button type="button" class="swatch ${c === selectedColor ? "active" : ""}" style="background:${c}" data-swatch="${c}" aria-label="Color ${c}"></button>`
              ).join("")}
            </div>
          </div>

          <div class="form-field">
            <label>Theme</label>
            ${renderThemePillGroupHtml(state.theme)}
          </div>

          <div class="form-field">
            <label>Lifting Companion</label>
            ${renderCompanionPillGroupHtml(state.companion)}
          </div>

          <div class="grid-2">
            <button type="button" class="btn btn-primary" id="btn-local-start">Start Fresh</button>
            <button type="button" class="btn btn-mint" id="btn-local-demo">Try Sample Block</button>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <span class="small muted">Saved locally on this phone</span>
            <label class="btn btn-secondary btn-sm" style="cursor:pointer;">
              Restore Backup (.json)
              <input type="file" id="auth-restore-file" accept=".json,application/json" hidden />
            </label>
          </div>
        </div>
      </div>
    `;

    const nameInput = containerEl.querySelector("#local-name");
    if (nameInput) {
      nameInput.addEventListener("input", () => {
        localName = nameInput.value;
      });
    }

    for (const sw of containerEl.querySelectorAll("[data-swatch]")) {
      sw.addEventListener("click", () => {
        selectedColor = sw.getAttribute("data-swatch");
        renderLocalWelcome();
      });
    }

    for (const btn of containerEl.querySelectorAll("[data-theme-pick]")) {
      btn.addEventListener("click", () => {
        applyTheme(btn.getAttribute("data-theme-pick"));
        renderLocalWelcome();
      });
    }

    for (const btn of containerEl.querySelectorAll("[data-companion-pick]")) {
      btn.addEventListener("click", () => {
        applyCompanion(btn.getAttribute("data-companion-pick"));
        renderLocalWelcome();
      });
    }

    const getName = () => localName.trim() || "Lifter";

    containerEl.querySelector("#btn-local-start").addEventListener("click", async () => {
      try {
        const res = await api.createLocalProfile({
          display_name: getName(),
          avatar_color: selectedColor,
        });
        await onAuthenticated(res);
      } catch (err) {
        showToast(err.message, true);
      }
    });

    containerEl.querySelector("#btn-local-demo").addEventListener("click", async () => {
      try {
        const res = await api.demoLogin({
          display_name: getName(),
          avatar_color: selectedColor,
        });
        showToast("Loaded sample training block!");
        await onAuthenticated(res);
      } catch (err) {
        showToast(err.message, true);
      }
    });

    containerEl.querySelector("#auth-restore-file").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await api.importBackup(JSON.parse(text));
        showToast("Backup restored!");
        await onAuthenticated(res);
      } catch (err) {
        showToast(err.message || "Invalid backup file", true);
      }
    });
  };

  const renderRemoteAuth = () => {
    containerEl.innerHTML = `
      <div class="auth-screen">
        <div class="card auth-card">
          <div class="row-inline">
            <img src="./icons/icon.svg" alt="PairLift" style="width:42px;height:42px;border-radius:11px;" />
            <div>
              <h1 style="margin:0;font-size:22px;letter-spacing:-0.02em;">PairLift</h1>
              <div class="muted small">Powerlifting training blocks & daily strength targets</div>
            </div>
          </div>

          <div class="row-inline" style="background:var(--surface-2);padding:4px;border-radius:12px;">
            <button type="button" class="btn btn-sm ${mode === "login" ? "btn-primary" : "btn-ghost"}" style="flex:1;" data-mode="login">Sign In</button>
            <button type="button" class="btn btn-sm ${mode === "register" ? "btn-primary" : "btn-ghost"}" style="flex:1;" data-mode="register">Create Account</button>
          </div>

          <form id="auth-form" style="display:flex;flex-direction:column;gap:12px;">
            <div class="form-field">
              <label for="auth-username">Username</label>
              <input id="auth-username" type="text" required autocomplete="username" placeholder="e.g. norman" />
            </div>

            ${
              mode === "register"
                ? `
                  <div class="form-field">
                    <label for="auth-display">Display Name</label>
                    <input id="auth-display" type="text" required placeholder="e.g. Norman" />
                  </div>
                  <div class="form-field">
                    <label>Badge Color</label>
                    <div class="color-swatches">
                      ${SWATCHES.map(
                        (c) =>
                          `<button type="button" class="swatch ${c === selectedColor ? "active" : ""}" style="background:${c}" data-swatch="${c}" aria-label="Color ${c}"></button>`
                      ).join("")}
                    </div>
                  </div>
                `
                : ""
            }

            <div class="form-field">
              <label for="auth-password">Password</label>
              <input id="auth-password" type="password" required autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="Min 4 characters" />
            </div>

            <button type="submit" class="btn btn-primary btn-block" id="auth-submit">
              ${mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div style="border-top:1px solid var(--border);padding-top:14px;display:flex;flex-direction:column;gap:8px;">
            <div class="small muted">Want to explore a sample 14-week training block first?</div>
            <button type="button" class="btn btn-mint btn-sm btn-block" id="btn-demo">
              Try Sample Block (Demo)
            </button>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:6px;">
            <div class="small muted">Theme</div>
            ${renderThemePillGroupHtml(state.theme)}
          </div>
        </div>
      </div>
    `;

    for (const btn of containerEl.querySelectorAll("[data-mode]")) {
      btn.addEventListener("click", () => {
        mode = btn.getAttribute("data-mode");
        renderRemoteAuth();
      });
    }

    const nameInput = containerEl.querySelector("#local-name");
    if (nameInput) {
      nameInput.addEventListener("input", () => {
        localName = nameInput.value;
      });
    }

    for (const sw of containerEl.querySelectorAll("[data-swatch]")) {
      sw.addEventListener("click", () => {
        selectedColor = sw.getAttribute("data-swatch");
        renderRemoteAuth();
      });
    }

    for (const btn of containerEl.querySelectorAll("[data-theme-pick]")) {
      btn.addEventListener("click", () => {
        applyTheme(btn.getAttribute("data-theme-pick"));
        renderRemoteAuth();
      });
    }

    containerEl.querySelector("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = containerEl.querySelector("#auth-username").value.trim();
      const password = containerEl.querySelector("#auth-password").value;
      try {
        let res;
        if (mode === "login") {
          res = await api.login({ username, password });
        } else {
          const display_name = containerEl.querySelector("#auth-display").value.trim();
          res = await api.register({
            username,
            display_name,
            password,
            avatar_color: selectedColor,
          });
        }
        await onAuthenticated(res);
      } catch (err) {
        showToast(err.message, true);
      }
    });

    containerEl.querySelector("#btn-demo").addEventListener("click", async () => {
      try {
        const res = await api.demoLogin();
        showToast("Loaded sample training block!");
        await onAuthenticated(res);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  };

  if (IS_LOCAL_MODE) {
    renderLocalWelcome();
  } else {
    renderRemoteAuth();
  }
}
