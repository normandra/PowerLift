"""SQLite connection management, schema initialization, and single-user migration."""

import os
import sqlite3
from contextlib import contextmanager
from typing import Iterator

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_db_path() -> str:
    """Resolve database file path dynamically so PAIRLIFT_DB overrides work cleanly."""
    return os.environ.get("PAIRLIFT_DB", os.path.join(BASE_DIR, "data", "pairlift.db"))


def _connect(db_path: str) -> sqlite3.Connection:
    parent = os.path.dirname(os.path.abspath(db_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Yield a managed SQLite connection with automatic commit/rollback."""
    conn = _connect(get_db_path())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate_legacy_group_schema(conn: sqlite3.Connection) -> None:
    """Migrate an existing v0 group-based blocks schema to single-user ownership safely."""
    cols = conn.execute("PRAGMA table_info(blocks)").fetchall()
    if not cols:
        return
    col_names = {r["name"] for r in cols}
    if "user_id" in col_names:
        # Clean up any leftover group/social tables if present
        conn.executescript(
            """
            DROP TABLE IF EXISTS reactions;
            DROP TABLE IF EXISTS comments;
            DROP TABLE IF EXISTS nudges;
            DROP TABLE IF EXISTS group_members;
            DROP TABLE IF EXISTS groups;
            """
        )
        return

    if "group_id" in col_names:
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.executescript(
            """
            DROP INDEX IF EXISTS idx_blocks_group;
            DROP INDEX IF EXISTS idx_nudges_to_user;

            CREATE TABLE blocks_backup AS
            SELECT id, created_by AS user_id, name, start_date, duration_days,
                   track_bodyweight, weekly_session_goal, status, created_at
            FROM blocks;

            DROP TABLE blocks;

            CREATE TABLE blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                start_date TEXT NOT NULL,
                duration_days INTEGER NOT NULL,
                track_bodyweight INTEGER NOT NULL DEFAULT 1,
                weekly_session_goal INTEGER NOT NULL DEFAULT 3,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL
            );

            INSERT INTO blocks(
                id, user_id, name, start_date, duration_days,
                track_bodyweight, weekly_session_goal, status, created_at
            )
            SELECT id, user_id, name, start_date, duration_days,
                   track_bodyweight, weekly_session_goal, status, created_at
            FROM blocks_backup;

            DROP TABLE blocks_backup;

            DROP TABLE IF EXISTS reactions;
            DROP TABLE IF EXISTS comments;
            DROP TABLE IF EXISTS nudges;
            DROP TABLE IF EXISTS group_members;
            DROP TABLE IF EXISTS groups;
            """
        )
        conn.execute("PRAGMA foreign_keys = ON;")


def init_db() -> None:
    """Create all 8 single-user database tables and indexes (migrating v0 schemas if needed)."""
    with get_conn() as conn:
        _migrate_legacy_group_schema(conn)
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                avatar_color TEXT NOT NULL DEFAULT '#FF6B57',
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                start_date TEXT NOT NULL,
                duration_days INTEGER NOT NULL,
                track_bodyweight INTEGER NOT NULL DEFAULT 1,
                weekly_session_goal INTEGER NOT NULL DEFAULT 3,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS block_exercises (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                default_increment REAL NOT NULL DEFAULT 2.5,
                sort_order INTEGER NOT NULL DEFAULT 0,
                UNIQUE (block_id, slug)
            );

            CREATE TABLE IF NOT EXISTS member_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                plan_type TEXT NOT NULL DEFAULT 'linear',
                plan_name TEXT NOT NULL DEFAULT 'Linear Progression',
                bodyweight_start REAL,
                bodyweight_goal REAL,
                updated_at TEXT NOT NULL,
                UNIQUE (block_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS member_exercise_targets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_plan_id INTEGER NOT NULL REFERENCES member_plans(id) ON DELETE CASCADE,
                block_exercise_id INTEGER NOT NULL REFERENCES block_exercises(id) ON DELETE CASCADE,
                plan_type TEXT NOT NULL DEFAULT 'linear',
                target_metric TEXT NOT NULL DEFAULT 'working_weight',
                start_weight REAL NOT NULL,
                goal_weight REAL NOT NULL,
                increment REAL NOT NULL DEFAULT 2.5,
                config_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE (member_plan_id, block_exercise_id)
            );

            CREATE TABLE IF NOT EXISTS workout_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                block_exercise_id INTEGER NOT NULL REFERENCES block_exercises(id) ON DELETE CASCADE,
                log_date TEXT NOT NULL,
                working_weight REAL,
                one_rm REAL,
                estimated_1rm REAL,
                sets_json TEXT NOT NULL DEFAULT '[]',
                total_volume REAL NOT NULL DEFAULT 0,
                is_pr INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bodyweight_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                log_date TEXT NOT NULL,
                weight REAL NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE (block_id, user_id, log_date)
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks(user_id);
            CREATE INDEX IF NOT EXISTS idx_workout_logs_block_date ON workout_logs(block_id, log_date);
            CREATE INDEX IF NOT EXISTS idx_workout_logs_user_ex ON workout_logs(user_id, block_exercise_id, log_date);
            CREATE INDEX IF NOT EXISTS idx_bodyweight_block_user ON bodyweight_logs(block_id, user_id, log_date);
            """
        )
