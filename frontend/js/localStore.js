/**
 * Versioned localStorage engine (schema_version: 1) implementing the PairLift backend contract
 * with UUIDs and updated_at timestamps for 100% forward compatibility with a future cloud backend.
 */

import {
  PLAN_PRESETS,
  PLAN_PRESET_MAP,
  clampedDayIndex,
  computeBodyweightDayTarget,
  computeExerciseDayTarget,
  computeNormalizedProgress,
  computeSetsSummary,
  dayIndex,
  dayToDateStr,
  evaluateBodyweightAgainstTarget,
  evaluateLiftAgainstTarget,
} from "./plansEngine.js";
import { todayIso } from "./state.js";

const STORE_KEY = "pairlift_store_v1";

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(name) {
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "exercise";
}

function emptyStore() {
  return {
    schema_version: 1,
    user: null,
    blocks: [],
    block_exercises: [],
    plans: [],
    exercise_targets: [],
    workout_logs: [],
    bodyweight_logs: [],
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.schema_version !== 1) {
      return emptyStore();
    }
    return {
      ...emptyStore(),
      ...parsed,
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function requireBlock(store, blockId) {
  const block = store.blocks.find((b) => String(b.id) === String(blockId));
  if (!block) throw new Error("Training block not found");
  return block;
}

function sortBlocks(blocks, exercises) {
  const countByBlock = new Map();
  for (const ex of exercises) {
    countByBlock.set(ex.block_id, (countByBlock.get(ex.block_id) || 0) + 1);
  }
  return [...blocks]
    .sort((a, b) => {
      const sa = a.status === "active" ? 0 : 1;
      const sb = b.status === "active" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.start_date !== b.start_date) return b.start_date.localeCompare(a.start_date);
      return String(b.created_at).localeCompare(String(a.created_at));
    })
    .map((b) => ({
      ...b,
      exercise_count: countByBlock.get(b.id) || 0,
    }));
}

function buildBlockDetail(store, block) {
  const exercises = store.block_exercises
    .filter((e) => e.block_id === block.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const planRow = store.plans.find((p) => p.block_id === block.id) || null;
  let plan = null;
  if (planRow) {
    const targets = store.exercise_targets
      .filter((t) => t.member_plan_id === planRow.id)
      .map((t) => {
        const ex = exercises.find((e) => e.id === t.block_exercise_id);
        return {
          ...t,
          exercise_name: ex ? ex.name : "Lift",
          exercise_slug: ex ? ex.slug : "lift",
        };
      });
    plan = { ...planRow, targets };
  }
  return {
    block: { ...block },
    exercises,
    plan,
  };
}

function blockTimeMeta(block, todayStr) {
  const durationDays = Number(block.duration_days);
  const totalWeeks = Math.max(1, Math.ceil(durationDays / 7));
  const rawDay = dayIndex(block.start_date, todayStr);
  const clampedDay = Math.max(1, Math.min(durationDays, rawDay));
  const currentWeek = Math.floor((clampedDay - 1) / 7) + 1;
  const daysRemaining = Math.max(0, durationDays - Math.max(0, rawDay));
  const pctElapsed = Math.round((clampedDay / durationDays) * 1000) / 10;
  const endDate = dayToDateStr(block.start_date, durationDays);
  return {
    today_date: todayStr,
    end_date: endDate,
    raw_day: rawDay,
    day_number: clampedDay,
    total_days: durationDays,
    week_number: currentWeek,
    total_weeks: totalWeeks,
    days_remaining: daysRemaining,
    pct_elapsed: pctElapsed,
    has_started: rawDay >= 1,
    has_ended: rawDay > durationDays,
  };
}

function evaluateLog(block, log, targetCfg) {
  if (!targetCfg) return null;
  const dIdx = clampedDayIndex(block.start_date, log.log_date, Number(block.duration_days));
  const tInfo = computeExerciseDayTarget(
    targetCfg.plan_type,
    dIdx,
    Number(block.duration_days),
    Number(targetCfg.start_weight),
    Number(targetCfg.goal_weight),
    Number(targetCfg.increment),
    targetCfg.config
  );
  const ev = evaluateLiftAgainstTarget(
    log.working_weight,
    log.one_rm,
    log.estimated_1rm,
    tInfo,
    targetCfg.target_metric || "working_weight"
  );
  return {
    ...ev,
    day_number: dIdx,
    prescription: tInfo.prescription,
    phase: tInfo.phase,
    secondary_target: tInfo.secondary_target,
  };
}

function metricValueForLog(log, targetMetric) {
  if (targetMetric === "one_rm") {
    return log.one_rm ?? log.estimated_1rm ?? log.working_weight ?? null;
  }
  return log.working_weight ?? log.one_rm ?? log.estimated_1rm ?? null;
}

function weeklyStreak(block, logs, currentWeek) {
  const weeks = new Set();
  const dur = Number(block.duration_days);
  for (const l of logs) {
    const d = clampedDayIndex(block.start_date, l.log_date, dur);
    weeks.add(Math.floor((d - 1) / 7) + 1);
  }
  if (!weeks.size) return 0;
  let w = weeks.has(currentWeek) ? currentWeek : currentWeek - 1;
  let streak = 0;
  while (w >= 1 && weeks.has(w)) {
    streak += 1;
    w -= 1;
  }
  return streak;
}

function checkIsPr(store, blockId, exId, logDate, workingWeight, oneRm, est1rm, excludeId = null) {
  const prior = store.workout_logs.filter((l) => {
    if (l.block_id !== blockId || l.block_exercise_id !== exId) return false;
    if (excludeId && l.id === excludeId) return false;
    return excludeId ? l.log_date < logDate : l.log_date <= logDate;
  });
  if (!prior.length) return 0;
  const wwVals = prior.map((r) => r.working_weight).filter((v) => v !== null && v !== undefined);
  const ormVals = prior
    .map((r) => r.one_rm ?? r.estimated_1rm)
    .filter((v) => v !== null && v !== undefined);
  const bestWw = wwVals.length ? Math.max(...wwVals) : null;
  const best1rm = ormVals.length ? Math.max(...ormVals) : null;

  if (workingWeight !== null && workingWeight !== undefined && bestWw !== null && workingWeight > bestWw) {
    return 1;
  }
  const cur1rm = oneRm ?? est1rm;
  if (cur1rm !== null && cur1rm !== undefined && best1rm !== null && cur1rm > best1rm) {
    return 1;
  }
  return 0;
}

function seedSampleBlock(store) {
  const now = nowIso();
  const today = todayIso();
  // Day 16 = today (dayToDateStr subtracts 1 from dayNum, so -14 shifts -15 days)
  const startDate = dayToDateStr(today, -14);

  const blockId = newId();
  store.blocks.push({
    id: blockId,
    user_id: store.user.id,
    name: "Winter Strength Block",
    start_date: startDate,
    duration_days: 98,
    track_bodyweight: true,
    weekly_session_goal: 3,
    status: "active",
    created_at: now,
    updated_at: now,
  });

  const exSpec = [
    ["Squat", "squat", 2.5, 0],
    ["Bench", "bench", 2.5, 1],
    ["Deadlift", "deadlift", 2.5, 2],
    ["OHP", "ohp", 1.25, 3],
  ];
  const exIds = {};
  for (const [name, slug, inc, sort_order] of exSpec) {
    const eid = newId();
    exIds[slug] = eid;
    store.block_exercises.push({
      id: eid,
      block_id: blockId,
      name,
      slug,
      default_increment: inc,
      sort_order,
    });
  }

  const planId = newId();
  store.plans.push({
    id: planId,
    block_id: blockId,
    user_id: store.user.id,
    plan_type: "linear",
    plan_name: "Linear Target Curve",
    bodyweight_start: 68.4,
    bodyweight_goal: 66.0,
    updated_at: now,
  });

  const targetsSpec = [
    ["squat", 60, 120, 2.5],
    ["bench", 50, 100, 2.5],
    ["deadlift", 80, 160, 2.5],
    ["ohp", 30, 60, 1.25],
  ];
  for (const [slug, sw, gw, inc] of targetsSpec) {
    store.exercise_targets.push({
      id: newId(),
      member_plan_id: planId,
      block_exercise_id: exIds[slug],
      plan_type: "linear",
      target_metric: "working_weight",
      start_weight: sw,
      goal_weight: gw,
      increment: inc,
      config: {},
    });
  }

  const sampleLogs = [
    ["bench", 1, 50, 75, [{ weight: 50, reps: 5 }, { weight: 50, reps: 5 }], 0, "Block opener!"],
    ["squat", 1, 60, 90, [{ weight: 60, reps: 5 }, { weight: 60, reps: 5 }], 0, ""],
    ["deadlift", 3, 85, 120, [{ weight: 85, reps: 5 }], 0, "Moved smoothly"],
    ["ohp", 5, 32.5, null, [{ weight: 32.5, reps: 5 }, { weight: 32.5, reps: 5 }], 0, "Solid overhead stability"],
    ["bench", 8, 57.5, 80, [{ weight: 57.5, reps: 5 }, { weight: 57.5, reps: 5 }], 1, "Beat Day 8 target!"],
    ["squat", 10, 70, 97.5, [{ weight: 70, reps: 5 }, { weight: 70, reps: 5 }], 1, "Felt super stable"],
    ["deadlift", 12, 100, 130, [{ weight: 100, reps: 4 }], 1, "Clean pulls off the floor"],
    ["bench", 15, 60, 85, [{ weight: 60, reps: 5 }, { weight: 60, reps: 5 }, { weight: 60, reps: 6 }], 1, "Locked in 60x6"],
  ];

  for (const [slug, dayNum, ww, orm, sets, isPr, notes] of sampleLogs) {
    const summary = computeSetsSummary(sets);
    store.workout_logs.push({
      id: newId(),
      block_id: blockId,
      user_id: store.user.id,
      block_exercise_id: exIds[slug],
      log_date: dayToDateStr(startDate, dayNum),
      working_weight: ww,
      one_rm: orm,
      estimated_1rm: summary.best1rm,
      sets,
      total_volume: summary.totalVolume,
      is_pr: isPr,
      notes,
      created_at: now,
      updated_at: now,
    });
  }

  for (const [dayNum, wt] of [[1, 68.4], [8, 68.0], [15, 67.8]]) {
    store.bodyweight_logs.push({
      id: newId(),
      block_id: blockId,
      user_id: store.user.id,
      log_date: dayToDateStr(startDate, dayNum),
      weight: wt,
      notes: "",
      created_at: now,
      updated_at: now,
    });
  }

  return blockId;
}

export const localStore = {
  async planPresets() {
    return PLAN_PRESETS;
  },

  async me() {
    const store = loadStore();
    if (!store.user) {
      const err = new Error("No local profile yet");
      err.status = 401;
      throw err;
    }
    return {
      user: store.user,
      blocks: sortBlocks(store.blocks, store.block_exercises),
    };
  },

  async createLocalProfile({ display_name = "Lifter", avatar_color = "#FF6B57" } = {}) {
    const store = loadStore();
    const now = nowIso();
    const cleanName = (display_name || "Lifter").trim() || "Lifter";
    store.user = {
      id: store.user?.id || newId(),
      username: "local",
      display_name: cleanName,
      avatar_color: avatar_color || "#FF6B57",
      created_at: store.user?.created_at || now,
      updated_at: now,
    };
    saveStore(store);
    return {
      user: store.user,
      blocks: sortBlocks(store.blocks, store.block_exercises),
    };
  },

  async updateProfile({ display_name, avatar_color } = {}) {
    const store = loadStore();
    if (!store.user) return localStore.createLocalProfile({ display_name, avatar_color });
    if (display_name !== undefined && display_name.trim()) {
      store.user.display_name = display_name.trim();
    }
    if (avatar_color) store.user.avatar_color = avatar_color;
    store.user.updated_at = nowIso();
    saveStore(store);
    return { user: store.user, blocks: sortBlocks(store.blocks, store.block_exercises) };
  },

  async demoLogin({ display_name = "Norman", avatar_color = "#FF6B57" } = {}) {
    const store = loadStore();
    const now = nowIso();
    if (!store.user) {
      store.user = {
        id: newId(),
        username: "local",
        display_name: (display_name || "Norman").trim() || "Norman",
        avatar_color: avatar_color || "#FF6B57",
        created_at: now,
        updated_at: now,
      };
    }
    const existingDemo = store.blocks.find((b) => b.name === "Winter Strength Block");
    if (!existingDemo) {
      seedSampleBlock(store);
    }
    saveStore(store);
    return {
      user: store.user,
      blocks: sortBlocks(store.blocks, store.block_exercises),
    };
  },

  async logout() {
    return { ok: true };
  },

  async resetLocalData() {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem("pairlift_block_id");
    return { ok: true };
  },

  async exportBackup() {
    const store = loadStore();
    return {
      ...store,
      exported_at: nowIso(),
      app: "PairLift",
    };
  },

  async importBackup(data) {
    if (
      !data ||
      typeof data !== "object" ||
      data.schema_version !== 1 ||
      !Array.isArray(data.blocks) ||
      !Array.isArray(data.block_exercises) ||
      !Array.isArray(data.workout_logs)
    ) {
      throw new Error("Invalid PairLift backup file (expected schema_version 1)");
    }
    const now = nowIso();
    const clean = {
      schema_version: 1,
      user: data.user || {
        id: newId(),
        username: "local",
        display_name: "Lifter",
        avatar_color: "#FF6B57",
        created_at: now,
        updated_at: now,
      },
      blocks: data.blocks,
      block_exercises: data.block_exercises,
      plans: Array.isArray(data.plans) ? data.plans : [],
      exercise_targets: Array.isArray(data.exercise_targets) ? data.exercise_targets : [],
      workout_logs: data.workout_logs,
      bodyweight_logs: Array.isArray(data.bodyweight_logs) ? data.bodyweight_logs : [],
    };
    saveStore(clean);
    return {
      user: clean.user,
      blocks: sortBlocks(clean.blocks, clean.block_exercises),
    };
  },

  async listBlocks() {
    const store = loadStore();
    return sortBlocks(store.blocks, store.block_exercises);
  },

  async createBlock(payload) {
    const store = loadStore();
    if (!store.user) {
      await localStore.createLocalProfile();
    }
    const freshStore = loadStore();
    const now = nowIso();
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("Block name is required");

    const durationDays =
      payload.duration_days != null
        ? Number(payload.duration_days)
        : Number((payload.duration_weeks || 14) * 7);

    const blockId = newId();
    const block = {
      id: blockId,
      user_id: freshStore.user.id,
      name,
      start_date: payload.start_date || todayIso(),
      duration_days: durationDays,
      track_bodyweight: Boolean(payload.track_bodyweight ?? true),
      weekly_session_goal: Number(payload.weekly_session_goal || 3),
      status: "active",
      created_at: now,
      updated_at: now,
    };
    freshStore.blocks.push(block);

    const exInput =
      payload.exercises && payload.exercises.length
        ? payload.exercises
        : [
            { name: "Squat", default_increment: 2.5 },
            { name: "Bench", default_increment: 2.5 },
            { name: "Deadlift", default_increment: 2.5 },
          ];
    const seen = new Set();
    exInput.forEach((ex, idx) => {
      const exName = String(ex.name || "").trim();
      if (!exName) return;
      const base = slugify(exName);
      let slug = base;
      let c = 2;
      while (seen.has(slug)) {
        slug = `${base}_${c}`;
        c += 1;
      }
      seen.add(slug);
      freshStore.block_exercises.push({
        id: newId(),
        block_id: blockId,
        name: exName,
        slug,
        default_increment: Number(ex.default_increment || 2.5),
        sort_order: idx,
      });
    });

    saveStore(freshStore);
    return buildBlockDetail(freshStore, block);
  },

  async getBlock(blockId) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    return buildBlockDetail(store, block);
  },

  async updateBlock(blockId, payload) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    if (payload.name !== undefined) block.name = String(payload.name).trim();
    if (payload.status !== undefined) block.status = payload.status;
    if (payload.weekly_session_goal !== undefined) {
      block.weekly_session_goal = Number(payload.weekly_session_goal);
    }
    if (payload.track_bodyweight !== undefined) {
      block.track_bodyweight = Boolean(payload.track_bodyweight);
    }
    block.updated_at = nowIso();

    if (Array.isArray(payload.add_exercises)) {
      const existing = store.block_exercises.filter((e) => e.block_id === block.id);
      const seen = new Set(existing.map((e) => e.slug));
      let nextOrder = existing.reduce((m, e) => Math.max(m, e.sort_order), -1) + 1;
      for (const ex of payload.add_exercises) {
        const exName = String(ex.name || "").trim();
        if (!exName) continue;
        const base = slugify(exName);
        let slug = base;
        let c = 2;
        while (seen.has(slug)) {
          slug = `${base}_${c}`;
          c += 1;
        }
        seen.add(slug);
        store.block_exercises.push({
          id: newId(),
          block_id: block.id,
          name: exName,
          slug,
          default_increment: Number(ex.default_increment || 2.5),
          sort_order: nextOrder,
        });
        nextOrder += 1;
      }
    }

    saveStore(store);
    return buildBlockDetail(store, block);
  },

  async deleteBlock(blockId) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const planIds = new Set(store.plans.filter((p) => p.block_id === block.id).map((p) => p.id));
    store.blocks = store.blocks.filter((b) => b.id !== block.id);
    store.block_exercises = store.block_exercises.filter((e) => e.block_id !== block.id);
    store.plans = store.plans.filter((p) => p.block_id !== block.id);
    store.exercise_targets = store.exercise_targets.filter((t) => !planIds.has(t.member_plan_id));
    store.workout_logs = store.workout_logs.filter((l) => l.block_id !== block.id);
    store.bodyweight_logs = store.bodyweight_logs.filter((b) => b.block_id !== block.id);
    saveStore(store);
    return { ok: true, id: blockId };
  },

  async saveMyPlan(blockId, payload) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const now = nowIso();
    const planType = payload.plan_type || "linear";
    const planName =
      payload.plan_name && payload.plan_name.trim()
        ? payload.plan_name.trim()
        : (PLAN_PRESET_MAP[planType]?.title || "Linear Target Curve");

    let plan = store.plans.find((p) => p.block_id === block.id);
    if (plan) {
      plan.plan_type = planType;
      plan.plan_name = planName;
      plan.bodyweight_start = payload.bodyweight_start ?? null;
      plan.bodyweight_goal = payload.bodyweight_goal ?? null;
      plan.updated_at = now;
      store.exercise_targets = store.exercise_targets.filter((t) => t.member_plan_id !== plan.id);
    } else {
      plan = {
        id: newId(),
        block_id: block.id,
        user_id: store.user?.id || "local",
        plan_type: planType,
        plan_name: planName,
        bodyweight_start: payload.bodyweight_start ?? null,
        bodyweight_goal: payload.bodyweight_goal ?? null,
        updated_at: now,
      };
      store.plans.push(plan);
    }

    const validExIds = new Set(
      store.block_exercises.filter((e) => e.block_id === block.id).map((e) => String(e.id))
    );
    for (const t of payload.targets || []) {
      const exIdStr = String(t.block_exercise_id);
      if (!validExIds.has(exIdStr)) {
        throw new Error(`Exercise ${exIdStr} does not belong to this block`);
      }
      const exObj = store.block_exercises.find((e) => String(e.id) === exIdStr);
      store.exercise_targets.push({
        id: newId(),
        member_plan_id: plan.id,
        block_exercise_id: exObj.id,
        plan_type: t.plan_type || planType,
        target_metric: t.target_metric || "working_weight",
        start_weight: Number(t.start_weight),
        goal_weight: Number(t.goal_weight),
        increment: Number(t.increment || 2.5),
        config: t.config || {},
      });
    }

    saveStore(store);
    return buildBlockDetail(store, block);
  },

  async previewPlan(blockId, payload) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const dur = Number(block.duration_days);
    const midDay = Math.max(1, Math.floor((dur + 1) / 2));
    const sampleDays = Array.from(new Set([1, 8, 15, 22, midDay, dur]))
      .filter((d) => d <= dur)
      .sort((a, b) => a - b);
    const samples = sampleDays.map((d) => ({
      day: d,
      week: Math.floor((d - 1) / 7) + 1,
      ...computeExerciseDayTarget(
        payload.plan_type,
        d,
        dur,
        payload.start_weight,
        payload.goal_weight,
        payload.increment,
        payload.config
      ),
    }));
    return {
      duration_days: dur,
      day_1: samples[0] || null,
      midpoint: computeExerciseDayTarget(
        payload.plan_type,
        midDay,
        dur,
        payload.start_weight,
        payload.goal_weight,
        payload.increment,
        payload.config
      ),
      final: samples[samples.length - 1] || null,
      samples,
    };
  },

  async logWorkout(blockId, payload) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const ex = store.block_exercises.find(
      (e) => e.block_id === block.id && String(e.id) === String(payload.block_exercise_id)
    );
    if (!ex) throw new Error("Exercise not found in this block");

    const sets = payload.sets || [];
    const summary = computeSetsSummary(sets);
    const workingWeight =
      payload.working_weight !== null && payload.working_weight !== undefined
        ? Number(payload.working_weight)
        : summary.topWeight;
    const oneRm =
      payload.one_rm !== null && payload.one_rm !== undefined ? Number(payload.one_rm) : null;

    if (workingWeight === null && oneRm === null && !sets.length) {
      throw new Error("Provide working weight, 1RM, or at least one set");
    }

    const logDate = payload.log_date || todayIso();
    const isPr = checkIsPr(
      store,
      block.id,
      ex.id,
      logDate,
      workingWeight,
      oneRm,
      summary.best1rm
    );
    const now = nowIso();
    const log = {
      id: newId(),
      block_id: block.id,
      user_id: store.user?.id || "local",
      block_exercise_id: ex.id,
      log_date: logDate,
      working_weight: workingWeight,
      one_rm: oneRm,
      estimated_1rm: summary.best1rm,
      sets,
      total_volume: summary.totalVolume,
      is_pr: isPr,
      notes: String(payload.notes || "").trim(),
      created_at: now,
      updated_at: now,
    };
    store.workout_logs.push(log);
    saveStore(store);
    return { ...log, exercise_name: ex.name };
  },

  async deleteWorkout(logId) {
    const store = loadStore();
    store.workout_logs = store.workout_logs.filter((l) => String(l.id) !== String(logId));
    saveStore(store);
    return { ok: true, id: logId };
  },

  async logBodyweight(blockId, payload) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const now = nowIso();
    const logDate = payload.log_date || todayIso();
    let existing = store.bodyweight_logs.find(
      (b) => b.block_id === block.id && b.log_date === logDate
    );
    if (existing) {
      existing.weight = Number(payload.weight);
      existing.notes = String(payload.notes || "").trim();
      existing.updated_at = now;
    } else {
      existing = {
        id: newId(),
        block_id: block.id,
        user_id: store.user?.id || "local",
        log_date: logDate,
        weight: Number(payload.weight),
        notes: String(payload.notes || "").trim(),
        created_at: now,
        updated_at: now,
      };
      store.bodyweight_logs.push(existing);
    }
    saveStore(store);
    return existing;
  },

  async getDashboard(blockId) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const todayStr = todayIso();
    const timeMeta = blockTimeMeta(block, todayStr);
    const dayNum = timeMeta.day_number;
    const dur = timeMeta.total_days;
    const currentWeek = timeMeta.week_number;

    const exercises = store.block_exercises
      .filter((e) => e.block_id === block.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const plan = store.plans.find((p) => p.block_id === block.id) || null;
    const targetsByEx = new Map();
    if (plan) {
      for (const t of store.exercise_targets) {
        if (t.member_plan_id === plan.id) targetsByEx.set(t.block_exercise_id, t);
      }
    }

    const logs = store.workout_logs
      .filter((l) => l.block_id === block.id)
      .sort((a, b) => (a.log_date !== b.log_date ? a.log_date.localeCompare(b.log_date) : String(a.created_at).localeCompare(String(b.created_at))));
    const bwLogs = store.bodyweight_logs
      .filter((b) => b.block_id === block.id)
      .sort((a, b) => a.log_date.localeCompare(b.log_date));

    const pcts = [];
    const todayCards = exercises.map((ex) => {
      const tCfg = targetsByEx.get(ex.id) || null;
      const exLogs = logs.filter((l) => l.block_exercise_id === ex.id);
      const latestLog = exLogs[exLogs.length - 1] || null;
      const todayLog = [...exLogs].reverse().find((l) => l.log_date === todayStr) || null;
      const weekLogs = exLogs.filter(
        (l) => Math.floor((clampedDayIndex(block.start_date, l.log_date, dur) - 1) / 7) + 1 === currentWeek
      );

      let targetInfo = null;
      let latestEval = null;
      let todayEval = null;
      let pctToGoal = 0;
      let targetMetric = "working_weight";
      let startW = null;
      let goalW = null;
      let bestVal = null;

      if (tCfg) {
        targetMetric = tCfg.target_metric || "working_weight";
        startW = Number(tCfg.start_weight);
        goalW = Number(tCfg.goal_weight);
        targetInfo = computeExerciseDayTarget(
          tCfg.plan_type,
          dayNum,
          dur,
          startW,
          goalW,
          Number(tCfg.increment),
          tCfg.config
        );
        const vals = exLogs.map((l) => metricValueForLog(l, targetMetric)).filter((v) => v !== null);
        if (vals.length) bestVal = Math.max(...vals);
        if (latestLog) {
          latestEval = evaluateLog(block, latestLog, tCfg);
          pctToGoal = computeNormalizedProgress(metricValueForLog(latestLog, targetMetric), startW, goalW);
          pcts.push(pctToGoal);
        }
        if (todayLog) todayEval = evaluateLog(block, todayLog, tCfg);
      } else if (exLogs.length) {
        const vals = exLogs.map((l) => metricValueForLog(l, "working_weight")).filter((v) => v !== null);
        if (vals.length) bestVal = Math.max(...vals);
      }

      return {
        block_exercise_id: ex.id,
        name: ex.name,
        slug: ex.slug,
        default_increment: ex.default_increment,
        has_target: Boolean(tCfg),
        plan_type: tCfg ? tCfg.plan_type : plan ? plan.plan_type : null,
        target_metric: targetMetric,
        start_weight: startW,
        goal_weight: goalW,
        increment: tCfg ? Number(tCfg.increment) : ex.default_increment,
        today_target: targetInfo,
        today_log: todayLog,
        today_eval: todayEval,
        latest_log: latestLog,
        latest_eval: latestEval,
        best_value: bestVal,
        logged_this_week: weekLogs.length > 0,
        pct_to_goal: pctToGoal,
      };
    });

    const latestBw = bwLogs[bwLogs.length - 1] || null;
    const todayBw = [...bwLogs].reverse().find((b) => b.log_date === todayStr) || null;
    const bwCard = {
      enabled: Boolean(block.track_bodyweight),
      has_target: Boolean(plan && plan.bodyweight_start != null && plan.bodyweight_goal != null),
      start: plan ? plan.bodyweight_start : null,
      goal: plan ? plan.bodyweight_goal : null,
      today_target: null,
      latest_log: latestBw,
      today_log: todayBw,
      evaluation: null,
    };
    if (bwCard.enabled && bwCard.has_target) {
      bwCard.today_target = computeBodyweightDayTarget(dayNum, dur, plan.bodyweight_start, plan.bodyweight_goal);
      const refBw = todayBw || latestBw;
      if (refBw) {
        bwCard.evaluation = evaluateBodyweightAgainstTarget(
          refBw.weight,
          bwCard.today_target,
          plan.bodyweight_start,
          plan.bodyweight_goal
        );
      }
    }

    let totalKg = 0;
    let totalPrs = 0;
    let targetsHit = 0;
    let targetsTotal = 0;
    for (const l of logs) {
      totalKg += l.total_volume > 0 ? Number(l.total_volume) : Number(l.working_weight ?? l.one_rm ?? 0);
      if (l.is_pr) totalPrs += 1;
      const ev = evaluateLog(block, l, targetsByEx.get(l.block_exercise_id));
      if (ev) {
        targetsTotal += 1;
        if (ev.hit) targetsHit += 1;
      }
    }

    const exMap = new Map(exercises.map((e) => [e.id, e]));
    const recentLogs = [...logs]
      .slice(-10)
      .reverse()
      .map((l) => {
        const ex = exMap.get(l.block_exercise_id);
        return {
          ...l,
          exercise_name: ex ? ex.name : "Lift",
          day_number: clampedDayIndex(block.start_date, l.log_date, dur),
          evaluation: evaluateLog(block, l, targetsByEx.get(l.block_exercise_id)),
        };
      });

    return {
      block: { ...block },
      time: timeMeta,
      has_plan: Boolean(plan),
      plan,
      today_cards: todayCards,
      bodyweight_card: bwCard,
      stats: {
        total_kg_lifted: Math.round(totalKg * 10) / 10,
        sessions_logged: new Set(logs.map((l) => l.log_date)).size,
        streak_weeks: weeklyStreak(block, logs, currentWeek),
        total_prs: totalPrs,
        targets_hit: targetsHit,
        targets_total: targetsTotal,
        hit_rate_pct: targetsTotal > 0 ? Math.round((targetsHit / targetsTotal) * 1000) / 10 : null,
        avg_pct_to_goal: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : 0,
      },
      recent_logs: recentLogs,
    };
  },

  async getWeekly(blockId, weekNum = null) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const timeMeta = blockTimeMeta(block, todayIso());
    const dur = timeMeta.total_days;
    const totalWeeks = timeMeta.total_weeks;
    const selectedWeek =
      weekNum == null ? timeMeta.week_number : Math.max(1, Math.min(totalWeeks, Number(weekNum)));

    const startDay = (selectedWeek - 1) * 7 + 1;
    const endDay = Math.min(selectedWeek * 7, dur);
    const weekStart = dayToDateStr(block.start_date, startDay);
    const weekEnd = dayToDateStr(block.start_date, endDay);

    const exercises = store.block_exercises
      .filter((e) => e.block_id === block.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const plan = store.plans.find((p) => p.block_id === block.id) || null;
    const targetsByEx = new Map();
    if (plan) {
      for (const t of store.exercise_targets) {
        if (t.member_plan_id === plan.id) targetsByEx.set(t.block_exercise_id, t);
      }
    }

    const logs = store.workout_logs.filter((l) => l.block_id === block.id);
    const logsWeek = logs.filter((l) => l.log_date >= weekStart && l.log_date <= weekEnd);
    const bwLogsWeek = store.bodyweight_logs.filter(
      (b) => b.block_id === block.id && b.log_date >= weekStart && b.log_date <= weekEnd
    );

    const exMap = new Map(exercises.map((e) => [e.id, e]));
    let targetsHit = 0;
    let targetsMissed = 0;
    let totalVol = 0;
    const prs = [];
    for (const l of logsWeek) {
      const ev = evaluateLog(block, l, targetsByEx.get(l.block_exercise_id));
      if (ev) {
        if (ev.hit) targetsHit += 1;
        else targetsMissed += 1;
      }
      totalVol += l.total_volume > 0 ? Number(l.total_volume) : Number(l.working_weight || 0);
      if (l.is_pr) {
        prs.push({
          exercise_name: exMap.get(l.block_exercise_id)?.name || "Lift",
          working_weight: l.working_weight,
          one_rm: l.one_rm ?? l.estimated_1rm,
          log_date: l.log_date,
        });
      }
    }

    const evalTotal = targetsHit + targetsMissed;
    const bwAvg = bwLogsWeek.length
      ? Math.round((bwLogsWeek.reduce((s, b) => s + Number(b.weight), 0) / bwLogsWeek.length) * 10) / 10
      : null;
    let bwTargetEnd = null;
    let bwOnTrack = null;
    if (block.track_bodyweight && plan && plan.bodyweight_start != null && plan.bodyweight_goal != null) {
      bwTargetEnd = computeBodyweightDayTarget(endDay, dur, plan.bodyweight_start, plan.bodyweight_goal);
      if (bwAvg !== null) {
        bwOnTrack = evaluateBodyweightAgainstTarget(
          bwAvg,
          bwTargetEnd,
          plan.bodyweight_start,
          plan.bodyweight_goal
        ).on_track;
      }
    }

    const exBreakdown = exercises.map((ex) => {
      const tCfg = targetsByEx.get(ex.id) || null;
      const exWeekLogs = logsWeek.filter((l) => l.block_exercise_id === ex.id);
      const weekTargetInfo = tCfg
        ? computeExerciseDayTarget(
            tCfg.plan_type,
            endDay,
            dur,
            tCfg.start_weight,
            tCfg.goal_weight,
            tCfg.increment,
            tCfg.config
          )
        : null;
      let bestLog = null;
      let bestEval = null;
      if (exWeekLogs.length) {
        const metric = tCfg ? tCfg.target_metric : "working_weight";
        bestLog = exWeekLogs.reduce((best, cur) =>
          (metricValueForLog(cur, metric) || 0) >= (metricValueForLog(best, metric) || 0) ? cur : best
        );
        bestEval = evaluateLog(block, bestLog, tCfg);
      }
      return {
        block_exercise_id: ex.id,
        exercise_name: ex.name,
        sessions: exWeekLogs.length,
        week_target: weekTargetInfo ? weekTargetInfo.target : null,
        prescription: weekTargetInfo ? weekTargetInfo.prescription : null,
        best_working_weight: bestLog ? bestLog.working_weight : null,
        best_one_rm: bestLog ? (bestLog.one_rm ?? bestLog.estimated_1rm) : null,
        status: bestEval ? bestEval.status : bestLog ? "logged" : "unlogged",
        delta: bestEval ? bestEval.delta : null,
      };
    });

    const sessionsCount = new Set(logsWeek.map((l) => l.log_date)).size;
    return {
      block_id: block.id,
      week_number: selectedWeek,
      total_weeks: totalWeeks,
      current_week: timeMeta.week_number,
      week_start: weekStart,
      week_end: weekEnd,
      start_day: startDay,
      end_day: endDay,
      plan_name: plan ? plan.plan_name : "No plan",
      sessions_count: sessionsCount,
      weekly_session_goal: Number(block.weekly_session_goal),
      met_session_goal: sessionsCount >= Number(block.weekly_session_goal),
      targets_hit: targetsHit,
      targets_missed: targetsMissed,
      hit_rate_pct: evalTotal > 0 ? Math.round((targetsHit / evalTotal) * 1000) / 10 : null,
      prs,
      total_volume: Math.round(totalVol * 10) / 10,
      streak_weeks: weeklyStreak(block, logs, selectedWeek),
      bodyweight_avg: bwAvg,
      bodyweight_target_end: bwTargetEnd,
      bodyweight_on_track: bwOnTrack,
      exercises: exBreakdown,
    };
  },

  async getCharts(blockId) {
    const store = loadStore();
    const block = requireBlock(store, blockId);
    const timeMeta = blockTimeMeta(block, todayIso());
    const dur = timeMeta.total_days;

    const exercises = store.block_exercises
      .filter((e) => e.block_id === block.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const plan = store.plans.find((p) => p.block_id === block.id) || null;
    const targetsByEx = new Map();
    if (plan) {
      for (const t of store.exercise_targets) {
        if (t.member_plan_id === plan.id) targetsByEx.set(t.block_exercise_id, t);
      }
    }
    const logs = store.workout_logs
      .filter((l) => l.block_id === block.id)
      .sort((a, b) => a.log_date.localeCompare(b.log_date));
    const bwLogs = store.bodyweight_logs
      .filter((b) => b.block_id === block.id)
      .sort((a, b) => a.log_date.localeCompare(b.log_date));

    const exerciseCharts = exercises.map((ex) => {
      const tCfg = targetsByEx.get(ex.id) || null;
      const exLogs = logs.filter((l) => l.block_exercise_id === ex.id);
      const targetSeries = [];
      if (tCfg) {
        for (let d = 1; d <= dur; d += 1) {
          const ti = computeExerciseDayTarget(
            tCfg.plan_type,
            d,
            dur,
            tCfg.start_weight,
            tCfg.goal_weight,
            tCfg.increment,
            tCfg.config
          );
          targetSeries.push({
            day: d,
            date: dayToDateStr(block.start_date, d),
            target: ti.target,
            secondary_target: ti.secondary_target,
          });
        }
      }
      const actualPoints = exLogs.map((l) => {
        const dIdx = clampedDayIndex(block.start_date, l.log_date, dur);
        const ev = evaluateLog(block, l, tCfg);
        const metric = tCfg ? tCfg.target_metric : "working_weight";
        const val = metricValueForLog(l, metric);
        return {
          log_id: l.id,
          day: dIdx,
          date: l.log_date,
          working_weight: l.working_weight,
          one_rm: l.one_rm,
          estimated_1rm: l.estimated_1rm,
          metric_value: val,
          target: ev ? ev.target : null,
          delta: ev ? ev.delta : null,
          status: ev ? ev.status : "logged",
          hit: ev ? ev.hit : true,
          is_pr: Boolean(l.is_pr),
          normalized_pct: tCfg ? computeNormalizedProgress(val, tCfg.start_weight, tCfg.goal_weight) : null,
        };
      });
      return {
        block_exercise_id: ex.id,
        name: ex.name,
        slug: ex.slug,
        has_target: Boolean(tCfg),
        plan_type: tCfg ? tCfg.plan_type : null,
        target_metric: tCfg ? tCfg.target_metric : "working_weight",
        start_weight: tCfg ? Number(tCfg.start_weight) : null,
        goal_weight: tCfg ? Number(tCfg.goal_weight) : null,
        target_series: targetSeries,
        actual_points: actualPoints,
      };
    });

    const bwEnabled = Boolean(block.track_bodyweight);
    const hasBwTarget = Boolean(
      bwEnabled && plan && plan.bodyweight_start != null && plan.bodyweight_goal != null
    );
    const bwTargetSeries = [];
    if (hasBwTarget) {
      for (let d = 1; d <= dur; d += 1) {
        bwTargetSeries.push({
          day: d,
          date: dayToDateStr(block.start_date, d),
          target: computeBodyweightDayTarget(d, dur, plan.bodyweight_start, plan.bodyweight_goal),
        });
      }
    }
    const bwActualPoints = bwLogs.map((b) => {
      const dIdx = clampedDayIndex(block.start_date, b.log_date, dur);
      let tVal = null;
      let onTrack = true;
      if (hasBwTarget) {
        tVal = computeBodyweightDayTarget(dIdx, dur, plan.bodyweight_start, plan.bodyweight_goal);
        onTrack = evaluateBodyweightAgainstTarget(
          b.weight,
          tVal,
          plan.bodyweight_start,
          plan.bodyweight_goal
        ).on_track;
      }
      return {
        day: dIdx,
        date: b.log_date,
        weight: b.weight,
        target: tVal,
        delta: tVal !== null ? Math.round((Number(b.weight) - tVal) * 100) / 100 : null,
        on_track: onTrack,
      };
    });

    return {
      block_id: block.id,
      start_date: block.start_date,
      duration_days: dur,
      current_day: timeMeta.day_number,
      exercises: exerciseCharts,
      bodyweight: {
        enabled: bwEnabled,
        has_target: hasBwTarget,
        start: plan ? plan.bodyweight_start : null,
        goal: plan ? plan.bodyweight_goal : null,
        target_series: bwTargetSeries,
        actual_points: bwActualPoints,
      },
    };
  },
};
