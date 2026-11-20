"""Authentication, password hashing, session management, and block ownership guards."""

import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import Cookie, Depends, Header, HTTPException, Response

from backend.db import get_conn

SESSION_COOKIE_NAME = "pairlift_session"
SESSION_DAYS = 30
PBKDF2_ITERATIONS = 200_000


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def hash_password(password: str) -> str:
    """Hash a plaintext password using PBKDF2-HMAC-SHA256 and a random salt."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a plaintext password against a stored PBKDF2 hash."""
    try:
        algo, iters_str, salt, expected = stored_hash.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_str)
    except (ValueError, AttributeError):
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iters,
    ).hex()
    return hmac.compare_digest(digest, expected)


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    """Insert a 30-day session row and return the session token."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    expires = now + timedelta(days=SESSION_DAYS)
    conn.execute(
        "INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now.isoformat(), expires.isoformat()),
    )
    return token


def set_session_cookie(response: Response, token: str) -> None:
    """Attach the HttpOnly session cookie to a FastAPI response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Expire the session cookie."""
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


def extract_token(
    cookie_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    authorization: Optional[str] = Header(default=None),
) -> Optional[str]:
    """Extract session token from HttpOnly cookie or Bearer Authorization header."""
    if cookie_token:
        return cookie_token
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _lookup_user_by_token(conn: sqlite3.Connection, token: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT u.id, u.username, u.display_name, u.avatar_color, u.created_at, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()
    if row is None:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "avatar_color": row["avatar_color"],
        "created_at": row["created_at"],
    }


def get_current_user(token: Optional[str] = Depends(extract_token)) -> Dict[str, Any]:
    """FastAPI dependency that resolves the authenticated user or raises 401."""
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    with get_conn() as conn:
        user = _lookup_user_by_token(conn, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def require_block_owner(conn: sqlite3.Connection, block_id: int, user_id: int) -> sqlite3.Row:
    """Load block and verify current user owns it (raises 404 or 403)."""
    block = conn.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
    if block is None:
        raise HTTPException(status_code=404, detail="Training block not found")
    if block["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this block")
    return block
