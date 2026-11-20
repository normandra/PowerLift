"""Deterministic powerlifting progression engine & target evaluation."""

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple


PLAN_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "linear",
        "title": "Linear Target Curve",
        "short_summary": "Start-to-goal daily strength curve with plate rounding (matches your Google Sheets).",
        "default_metric": "working_weight",
        "fields": ["start_weight", "goal_weight", "increment", "target_metric"],
    },
    {
        "id": "531",
        "title": "5/3/1 Waves",
        "short_summary": "Jim Wendler 4-week waves (5s / 3s / 5-3-1 / Deload) with auto Training Max bumps.",
        "default_metric": "working_weight",
        "fields": ["start_weight", "goal_weight", "increment", "training_max", "cycle_increment"],
    },
    {
        "id": "1rm_everyday",
        "title": "1RM Everyday (Bulgarian)",
        "short_summary": "Daily minimum floor + stretch daily max progression toward a block 1RM peak.",
        "default_metric": "one_rm",
        "fields": ["start_weight", "goal_weight", "increment", "daily_min_start", "daily_min_goal"],
    },
    {
        "id": "gzclp",
        "title": "GZCLP / Double Progression",
        "short_summary": "Weekly step-loading progression with configurable rep scheme (e.g. 5x3+ or 3x5+).",
        "default_metric": "working_weight",
        "fields": ["start_weight", "goal_weight", "increment", "weekly_increment", "rep_scheme"],
    },
    {
        "id": "custom",
        "title": "Custom Weekly Milestones",
        "short_summary": "Define explicit week-by-week target weights (falls back to linear if left blank).",
        "default_metric": "working_weight",
        "fields": ["start_weight", "goal_weight", "increment", "weekly_targets"],
    },
]

PLAN_PRESET_MAP: Dict[str, Dict[str, Any]] = {p["id"]: p for p in PLAN_PRESETS}


def mround(value: float, increment: float) -> float:
    """Round value to nearest multiple of increment using half-up rounding (Excel MROUND)."""
    if increment <= 0:
        return round(float(value), 2)
    d_val = Decimal(str(value))
    d_inc = Decimal(str(increment))
    quotient = (d_val / d_inc).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    result = quotient * d_inc
    # Normalize clean float representation
    return float(result.normalize()) if result != 0 else 0.0


def epley_1rm(weight: float, reps: int) -> float:
    """Estimate 1RM using Epley formula rounded to 0.5 kg."""
    if weight <= 0:
        return 0.0
    if reps <= 1:
        return mround(weight, 0.5)
    raw = weight * (1.0 + reps / 30.0)
    return mround(raw, 0.5)


def compute_sets_summary(
    sets: List[Dict[str, Any]]
) -> Tuple[Optional[float], Optional[float], float]:
    """Return (top_working_weight, best_estimated_1rm, total_volume) from set list."""
    if not sets:
        return None, None, 0.0
    top_weight: Optional[float] = None
    best_1rm: Optional[float] = None
    volume = 0.0
    for s in sets:
        w = float(s.get("weight") or 0)
        reps = int(s.get("reps") or 0)
        if w <= 0 or reps <= 0:
            continue
        if top_weight is None or w > top_weight:
            top_weight = w
        est = epley_1rm(w, reps)
        if best_1rm is None or est > best_1rm:
            best_1rm = est
        volume += w * reps
    return top_weight, best_1rm, round(volume, 2)


def parse_iso_date(date_str: str) -> date:
    """Parse YYYY-MM-DD date string."""
    return date.fromisoformat(date_str[:10])


def day_index(start_date_str: str, target_date_str: str) -> int:
    """Compute 1-based day index relative to block start date."""
    start = parse_iso_date(start_date_str)
    target = parse_iso_date(target_date_str)
    return (target - start).days + 1


def clamped_day_index(start_date_str: str, target_date_str: str, duration_days: int) -> int:
    """Compute 1-based day index clamped to [1, duration_days]."""
    raw = day_index(start_date_str, target_date_str)
    return max(1, min(duration_days, raw))


def day_to_date_str(start_date_str: str, day_num: int) -> str:
    """Convert 1-based day index back to YYYY-MM-DD."""
    start = parse_iso_date(start_date_str)
    return (start + timedelta(days=day_num - 1)).isoformat()


def _format_num(val: float) -> str:
    if float(val).is_integer():
        return str(int(val))
    return f"{val:g}"


def compute_exercise_day_target(
    plan_type: str,
    day: int,
    duration_days: int,
    start_weight: float,
    goal_weight: float,
    increment: float,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Compute the target weight, optional secondary target, prescription, and phase for a block day."""
    cfg = config or {}
    dur = max(1, int(duration_days))
    d = max(1, min(dur, int(day)))
    inc = float(increment) if increment and increment > 0 else 2.5
    frac = (d - 1) / max(dur - 1, 1)

    if plan_type == "531":
        raw_tm = cfg.get("training_max")
        base_tm = float(raw_tm) if raw_tm is not None and float(raw_tm) > 0 else mround(start_weight * 0.9, inc)
        cycle_inc = float(cfg.get("cycle_increment") or (5.0 if inc >= 2.5 and base_tm >= 90 else 2.5))
        week_idx = (d - 1) // 7
        cycle = week_idx // 4
        week_in_cycle = (week_idx % 4) + 1
        tm = base_tm + cycle * cycle_inc

        if week_in_cycle == 1:
            waves = [(0.65, "5"), (0.75, "5"), (0.85, "5+")]
            label = "5s Week"
        elif week_in_cycle == 2:
            waves = [(0.70, "3"), (0.80, "3"), (0.90, "3+")]
            label = "3s Week"
        elif week_in_cycle == 3:
            waves = [(0.75, "5"), (0.85, "3"), (0.95, "1+")]
            label = "5/3/1 Week"
        else:
            waves = [(0.40, "5"), (0.50, "5"), (0.60, "5")]
            label = "Deload"

        set_strs = []
        top_target = 0.0
        for pct, reps in waves:
            w = mround(tm * pct, inc)
            top_target = w
            set_strs.append(f"{_format_num(w)}×{reps}")

        return {
            "target": top_target,
            "secondary_target": mround(tm, inc),
            "prescription": " · ".join(set_strs),
            "phase": f"Cycle {cycle + 1} · {label}",
        }

    if plan_type == "1rm_everyday":
        raw_min_start = cfg.get("daily_min_start")
        raw_min_goal = cfg.get("daily_min_goal")
        min_start = (
            float(raw_min_start)
            if raw_min_start is not None and float(raw_min_start) > 0
            else mround(start_weight * 0.85, inc)
        )
        min_goal = (
            float(raw_min_goal)
            if raw_min_goal is not None and float(raw_min_goal) > 0
            else mround(goal_weight * 0.90, inc)
        )
        daily_min = mround(min_start + (min_goal - min_start) * frac, inc)
        daily_max = mround(start_weight + (goal_weight - start_weight) * frac, inc)
        week_num = (d - 1) // 7 + 1
        return {
            "target": daily_min,
            "secondary_target": daily_max,
            "prescription": f"Min {_format_num(daily_min)} kg · Max {_format_num(daily_max)} kg",
            "phase": f"Daily Max · Week {week_num}",
        }

    if plan_type == "gzclp":
        weekly_inc = float(cfg.get("weekly_increment") or inc)
        rep_scheme = str(cfg.get("rep_scheme") or "5×3+")
        week_idx = (d - 1) // 7
        target = mround(start_weight + week_idx * weekly_inc, inc)
        return {
            "target": target,
            "secondary_target": None,
            "prescription": f"{rep_scheme} @ {_format_num(target)} kg",
            "phase": f"Week {week_idx + 1}",
        }

    if plan_type == "custom":
        weekly_targets = cfg.get("weekly_targets") or []
        week_idx = (d - 1) // 7
        if isinstance(weekly_targets, list) and len(weekly_targets) > 0:
            val = float(weekly_targets[min(week_idx, len(weekly_targets) - 1)])
            target = mround(val, inc)
        else:
            target = mround(start_weight + (goal_weight - start_weight) * frac, inc)
        return {
            "target": target,
            "secondary_target": None,
            "prescription": f"Target {_format_num(target)} kg",
            "phase": f"Week {week_idx + 1}",
        }

    # Default: "linear" (exact match to Google Sheet MROUND(FORECAST(...), inc))
    raw = start_weight + (goal_weight - start_weight) * frac
    target = mround(raw, inc)
    week_num = (d - 1) // 7 + 1
    return {
        "target": target,
        "secondary_target": None,
        "prescription": f"Target {_format_num(target)} kg",
        "phase": f"Linear · Week {week_num}",
    }


def compute_bodyweight_day_target(
    day: int,
    duration_days: int,
    start_bw: float,
    goal_bw: float,
) -> float:
    """Compute linear bodyweight target rounded to 0.1 kg."""
    dur = max(1, int(duration_days))
    d = max(1, min(dur, int(day)))
    frac = (d - 1) / max(dur - 1, 1)
    raw = start_bw + (goal_bw - start_bw) * frac
    return mround(raw, 0.1)


def evaluate_lift_against_target(
    actual_working: Optional[float],
    actual_1rm: Optional[float],
    est_1rm: Optional[float],
    target_info: Dict[str, Any],
    target_metric: str = "working_weight",
) -> Dict[str, Any]:
    """Compare a logged lift against the day's target."""
    target = float(target_info["target"])
    if target_metric == "one_rm":
        actual_val = actual_1rm if actual_1rm is not None else est_1rm
    else:
        actual_val = actual_working

    if actual_val is None:
        has_1rm = actual_1rm is not None or est_1rm is not None
        return {
            "actual_value": None,
            "target": target,
            "delta": None,
            "status": "1rm_only" if has_1rm else "unlogged",
            "hit": None,
        }

    delta = round(float(actual_val) - target, 2)
    if delta > 0:
        status = "beat"
    elif delta == 0:
        status = "hit"
    else:
        status = "missed"

    return {
        "actual_value": float(actual_val),
        "target": target,
        "delta": delta,
        "status": status,
        "hit": delta >= 0,
    }


def evaluate_bodyweight_against_target(
    actual_bw: float,
    target_bw: float,
    start_bw: float,
    goal_bw: float,
) -> Dict[str, Any]:
    """Evaluate logged bodyweight against target based on cut/bulk/maintain goal."""
    delta = round(actual_bw - target_bw, 2)
    if goal_bw < start_bw:
        # Cutting: at or below target (+0.3 kg tolerance) is on-track
        on_track = actual_bw <= target_bw + 0.3
    elif goal_bw > start_bw:
        # Bulking: at or above target (-0.3 kg tolerance) is on-track
        on_track = actual_bw >= target_bw - 0.3
    else:
        # Maintaining: within 0.5 kg
        on_track = abs(actual_bw - target_bw) <= 0.5

    return {
        "actual": actual_bw,
        "target": target_bw,
        "delta": delta,
        "on_track": on_track,
        "status": "on_track" if on_track else "off_pace",
    }


def compute_normalized_progress(
    current: Optional[float],
    start: float,
    goal: float,
) -> float:
    """Compute percentage progress from start toward goal (allows >100% if exceeded)."""
    if current is None:
        return 0.0
    span = goal - start
    if abs(span) < 1e-9:
        return 100.0 if current >= goal else 0.0
    pct = ((current - start) / span) * 100.0
    return round(max(-50.0, min(200.0, pct)), 1)
