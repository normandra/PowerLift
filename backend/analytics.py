"""Single-user domain analytics for PairLift dashboards, weekly recaps, and charts."""

import json
import sqlite3
from datetime import date
from typing import Any, Dict, List, Optional

from backend.plans import (
    clamped_day_index,
    compute_bodyweight_day_target,
    compute_exercise_day_target,
    compute_normalized_progress,
    day_index,
    day_to_date_str,
    evaluate_bodyweight_against_target,
    evaluate_lift_against_target,
)


def _today_str(ref_date: Optional[str] = None) -> str:
    return ref_date[:10] if ref_date else date.today().isoformat()


def _load_block_context(conn: sqlite3.Connection, block: sqlite3.Row, user_id: int) -> Dict[str, Any]:
    """Load block exercises, user's plan, per-exercise targets, workout logs, and bodyweight logs."""
    block_id = block["id"]

    exercises = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM block_exercises WHERE block_id = ? ORDER BY sort_order, id",
            (block_id,),
        ).fetchall()
    ]

    plan_row = conn.execute(
        "SELECT * FROM member_plans WHERE block_id = ? AND user_id = ?",
        (block_id, user_id),
    ).fetchone()
    plan = dict(plan_row) if plan_row else None

    targets_by_ex: Dict[int, Dict[str, Any]] = {}
    if plan:
        t_rows = conn.execute(
            "SELECT * FROM member_exercise_targets WHERE member_plan_id = ?",
            (plan["id"],),
        ).fetchall()
        for r in t_rows:
            d = dict(r)
            try:
                d["config"] = json.loads(d.get("config_json") or "{}")
            except json.JSONDecodeError:
                d["config"] = {}
            targets_by_ex[d["block_exercise_id"]] = d

    logs_rows = conn.execute(
        """
        SELECT wl.*, be.name AS exercise_name, be.slug AS exercise_slug, be.default_increment
        FROM workout_logs wl
        JOIN block_exercises be ON be.id = wl.block_exercise_id
        WHERE wl.block_id = ? AND wl.user_id = ?
        ORDER BY wl.log_date ASC, wl.id ASC
        """,
        (block_id, user_id),
    ).fetchall()
    logs: List[Dict[str, Any]] = []
    for r in logs_rows:
        d = dict(r)
        try:
            d["sets"] = json.loads(d.get("sets_json") or "[]")
        except json.JSONDecodeError:
            d["sets"] = []
        logs.append(d)

    bw_logs = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM bodyweight_logs WHERE block_id = ? AND user_id = ? ORDER BY log_date ASC, id ASC",
            (block_id, user_id),
        ).fetchall()
    ]

    return {
        "exercises": exercises,
        "plan": plan,
        "targets_by_ex": targets_by_ex,
        "logs": logs,
        "bw_logs": bw_logs,
    }


def _block_time_meta(block: sqlite3.Row, today_str: str) -> Dict[str, Any]:
    duration_days = int(block["duration_days"])
    total_weeks = max(1, (duration_days + 6) // 7)
    raw_day = day_index(block["start_date"], today_str)
    clamped_day = max(1, min(duration_days, raw_day))
    current_week = ((clamped_day - 1) // 7) + 1
    days_remaining = max(0, duration_days - max(0, raw_day))
    pct_elapsed = round((clamped_day / duration_days) * 100.0, 1)
    end_date = day_to_date_str(block["start_date"], duration_days)
    return {
        "today_date": today_str,
        "end_date": end_date,
        "raw_day": raw_day,
        "day_number": clamped_day,
        "total_days": duration_days,
        "week_number": current_week,
        "total_weeks": total_weeks,
        "days_remaining": days_remaining,
        "pct_elapsed": pct_elapsed,
        "has_started": raw_day >= 1,
        "has_ended": raw_day > duration_days,
    }


def _evaluate_log(
    block: sqlite3.Row,
    log: Dict[str, Any],
    target_cfg: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not target_cfg:
        return None
    d_idx = clamped_day_index(block["start_date"], log["log_date"], int(block["duration_days"]))
    t_info = compute_exercise_day_target(
        plan_type=target_cfg["plan_type"],
        day=d_idx,
        duration_days=int(block["duration_days"]),
        start_weight=float(target_cfg["start_weight"]),
        goal_weight=float(target_cfg["goal_weight"]),
        increment=float(target_cfg["increment"]),
        config=target_cfg.get("config"),
    )
    ev = evaluate_lift_against_target(
        actual_working=log.get("working_weight"),
        actual_1rm=log.get("one_rm"),
        est_1rm=log.get("estimated_1rm"),
        target_info=t_info,
        target_metric=target_cfg.get("target_metric", "working_weight"),
    )
    ev["day_number"] = d_idx
    ev["prescription"] = t_info["prescription"]
    ev["phase"] = t_info["phase"]
    ev["secondary_target"] = t_info["secondary_target"]
    return ev


def _metric_value_for_log(log: Dict[str, Any], target_metric: str) -> Optional[float]:
    if target_metric == "one_rm":
        return (
            log["one_rm"]
            if log.get("one_rm") is not None
            else (log["estimated_1rm"] if log.get("estimated_1rm") is not None else log.get("working_weight"))
        )
    return (
        log["working_weight"]
        if log.get("working_weight") is not None
        else (log["one_rm"] if log.get("one_rm") is not None else log.get("estimated_1rm"))
    )


def _weekly_streak(
    block: sqlite3.Row,
    logs: List[Dict[str, Any]],
    current_week: int,
) -> int:
    """Count consecutive block weeks with >=1 session ending at current_week (or current_week - 1)."""
    weeks_with_logs = set()
    duration_days = int(block["duration_days"])
    for l in logs:
        d = clamped_day_index(block["start_date"], l["log_date"], duration_days)
        weeks_with_logs.add(((d - 1) // 7) + 1)
    if not weeks_with_logs:
        return 0

    start_w = current_week if current_week in weeks_with_logs else current_week - 1
    streak = 0
    w = start_w
    while w >= 1 and w in weeks_with_logs:
        streak += 1
        w -= 1
    return streak


def get_block_dashboard(
    conn: sqlite3.Connection,
    block: sqlite3.Row,
    user_id: int,
    ref_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute Today dashboard for a single user: daily targets, bodyweight, stats, and recent logs."""
    today_str = _today_str(ref_date)
    ctx = _load_block_context(conn, block, user_id)
    time_meta = _block_time_meta(block, today_str)
    day_num = time_meta["day_number"]
    duration_days = time_meta["total_days"]
    current_week = time_meta["week_number"]

    exercises = ctx["exercises"]
    plan = ctx["plan"]
    targets_by_ex = ctx["targets_by_ex"]
    logs = ctx["logs"]
    bw_logs = ctx["bw_logs"]

    today_cards: List[Dict[str, Any]] = []
    pcts: List[float] = []

    for ex in exercises:
        ex_id = ex["id"]
        t_cfg = targets_by_ex.get(ex_id)
        ex_logs = [l for l in logs if l["block_exercise_id"] == ex_id]
        latest_log = ex_logs[-1] if ex_logs else None
        today_log = next((l for l in reversed(ex_logs) if l["log_date"] == today_str), None)

        week_logs = [
            l
            for l in ex_logs
            if ((clamped_day_index(block["start_date"], l["log_date"], duration_days) - 1) // 7) + 1
            == current_week
        ]

        target_info = None
        latest_eval = None
        today_eval = None
        pct_to_goal = 0.0
        target_metric = "working_weight"
        start_w = None
        goal_w = None
        best_val = None

        if t_cfg:
            target_metric = t_cfg.get("target_metric", "working_weight")
            start_w = float(t_cfg["start_weight"])
            goal_w = float(t_cfg["goal_weight"])
            target_info = compute_exercise_day_target(
                plan_type=t_cfg["plan_type"],
                day=day_num,
                duration_days=duration_days,
                start_weight=start_w,
                goal_weight=goal_w,
                increment=float(t_cfg["increment"]),
                config=t_cfg.get("config"),
            )
            vals = [v for v in (_metric_value_for_log(l, target_metric) for l in ex_logs) if v is not None]
            if vals:
                best_val = max(vals)
            if latest_log:
                latest_eval = _evaluate_log(block, latest_log, t_cfg)
                cur_val = _metric_value_for_log(latest_log, target_metric)
                pct_to_goal = compute_normalized_progress(cur_val, start_w, goal_w)
                pcts.append(pct_to_goal)
            if today_log:
                today_eval = _evaluate_log(block, today_log, t_cfg)
        elif ex_logs:
            vals = [v for v in (_metric_value_for_log(l, "working_weight") for l in ex_logs) if v is not None]
            if vals:
                best_val = max(vals)

        today_cards.append(
            {
                "block_exercise_id": ex_id,
                "name": ex["name"],
                "slug": ex["slug"],
                "default_increment": ex["default_increment"],
                "has_target": t_cfg is not None,
                "plan_type": t_cfg["plan_type"] if t_cfg else (plan["plan_type"] if plan else None),
                "target_metric": target_metric,
                "start_weight": start_w,
                "goal_weight": goal_w,
                "increment": float(t_cfg["increment"]) if t_cfg else ex["default_increment"],
                "today_target": target_info,
                "today_log": today_log,
                "today_eval": today_eval,
                "latest_log": latest_log,
                "latest_eval": latest_eval,
                "best_value": best_val,
                "logged_this_week": len(week_logs) > 0,
                "pct_to_goal": pct_to_goal,
            }
        )

    latest_bw = bw_logs[-1] if bw_logs else None
    today_bw_log = next((b for b in reversed(bw_logs) if b["log_date"] == today_str), None)
    bw_card: Dict[str, Any] = {
        "enabled": bool(block["track_bodyweight"]),
        "has_target": bool(
            plan
            and plan.get("bodyweight_start") is not None
            and plan.get("bodyweight_goal") is not None
        ),
        "start": plan.get("bodyweight_start") if plan else None,
        "goal": plan.get("bodyweight_goal") if plan else None,
        "today_target": None,
        "latest_log": latest_bw,
        "today_log": today_bw_log,
        "evaluation": None,
    }
    if bw_card["enabled"] and bw_card["has_target"]:
        bw_target = compute_bodyweight_day_target(
            day_num,
            duration_days,
            float(plan["bodyweight_start"]),
            float(plan["bodyweight_goal"]),
        )
        bw_card["today_target"] = bw_target
        ref_bw = today_bw_log or latest_bw
        if ref_bw:
            bw_card["evaluation"] = evaluate_bodyweight_against_target(
                float(ref_bw["weight"]),
                bw_target,
                float(plan["bodyweight_start"]),
                float(plan["bodyweight_goal"]),
            )

    total_kg_lifted = 0.0
    total_prs = 0
    targets_hit = 0
    targets_total = 0

    for l in logs:
        vol = float(l.get("total_volume") or 0)
        total_kg_lifted += vol if vol > 0 else float(l.get("working_weight") or l.get("one_rm") or 0)
        if l.get("is_pr"):
            total_prs += 1
        ev = _evaluate_log(block, l, targets_by_ex.get(l["block_exercise_id"]))
        if ev:
            targets_total += 1
            if ev["hit"]:
                targets_hit += 1

    hit_rate = round((targets_hit / targets_total) * 100.0, 1) if targets_total > 0 else None
    avg_pct = round(sum(pcts) / len(pcts), 1) if pcts else 0.0

    recent_logs: List[Dict[str, Any]] = []
    for l in reversed(logs[-10:]):
        ev = _evaluate_log(block, l, targets_by_ex.get(l["block_exercise_id"]))
        recent_logs.append(
            {
                "id": l["id"],
                "block_exercise_id": l["block_exercise_id"],
                "exercise_name": l["exercise_name"],
                "log_date": l["log_date"],
                "day_number": clamped_day_index(block["start_date"], l["log_date"], duration_days),
                "working_weight": l["working_weight"],
                "one_rm": l["one_rm"],
                "estimated_1rm": l["estimated_1rm"],
                "sets": l["sets"],
                "total_volume": l["total_volume"],
                "is_pr": bool(l["is_pr"]),
                "notes": l["notes"],
                "evaluation": ev,
            }
        )

    return {
        "block": {
            "id": block["id"],
            "user_id": block["user_id"],
            "name": block["name"],
            "start_date": block["start_date"],
            "duration_days": duration_days,
            "track_bodyweight": bool(block["track_bodyweight"]),
            "weekly_session_goal": int(block["weekly_session_goal"]),
            "status": block["status"],
        },
        "time": time_meta,
        "has_plan": plan is not None,
        "plan": plan,
        "today_cards": today_cards,
        "bodyweight_card": bw_card,
        "stats": {
            "total_kg_lifted": round(total_kg_lifted, 1),
            "sessions_logged": len({l["log_date"] for l in logs}),
            "streak_weeks": _weekly_streak(block, logs, current_week),
            "total_prs": total_prs,
            "targets_hit": targets_hit,
            "targets_total": targets_total,
            "hit_rate_pct": hit_rate,
            "avg_pct_to_goal": avg_pct,
        },
        "recent_logs": recent_logs,
    }


def get_weekly_recap(
    conn: sqlite3.Connection,
    block: sqlite3.Row,
    user_id: int,
    week_num: Optional[int] = None,
    ref_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute single-user weekly check-in scorecard and per-exercise breakdown for week N."""
    today_str = _today_str(ref_date)
    ctx = _load_block_context(conn, block, user_id)
    time_meta = _block_time_meta(block, today_str)
    duration_days = time_meta["total_days"]
    total_weeks = time_meta["total_weeks"]

    selected_week = time_meta["week_number"] if week_num is None else max(1, min(total_weeks, int(week_num)))
    start_day = (selected_week - 1) * 7 + 1
    end_day = min(selected_week * 7, duration_days)
    week_start = day_to_date_str(block["start_date"], start_day)
    week_end = day_to_date_str(block["start_date"], end_day)

    exercises = ctx["exercises"]
    plan = ctx["plan"]
    targets_by_ex = ctx["targets_by_ex"]
    logs = ctx["logs"]
    bw_logs = ctx["bw_logs"]

    weekly_session_goal = int(block["weekly_session_goal"])
    logs_week = [l for l in logs if week_start <= l["log_date"] <= week_end]
    sessions_count = len({l["log_date"] for l in logs_week})

    targets_hit = 0
    targets_missed = 0
    total_volume = 0.0
    prs: List[Dict[str, Any]] = []

    for l in logs_week:
        t_cfg = targets_by_ex.get(l["block_exercise_id"])
        ev = _evaluate_log(block, l, t_cfg)
        if ev:
            if ev["hit"]:
                targets_hit += 1
            else:
                targets_missed += 1
        vol = float(l.get("total_volume") or 0)
        total_volume += vol if vol > 0 else float(l.get("working_weight") or 0)
        if l.get("is_pr"):
            prs.append(
                {
                    "exercise_name": l["exercise_name"],
                    "working_weight": l["working_weight"],
                    "one_rm": l["one_rm"] or l["estimated_1rm"],
                    "log_date": l["log_date"],
                }
            )

    eval_total = targets_hit + targets_missed
    hit_rate = round((targets_hit / eval_total) * 100.0, 1) if eval_total > 0 else None

    bw_week = [b for b in bw_logs if week_start <= b["log_date"] <= week_end]
    bw_avg = round(sum(float(b["weight"]) for b in bw_week) / len(bw_week), 1) if bw_week else None
    bw_target_end = None
    bw_on_track = None
    if (
        block["track_bodyweight"]
        and plan
        and plan.get("bodyweight_start") is not None
        and plan.get("bodyweight_goal") is not None
    ):
        bw_target_end = compute_bodyweight_day_target(
            end_day,
            duration_days,
            float(plan["bodyweight_start"]),
            float(plan["bodyweight_goal"]),
        )
        if bw_avg is not None:
            bw_on_track = evaluate_bodyweight_against_target(
                bw_avg,
                bw_target_end,
                float(plan["bodyweight_start"]),
                float(plan["bodyweight_goal"]),
            )["on_track"]

    exercise_breakdown: List[Dict[str, Any]] = []
    for ex in exercises:
        t_cfg = targets_by_ex.get(ex["id"])
        ex_week_logs = [l for l in logs_week if l["block_exercise_id"] == ex["id"]]
        week_target_info = None
        if t_cfg:
            week_target_info = compute_exercise_day_target(
                t_cfg["plan_type"],
                end_day,
                duration_days,
                float(t_cfg["start_weight"]),
                float(t_cfg["goal_weight"]),
                float(t_cfg["increment"]),
                t_cfg.get("config"),
            )
        best_log = None
        best_eval = None
        if ex_week_logs:
            metric = t_cfg.get("target_metric", "working_weight") if t_cfg else "working_weight"
            best_log = max(
                ex_week_logs,
                key=lambda item: _metric_value_for_log(item, metric) or 0.0,
            )
            best_eval = _evaluate_log(block, best_log, t_cfg)

        exercise_breakdown.append(
            {
                "block_exercise_id": ex["id"],
                "exercise_name": ex["name"],
                "sessions": len(ex_week_logs),
                "week_target": week_target_info["target"] if week_target_info else None,
                "prescription": week_target_info["prescription"] if week_target_info else None,
                "best_working_weight": best_log["working_weight"] if best_log else None,
                "best_one_rm": (
                    best_log["one_rm"] or best_log["estimated_1rm"] if best_log else None
                ),
                "status": best_eval["status"] if best_eval else ("logged" if best_log else "unlogged"),
                "delta": best_eval["delta"] if best_eval else None,
            }
        )

    return {
        "block_id": block["id"],
        "week_number": selected_week,
        "total_weeks": total_weeks,
        "current_week": time_meta["week_number"],
        "week_start": week_start,
        "week_end": week_end,
        "start_day": start_day,
        "end_day": end_day,
        "plan_name": plan["plan_name"] if plan else "No plan",
        "sessions_count": sessions_count,
        "weekly_session_goal": weekly_session_goal,
        "met_session_goal": sessions_count >= weekly_session_goal,
        "targets_hit": targets_hit,
        "targets_missed": targets_missed,
        "hit_rate_pct": hit_rate,
        "prs": prs,
        "total_volume": round(total_volume, 1),
        "streak_weeks": _weekly_streak(block, logs, selected_week),
        "bodyweight_avg": bw_avg,
        "bodyweight_target_end": bw_target_end,
        "bodyweight_on_track": bw_on_track,
        "exercises": exercise_breakdown,
    }


def get_block_charts(
    conn: sqlite3.Connection,
    block: sqlite3.Row,
    user_id: int,
    ref_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Return single-user daily target series and sparse actual points per exercise & bodyweight."""
    today_str = _today_str(ref_date)
    ctx = _load_block_context(conn, block, user_id)
    time_meta = _block_time_meta(block, today_str)
    duration_days = time_meta["total_days"]

    exercises = ctx["exercises"]
    plan = ctx["plan"]
    targets_by_ex = ctx["targets_by_ex"]
    logs = ctx["logs"]
    bw_logs = ctx["bw_logs"]

    exercise_charts: List[Dict[str, Any]] = []
    for ex in exercises:
        t_cfg = targets_by_ex.get(ex["id"])
        ex_logs = [l for l in logs if l["block_exercise_id"] == ex["id"]]

        target_series: List[Dict[str, Any]] = []
        if t_cfg:
            for d in range(1, duration_days + 1):
                ti = compute_exercise_day_target(
                    t_cfg["plan_type"],
                    d,
                    duration_days,
                    float(t_cfg["start_weight"]),
                    float(t_cfg["goal_weight"]),
                    float(t_cfg["increment"]),
                    t_cfg.get("config"),
                )
                target_series.append(
                    {
                        "day": d,
                        "date": day_to_date_str(block["start_date"], d),
                        "target": ti["target"],
                        "secondary_target": ti["secondary_target"],
                    }
                )

        actual_points: List[Dict[str, Any]] = []
        for l in ex_logs:
            d_idx = clamped_day_index(block["start_date"], l["log_date"], duration_days)
            ev = _evaluate_log(block, l, t_cfg)
            metric = t_cfg.get("target_metric", "working_weight") if t_cfg else "working_weight"
            val = _metric_value_for_log(l, metric)
            norm_pct = (
                compute_normalized_progress(
                    val, float(t_cfg["start_weight"]), float(t_cfg["goal_weight"])
                )
                if t_cfg
                else None
            )
            actual_points.append(
                {
                    "log_id": l["id"],
                    "day": d_idx,
                    "date": l["log_date"],
                    "working_weight": l["working_weight"],
                    "one_rm": l["one_rm"],
                    "estimated_1rm": l["estimated_1rm"],
                    "metric_value": val,
                    "target": ev["target"] if ev else None,
                    "delta": ev["delta"] if ev else None,
                    "status": ev["status"] if ev else "logged",
                    "hit": ev["hit"] if ev else True,
                    "is_pr": bool(l["is_pr"]),
                    "normalized_pct": norm_pct,
                }
            )

        exercise_charts.append(
            {
                "block_exercise_id": ex["id"],
                "name": ex["name"],
                "slug": ex["slug"],
                "has_target": t_cfg is not None,
                "plan_type": t_cfg["plan_type"] if t_cfg else None,
                "target_metric": t_cfg.get("target_metric", "working_weight") if t_cfg else "working_weight",
                "start_weight": float(t_cfg["start_weight"]) if t_cfg else None,
                "goal_weight": float(t_cfg["goal_weight"]) if t_cfg else None,
                "target_series": target_series,
                "actual_points": actual_points,
            }
        )

    bw_enabled = bool(block["track_bodyweight"])
    has_bw_target = bool(
        bw_enabled
        and plan
        and plan.get("bodyweight_start") is not None
        and plan.get("bodyweight_goal") is not None
    )
    bw_target_series: List[Dict[str, Any]] = []
    if has_bw_target:
        for d in range(1, duration_days + 1):
            bw_target_series.append(
                {
                    "day": d,
                    "date": day_to_date_str(block["start_date"], d),
                    "target": compute_bodyweight_day_target(
                        d,
                        duration_days,
                        float(plan["bodyweight_start"]),
                        float(plan["bodyweight_goal"]),
                    ),
                }
            )
    bw_actual_points: List[Dict[str, Any]] = []
    for b in bw_logs:
        d_idx = clamped_day_index(block["start_date"], b["log_date"], duration_days)
        t_val = None
        on_track = True
        if has_bw_target:
            t_val = compute_bodyweight_day_target(
                d_idx,
                duration_days,
                float(plan["bodyweight_start"]),
                float(plan["bodyweight_goal"]),
            )
            on_track = evaluate_bodyweight_against_target(
                float(b["weight"]),
                t_val,
                float(plan["bodyweight_start"]),
                float(plan["bodyweight_goal"]),
            )["on_track"]
        bw_actual_points.append(
            {
                "day": d_idx,
                "date": b["log_date"],
                "weight": b["weight"],
                "target": t_val,
                "delta": round(float(b["weight"]) - t_val, 2) if t_val is not None else None,
                "on_track": on_track,
            }
        )

    return {
        "block_id": block["id"],
        "start_date": block["start_date"],
        "duration_days": duration_days,
        "current_day": time_meta["day_number"],
        "exercises": exercise_charts,
        "bodyweight": {
            "enabled": bw_enabled,
            "has_target": has_bw_target,
            "start": plan.get("bodyweight_start") if plan else None,
            "goal": plan.get("bodyweight_goal") if plan else None,
            "target_series": bw_target_series,
            "actual_points": bw_actual_points,
        },
    }
