/**
 * Deterministic client-side powerlifting progression engine (1:1 parity with backend/plans.py).
 */

export const PLAN_PRESETS = [
  {
    id: "linear",
    title: "Linear Target Curve",
    short_summary: "Start-to-goal daily strength curve with plate rounding (matches your Google Sheets).",
    default_metric: "working_weight",
    fields: ["start_weight", "goal_weight", "increment", "target_metric"],
  },
  {
    id: "531",
    title: "5/3/1 Waves",
    short_summary: "Jim Wendler 4-week waves (5s / 3s / 5-3-1 / Deload) with auto Training Max bumps.",
    default_metric: "working_weight",
    fields: ["start_weight", "goal_weight", "increment", "training_max", "cycle_increment"],
  },
  {
    id: "1rm_everyday",
    title: "1RM Everyday (Bulgarian)",
    short_summary: "Daily minimum floor + stretch daily max progression toward a block 1RM peak.",
    default_metric: "one_rm",
    fields: ["start_weight", "goal_weight", "increment", "daily_min_start", "daily_min_goal"],
  },
  {
    id: "gzclp",
    title: "GZCLP / Double Progression",
    short_summary: "Weekly step-loading progression with configurable rep scheme (e.g. 5x3+ or 3x5+).",
    default_metric: "working_weight",
    fields: ["start_weight", "goal_weight", "increment", "weekly_increment", "rep_scheme"],
  },
  {
    id: "custom",
    title: "Custom Weekly Milestones",
    short_summary: "Define explicit week-by-week target weights (falls back to linear if left blank).",
    default_metric: "working_weight",
    fields: ["start_weight", "goal_weight", "increment", "weekly_targets"],
  },
];

export const PLAN_PRESET_MAP = Object.fromEntries(PLAN_PRESETS.map((p) => [p.id, p]));

export function mround(value, increment) {
  const val = Number(value);
  const inc = Number(increment);
  if (!inc || inc <= 0) return Math.round(val * 100) / 100;
  const ratio = val / inc;
  const q = ratio >= 0 ? Math.floor(ratio + 0.5 + 1e-12) : Math.ceil(ratio - 0.5 - 1e-12);
  const res = Math.round(q * inc * 1e6) / 1e6;
  return res === 0 ? 0 : res;
}

export function epley1rm(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!w || w <= 0) return 0;
  if (!r || r <= 1) return mround(w, 0.5);
  return mround(w * (1 + r / 30), 0.5);
}

export function computeSetsSummary(sets) {
  if (!sets || !sets.length) return { topWeight: null, best1rm: null, totalVolume: 0 };
  let topWeight = null;
  let best1rm = null;
  let totalVolume = 0;
  for (const s of sets) {
    const w = Number(s.weight || 0);
    const reps = Number(s.reps || 0);
    if (w <= 0 || reps <= 0) continue;
    if (topWeight === null || w > topWeight) topWeight = w;
    const est = epley1rm(w, reps);
    if (best1rm === null || est > best1rm) best1rm = est;
    totalVolume += w * reps;
  }
  return { topWeight, best1rm, totalVolume: Math.round(totalVolume * 100) / 100 };
}

function parseUtcDate(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayIndex(startDateStr, targetDateStr) {
  return Math.round((parseUtcDate(targetDateStr) - parseUtcDate(startDateStr)) / 86400000) + 1;
}

export function clampedDayIndex(startDateStr, targetDateStr, durationDays) {
  const raw = dayIndex(startDateStr, targetDateStr);
  return Math.max(1, Math.min(durationDays, raw));
}

export function dayToDateStr(startDateStr, dayNum) {
  const ms = parseUtcDate(startDateStr) + (dayNum - 1) * 86400000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtNum(val) {
  return Number.isInteger(val) ? String(val) : String(val);
}

export function computeExerciseDayTarget(
  planType,
  day,
  durationDays,
  startWeight,
  goalWeight,
  increment,
  config = {}
) {
  const cfg = config || {};
  const dur = Math.max(1, Math.trunc(durationDays));
  const d = Math.max(1, Math.min(dur, Math.trunc(day)));
  const inc = increment && Number(increment) > 0 ? Number(increment) : 2.5;
  const sw = Number(startWeight);
  const gw = Number(goalWeight);
  const frac = (d - 1) / Math.max(dur - 1, 1);

  if (planType === "531") {
    const rawTm = cfg.training_max;
    const baseTm =
      rawTm !== undefined && rawTm !== null && Number(rawTm) > 0
        ? Number(rawTm)
        : mround(sw * 0.9, inc);
    const cycleInc = Number(cfg.cycle_increment || (inc >= 2.5 && baseTm >= 90 ? 5.0 : 2.5));
    const weekIdx = Math.floor((d - 1) / 7);
    const cycle = Math.floor(weekIdx / 4);
    const weekInCycle = (weekIdx % 4) + 1;
    const tm = baseTm + cycle * cycleInc;

    let waves;
    let label;
    if (weekInCycle === 1) {
      waves = [[0.65, "5"], [0.75, "5"], [0.85, "5+"]];
      label = "5s Week";
    } else if (weekInCycle === 2) {
      waves = [[0.7, "3"], [0.8, "3"], [0.9, "3+"]];
      label = "3s Week";
    } else if (weekInCycle === 3) {
      waves = [[0.75, "5"], [0.85, "3"], [0.95, "1+"]];
      label = "5/3/1 Week";
    } else {
      waves = [[0.4, "5"], [0.5, "5"], [0.6, "5"]];
      label = "Deload";
    }

    const setStrs = [];
    let topTarget = 0;
    for (const [pct, reps] of waves) {
      const w = mround(tm * pct, inc);
      topTarget = w;
      setStrs.push(`${fmtNum(w)}×${reps}`);
    }
    return {
      target: topTarget,
      secondary_target: mround(tm, inc),
      prescription: setStrs.join(" · "),
      phase: `Cycle ${cycle + 1} · ${label}`,
    };
  }

  if (planType === "1rm_everyday") {
    const rawMinS = cfg.daily_min_start;
    const rawMinG = cfg.daily_min_goal;
    const minStart =
      rawMinS !== undefined && rawMinS !== null && Number(rawMinS) > 0
        ? Number(rawMinS)
        : mround(sw * 0.85, inc);
    const minGoal =
      rawMinG !== undefined && rawMinG !== null && Number(rawMinG) > 0
        ? Number(rawMinG)
        : mround(gw * 0.9, inc);
    const dailyMin = mround(minStart + (minGoal - minStart) * frac, inc);
    const dailyMax = mround(sw + (gw - sw) * frac, inc);
    const weekNum = Math.floor((d - 1) / 7) + 1;
    return {
      target: dailyMin,
      secondary_target: dailyMax,
      prescription: `Min ${fmtNum(dailyMin)} kg · Max ${fmtNum(dailyMax)} kg`,
      phase: `Daily Max · Week ${weekNum}`,
    };
  }

  if (planType === "gzclp") {
    const weeklyInc = Number(cfg.weekly_increment || inc);
    const repScheme = String(cfg.rep_scheme || "5×3+");
    const weekIdx = Math.floor((d - 1) / 7);
    const target = mround(sw + weekIdx * weeklyInc, inc);
    return {
      target,
      secondary_target: null,
      prescription: `${repScheme} @ ${fmtNum(target)} kg`,
      phase: `Week ${weekIdx + 1}`,
    };
  }

  if (planType === "custom") {
    const weeklyTargets = cfg.weekly_targets || [];
    const weekIdx = Math.floor((d - 1) / 7);
    let target;
    if (Array.isArray(weeklyTargets) && weeklyTargets.length > 0) {
      const val = Number(weeklyTargets[Math.min(weekIdx, weeklyTargets.length - 1)]);
      target = mround(val, inc);
    } else {
      target = mround(sw + (gw - sw) * frac, inc);
    }
    return {
      target,
      secondary_target: null,
      prescription: `Target ${fmtNum(target)} kg`,
      phase: `Week ${weekIdx + 1}`,
    };
  }

  // Linear target curve (matches spreadsheet MROUND(FORECAST(...), inc))
  const raw = sw + (gw - sw) * frac;
  const target = mround(raw, inc);
  const weekNum = Math.floor((d - 1) / 7) + 1;
  return {
    target,
    secondary_target: null,
    prescription: `Target ${fmtNum(target)} kg`,
    phase: `Linear · Week ${weekNum}`,
  };
}

export function computeBodyweightDayTarget(day, durationDays, startBw, goalBw) {
  const dur = Math.max(1, Math.trunc(durationDays));
  const d = Math.max(1, Math.min(dur, Math.trunc(day)));
  const frac = (d - 1) / Math.max(dur - 1, 1);
  return mround(Number(startBw) + (Number(goalBw) - Number(startBw)) * frac, 0.1);
}

export function evaluateLiftAgainstTarget(
  actualWorking,
  actual1rm,
  est1rm,
  targetInfo,
  targetMetric = "working_weight"
) {
  const target = Number(targetInfo.target);
  let actualVal;
  if (targetMetric === "one_rm") {
    actualVal = actual1rm ?? est1rm ?? actualWorking ?? null;
  } else {
    actualVal = actualWorking ?? actual1rm ?? est1rm ?? null;
  }
  if (actualVal === null || actualVal === undefined) {
    return { actual_value: null, target, delta: null, status: "unlogged", hit: false };
  }
  const delta = Math.round((Number(actualVal) - target) * 100) / 100;
  const status = delta > 0 ? "beat" : delta === 0 ? "hit" : "missed";
  return { actual_value: Number(actualVal), target, delta, status, hit: delta >= 0 };
}

export function evaluateBodyweightAgainstTarget(actualBw, targetBw, startBw, goalBw) {
  const actual = Number(actualBw);
  const target = Number(targetBw);
  const delta = Math.round((actual - target) * 100) / 100;
  let onTrack;
  if (goalBw < startBw) {
    onTrack = actual <= target + 0.3;
  } else if (goalBw > startBw) {
    onTrack = actual >= target - 0.3;
  } else {
    onTrack = Math.abs(actual - target) <= 0.5;
  }
  return {
    actual,
    target,
    delta,
    on_track: onTrack,
    status: onTrack ? "on_track" : "off_pace",
  };
}

export function computeNormalizedProgress(current, start, goal) {
  if (current === null || current === undefined) return 0;
  const span = Number(goal) - Number(start);
  if (Math.abs(span) < 1e-9) {
    return Number(current) >= Number(goal) ? 100.0 : 0.0;
  }
  const pct = ((Number(current) - Number(start)) / span) * 100.0;
  return Math.round(Math.max(-50, Math.min(200, pct)) * 10) / 10;
}
