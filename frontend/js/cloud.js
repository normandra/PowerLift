/**
 * PairLift Cloud Sync & Partner Engine (Supabase Auth + Postgres + RLS).
 * Designed offline-first: dynamic ESM import with graceful offline fallback,
 * UUID-preserving bidirectional sync, and 1:1 linked partner charts + emoji reactions.
 */

import { localStore } from "./localStore.js";
import { applyCompanion, applyTheme, state } from "./state.js";

const SUPABASE_URL =
  (typeof window !== "undefined" && window.PAIRLIFT_SUPABASE_URL) ||
  "https://qivjtpgbbvxawoghyjwq.supabase.co";

const SUPABASE_KEY =
  (typeof window !== "undefined" && window.PAIRLIFT_SUPABASE_KEY) ||
  "sb_publishable_ZYJfIi7mhCnZUcuggCY-Ig_RDMhltDK";

const PENDING_DELETES_KEY = "pairlift_pending_deletes_v1";
const CHEERS_SEEN_IDS_KEY = "pairlift_cheers_seen_ids_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let supabaseClientPromise = null;
let syncInFlight = null;
let debounceTimer = null;
let authUnsub = null;
let reactionsChannel = null;
let reactionsChannelUid = null;
let reactionsCallback = null;

function isUuid(val) {
  return typeof val === "string" && UUID_RE.test(val);
}

function makeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadPendingDeletes() {
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingDeletes(items) {
  try {
    if (!items.length) localStorage.removeItem(PENDING_DELETES_KEY);
    else localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

function addPendingDelete(table, id) {
  if (!id || !isUuid(String(id))) return;
  const list = loadPendingDeletes();
  const key = `${table}:${id}`;
  if (!list.some((x) => `${x.table}:${x.id}` === key)) {
    list.push({ table, id: String(id), ts: Date.now() });
    savePendingDeletes(list);
  }
}

function loadSeenCheerIds() {
  try {
    const raw = localStorage.getItem(CHEERS_SEEN_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveSeenCheerIds(ids) {
  try {
    const arr = Array.from(ids).slice(-150);
    localStorage.setItem(CHEERS_SEEN_IDS_KEY, JSON.stringify(arr));
  } catch {
    // ignore storage quota errors
  }
}

async function stopReactionsChannel(client = null) {
  const ch = reactionsChannel;
  reactionsChannel = null;
  reactionsChannelUid = null;
  reactionsCallback = null;
  if (!ch) return;
  try {
    const c = client || (await getSupabaseClient());
    if (c) await c.removeChannel(ch);
  } catch {
    // ignore cleanup errors
  }
}

function resetCloudState() {
  state.cloud.signedIn = false;
  state.cloud.email = null;
  state.cloud.authUserId = null;
  state.cloud.syncing = false;
  state.cloud.error = null;
  state.partner.linked = false;
  state.partner.profile = null;
  state.partner.inviteCode = null;
  state.partner.inviteExpiresAt = null;
  state.partner.overview = null;
  state.partner.selectedChartSlug = null;
  state.partner.recentLimit = 3;
  state.partner.loading = false;
  state.cheers = {
    items: [],
    unreadCount: 0,
    loading: false,
  };
  stopReactionsChannel();
}

function applySessionMeta(session) {
  if (!session || !session.user) {
    resetCloudState();
    return false;
  }
  state.cloud.signedIn = true;
  state.cloud.email = session.user.email || "";
  state.cloud.authUserId = session.user.id;
  state.cloud.error = null;
  return true;
}

export async function getSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = (async () => {
      try {
        const mod = await import("https://esm.sh/@supabase/supabase-js@2.119.2");
        const client = mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
            flowType: "pkce",
            detectSessionInUrl: true,
            persistSession: true,
            autoRefreshToken: true,
          },
        });
        state.cloud.available = true;
        return client;
      } catch (err) {
        state.cloud.available = false;
        supabaseClientPromise = null;
        return null;
      }
    })();
  }
  return supabaseClientPromise;
}

function tsMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function mergeByUpdatedAt(localRows, cloudRows, deletedIds) {
  const map = new Map();
  for (const row of cloudRows || []) {
    if (!row?.id || deletedIds.has(String(row.id))) continue;
    map.set(String(row.id), row);
  }
  for (const row of localRows || []) {
    if (!row?.id || deletedIds.has(String(row.id))) continue;
    const id = String(row.id);
    const existing = map.get(id);
    if (!existing) {
      map.set(id, row);
    } else if (tsMs(row.updated_at || row.created_at) >= tsMs(existing.updated_at || existing.created_at)) {
      map.set(id, { ...existing, ...row });
    }
  }
  return Array.from(map.values());
}

function mergeStaticRows(localRows, cloudRows, deletedIds, naturalKeyFn) {
  const byId = new Map();
  const idByNatural = new Map();
  const idRemap = new Map();

  for (const row of cloudRows || []) {
    if (!row?.id || deletedIds.has(String(row.id))) continue;
    const id = String(row.id);
    byId.set(id, row);
    const nk = naturalKeyFn ? naturalKeyFn(row) : null;
    if (nk) idByNatural.set(nk, id);
  }

  for (const row of localRows || []) {
    if (!row?.id || deletedIds.has(String(row.id))) continue;
    const id = String(row.id);
    const nk = naturalKeyFn ? naturalKeyFn(row) : null;
    if (nk && idByNatural.has(nk) && idByNatural.get(nk) !== id) {
      const winnerId = idByNatural.get(nk);
      idRemap.set(id, winnerId);
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, row);
      if (nk) idByNatural.set(nk, id);
    } else {
      const cur = byId.get(id);
      const curTs = tsMs(cur.updated_at);
      const rowTs = tsMs(row.updated_at);
      if (curTs && rowTs) {
        // Both sides are versioned: the newer row wins (ties favor local).
        byId.set(id, rowTs >= curTs ? { ...cur, ...row } : { ...row, ...cur });
      } else if (curTs && !rowTs) {
        // Legacy local row without a version stamp: keep the cloud's versioned state.
        byId.set(id, { ...row, ...cur });
      } else {
        byId.set(id, { ...cur, ...row });
      }
    }
  }
  return { rows: Array.from(byId.values()), idRemap };
}

function normalizeSnapshotUuids(snap, uid) {
  const idMap = new Map();
  const mapId = (raw) => {
    const key = String(raw || "");
    if (isUuid(key)) return key;
    if (!idMap.has(key)) idMap.set(key, makeUuid());
    return idMap.get(key);
  };

  const now = new Date().toISOString();
  const blocks = (snap.blocks || []).map((b) => ({
    ...b,
    id: mapId(b.id),
    user_id: uid,
    created_at: b.created_at || now,
    updated_at: b.updated_at || b.created_at || now,
  }));

  const blockExercises = (snap.block_exercises || []).map((e) => ({
    ...e,
    id: mapId(e.id),
    block_id: mapId(e.block_id),
    user_id: uid,
    is_tracked: e.is_tracked !== false,
    updated_at: e.updated_at || undefined,
  }));

  const plans = (snap.plans || []).map((p) => ({
    ...p,
    id: mapId(p.id),
    block_id: mapId(p.block_id),
    user_id: uid,
    updated_at: p.updated_at || now,
  }));

  const exerciseTargets = (snap.exercise_targets || []).map((t) => ({
    ...t,
    id: mapId(t.id),
    member_plan_id: mapId(t.member_plan_id),
    block_exercise_id: mapId(t.block_exercise_id),
    user_id: uid,
  }));

  const workoutLogs = (snap.workout_logs || []).map((l) => ({
    ...l,
    id: mapId(l.id),
    block_id: mapId(l.block_id),
    block_exercise_id: mapId(l.block_exercise_id),
    user_id: uid,
    created_at: l.created_at || now,
    updated_at: l.updated_at || l.created_at || now,
  }));

  const bodyweightLogs = (snap.bodyweight_logs || []).map((b) => ({
    ...b,
    id: mapId(b.id),
    block_id: mapId(b.block_id),
    user_id: uid,
    created_at: b.created_at || now,
    updated_at: b.updated_at || b.created_at || now,
  }));

  return {
    blocks,
    block_exercises: blockExercises,
    plans,
    exercise_targets: exerciseTargets,
    workout_logs: workoutLogs,
    bodyweight_logs: bodyweightLogs,
  };
}

function defaultDisplayNameFromUser(authUser, localUser) {
  if (localUser?.display_name && localUser.display_name !== "Lifter") {
    return localUser.display_name;
  }
  const metaName = authUser?.user_metadata?.full_name || authUser?.user_metadata?.name;
  if (metaName && String(metaName).trim()) return String(metaName).trim().slice(0, 40);
  const emailPrefix = authUser?.email ? String(authUser.email).split("@")[0] : "";
  if (emailPrefix) return emailPrefix.slice(0, 40);
  return localUser?.display_name || "Lifter";
}

function toCloudBlockRow(b, uid) {
  return {
    id: b.id,
    user_id: uid,
    name: String(b.name || "Training Block"),
    start_date: String(b.start_date),
    duration_days: Number(b.duration_days || 98),
    track_bodyweight: Boolean(b.track_bodyweight ?? true),
    weekly_session_goal: Number(b.weekly_session_goal || 3),
    status: b.status === "archived" ? "archived" : "active",
    created_at: b.created_at || new Date().toISOString(),
    updated_at: b.updated_at || new Date().toISOString(),
  };
}

function toCloudExerciseRow(e, uid) {
  return {
    id: e.id,
    user_id: uid,
    block_id: e.block_id,
    name: String(e.name || "Lift"),
    slug: String(e.slug || "lift"),
    default_increment: Number(e.default_increment || 2.5),
    sort_order: Number(e.sort_order ?? 0),
    is_tracked: e.is_tracked !== false,
    updated_at: e.updated_at || new Date().toISOString(),
  };
}

function toCloudPlanRow(p, uid) {
  return {
    id: p.id,
    user_id: uid,
    block_id: p.block_id,
    plan_type: String(p.plan_type || "linear"),
    plan_name: String(p.plan_name || "Linear Target Curve"),
    bodyweight_start: p.bodyweight_start != null ? Number(p.bodyweight_start) : null,
    bodyweight_goal: p.bodyweight_goal != null ? Number(p.bodyweight_goal) : null,
    updated_at: p.updated_at || new Date().toISOString(),
  };
}

function toCloudTargetRow(t, uid) {
  return {
    id: t.id,
    user_id: uid,
    member_plan_id: t.member_plan_id,
    block_exercise_id: t.block_exercise_id,
    plan_type: String(t.plan_type || "linear"),
    target_metric: t.target_metric === "one_rm" ? "one_rm" : "working_weight",
    start_weight: Number(t.start_weight),
    goal_weight: Number(t.goal_weight),
    increment: Number(t.increment || 2.5),
    config: t.config && typeof t.config === "object" ? t.config : {},
  };
}

function toCloudWorkoutRow(l, uid) {
  return {
    id: l.id,
    user_id: uid,
    block_id: l.block_id,
    block_exercise_id: l.block_exercise_id,
    log_date: String(l.log_date),
    working_weight: l.working_weight != null ? Number(l.working_weight) : null,
    one_rm: l.one_rm != null ? Number(l.one_rm) : null,
    estimated_1rm: l.estimated_1rm != null ? Number(l.estimated_1rm) : null,
    sets: Array.isArray(l.sets) ? l.sets : [],
    total_volume: Number(l.total_volume || 0),
    is_pr: Boolean(l.is_pr),
    notes: String(l.notes || ""),
    created_at: l.created_at || new Date().toISOString(),
    updated_at: l.updated_at || new Date().toISOString(),
  };
}

function toCloudBwRow(b, uid) {
  return {
    id: b.id,
    user_id: uid,
    block_id: b.block_id,
    log_date: String(b.log_date),
    weight: Number(b.weight),
    notes: String(b.notes || ""),
    created_at: b.created_at || new Date().toISOString(),
    updated_at: b.updated_at || new Date().toISOString(),
  };
}

async function flushPendingDeletes(client, uid) {
  const pending = loadPendingDeletes();
  if (!pending.length) return new Set();

  const remaining = [];
  const deletedSet = new Set(pending.map((x) => String(x.id)));
  const grouped = new Map();
  for (const item of pending) {
    if (!grouped.has(item.table)) grouped.set(item.table, []);
    grouped.get(item.table).push(item.id);
  }

  for (const [table, ids] of grouped.entries()) {
    const { error } = await client.from(table).delete().eq("user_id", uid).in("id", ids);
    if (error) {
      for (const id of ids) remaining.push({ table, id, ts: Date.now() });
    }
  }

  savePendingDeletes(remaining);
  return deletedSet;
}

export const cloud = {
  async initSession(onAuthChanged) {
    const hadOAuthCode =
      typeof window !== "undefined" &&
      (window.location.search.includes("code=") || window.location.search.includes("error="));

    const client = await getSupabaseClient();
    if (!client) {
      resetCloudState();
      return { session: null, justSignedIn: false };
    }

    const { data, error } = await client.auth.getSession();
    const session = error ? null : data?.session || null;
    applySessionMeta(session);

    if (hadOAuthCode && typeof window !== "undefined") {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }

    if (authUnsub) authUnsub();
    const { data: subData } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "INITIAL_SESSION") return;
      applySessionMeta(nextSession);
      if (typeof onAuthChanged === "function") {
        onAuthChanged(event, nextSession);
      }
    });
    authUnsub = () => subData?.subscription?.unsubscribe();

    return { session, justSignedIn: Boolean(hadOAuthCode && session) };
  },

  async signInWithGoogle() {
    const client = await getSupabaseClient();
    if (!client) {
      throw new Error("Internet connection required to sign in with Google.");
    }
    const redirectTo = window.location.origin + window.location.pathname;
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const client = await getSupabaseClient();
    await stopReactionsChannel(client);
    if (client) {
      await client.auth.signOut().catch(() => {});
    }
    resetCloudState();
    savePendingDeletes([]);
    return { ok: true };
  },

  async syncNow({ silent = false } = {}) {
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      const client = await getSupabaseClient();
      if (!client) return null;

      const { data: sessData } = await client.auth.getSession();
      const session = sessData?.session;
      if (!session || !session.user) {
        resetCloudState();
        return null;
      }

      applySessionMeta(session);
      const uid = session.user.id;
      state.cloud.syncing = true;
      state.cloud.error = null;

      try {
        const deletedIds = await flushPendingDeletes(client, uid);
        const snap = localStore.getRawSnapshot();

        const [profRes, blkRes, exRes, planRes, tgtRes, logRes, bwRes] = await Promise.all([
          client.from("profiles").select("*").eq("id", uid).maybeSingle(),
          client.from("blocks").select("*").eq("user_id", uid),
          client.from("block_exercises").select("*").eq("user_id", uid),
          client.from("plans").select("*").eq("user_id", uid),
          client.from("exercise_targets").select("*").eq("user_id", uid),
          client.from("workout_logs").select("*").eq("user_id", uid),
          client.from("bodyweight_logs").select("*").eq("user_id", uid),
        ]);

        for (const r of [profRes, blkRes, exRes, planRes, tgtRes, logRes, bwRes]) {
          if (r.error) throw new Error(r.error.message || "Cloud read failed");
        }

        const cloudProfile = profRes.data || null;
        const localUser = snap.user || null;
        const now = new Date().toISOString();

        let mergedUser;
        if (!cloudProfile) {
          mergedUser = {
            id: uid,
            username: "google",
            display_name: defaultDisplayNameFromUser(session.user, localUser),
            avatar_color: localUser?.avatar_color || "#FF6B57",
            companion: state.companion || "cat",
            created_at: localUser?.created_at || now,
            updated_at: now,
          };
        } else if (!localUser || tsMs(cloudProfile.updated_at) > tsMs(localUser.updated_at)) {
          mergedUser = {
            id: uid,
            username: "google",
            display_name: cloudProfile.display_name || defaultDisplayNameFromUser(session.user, localUser),
            avatar_color: cloudProfile.avatar_color || "#FF6B57",
            companion: cloudProfile.companion || state.companion || "cat",
            created_at: cloudProfile.created_at || now,
            updated_at: cloudProfile.updated_at || now,
          };
          if (mergedUser.companion && mergedUser.companion !== state.companion) {
            applyCompanion(mergedUser.companion);
          }
        } else {
          mergedUser = {
            id: uid,
            username: "google",
            display_name: localUser.display_name || cloudProfile.display_name || "Lifter",
            avatar_color: localUser.avatar_color || cloudProfile.avatar_color || "#FF6B57",
            companion: state.companion || cloudProfile.companion || "cat",
            created_at: cloudProfile.created_at || localUser.created_at || now,
            updated_at: localUser.updated_at || now,
          };
        }

        const profUpsert = await client
          .from("profiles")
          .upsert(
            {
              id: uid,
              display_name: mergedUser.display_name,
              avatar_color: mergedUser.avatar_color,
              companion: mergedUser.companion || "cat",
              updated_at: mergedUser.updated_at,
            },
            { onConflict: "id" }
          )
          .select("*")
          .single();
        if (profUpsert.error) throw new Error(profUpsert.error.message);

        const normLocal = normalizeSnapshotUuids(snap, uid);

        const mergedBlocks = mergeByUpdatedAt(normLocal.blocks, blkRes.data || [], deletedIds);
        const validBlockIds = new Set(mergedBlocks.map((b) => String(b.id)));

        const { rows: mergedExercisesRaw, idRemap: exIdRemap } = mergeStaticRows(
          normLocal.block_exercises.filter((e) => validBlockIds.has(String(e.block_id))),
          (exRes.data || []).filter((e) => validBlockIds.has(String(e.block_id))),
          deletedIds,
          (e) => `${e.block_id}::${e.slug}`
        );

        const localPlansFixed = normLocal.plans.filter((p) => validBlockIds.has(String(p.block_id)));
        const cloudPlansFixed = (planRes.data || []).filter((p) => validBlockIds.has(String(p.block_id)));
        const mergedPlansAll = mergeByUpdatedAt(localPlansFixed, cloudPlansFixed, deletedIds);
        const planByBlock = new Map();
        const planRemap = new Map();
        for (const p of mergedPlansAll) {
          const bk = String(p.block_id);
          const cur = planByBlock.get(bk);
          if (!cur) {
            planByBlock.set(bk, p);
          } else if (tsMs(p.updated_at) > tsMs(cur.updated_at)) {
            planRemap.set(String(cur.id), String(p.id));
            planByBlock.set(bk, p);
          } else {
            planRemap.set(String(p.id), String(cur.id));
          }
        }
        const mergedPlans = Array.from(planByBlock.values());
        const validPlanIds = new Set(mergedPlans.map((p) => String(p.id)));
        const validExIds = new Set(mergedExercisesRaw.map((e) => String(e.id)));

        const localTargetsFixed = normLocal.exercise_targets
          .map((t) => ({
            ...t,
            member_plan_id: planRemap.get(String(t.member_plan_id)) || t.member_plan_id,
            block_exercise_id: exIdRemap.get(String(t.block_exercise_id)) || t.block_exercise_id,
          }))
          .filter((t) => validPlanIds.has(String(t.member_plan_id)) && validExIds.has(String(t.block_exercise_id)));
        const cloudTargetsFixed = (tgtRes.data || []).filter(
          (t) => validPlanIds.has(String(t.member_plan_id)) && validExIds.has(String(t.block_exercise_id))
        );
        const { rows: mergedTargets } = mergeStaticRows(
          localTargetsFixed,
          cloudTargetsFixed,
          deletedIds,
          (t) => `${t.member_plan_id}::${t.block_exercise_id}`
        );

        const localLogsFixed = normLocal.workout_logs
          .map((l) => ({
            ...l,
            block_exercise_id: exIdRemap.get(String(l.block_exercise_id)) || l.block_exercise_id,
          }))
          .filter((l) => validBlockIds.has(String(l.block_id)) && validExIds.has(String(l.block_exercise_id)));
        const mergedWorkoutLogs = mergeByUpdatedAt(
          localLogsFixed,
          (logRes.data || []).filter(
            (l) => validBlockIds.has(String(l.block_id)) && validExIds.has(String(l.block_exercise_id))
          ),
          deletedIds
        );

        const mergedBwLogs = mergeByUpdatedAt(
          normLocal.bodyweight_logs.filter((b) => validBlockIds.has(String(b.block_id))),
          (bwRes.data || []).filter((b) => validBlockIds.has(String(b.block_id))),
          deletedIds
        );

        if (mergedBlocks.length) {
          const { error: uErr } = await client
            .from("blocks")
            .upsert(mergedBlocks.map((b) => toCloudBlockRow(b, uid)), { onConflict: "id" });
          if (uErr) throw new Error(uErr.message);
        }
        if (mergedExercisesRaw.length) {
          const { error: uErr } = await client
            .from("block_exercises")
            .upsert(mergedExercisesRaw.map((e) => toCloudExerciseRow(e, uid)), { onConflict: "id" });
          if (uErr) throw new Error(uErr.message);
        }
        if (mergedPlans.length) {
          const { error: uErr } = await client
            .from("plans")
            .upsert(mergedPlans.map((p) => toCloudPlanRow(p, uid)), { onConflict: "id" });
          if (uErr) throw new Error(uErr.message);
        }
        if (mergedTargets.length) {
          const { error: uErr } = await client
            .from("exercise_targets")
            .upsert(mergedTargets.map((t) => toCloudTargetRow(t, uid)), { onConflict: "id" });
          if (uErr) throw new Error(uErr.message);
        }
        if (mergedWorkoutLogs.length) {
          const { error: uErr } = await client
            .from("workout_logs")
            .upsert(mergedWorkoutLogs.map((l) => toCloudWorkoutRow(l, uid)), { onConflict: "id" });
          if (uErr) throw new Error(uErr.message);
        }
        if (mergedBwLogs.length) {
          const { error: uErr } = await client
            .from("bodyweight_logs")
            .upsert(mergedBwLogs.map((b) => toCloudBwRow(b, uid)), { onConflict: "id" });
          if (uErr) throw new Error(uErr.message);
        }

        const nextSnapshot = {
          schema_version: 1,
          user: mergedUser,
          blocks: mergedBlocks.map((b) => toCloudBlockRow(b, uid)),
          block_exercises: mergedExercisesRaw.map((e) => toCloudExerciseRow(e, uid)),
          plans: mergedPlans.map((p) => toCloudPlanRow(p, uid)),
          exercise_targets: mergedTargets.map((t) => toCloudTargetRow(t, uid)),
          workout_logs: mergedWorkoutLogs.map((l) => toCloudWorkoutRow(l, uid)),
          bodyweight_logs: mergedBwLogs.map((b) => toCloudBwRow(b, uid)),
        };
        localStore.replaceRawSnapshot(nextSnapshot);
        state.user = nextSnapshot.user;
        state.cloud.lastSyncedAt = new Date().toISOString();

        await this.fetchPartnerStatus();
        if (state.partner.linked) {
          await this.fetchIncomingReactions().catch(() => {});
        } else {
          state.cheers = { items: [], unreadCount: 0, loading: false };
        }
        return nextSnapshot;
      } catch (err) {
        state.cloud.error = err?.message || "Sync failed";
        if (!silent) throw err;
        return null;
      } finally {
        state.cloud.syncing = false;
        syncInFlight = null;
      }
    })();

    return syncInFlight;
  },

  handleLocalMutation(evt) {
    if (!state.cloud.signedIn) return;
    if (evt?.type === "delete" && evt?.table && evt?.id) {
      addPendingDelete(evt.table, evt.id);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      this.syncNow({ silent: true }).catch(() => {});
    }, 300);
  },

  async fetchPartnerStatus() {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.cloud.authUserId) {
      state.partner.linked = false;
      state.partner.profile = null;
      state.partner.inviteCode = null;
      state.partner.inviteExpiresAt = null;
      return { linked: false };
    }
    const uid = state.cloud.authUserId;
    const { data: link, error } = await client
      .from("partner_links")
      .select("id, user_a, user_b, status, created_at")
      .or(`user_a.eq.${uid},user_b.eq.${uid}`)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (link) {
      const partnerId = link.user_a === uid ? link.user_b : link.user_a;
      const { data: prof, error: pErr } = await client
        .from("profiles")
        .select("id, display_name, avatar_color, companion")
        .eq("id", partnerId)
        .maybeSingle();
      if (pErr) throw new Error(pErr.message);

      state.partner.linked = true;
      state.partner.profile = prof || {
        id: partnerId,
        display_name: "Partner",
        avatar_color: "#2DD4BF",
        companion: "cat",
      };
      state.partner.inviteCode = null;
      state.partner.inviteExpiresAt = null;
      return { linked: true, profile: state.partner.profile };
    }

    state.partner.linked = false;
    state.partner.profile = null;
    state.partner.overview = null;

    const nowIso = new Date().toISOString();
    const { data: inv } = await client
      .from("partner_invites")
      .select("code, expires_at")
      .eq("inviter_id", uid)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    state.partner.inviteCode = inv?.code || null;
    state.partner.inviteExpiresAt = inv?.expires_at || null;
    return { linked: false, inviteCode: state.partner.inviteCode };
  },

  async createInviteCode() {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.cloud.authUserId) {
      throw new Error("Sign in with Google first to generate a partner code.");
    }
    const uid = state.cloud.authUserId;
    await client
      .from("profiles")
      .upsert(
        {
          id: uid,
          display_name: state.user?.display_name || "Lifter",
          avatar_color: state.user?.avatar_color || "#FF6B57",
          companion: state.companion || "cat",
        },
        { onConflict: "id" }
      );

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    const { data, error } = await client
      .from("partner_invites")
      .insert({ code, inviter_id: uid })
      .select("code, expires_at")
      .single();
    if (error) throw new Error(error.message);

    state.partner.inviteCode = data.code;
    state.partner.inviteExpiresAt = data.expires_at;
    return data;
  },

  async claimInviteCode(rawCode) {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn) {
      throw new Error("Sign in with Google first to link with your partner.");
    }
    const clean = String(rawCode || "").trim().toUpperCase();
    if (!clean) throw new Error("Enter your partner's 6-character invite code.");

    const { data, error } = await client.rpc("claim_partner_invite", { p_code: clean });
    if (error) throw new Error(error.message || "Could not link partner");

    await this.fetchPartnerStatus();
    await this.fetchPartnerOverview().catch(() => {});
    await this.fetchIncomingReactions().catch(() => {});
    return data;
  },

  async unlinkPartner() {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.cloud.authUserId) return;
    const uid = state.cloud.authUserId;
    const { error } = await client
      .from("partner_links")
      .delete()
      .or(`user_a.eq.${uid},user_b.eq.${uid}`);
    if (error) throw new Error(error.message);

    state.partner.linked = false;
    state.partner.profile = null;
    state.partner.overview = null;
    state.partner.selectedChartSlug = null;
    state.partner.recentLimit = 3;
    state.cheers = { items: [], unreadCount: 0, loading: false };
    await stopReactionsChannel(client);
  },

  async fetchPartnerOverview() {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.partner.linked || !state.partner.profile?.id) {
      state.partner.overview = null;
      return null;
    }

    const uid = state.cloud.authUserId;
    const partnerId = state.partner.profile.id;
    state.partner.loading = true;

    try {
      const [profRes, blkRes, exRes, planRes, tgtRes, logRes, bwRes] = await Promise.all([
        client.from("profiles").select("id, display_name, avatar_color, companion").eq("id", partnerId).maybeSingle(),
        client.from("blocks").select("*").eq("user_id", partnerId),
        client.from("block_exercises").select("*").eq("user_id", partnerId),
        client.from("plans").select("*").eq("user_id", partnerId),
        client.from("exercise_targets").select("*").eq("user_id", partnerId),
        client.from("workout_logs").select("*").eq("user_id", partnerId),
        client.from("bodyweight_logs").select("*").eq("user_id", partnerId),
      ]);

      for (const r of [profRes, blkRes, exRes, planRes, tgtRes, logRes, bwRes]) {
        if (r.error) throw new Error(r.error.message || "Failed loading partner data");
      }

      const partnerProfile = profRes.data || state.partner.profile;
      state.partner.profile = partnerProfile;

      const blocks = [...(blkRes.data || [])].sort((a, b) => {
        const sa = a.status === "active" ? 0 : 1;
        const sb = b.status === "active" ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return String(b.start_date).localeCompare(String(a.start_date));
      });

      if (!blocks.length) {
        state.partner.overview = {
          profile: partnerProfile,
          block: null,
          dashboard: null,
          charts: null,
          reactionsByLogId: {},
        };
        return state.partner.overview;
      }

      const activeBlock = blocks[0];
      const snapshot = {
        schema_version: 1,
        user: partnerProfile,
        blocks,
        block_exercises: exRes.data || [],
        plans: planRes.data || [],
        exercise_targets: tgtRes.data || [],
        workout_logs: logRes.data || [],
        bodyweight_logs: bwRes.data || [],
      };

      const { dashboard, charts } = localStore.computeAnalyticsForSnapshot(snapshot, activeBlock.id);
      const recentIds = (dashboard.recent_logs || []).map((l) => l.id).filter(Boolean);
      const reactionsByLogId = {};

      if (recentIds.length) {
        const { data: rxRows, error: rxErr } = await client
          .from("log_reactions")
          .select("workout_log_id, reactor_id, emoji")
          .in("workout_log_id", recentIds);
        if (!rxErr && Array.isArray(rxRows)) {
          for (const r of rxRows) {
            const lid = String(r.workout_log_id);
            if (!reactionsByLogId[lid]) reactionsByLogId[lid] = {};
            if (!reactionsByLogId[lid][r.emoji]) {
              reactionsByLogId[lid][r.emoji] = { count: 0, reactedByMe: false };
            }
            reactionsByLogId[lid][r.emoji].count += 1;
            if (r.reactor_id === uid) {
              reactionsByLogId[lid][r.emoji].reactedByMe = true;
            }
          }
        }
      }

      state.partner.overview = {
        profile: partnerProfile,
        block: activeBlock,
        dashboard,
        charts,
        reactionsByLogId,
      };
      return state.partner.overview;
    } finally {
      state.partner.loading = false;
    }
  },

  async toggleReaction(workoutLogId, logOwnerId, emoji, currentlyReacted) {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.cloud.authUserId) {
      throw new Error("Sign in required to react.");
    }
    const uid = state.cloud.authUserId;
    if (currentlyReacted) {
      const { error } = await client
        .from("log_reactions")
        .delete()
        .eq("workout_log_id", workoutLogId)
        .eq("reactor_id", uid)
        .eq("emoji", emoji);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await client.from("log_reactions").insert({
        workout_log_id: workoutLogId,
        log_owner_id: logOwnerId,
        reactor_id: uid,
        emoji,
      });
      if (error && error.code !== "23505") throw new Error(error.message);
    }
  },

  async fetchIncomingReactions() {
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.cloud.authUserId) {
      state.cheers = { items: [], unreadCount: 0, loading: false };
      return [];
    }

    const uid = state.cloud.authUserId;
    state.cheers.loading = true;
    try {
      const { data, error } = await client
        .from("log_reactions")
        .select("id, workout_log_id, log_owner_id, reactor_id, emoji, created_at")
        .eq("log_owner_id", uid)
        .neq("reactor_id", uid)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) throw new Error(error.message);

      const snap = localStore.getRawSnapshot();
      const logById = new Map((snap.workout_logs || []).map((l) => [String(l.id), l]));
      const exById = new Map((snap.block_exercises || []).map((e) => [String(e.id), e]));
      const seenIds = loadSeenCheerIds();
      const partnerProf = state.partner.profile;

      const items = (data || []).map((r) => {
        const log = logById.get(String(r.workout_log_id)) || null;
        const ex = log ? exById.get(String(log.block_exercise_id)) || null : null;
        const isPartner = partnerProf?.id && String(partnerProf.id) === String(r.reactor_id);
        return {
          id: String(r.id),
          workout_log_id: String(r.workout_log_id),
          reactor_id: String(r.reactor_id),
          reactor_name: isPartner ? partnerProf.display_name || "Partner" : partnerProf?.display_name || "Partner",
          reactor_color: partnerProf?.avatar_color || "#2DD4BF",
          emoji: r.emoji,
          created_at: r.created_at,
          block_exercise_id: log?.block_exercise_id || null,
          exercise_name: ex?.name || "Lift",
          exercise_slug: ex?.slug || "lift",
          log_date: log?.log_date || null,
          primary_weight: log ? log.working_weight ?? log.one_rm ?? log.estimated_1rm ?? null : null,
          isUnread: !seenIds.has(String(r.id)),
        };
      });

      state.cheers.items = items;
      state.cheers.unreadCount = items.filter((x) => x.isUnread).length;
      return items;
    } finally {
      state.cheers.loading = false;
    }
  },

  markAllCheersSeen() {
    const seenIds = loadSeenCheerIds();
    for (const item of state.cheers.items || []) {
      seenIds.add(String(item.id));
      item.isUnread = false;
    }
    saveSeenCheerIds(seenIds);
    state.cheers.unreadCount = 0;
  },

  async subscribeIncomingReactions(onEvent) {
    reactionsCallback = typeof onEvent === "function" ? onEvent : null;
    const client = await getSupabaseClient();
    if (!client || !state.cloud.signedIn || !state.cloud.authUserId) {
      await stopReactionsChannel(client);
      return null;
    }

    const uid = state.cloud.authUserId;
    if (reactionsChannel && reactionsChannelUid === uid) {
      return reactionsChannel;
    }

    await stopReactionsChannel(client);
    reactionsCallback = typeof onEvent === "function" ? onEvent : null;
    reactionsChannelUid = uid;
    reactionsChannel = client
      .channel(`pairlift-cheers-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "log_reactions",
          filter: `log_owner_id=eq.${uid}`,
        },
        (payload) => {
          if (typeof reactionsCallback === "function") {
            reactionsCallback(payload);
          }
        }
      )
      .subscribe();

    return reactionsChannel;
  },

  async unsubscribeIncomingReactions() {
    await stopReactionsChannel();
  },
};
