"""NFL model runner — writes the weekly Anytime-TD slate JSON.

Output: frontend/public/data/nfl/<season>-w<week>.json (+ latest.json + index.json).
Compact JSON (no indent) — same rule as the MLB slates so files stay small.

Run:  python3 -m nfl.main --season 2025 --week 10
Weekly cadence (a season plays one slate per week), unlike the daily MLB model.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

try:
    from .model import score_week
except ImportError:
    from model import score_week

OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data" / "nfl"


def run_model(season: int, week: int) -> dict:
    meta, games = score_week(season, week)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {**meta, "generated_at": datetime.now(timezone.utc).isoformat(), "games": games}

    name = f"{season}-w{week:02d}.json"
    for path in (OUT_DIR / name, OUT_DIR / "latest.json"):
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"), default=str)

    # index of available slates
    idx = OUT_DIR / "index.json"
    slates = []
    if idx.exists():
        try:
            slates = json.load(open(idx)).get("slates", [])
        except Exception:
            pass
    slates = [s for s in slates if not (s["season"] == season and s["week"] == week)]
    slates.append({"season": season, "week": week, "file": name})
    slates.sort(key=lambda s: (s["season"], s["week"]), reverse=True)
    with open(idx, "w") as f:
        json.dump({"slates": slates}, f, indent=2)

    n = sum(len(g["players"]) for g in games)
    print(f"NFL {season} wk{week}: {len(games)} games, {n} players -> {OUT_DIR / name}")
    return payload


def main() -> None:
    ap = argparse.ArgumentParser(description="NFL Anytime-TD weekly model")
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--week", type=int, required=True)
    args = ap.parse_args()
    run_model(args.season, args.week)


if __name__ == "__main__":
    main()
