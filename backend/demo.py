"""One-click sample block seed for single-user exploration."""

import json
import sqlite3
from datetime import date, timedelta
from typing import Any, Dict

from backend.auth import hash_password, utc_now_iso
from backend.plans import compute_sets_summary


def ensure_demo_user(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Create or locate the single demo lifter account, sample block, plan, and logs."""
    existing = conn.execute(
        "SELECT id, username, display_name, avatar_color FROM users WHERE username = 'demo_lifter'"
    ).fetchone()

    if existing:
        blk = conn.execute(
            "SELECT id FROM blocks WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            (existing["id"],),
        ).fetchone()
        return {
            "user_id": existing["id"],
            "username": existing["username"],
            "block_id": blk["id"] if blk else None,
        }

    now = utc_now_iso()
    pw_hash = hash_password("demo-password")
    cur = conn.execute(
        """
        INSERT INTO users(username, display_name, avatar_color, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("demo_lifter", "Norman", "#FF6B57", pw_hash, now),
    )
    user_id = cur.lastrowid

    # Anchor block so today is Day 16 (Week 3) of a 98-day (14-week) block
    today = date.today()
    start_dt = today - timedelta(days=15)
    start_str = start_dt.isoformat()

    cur = conn.execute(
        """
        INSERT INTO blocks(
            user_id, name, start_date, duration_days,
            track_bodyweight, weekly_session_goal, status, created_at
        ) VALUES (?, ?, ?, 98, 1, 3, 'active', ?)
        """,
        (user_id, "Winter Strength Block", start_str, now),
    )
    block_id = cur.lastrowid

    exercises_spec = [
        ("Squat", "squat", 2.5, 0),
        ("Bench", "bench", 2.5, 1),
        ("Deadlift", "deadlift", 2.5, 2),
    ]
    ex_ids: Dict[str, int] = {}
    for name, slug, inc, sort_ord in exercises_spec:
        c = conn.execute(
            """
            INSERT INTO block_exercises(block_id, name, slug, default_increment, sort_order)
            VALUES (?, ?, ?, ?, ?)
            """,
            (block_id, name, slug, inc, sort_ord),
        )
        ex_ids[slug] = c.lastrowid

    c_p = conn.execute(
        """
        INSERT INTO member_plans(
            block_id, user_id, plan_type, plan_name, bodyweight_start, bodyweight_goal, updated_at
        ) VALUES (?, ?, 'linear', 'Linear Target Curve', 68.4, 66.0, ?)
        """,
        (block_id, user_id, now),
    )
    plan_id = c_p.lastrowid

    targets = [
        ("squat", "linear", "working_weight", 60.0, 120.0, 2.5, {}),
        ("bench", "linear", "working_weight", 50.0, 100.0, 2.5, {}),
        ("deadlift", "linear", "working_weight", 80.0, 160.0, 2.5, {}),
    ]
    for slug, ptype, metric, sw, gw, inc, cfg in targets:
        conn.execute(
            """
            INSERT INTO member_exercise_targets(
                member_plan_id, block_exercise_id, plan_type, target_metric,
                start_weight, goal_weight, increment, config_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (plan_id, ex_ids[slug], ptype, metric, sw, gw, inc, json.dumps(cfg)),
        )

    def d_str(day_offset: int) -> str:
        return (start_dt + timedelta(days=day_offset)).isoformat()

    sample_logs = [
        ("bench", 0, 50.0, 75.0, [{"weight": 50, "reps": 5}, {"weight": 50, "reps": 5}], 0, "Block opener!"),
        ("squat", 0, 60.0, 90.0, [{"weight": 60, "reps": 5}, {"weight": 60, "reps": 5}], 0, ""),
        ("deadlift", 2, 85.0, 120.0, [{"weight": 85, "reps": 5}], 0, "Moved smoothly"),
        ("bench", 7, 57.5, 80.0, [{"weight": 57.5, "reps": 5}, {"weight": 57.5, "reps": 5}], 1, "Beat Day 8 target!"),
        ("squat", 9, 70.0, 97.5, [{"weight": 70, "reps": 5}, {"weight": 70, "reps": 5}], 1, "Felt super stable"),
        ("deadlift", 11, 100.0, 130.0, [{"weight": 100, "reps": 4}], 1, "Clean pulls off the floor"),
        ("bench", 14, 60.0, 85.0, [{"weight": 60, "reps": 5}, {"weight": 60, "reps": 5}, {"weight": 60, "reps": 6}], 1, "Locked in 60x6"),
    ]

    for slug, offset, ww, one_rm, sets, is_pr, notes in sample_logs:
        _, est_1rm, vol = compute_sets_summary(sets)
        conn.execute(
            """
            INSERT INTO workout_logs(
                block_id, user_id, block_exercise_id, log_date,
                working_weight, one_rm, estimated_1rm, sets_json,
                total_volume, is_pr, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                block_id,
                user_id,
                ex_ids[slug],
                d_str(offset),
                ww,
                one_rm,
                est_1rm,
                json.dumps(sets),
                vol,
                is_pr,
                notes,
                now,
            ),
        )

    for offset, wt in [(0, 68.4), (7, 68.0), (14, 67.8)]:
        conn.execute(
            """
            INSERT OR REPLACE INTO bodyweight_logs(block_id, user_id, log_date, weight, notes, created_at)
            VALUES (?, ?, ?, ?, '', ?)
            """,
            (block_id, user_id, d_str(offset), wt, now),
        )

    return {
        "user_id": user_id,
        "username": "demo_lifter",
        "block_id": block_id,
    }
