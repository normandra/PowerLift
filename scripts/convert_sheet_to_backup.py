#!/usr/bin/env python3
"""Convert a Google Sheet gym export (.xlsx) into a PairLift schema_version=1 JSON backup."""

import argparse
import json
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
EXERCISE_ORDER = ["Squat", "Bench", "Deadlift"]


def _excel_serial_to_iso(serial_str: str) -> str:
    days = float(serial_str)
    return (datetime(1899, 12, 30) + timedelta(days=days)).strftime("%Y-%m-%d")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "exercise"


def _parse_mround_increment(formula_text: Optional[str], default: float = 2.5) -> float:
    if not formula_text:
        return default
    m = re.search(r",\s*([0-9]+(?:\.[0-9]+)?)\s*\)\s*$", formula_text.strip())
    return float(m.group(1)) if m else default


def _read_sheet_rows(xlsx_path: str) -> Tuple[Dict[str, str], Dict[int, Dict[str, Tuple[Optional[str], Optional[str]]]]]:
    """Return (headers_by_col, rows_by_num -> {col_letter: (val, formula)})."""
    with zipfile.ZipFile(xlsx_path) as z:
        shared_strings: List[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            ss_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in ss_root.findall("m:si", NS):
                shared_strings.append("".join(t.text or "" for t in si.findall(".//m:t", NS)))

        sroot = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        headers: Dict[str, str] = {}
        rows: Dict[int, Dict[str, Tuple[Optional[str], Optional[str]]]] = {}

        for row in sroot.findall(".//m:sheetData/m:row", NS):
            rnum = int(row.attrib["r"])
            row_map: Dict[str, Tuple[Optional[str], Optional[str]]] = {}
            for c in row.findall("m:c", NS):
                ref = c.attrib.get("r", "")
                col = "".join(ch for ch in ref if ch.isalpha())
                ctype = c.attrib.get("t")
                f_el = c.find("m:f", NS)
                v_el = c.find("m:v", NS)
                formula = f_el.text if f_el is not None else None
                # Also capture shared formula marker if present
                if f_el is not None and formula is None:
                    formula = "__shared__"
                val = v_el.text if v_el is not None else None
                if ctype == "s" and val is not None:
                    val = shared_strings[int(val)]
                elif ctype == "inlineStr":
                    val = "".join(x.text or "" for x in c.findall(".//m:t", NS))

                if rnum == 1 and val is not None:
                    headers[col] = val.strip()
                elif val is not None or formula is not None:
                    row_map[col] = (val, formula)
            if row_map:
                rows[rnum] = row_map
    return headers, rows


def convert_xlsx_to_backup(
    xlsx_path: str,
    display_name: str,
    avatar_color: str,
    block_name: str,
    skip_1m: bool = False,
) -> Dict[str, Any]:
    headers, rows = _read_sheet_rows(xlsx_path)
    col_by_header: Dict[str, str] = {h: c for c, h in headers.items()}

    row2 = rows.get(2, {})
    row105 = rows.get(105, {})
    row106 = rows.get(106, {})

    start_serial = row2.get(col_by_header["Date"], (None, None))[0]
    if not start_serial:
        raise ValueError(f"Could not find start date in Row 2 of {xlsx_path}")
    start_date = _excel_serial_to_iso(start_serial)

    goal_day_val = row106.get(col_by_header["Day"], ("98", None))[0]
    duration_days = int(round(float(goal_day_val or 98)))

    bw_target_col = col_by_header.get("Bodyweight Target")
    bw_start = float(row105[bw_target_col][0]) if bw_target_col and bw_target_col in row105 else None
    bw_goal = float(row106[bw_target_col][0]) if bw_target_col and bw_target_col in row106 else None

    now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    user_id = str(uuid.uuid4())
    block_id = str(uuid.uuid4())
    plan_id = str(uuid.uuid4())

    block_exercises: List[Dict[str, Any]] = []
    exercise_targets: List[Dict[str, Any]] = []
    ex_id_by_name: Dict[str, str] = {}

    for sort_order, ex_name in enumerate(EXERCISE_ORDER):
        target_header = f"{ex_name} Target"
        t_col = col_by_header.get(target_header)
        if not t_col:
            continue
        inc = _parse_mround_increment(row2.get(t_col, (None, None))[1], default=2.5)
        sw = float(row105[t_col][0]) if t_col in row105 and row105[t_col][0] is not None else 0.0
        gw = float(row106[t_col][0]) if t_col in row106 and row106[t_col][0] is not None else sw

        ex_id = str(uuid.uuid4())
        ex_id_by_name[ex_name] = ex_id
        block_exercises.append(
            {
                "id": ex_id,
                "block_id": block_id,
                "name": ex_name,
                "slug": _slugify(ex_name),
                "default_increment": inc,
                "sort_order": sort_order,
            }
        )
        exercise_targets.append(
            {
                "id": str(uuid.uuid4()),
                "member_plan_id": plan_id,
                "block_exercise_id": ex_id,
                "plan_type": "linear",
                "target_metric": "working_weight",
                "start_weight": sw,
                "goal_weight": gw,
                "increment": inc,
                "config": {},
            }
        )

    workout_logs: List[Dict[str, Any]] = []
    bodyweight_logs: List[Dict[str, Any]] = []
    best_ww_by_ex: Dict[str, float] = {}
    best_1rm_by_ex: Dict[str, float] = {}

    date_col = col_by_header["Date"]
    bw_col = col_by_header.get("Bodyweight")

    for rnum in sorted(rows.keys()):
        if rnum < 2 or rnum > 103:
            continue
        rmap = rows[rnum]
        date_cell = rmap.get(date_col)
        if not date_cell or date_cell[0] is None:
            continue
        log_date = _excel_serial_to_iso(date_cell[0])

        # Bodyweight entry (only if non-formula)
        if bw_col and bw_col in rmap:
            bw_val, bw_formula = rmap[bw_col]
            if bw_formula is None and bw_val is not None:
                bodyweight_logs.append(
                    {
                        "id": str(uuid.uuid4()),
                        "block_id": block_id,
                        "user_id": user_id,
                        "log_date": log_date,
                        "weight": float(bw_val),
                        "notes": "",
                        "created_at": now_iso,
                        "updated_at": now_iso,
                    }
                )

        # Combine <Lift> working weight and <Lift> 1M on the same date into one log
        for ex_name in EXERCISE_ORDER:
            ex_id = ex_id_by_name.get(ex_name)
            if not ex_id:
                continue
            ww_col = col_by_header.get(ex_name)
            orm_col = col_by_header.get(f"{ex_name} 1M")

            ww_val: Optional[float] = None
            orm_val: Optional[float] = None
            if ww_col and ww_col in rmap:
                v, f = rmap[ww_col]
                if f is None and v is not None:
                    ww_val = float(v)
            if not skip_1m and orm_col and orm_col in rmap:
                v, f = rmap[orm_col]
                if f is None and v is not None:
                    orm_val = float(v)

            if ww_val is None and orm_val is None:
                continue

            is_pr = 0
            if ex_id in best_ww_by_ex or ex_id in best_1rm_by_ex:
                if ww_val is not None and ex_id in best_ww_by_ex and ww_val > best_ww_by_ex[ex_id]:
                    is_pr = 1
                if orm_val is not None and ex_id in best_1rm_by_ex and orm_val > best_1rm_by_ex[ex_id]:
                    is_pr = 1

            if ww_val is not None:
                best_ww_by_ex[ex_id] = max(best_ww_by_ex.get(ex_id, ww_val), ww_val)
            if orm_val is not None:
                best_1rm_by_ex[ex_id] = max(best_1rm_by_ex.get(ex_id, orm_val), orm_val)

            workout_logs.append(
                {
                    "id": str(uuid.uuid4()),
                    "block_id": block_id,
                    "user_id": user_id,
                    "block_exercise_id": ex_id,
                    "log_date": log_date,
                    "working_weight": ww_val,
                    "one_rm": orm_val,
                    "estimated_1rm": None,
                    "sets": [],
                    "total_volume": 0,
                    "is_pr": is_pr,
                    "notes": "",
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }
            )

    return {
        "schema_version": 1,
        "app": "PairLift",
        "exported_at": now_iso,
        "user": {
            "id": user_id,
            "username": "local",
            "display_name": display_name,
            "avatar_color": avatar_color,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        "blocks": [
            {
                "id": block_id,
                "user_id": user_id,
                "name": block_name,
                "start_date": start_date,
                "duration_days": duration_days,
                "track_bodyweight": True,
                "weekly_session_goal": 3,
                "status": "active",
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        ],
        "block_exercises": block_exercises,
        "plans": [
            {
                "id": plan_id,
                "block_id": block_id,
                "user_id": user_id,
                "plan_type": "linear",
                "plan_name": "Linear Target Curve",
                "bodyweight_start": bw_start,
                "bodyweight_goal": bw_goal,
                "updated_at": now_iso,
            }
        ],
        "exercise_targets": exercise_targets,
        "workout_logs": workout_logs,
        "bodyweight_logs": bodyweight_logs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to exported .xlsx sheet")
    parser.add_argument("--output", required=True, help="Path to write PairLift .json backup")
    parser.add_argument("--name", required=True, help="Display name (e.g. Norman)")
    parser.add_argument("--color", default="#FF6B57", help="Avatar hex color")
    parser.add_argument("--block-name", required=True, help="Training block title")
    parser.add_argument(
        "--skip-1m",
        action="store_true",
        help="Exclude 1M columns (useful when template 1M values were copied)",
    )
    args = parser.parse_args()

    backup = convert_xlsx_to_backup(
        args.input,
        args.name,
        args.color,
        args.block_name,
        skip_1m=args.skip_1m,
    )
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(backup, f, indent=2)
    print(
        f"Wrote {args.output}: {len(backup['block_exercises'])} exercises, "
        f"{len(backup['workout_logs'])} workout logs, {len(backup['bodyweight_logs'])} bodyweight logs"
    )


if __name__ == "__main__":
    main()
