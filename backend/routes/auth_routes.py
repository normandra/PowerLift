"""Authentication and single-user demo routes."""

import sqlite3
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from backend.auth import (
    clear_session_cookie,
    create_session,
    extract_token,
    get_current_user,
    hash_password,
    set_session_cookie,
    utc_now_iso,
    verify_password,
)
from backend.db import get_conn
from backend.demo import ensure_demo_user
from backend.schemas import LoginRequest, RegisterRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _fetch_user_bundle(conn: sqlite3.Connection, user_id: int) -> Dict[str, Any]:
    user_row = conn.execute(
        "SELECT id, username, display_name, avatar_color, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    blocks = [
        dict(r)
        for r in conn.execute(
            """
            SELECT b.*,
                   (SELECT COUNT(*) FROM block_exercises be WHERE be.block_id = b.id) AS exercise_count
            FROM blocks b
            WHERE b.user_id = ?
            ORDER BY CASE WHEN b.status = 'active' THEN 0 ELSE 1 END, b.start_date DESC, b.id DESC
            """,
            (user_id,),
        ).fetchall()
    ]
    return {
        "user": dict(user_row),
        "blocks": blocks,
    }


@router.post("/register", status_code=201)
def register(payload: RegisterRequest, response: Response) -> Dict[str, Any]:
    username = payload.username.strip().lower()
    display_name = payload.display_name.strip()
    avatar_color = (payload.avatar_color or "#FF6B57").strip()
    if not username or not display_name:
        raise HTTPException(status_code=400, detail="Username and display name are required")

    now = utc_now_iso()
    pw_hash = hash_password(payload.password)

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Username is already taken")

        cur = conn.execute(
            """
            INSERT INTO users(username, display_name, avatar_color, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (username, display_name, avatar_color, pw_hash, now),
        )
        user_id = cur.lastrowid
        token = create_session(conn, user_id)
        bundle = _fetch_user_bundle(conn, user_id)

    set_session_cookie(response, token)
    bundle["token"] = token
    return bundle


@router.post("/login")
def login(payload: LoginRequest, response: Response) -> Dict[str, Any]:
    username = payload.username.strip().lower()
    with get_conn() as conn:
        user_row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not user_row or not verify_password(payload.password, user_row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        token = create_session(conn, user_row["id"])
        bundle = _fetch_user_bundle(conn, user_row["id"])

    set_session_cookie(response, token)
    bundle["token"] = token
    return bundle


@router.post("/logout")
def logout(
    response: Response,
    token: Optional[str] = Depends(extract_token),
) -> Dict[str, Any]:
    if token:
        with get_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    with get_conn() as conn:
        return _fetch_user_bundle(conn, current_user["id"])


@router.post("/demo")
def demo_login(response: Response) -> Dict[str, Any]:
    """Ensure the single-user sample training block exists and sign in."""
    with get_conn() as conn:
        demo_info = ensure_demo_user(conn)
        token = create_session(conn, demo_info["user_id"])
        bundle = _fetch_user_bundle(conn, demo_info["user_id"])

    set_session_cookie(response, token)
    bundle["token"] = token
    return bundle
