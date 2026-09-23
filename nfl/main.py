"""NFL model runner — writes the weekly Anytime-TD slate JSON.

Output: frontend/public/data/nfl/<season>-w<week>.json (+ latest.json + index.json).
Compact JSON (no indent) — same rule as the MLB slates so files stay small.

Run:  python3 -m nfl.main --season 2025 --week 10
      python3 -m nfl.main                    (auto-detects season/week from today's date)
Meant to run DAILY via cron, same as MLB — not just because a new week starts
each Thursday, but because it also refreshes depth charts/injury reports for
the week already in progress (a Sunday-morning inactive shouldn't require a
manual re-run to show up).
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

try:
    from .model import score_week
    from .data_fetchers import load_schedules
except ImportError:
    from model import score_week
    from data_fetchers import load_schedules

OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data" / "nfl"


def current_season_week(today: date | None = None) -> tuple[int, int]:
    """The season/week to run for RIGHT NOW. A season is labeled by the year
    it starts in (Sep) and runs through Feb of the next calendar year — same
    convention as the frontend's `seasonOf` (Jan/Feb belongs to the prior
    season). The current week is the first one whose games aren't ALL in the
    past yet, so the slate rolls over to next week's matchups the moment the
    current week finishes, not just once its own games start."""
    today = today or datetime.now(timezone.utc).date()
    season = today.year if today.month >= 3 else today.year - 1
    sched = load_schedules(season)
    reg = sched[sched["game_type"] == "REG"]
    weeks = sorted(int(w) for w in reg["week"].unique())
    for wk in weeks:
        last_game = reg.loc[reg["week"] == wk, "gameday"].max()
        if str(last_game) >= today.isoformat():
            return season, wk
    return season, (weeks[-1] if weeks else 1)  # season's fully over -> last week


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
    ap.add_argument("--season", type=int, default=None, help="Defaults to today's real season if omitted.")
    ap.add_argument("--week", type=int, default=None, help="Defaults to today's real week if omitted.")
    args = ap.parse_args()
    season, week = args.season, args.week
    if season is None or week is None:
        auto_season, auto_week = current_season_week()
        season = season if season is not None else auto_season
        week = week if week is not None else auto_week
    run_model(season, week)


if __name__ == "__main__":
    main()
