"""Workout logging, bodyweight check-in, and single-user analytics routes."""

import json
import sqlite3
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.analytics import get_block_charts, get_block_dashboard, get_weekly_recap
from backend.auth import get_current_user, require_block_owner, utc_now_iso
from backend.db import get_conn
from backend.plans import compute_sets_summary
from backend.schemas import (
    BodyweightLogRequest,
    WorkoutLogCreateRequest,
    WorkoutLogUpdateRequest,
)

router = APIRouter(prefix="/api", tags=["logs"])


def _resolve_log_metrics(
    working_weight: Optional[float],
    one_rm: Optional[float],
    sets_list: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    sets_clean = sets_list or []
    top_from_sets, est_1rm, vol = compute_sets_summary(sets_clean)
    final_working = working_weight if working_weight is not None else top_from_sets
    if final_working is None and one_rm is None and not sets_clean:
        raise HTTPException(
            status_code=400,
            detail="Provide working_weight, one_rm, or at least one set",
        )
    return {
        "working_weight": final_working,
        "one_rm": one_rm,
        "estimated_1rm": est_1rm,
        "sets_json": json.dumps(sets_clean),
        "total_volume": vol,
    }


def _check_is_pr(
    conn: sqlite3.Connection,
    block_id: int,
    user_id: int,
    block_exercise_id: int,
    log_date: str,
    working_weight: Optional[float],
    one_rm: Optional[float],
    estimated_1rm: Optional[float],
    exclude_log_id: Optional[int] = None,
) -> int:
    query = """
        SELECT working_weight, one_rm, estimated_1rm
        FROM workout_logs
        WHERE block_id = ? AND user_id = ? AND block_exercise_id = ?
    """
    params: List[Any] = [block_id, user_id, block_exercise_id]
    if exclude_log_id is not None:
        query += " AND (log_date < ? OR (log_date = ? AND id < ?))"
        params.extend([log_date, log_date, exclude_log_id])
    else:
        query += " AND log_date <= ?"
        params.append(log_date)

    prior = conn.execute(query, params).fetchall()
    if not prior:
        return 0

    best_ww = max((float(r["working_weight"]) for r in prior if r["working_weight"] is not None), default=None)
    best_1rm_vals = [
        float(r["one_rm"] or r["estimated_1rm"])
        for r in prior
        if (r["one_rm"] is not None or r["estimated_1rm"] is not None)
    ]
    best_1rm = max(best_1rm_vals, default=None)

    if working_weight is not None and best_ww is not None and working_weight > best_ww:
        return 1
    cur_1rm = one_rm if one_rm is not None else estimated_1rm
    if cur_1rm is not None and best_1rm is not None and cur_1rm > best_1rm:
        return 1
    return 0


@router.post("/blocks/{block_id}/logs", status_code=201)
def create_workout_log(
    block_id: int,
    payload: WorkoutLogCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    sets_dicts = [s.model_dump() for s in (payload.sets or [])]
    metrics = _resolve_log_metrics(payload.working_weight, payload.one_rm, sets_dicts)
    now = utc_now_iso()

    with get_conn() as conn:
        require_block_owner(conn, block_id, current_user["id"])
        ex = conn.execute(
            "SELECT * FROM block_exercises WHERE id = ? AND block_id = ?",
            (payload.block_exercise_id, block_id),
        ).fetchone()
        if ex is None:
            raise HTTPException(status_code=404, detail="Exercise not found in this block")

        is_pr = _check_is_pr(
            conn,
            block_id,
            current_user["id"],
            payload.block_exercise_id,
            payload.log_date,
            metrics["working_weight"],
            metrics["one_rm"],
            metrics["estimated_1rm"],
        )

        cur = conn.execute(
            """
            INSERT INTO workout_logs(
                block_id, user_id, block_exercise_id, log_date,
                working_weight, one_rm, estimated_1rm, sets_json,
                total_volume, is_pr, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                block_id,
                current_user["id"],
                payload.block_exercise_id,
                payload.log_date,
                metrics["working_weight"],
                metrics["one_rm"],
                metrics["estimated_1rm"],
                metrics["sets_json"],
                metrics["total_volume"],
                is_pr,
                payload.notes.strip(),
                now,
            ),
        )
        log_id = cur.lastrowid
        row = conn.execute("SELECT * FROM workout_logs WHERE id = ?", (log_id,)).fetchone()
        out = dict(row)
        out["sets"] = json.loads(out.get("sets_json") or "[]")
        out["exercise_name"] = ex["name"]
        return out


@router.patch("/logs/{log_id}")
def update_workout_log(
    log_id: int,
    payload: WorkoutLogUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM workout_logs WHERE id = ?", (log_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Workout log not found")
        if existing["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="You can only edit your own logs")

        log_date = payload.log_date or existing["log_date"]
        notes = payload.notes.strip() if payload.notes is not None else existing["notes"]

        if payload.sets is not None:
            sets_dicts = [s.model_dump() for s in payload.sets]
        else:
            sets_dicts = json.loads(existing["sets_json"] or "[]")

        ww = payload.working_weight if payload.working_weight is not None else existing["working_weight"]
        one_rm = payload.one_rm if payload.one_rm is not None else existing["one_rm"]
        metrics = _resolve_log_metrics(ww, one_rm, sets_dicts)
        is_pr = _check_is_pr(
            conn,
            existing["block_id"],
            current_user["id"],
            existing["block_exercise_id"],
            log_date,
            metrics["working_weight"],
            metrics["one_rm"],
            metrics["estimated_1rm"],
            exclude_log_id=log_id,
        )

        conn.execute(
            """
            UPDATE workout_logs
            SET log_date = ?, working_weight = ?, one_rm = ?, estimated_1rm = ?,
                sets_json = ?, total_volume = ?, is_pr = ?, notes = ?
            WHERE id = ?
            """,
            (
                log_date,
                metrics["working_weight"],
                metrics["one_rm"],
                metrics["estimated_1rm"],
                metrics["sets_json"],
                metrics["total_volume"],
                is_pr,
                notes,
                log_id,
            ),
        )
        row = conn.execute("SELECT * FROM workout_logs WHERE id = ?", (log_id,)).fetchone()
        out = dict(row)
        out["sets"] = json.loads(out.get("sets_json") or "[]")
        return out


@router.delete("/logs/{log_id}")
def delete_workout_log(
    log_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM workout_logs WHERE id = ?", (log_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Workout log not found")
        if existing["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="You can only delete your own logs")
        conn.execute("DELETE FROM workout_logs WHERE id = ?", (log_id,))
    return {"ok": True, "id": log_id}


@router.post("/blocks/{block_id}/bodyweight")
def upsert_bodyweight(
    block_id: int,
    payload: BodyweightLogRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    now = utc_now_iso()
    with get_conn() as conn:
        require_block_owner(conn, block_id, current_user["id"])
        conn.execute(
            """
            INSERT INTO bodyweight_logs(block_id, user_id, log_date, weight, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(block_id, user_id, log_date)
            DO UPDATE SET weight = excluded.weight, notes = excluded.notes, created_at = excluded.created_at
            """,
            (block_id, current_user["id"], payload.log_date, payload.weight, payload.notes.strip(), now),
        )
        row = conn.execute(
            "SELECT * FROM bodyweight_logs WHERE block_id = ? AND user_id = ? AND log_date = ?",
            (block_id, current_user["id"], payload.log_date),
        ).fetchone()
        return dict(row)


@router.get("/blocks/{block_id}/dashboard")
def block_dashboard(
    block_id: int,
    ref_date: Optional[str] = Query(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        block = require_block_owner(conn, block_id, current_user["id"])
        return get_block_dashboard(conn, block, current_user["id"], ref_date=ref_date)


@router.get("/blocks/{block_id}/weekly")
def block_weekly(
    block_id: int,
    week: Optional[int] = Query(default=None, ge=1),
    ref_date: Optional[str] = Query(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        block = require_block_owner(conn, block_id, current_user["id"])
        return get_weekly_recap(conn, block, current_user["id"], week_num=week, ref_date=ref_date)


@router.get("/blocks/{block_id}/charts")
def block_charts(
    block_id: int,
    ref_date: Optional[str] = Query(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with get_conn() as conn:
        block = require_block_owner(conn, block_id, current_user["id"])
        return get_block_charts(conn, block, current_user["id"], ref_date=ref_date)
