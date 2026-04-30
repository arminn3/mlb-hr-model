#!/usr/bin/env python3
"""Refresh game status + weather (incl. gusts) for today's slate.

Re-pulls each game's MLB status and re-fetches weather for the current game
hour. Patches the slate JSON in place. Does NOT re-score batters.

Run any time during the day to surface delays / refreshed forecasts.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import requests

import config
from environment import calc_environment_score
from main import _estimate_local_game_hour

SLATE_DIR = Path("frontend/public/data")
MLB_API = "https://statsapi.mlb.com/api/v1"


def _fetch_game_state(game_date: date) -> dict[int, dict]:
    """Returns {game_pk: {status, datetime, ...}}."""
    url = f"{MLB_API}/schedule?date={game_date.isoformat()}&sportId=1&hydrate=team"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    out: dict[int, dict] = {}
    for de in r.json().get("dates", []):
        for g in de.get("games", []):
            status = g.get("status", {})
            out[g["gamePk"]] = {
                "game_datetime_utc": g.get("gameDate", ""),
                "detailed_state": status.get("detailedState", ""),
                "abstract_state": status.get("abstractGameState", ""),
                "reason": status.get("reason", ""),
                "is_tbd": status.get("startTimeTBD", False),
            }
    return out


def _format_game_time(utc_str: str) -> tuple[str, int]:
    """Format UTC ISO time as 'h:mm AM/PM ET' string + sort key (minutes since midnight ET)."""
    if not utc_str or len(utc_str) < 16:
        return "TBD", 9999
    try:
        utc_hour = int(utc_str[11:13])
        utc_min = int(utc_str[14:16])
    except (ValueError, IndexError):
        return "TBD", 9999
    est_hour = (utc_hour - 4) % 24
    ampm = "AM" if est_hour < 12 else "PM"
    display_hour = est_hour % 12 or 12
    return f"{display_hour}:{utc_min:02d} {ampm} ET", est_hour * 60 + utc_min


def refresh(game_date: date) -> None:
    slate_path = SLATE_DIR / f"{game_date.isoformat()}.json"
    if not slate_path.exists():
        print(f"No slate at {slate_path}", file=sys.stderr)
        sys.exit(1)

    slate = json.loads(slate_path.read_text())
    state = _fetch_game_state(game_date)

    n_status_updated = 0
    n_time_changed = 0
    n_weather_refreshed = 0

    for g in slate["games"]:
        gpk = g["game_pk"]
        live = state.get(gpk)
        if not live:
            continue

        # Game status — surface delay / postponement
        prev_status = g.get("game_status")
        new_status = live["detailed_state"]
        new_reason = live["reason"]
        if prev_status != new_status:
            g["game_status"] = new_status
            if new_reason:
                g["game_status_reason"] = new_reason
            elif "game_status_reason" in g:
                del g["game_status_reason"]
            n_status_updated += 1
            print(f"  {g['away_team']}@{g['home_team']}: status -> {new_status}"
                  f"{' (' + new_reason + ')' if new_reason else ''}")

        # Game time — re-format from MLB's current gameDate
        new_time_str, new_sort = _format_game_time(live["game_datetime_utc"])
        if g.get("game_time") != new_time_str:
            print(f"  {g['away_team']}@{g['home_team']}: time {g.get('game_time')} -> {new_time_str}")
            g["game_time"] = new_time_str
            g["game_time_sort"] = new_sort
            n_time_changed += 1

        # Weather — always refresh; forecasts update through the day
        home = g.get("home_team", "")
        if not home:
            continue
        game_hour = _estimate_local_game_hour(live["game_datetime_utc"], home)
        env = calc_environment_score(home, game_date, game_hour_local=game_hour)
        # Preserve fields the scoring pipeline writes (park_factor, env_score etc.)
        # and just overlay live-weather fields.
        existing = g.get("environment", {}) or {}
        for k, v in env.items():
            existing[k] = v
        g["environment"] = existing
        n_weather_refreshed += 1

    # Re-sort games by current start time
    slate["games"].sort(key=lambda g: g.get("game_time_sort", 9999))
    slate["refreshed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    slate_path.write_text(json.dumps(slate, indent=2, default=str))
    print(f"\nSaved {slate_path}")
    print(f"  {n_status_updated} status changes, {n_time_changed} time changes, "
          f"{n_weather_refreshed} weather refreshes")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--date", type=str, default=None, help="YYYY-MM-DD; defaults to today")
    args = p.parse_args()
    d = date.fromisoformat(args.date) if args.date else date.today()
    refresh(d)
