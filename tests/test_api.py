"""End-to-end API integration tests for single-user PairLift workflows & legacy DB migration."""

import sqlite3
from fastapi.testclient import TestClient

from backend.db import init_db
from backend.main import app


def _make_client(tmp_path, monkeypatch, filename="test_pairlift.db"):
    db_file = tmp_path / filename
    monkeypatch.setenv("PAIRLIFT_DB", str(db_file))
    init_db()
    return TestClient(app)


def test_single_user_lifecycle_and_isolation(tmp_path, monkeypatch):
    db_file = tmp_path / "test_single.db"
    monkeypatch.setenv("PAIRLIFT_DB", str(db_file))
    init_db()

    client_a = TestClient(app)
    client_b = TestClient(app)

    # 1. Register user A and user B
    r_a = client_a.post(
        "/api/auth/register",
        json={"username": "norman", "display_name": "Norman", "password": "secret"},
    )
    assert r_a.status_code == 201

    r_b = client_b.post(
        "/api/auth/register",
        json={"username": "other", "display_name": "Other", "password": "secret"},
    )
    assert r_b.status_code == 201

    # 2. User A creates a 14-week block defaulting to Big 3 + bodyweight
    blk_res = client_a.post(
        "/api/blocks",
        json={
            "name": "Winter Block",
            "start_date": "2026-11-01",
            "duration_weeks": 14,
            "track_bodyweight": True,
            "weekly_session_goal": 3,
        },
    )
    assert blk_res.status_code == 201
    blk_data = blk_res.json()
    block_id = blk_data["block"]["id"]
    ex_names = [e["name"] for e in blk_data["exercises"]]
    assert ex_names == ["Squat", "Bench", "Deadlift"]
    ex_by_name = {e["name"]: e["id"] for e in blk_data["exercises"]}

    # User B cannot access User A's block
    assert client_b.get(f"/api/blocks/{block_id}").status_code == 403
    assert client_b.get(f"/api/blocks/{block_id}/dashboard").status_code == 403
    assert client_b.delete(f"/api/blocks/{block_id}").status_code == 403

    # 3. User A configures Linear plan on Bench/Squat and 5/3/1 on Deadlift
    plan_res = client_a.put(
        f"/api/blocks/{block_id}/my-plan",
        json={
            "plan_type": "linear",
            "bodyweight_start": 68.4,
            "bodyweight_goal": 66.0,
            "targets": [
                {"block_exercise_id": ex_by_name["Squat"], "start_weight": 60, "goal_weight": 120, "increment": 2.5},
                {"block_exercise_id": ex_by_name["Bench"], "start_weight": 50, "goal_weight": 100, "increment": 2.5},
                {
                    "block_exercise_id": ex_by_name["Deadlift"],
                    "plan_type": "531",
                    "start_weight": 80,
                    "goal_weight": 160,
                    "increment": 2.5,
                    "config": {"training_max": 120, "cycle_increment": 5},
                },
            ],
        },
    )
    assert plan_res.status_code == 200
    assert plan_res.json()["plan"]["plan_type"] == "linear"

    # Plan preview
    prev = client_a.post(
        f"/api/blocks/{block_id}/plan-preview",
        json={"plan_type": "linear", "start_weight": 50, "goal_weight": 100, "increment": 2.5},
    )
    assert prev.status_code == 200
    assert prev.json()["day_1"]["target"] == 50.0
    assert prev.json()["final"]["target"] == 100.0

    # 4. Log quick working weight + sets×reps + PR detection
    log_1 = client_a.post(
        f"/api/blocks/{block_id}/logs",
        json={
            "block_exercise_id": ex_by_name["Bench"],
            "log_date": "2026-11-01",
            "working_weight": 50.0,
            "one_rm": 75.0,
            "notes": "Day 1 opener",
        },
    )
    assert log_1.status_code == 201
    assert log_1.json()["is_pr"] == 0
    log_1_id = log_1.json()["id"]

    log_2 = client_a.post(
        f"/api/blocks/{block_id}/logs",
        json={
            "block_exercise_id": ex_by_name["Bench"],
            "log_date": "2026-11-10",
            "sets": [
                {"weight": 50.0, "reps": 5},
                {"weight": 57.5, "reps": 6},
            ],
            "notes": "Beat Week 2 target!",
        },
    )
    assert log_2.status_code == 201
    l2 = log_2.json()
    assert l2["is_pr"] == 1
    assert l2["working_weight"] == 57.5
    assert l2["estimated_1rm"] == 69.0  # 57.5 * 1.2 = 69.0
    assert l2["total_volume"] == 50 * 5 + 57.5 * 6

    # Edit and delete ownership checks
    assert client_b.delete(f"/api/logs/{log_1_id}").status_code == 403
    patch_res = client_a.patch(f"/api/logs/{log_1_id}", json={"notes": "Updated opener"})
    assert patch_res.status_code == 200
    assert patch_res.json()["notes"] == "Updated opener"

    # Bodyweight check-in
    bw = client_a.post(
        f"/api/blocks/{block_id}/bodyweight",
        json={"log_date": "2026-11-11", "weight": 68.1},
    )
    assert bw.status_code == 200

    # 5. Verify dashboard, weekly, charts
    dash = client_a.get(f"/api/blocks/{block_id}/dashboard?ref_date=2026-11-12").json()
    assert dash["stats"]["sessions_logged"] == 2
    assert dash["stats"]["streak_weeks"] == 2
    assert dash["stats"]["total_prs"] == 1
    assert len(dash["recent_logs"]) == 2

    wk2 = client_a.get(f"/api/blocks/{block_id}/weekly?week=2&ref_date=2026-11-12").json()
    assert wk2["week_number"] == 2
    assert wk2["targets_hit"] == 1
    assert len(wk2["prs"]) == 1

    charts = client_a.get(f"/api/blocks/{block_id}/charts?ref_date=2026-11-12").json()
    bench_chart = next(e for e in charts["exercises"] if e["name"] == "Bench")
    assert len(bench_chart["target_series"]) == 98
    assert len(bench_chart["actual_points"]) == 2
    assert charts["bodyweight"]["enabled"] is True
    assert len(charts["bodyweight"]["actual_points"]) == 1

    # Archive block
    arch = client_a.patch(f"/api/blocks/{block_id}", json={"status": "archived"})
    assert arch.status_code == 200
    assert arch.json()["block"]["status"] == "archived"

    # Delete log
    assert client_a.delete(f"/api/logs/{log_1_id}").status_code == 200


def test_demo_endpoint(tmp_path, monkeypatch):
    client = _make_client(tmp_path, monkeypatch)
    res = client.post("/api/auth/demo")
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["username"] == "demo_lifter"
    assert len(data["blocks"]) == 1
    bid = data["blocks"][0]["id"]
    dash = client.get(f"/api/blocks/{bid}/dashboard").json()
    assert len(dash["today_cards"]) == 4
    assert dash["stats"]["sessions_logged"] > 0


def test_legacy_group_schema_migrates_cleanly(tmp_path, monkeypatch):
    db_file = tmp_path / "legacy_v0.db"
    conn = sqlite3.connect(str(db_file))
    conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            avatar_color TEXT NOT NULL DEFAULT '#FF6B57',
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            invite_code TEXT NOT NULL UNIQUE,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE group_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            PRIMARY KEY (group_id, user_id)
        );
        CREATE TABLE blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            start_date TEXT NOT NULL,
            duration_days INTEGER NOT NULL,
            track_bodyweight INTEGER NOT NULL DEFAULT 1,
            weekly_session_goal INTEGER NOT NULL DEFAULT 3,
            status TEXT NOT NULL DEFAULT 'active',
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE block_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            slug TEXT NOT NULL,
            default_increment REAL NOT NULL DEFAULT 2.5,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE reactions (id INTEGER PRIMARY KEY);
        CREATE TABLE comments (id INTEGER PRIMARY KEY);
        CREATE TABLE nudges (id INTEGER PRIMARY KEY);

        INSERT INTO users(id, username, display_name, password_hash, created_at)
        VALUES (1, 'norman', 'Norman', 'x', '2026-11-01T00:00:00Z');
        INSERT INTO groups(id, name, invite_code, created_by, created_at)
        VALUES (1, 'Legacy Group', 'PAIR-1234', 1, '2026-11-01T00:00:00Z');
        INSERT INTO blocks(id, group_id, name, start_date, duration_days, created_by, created_at)
        VALUES (10, 1, 'Legacy Block', '2026-11-01', 98, 1, '2026-11-01T00:00:00Z');
        INSERT INTO block_exercises(id, block_id, name, slug)
        VALUES (100, 10, 'Squat', 'squat');
        """
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv("PAIRLIFT_DB", str(db_file))
    init_db()

    conn2 = sqlite3.connect(str(db_file))
    conn2.row_factory = sqlite3.Row
    cols = {r["name"] for r in conn2.execute("PRAGMA table_info(blocks)").fetchall()}
    assert "user_id" in cols
    assert "group_id" not in cols
    blk = conn2.execute("SELECT * FROM blocks WHERE id = 10").fetchone()
    assert blk["user_id"] == 1
    assert blk["name"] == "Legacy Block"
    ex = conn2.execute("SELECT * FROM block_exercises WHERE block_id = 10").fetchone()
    assert ex["name"] == "Squat"
    tables = {
        r["name"]
        for r in conn2.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "groups" not in tables
    assert "reactions" not in tables
    assert "nudges" not in tables
    conn2.close()
