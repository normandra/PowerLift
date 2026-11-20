/**
 * Unified PairLift API adapter:
 * - Defaults to offline-first localStore (static PWA / GitHub Pages).
 * - Automatically switches to HTTP backend when window.PAIRLIFT_API_BASE or localStorage.pairlift_api_base is set.
 */

import { localStore } from "./localStore.js";

const API_BASE =
  (typeof window !== "undefined" && window.PAIRLIFT_API_BASE) ||
  (typeof localStorage !== "undefined" && localStorage.getItem("pairlift_api_base")) ||
  "";

export const IS_LOCAL_MODE = !API_BASE;

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const base = API_BASE.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    credentials: "same-origin",
    ...options,
    headers,
    body,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.detail) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const remoteApi = {
  health: () => request("/api/health"),
  planPresets: () => request("/api/plan-presets"),
  me: () => request("/api/auth/me"),
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/api/auth/login", { method: "POST", body: payload }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  demoLogin: () => request("/api/auth/demo", { method: "POST" }),
  listBlocks: () => request("/api/blocks"),
  createBlock: (payload) => request("/api/blocks", { method: "POST", body: payload }),
  getBlock: (blockId) => request(`/api/blocks/${blockId}`),
  updateBlock: (blockId, payload) =>
    request(`/api/blocks/${blockId}`, { method: "PATCH", body: payload }),
  deleteBlock: (blockId) => request(`/api/blocks/${blockId}`, { method: "DELETE" }),
  saveMyPlan: (blockId, payload) =>
    request(`/api/blocks/${blockId}/my-plan`, { method: "PUT", body: payload }),
  previewPlan: (blockId, payload) =>
    request(`/api/blocks/${blockId}/plan-preview`, { method: "POST", body: payload }),
  logWorkout: (blockId, payload) =>
    request(`/api/blocks/${blockId}/logs`, { method: "POST", body: payload }),
  deleteWorkout: (logId) => request(`/api/logs/${logId}`, { method: "DELETE" }),
  logBodyweight: (blockId, payload) =>
    request(`/api/blocks/${blockId}/bodyweight`, { method: "POST", body: payload }),
  getDashboard: (blockId) => request(`/api/blocks/${blockId}/dashboard`),
  getWeekly: (blockId, week) =>
    request(`/api/blocks/${blockId}/weekly${week ? `?week=${week}` : ""}`),
  getCharts: (blockId) => request(`/api/blocks/${blockId}/charts`),
};

export const api = IS_LOCAL_MODE ? localStore : remoteApi;
