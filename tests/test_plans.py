"""Unit tests for PairLift progression math and target evaluation."""

from backend.plans import (
    clamped_day_index,
    compute_bodyweight_day_target,
    compute_exercise_day_target,
    compute_normalized_progress,
    compute_sets_summary,
    epley_1rm,
    evaluate_bodyweight_against_target,
    evaluate_lift_against_target,
    mround,
)


def test_mround_half_up_matches_excel():
    # Excel MROUND rounds half away from zero rather than Python banker's rounding
    assert mround(22.5, 2.5) == 22.5
    assert mround(3.75, 2.5) == 5.0
    assert mround(6.25, 2.5) == 7.5
    assert mround(68.35, 0.1) == 68.4
    assert mround(68.25, 0.1) == 68.3


def test_linear_matches_norman_and_romy_spreadsheets():
    # Norman Bench: 50 -> 100 over 98 days, 2.5 kg increments
    assert compute_exercise_day_target("linear", 1, 98, 50.0, 100.0, 2.5)["target"] == 50.0
    assert compute_exercise_day_target("linear", 14, 98, 50.0, 100.0, 2.5)["target"] == 57.5
    assert compute_exercise_day_target("linear", 18, 98, 50.0, 100.0, 2.5)["target"] == 60.0
    assert compute_exercise_day_target("linear", 98, 98, 50.0, 100.0, 2.5)["target"] == 100.0

    # Romy Bench: 30 -> 60 over 98 days, 2.5 kg increments
    assert compute_exercise_day_target("linear", 1, 98, 30.0, 60.0, 2.5)["target"] == 30.0
    assert compute_exercise_day_target("linear", 6, 98, 30.0, 60.0, 2.5)["target"] == 32.5
    assert compute_exercise_day_target("linear", 14, 98, 30.0, 60.0, 2.5)["target"] == 35.0
    assert compute_exercise_day_target("linear", 98, 98, 30.0, 60.0, 2.5)["target"] == 60.0

    # Bodyweight: 68.4 -> 66.0 over 98 days, 0.1 kg increments
    assert compute_bodyweight_day_target(1, 98, 68.4, 66.0) == 68.4
    assert compute_bodyweight_day_target(4, 98, 68.4, 66.0) == 68.3
    assert compute_bodyweight_day_target(98, 98, 68.4, 66.0) == 66.0


def test_531_waves_and_cycle_progression():
    cfg = {"training_max": 100.0, "cycle_increment": 5.0}
    w1 = compute_exercise_day_target("531", 1, 98, 80.0, 120.0, 2.5, cfg)
    assert w1["target"] == 85.0
    assert "65×5 · 75×5 · 85×5+" == w1["prescription"]
    assert "Cycle 1 · 5s Week" == w1["phase"]

    w2 = compute_exercise_day_target("531", 8, 98, 80.0, 120.0, 2.5, cfg)
    assert w2["target"] == 90.0
    assert "Cycle 1 · 3s Week" == w2["phase"]

    w3 = compute_exercise_day_target("531", 15, 98, 80.0, 120.0, 2.5, cfg)
    assert w3["target"] == 95.0
    assert "Cycle 1 · 5/3/1 Week" == w3["phase"]

    w4 = compute_exercise_day_target("531", 22, 98, 80.0, 120.0, 2.5, cfg)
    assert w4["target"] == 60.0
    assert "Deload" in w4["phase"]

    # Cycle 2 Week 1 (day 29): TM increases from 100 -> 105; 85% = 89.25 -> 90.0
    c2_w1 = compute_exercise_day_target("531", 29, 98, 80.0, 120.0, 2.5, cfg)
    assert c2_w1["secondary_target"] == 105.0
    assert c2_w1["target"] == 90.0


def test_1rm_everyday_gzclp_and_custom():
    bulg = compute_exercise_day_target(
        "1rm_everyday",
        1,
        98,
        100.0,
        120.0,
        2.5,
        {"daily_min_start": 85.0, "daily_min_goal": 105.0},
    )
    assert bulg["target"] == 85.0
    assert bulg["secondary_target"] == 105.0 or bulg["secondary_target"] == 100.0
    assert bulg["secondary_target"] == 100.0

    bulg_end = compute_exercise_day_target(
        "1rm_everyday",
        98,
        98,
        100.0,
        120.0,
        2.5,
        {"daily_min_start": 85.0, "daily_min_goal": 105.0},
    )
    assert bulg_end["target"] == 105.0
    assert bulg_end["secondary_target"] == 120.0

    gz = compute_exercise_day_target(
        "gzclp", 15, 98, 60.0, 90.0, 2.5, {"weekly_increment": 2.5, "rep_scheme": "5×3+"}
    )
    assert gz["target"] == 65.0
    assert gz["prescription"] == "5×3+ @ 65 kg"

    cust = compute_exercise_day_target(
        "custom", 8, 98, 50.0, 80.0, 2.5, {"weekly_targets": [50, 55, 60]}
    )
    assert cust["target"] == 55.0


def test_epley_sets_summary_and_evaluations():
    assert epley_1rm(100.0, 1) == 100.0
    assert epley_1rm(60.0, 5) == 70.0  # 60 * (1 + 5/30) = 70.0

    top_w, est, vol = compute_sets_summary(
        [{"weight": 50, "reps": 5}, {"weight": 60, "reps": 6}]
    )
    assert top_w == 60.0
    assert est == 72.0  # 60 * 1.2 = 72.0
    assert vol == 610.0

    ev_beat = evaluate_lift_against_target(62.5, None, None, {"target": 60.0}, "working_weight")
    assert ev_beat["status"] == "beat"
    assert ev_beat["delta"] == 2.5
    assert ev_beat["hit"] is True

    ev_miss = evaluate_lift_against_target(57.5, None, None, {"target": 60.0}, "working_weight")
    assert ev_miss["status"] == "missed"
    assert ev_miss["delta"] == -2.5
    assert ev_miss["hit"] is False

    ev_1rm = evaluate_lift_against_target(80.0, 105.0, 95.0, {"target": 100.0}, "one_rm")
    assert ev_1rm["status"] == "beat"
    assert ev_1rm["actual_value"] == 105.0

    assert compute_normalized_progress(75.0, 50.0, 100.0) == 50.0
    assert clamped_day_index("2026-11-01", "2026-11-14", 98) == 14

    bw_cut_ok = evaluate_bodyweight_against_target(67.2, 67.0, 68.4, 66.0)
    assert bw_cut_ok["on_track"] is True
    bw_cut_bad = evaluate_bodyweight_against_target(68.0, 67.0, 68.4, 66.0)
    assert bw_cut_bad["on_track"] is False


def test_working_weight_target_does_not_fallback_to_1rm():
    from backend.plans import evaluate_lift_against_target

    t_info = {"target": 35.0, "secondary_target": None, "prescription": "Target 35 kg", "phase": "Week 2"}
    ev = evaluate_lift_against_target(
        actual_working=None,
        actual_1rm=85.0,
        est_1rm=None,
        target_info=t_info,
        target_metric="working_weight",
    )
    assert ev["actual_value"] is None
    assert ev["delta"] is None
    assert ev["hit"] is None
    assert ev["status"] == "1rm_only"

    ev_1rm = evaluate_lift_against_target(
        actual_working=50.0,
        actual_1rm=None,
        est_1rm=None,
        target_info={"target": 80.0},
        target_metric="one_rm",
    )
    assert ev_1rm["actual_value"] is None
    assert ev_1rm["hit"] is None
    assert ev_1rm["status"] == "unlogged"
