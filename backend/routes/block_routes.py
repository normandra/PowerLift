"""Single-user training block and plan configuration routes."""

import json
import re
import sqlite3
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user, require_block_owner, utc_now_iso
from backend.db import get_conn
from backend.plans import PLAN_PRESETS, PLAN_PRESET_MAP, compute_exercise_day_target
from backend.schemas import (
    BlockCreateRequest,
    BlockUpdateRequest,
    MemberPlanUpsertRequest,
    PlanPreviewRequest,
)

router = APIRouter(prefix="/api", tags=["blocks"])

DEFAULT_BIG_THREE = [
    ("Squat", 2.5),
    ("Bench", 2.5),
    ("Deadlift", 2.5),
]


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "exercise"


def _load_block_detail(conn: sqlite3.Connection, block: sqlite3.Row, user_id: int) -> Dict[str, Any]:
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

    plan: Any = None
    if plan_row:
        plan = dict(plan_row)
        targets = []
        t_rows = conn.execute(
            """
            SELECT met.*, be.name AS exercise_name, be.slug AS exercise_slug
            FROM member_exercise_targets met
            JOIN block_exercises be ON be.id = met.block_exercise_id
            WHERE met.member_plan_id = ?
            ORDER BY be.sort_order, be.id
            """,
            (plan_row["id"],),
        ).fetchall()
        for tr in t_rows:
            td = dict(tr)
            try:
                td["config"] = json.loads(td.get("config_json") or "{}")
            except json.JSONDecodeError:
                td["config"] = {}
            targets.append(td)
        plan["targets"] = targets

    return {
        "block": dict(block),
        "exercises": exercises,
        "plan": plan,
    }


@router.get("/plan-presets")
def list_plan_presets() -> List[Dict[str, Any]]:
    return PLAN_PRESETS


@router.get("/blocks")
def list_blocks(current_user: Dict[str, Any] = Depends(get_current_user)) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT b.*,
                   (SELECT COUNT(*) FROM block_exercises be WHERE be.block_id = b.id) AS exercise_count
            FROM blocks b
            WHERE b.user_id = ?
            ORDER BY CASE WHEN b.status = 'active' THEN 0 ELSE 1 END, b.start_date DESC, b.id DESC
            """,
            (current_user["id"],),
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/blocks", status_code=201)
def create_block(
    payload: BlockCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Block name is required")
    duration_days = (
        int(payload.duration_days)
        if payload.duration_days is not None
        else int((payload.duration_weeks or 14) * 7)
    )
    now = utc_now_iso()

    exercises_in = payload.exercises
    if not exercises_in:
        ex_list = [(n, inc) for n, inc in DEFAULT_BIG_THREE]
    else:
        ex_list = [(ex.name.strip(), float(ex.default_increment)) for ex in exercises_in if ex.name.strip()]
        if not ex_list:
            ex_list = [(n, inc) for n, inc in DEFAULT_BIG_THREE]

    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO blocks(
                user_id, name, start_date, duration_days,
                track_bodyweight, weekly_session_goal, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
            """,
            (
                current_user["id"],
                name,
                payload.start_date,
                duration_days,
                1 if payload.track_bodyweight else 0,
                payload.weekly_session_goal,
                now,
            ),
        )
        block_id = cur.lastrowid

        seen_slugs = set()
        for idx, (ex_name, inc) in enumerate(ex_list):
            base_slug = _slugify(ex_name)
            slug = base_slug
            counter = 2
            while slug in seen_slugs:
                slug = f"{base_slug}_{counter}"
                counter += 1
            seen_slugs.add(slug)
            conn.execute(
                """
                INSERT INTO block_exercises(block_id, name, slug, default_increment, sort_order)
                VALUES (?, ?, ?, ?, ?)
                """,
                (block_id, ex_name, slug, inc, idx),
            )

        block = conn.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
        return _load_block_detail(conn, block, current_user["id"])


@router.get("/blocks/{block_id}")
def get_block(
    block_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        block = require_block_owner(conn, block_id, current_user["id"])
        return _load_block_detail(conn, block, current_user["id"])


@router.patch("/blocks/{block_id}")
def update_block(
    block_id: int,
    payload: BlockUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        require_block_owner(conn, block_id, current_user["id"])
        updates: List[str] = []
        params: List[Any] = []
        if payload.name is not None:
            updates.append("name = ?")
            params.append(payload.name.strip())
        if payload.status is not None:
            updates.append("status = ?")
            params.append(payload.status)
        if payload.weekly_session_goal is not None:
            updates.append("weekly_session_goal = ?")
            params.append(payload.weekly_session_goal)
        if payload.track_bodyweight is not None:
            updates.append("track_bodyweight = ?")
            params.append(1 if payload.track_bodyweight else 0)

        if updates:
            params.append(block_id)
            conn.execute(f"UPDATE blocks SET {', '.join(updates)} WHERE id = ?", params)

        if payload.add_exercises:
            existing_rows = conn.execute(
                "SELECT slug, sort_order FROM block_exercises WHERE block_id = ?",
                (block_id,),
            ).fetchall()
            seen_slugs = {r["slug"] for r in existing_rows}
            next_order = max((r["sort_order"] for r in existing_rows), default=-1) + 1
            for ex in payload.add_exercises:
                ex_name = ex.name.strip()
                if not ex_name:
                    continue
                base_slug = _slugify(ex_name)
                slug = base_slug
                c = 2
                while slug in seen_slugs:
                    slug = f"{base_slug}_{c}"
                    c += 1
                seen_slugs.add(slug)
                conn.execute(
                    """
                    INSERT INTO block_exercises(block_id, name, slug, default_increment, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (block_id, ex_name, slug, float(ex.default_increment), next_order),
                )
                next_order += 1

        updated = conn.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
        return _load_block_detail(conn, updated, current_user["id"])


@router.delete("/blocks/{block_id}")
def delete_block(
    block_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        require_block_owner(conn, block_id, current_user["id"])
        conn.execute("DELETE FROM blocks WHERE id = ?", (block_id,))
    return {"ok": True, "id": block_id}


@router.put("/blocks/{block_id}/my-plan")
def upsert_my_plan(
    block_id: int,
    payload: MemberPlanUpsertRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    now = utc_now_iso()
    plan_title = (
        payload.plan_name.strip()
        if payload.plan_name and payload.plan_name.strip()
        else PLAN_PRESET_MAP[payload.plan_type]["title"]
    )

    with get_conn() as conn:
        require_block_owner(conn, block_id, current_user["id"])
        valid_ex_ids = {
            r["id"]
            for r in conn.execute(
                "SELECT id FROM block_exercises WHERE block_id = ?", (block_id,)
            ).fetchall()
        }

        existing = conn.execute(
            "SELECT id FROM member_plans WHERE block_id = ? AND user_id = ?",
            (block_id, current_user["id"]),
        ).fetchone()
        if existing:
            plan_id = existing["id"]
            conn.execute(
                """
                UPDATE member_plans
                SET plan_type = ?, plan_name = ?, bodyweight_start = ?, bodyweight_goal = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.plan_type,
                    plan_title,
                    payload.bodyweight_start,
                    payload.bodyweight_goal,
                    now,
                    plan_id,
                ),
            )
            conn.execute("DELETE FROM member_exercise_targets WHERE member_plan_id = ?", (plan_id,))
        else:
            cur = conn.execute(
                """
                INSERT INTO member_plans(
                    block_id, user_id, plan_type, plan_name, bodyweight_start, bodyweight_goal, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    block_id,
                    current_user["id"],
                    payload.plan_type,
                    plan_title,
                    payload.bodyweight_start,
                    payload.bodyweight_goal,
                    now,
                ),
            )
            plan_id = cur.lastrowid

        for t in payload.targets:
            if t.block_exercise_id not in valid_ex_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Exercise {t.block_exercise_id} does not belong to block {block_id}",
                )
            ex_ptype = t.plan_type or payload.plan_type
            if ex_ptype not in PLAN_PRESET_MAP:
                raise HTTPException(status_code=400, detail=f"Invalid plan type: {ex_ptype}")
            conn.execute(
                """
                INSERT INTO member_exercise_targets(
                    member_plan_id, block_exercise_id, plan_type, target_metric,
                    start_weight, goal_weight, increment, config_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    plan_id,
                    t.block_exercise_id,
                    ex_ptype,
                    t.target_metric,
                    float(t.start_weight),
                    float(t.goal_weight),
                    float(t.increment),
                    json.dumps(t.config or {}),
                ),
            )

        updated_block = conn.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
        return _load_block_detail(conn, updated_block, current_user["id"])


@router.post("/blocks/{block_id}/plan-preview")
def preview_plan(
    block_id: int,
    payload: PlanPreviewRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        block = require_block_owner(conn, block_id, current_user["id"])
        dur = int(block["duration_days"])

    mid_day = max(1, (dur + 1) // 2)
    sample_days = sorted({1, 8, 15, 22, mid_day, dur})
    samples = []
    for d in sample_days:
        if d > dur:
            continue
        ti = compute_exercise_day_target(
            plan_type=payload.plan_type,
            day=d,
            duration_days=dur,
            start_weight=payload.start_weight,
            goal_weight=payload.goal_weight,
            increment=payload.increment,
            config=payload.config,
        )
        samples.append({"day": d, "week": ((d - 1) // 7) + 1, **ti})

    return {
        "duration_days": dur,
        "day_1": samples[0] if samples else None,
        "midpoint": compute_exercise_day_target(
            payload.plan_type,
            mid_day,
            dur,
            payload.start_weight,
            payload.goal_weight,
            payload.increment,
            payload.config,
        ),
        "final": samples[-1] if samples else None,
        "samples": samples,
    }
