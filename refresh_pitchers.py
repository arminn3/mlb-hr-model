"""Lightweight refresher for probable starting pitchers.

Reads the current slate JSON (frontend/public/data/{date}.json), fetches the
latest probable pitcher names from MLB Stats API, and rewrites ONLY the
`away_pitcher`/`home_pitcher` blocks if anything changed (name, hand, id).

NEVER touches scores, batter ratings, or pitcher profiles — those are frozen
per the slate-lock rule. This is purely a metadata refresh so the site shows
the actual starter when MLB updates probables (rotation shuffles, scratches,
etc.). Run on a frequent cron (every 15–30 min) in the pre-game window.

Usage:
    python3 refresh_pitchers.py                    # refresh today
    python3 refresh_pitchers.py --date 2026-06-22
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Optional

import requests


SCHEDULE_URL = (
    "https://statsapi.mlb.com/api/v1/schedule"
    "?sportId=1&date={d}&hydrate=probablePitcher,team"
)


def fetch_probables(game_date: date) -> dict[int, dict]:
    """Return {gamePk: {away_pitcher: {...}, home_pitcher: {...}}} for the day.

    Pitcher dicts hold name/id/hand, matching the shape stored in our slate JSON.
    """
    url = SCHEDULE_URL.format(d=game_date.isoformat())
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    out: dict[int, dict] = {}
    for dt in data.get("dates", []):
        for g in dt.get("games", []):
            gpk = g.get("gamePk")
            if not gpk:
                continue
            home = (g.get("teams") or {}).get("home") or {}
            away = (g.get("teams") or {}).get("away") or {}
            hp = home.get("probablePitcher") or {}
            ap = away.get("probablePitcher") or {}
            out[gpk] = {
                "away_pitcher": _pitcher_block(ap),
                "home_pitcher": _pitcher_block(hp),
            }
    return out


def _pitcher_block(probable: dict) -> dict | None:
    """Build the {name, id, hand} block our slate uses. Returns None if MLB
    hasn't listed a probable yet (so we don't overwrite an already-correct
    starter with empty data)."""
    if not probable:
        return None
    name = probable.get("fullName")
    pid = probable.get("id")
    # Hand isn't in the schedule response — we look it up per pitcher.
    hand = _fetch_pitch_hand(pid) if pid else None
    if not name or not pid:
        return None
    return {"name": name, "id": int(pid), "hand": hand or "R"}


_HAND_CACHE: dict[int, str] = {}


def _fetch_pitch_hand(person_id: int) -> str | None:
    """Cached lookup of a pitcher's throwing hand."""
    if person_id in _HAND_CACHE:
        return _HAND_CACHE[person_id]
    try:
        url = f"https://statsapi.mlb.com/api/v1/people/{person_id}"
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        person = (r.json().get("people") or [{}])[0]
        hand = (person.get("pitchHand") or {}).get("code") or "R"
        _HAND_CACHE[person_id] = hand
        return hand
    except Exception:
        return None


def apply_to_slate(slate_path: Path, probables: dict[int, dict]) -> tuple[int, list[str]]:
    """Patch the slate file in place. Only touches pitcher name/id/hand fields.
    Returns (n_changes, change_log)."""
    if not slate_path.exists():
        print(f"  slate file missing: {slate_path}")
        return 0, []
    with open(slate_path) as f:
        slate = json.load(f)

    n_changes = 0
    log: list[str] = []
    for g in slate.get("games", []):
        gpk = g.get("game_pk")
        if gpk not in probables:
            continue
        for side in ("away_pitcher", "home_pitcher"):
            new = probables[gpk].get(side)
            if not new:
                continue
            old = g.get(side) or {}
            # Only patch when something actually differs to keep diffs small.
            if (old.get("name") == new["name"]
                and old.get("id") == new["id"]
                and old.get("hand") == new["hand"]):
                continue
            # Preserve profile + any other downstream fields by mutating in place.
            old["name"] = new["name"]
            old["id"] = new["id"]
            old["hand"] = new["hand"]
            g[side] = old
            n_changes += 1
            matchup = f"{g.get('away_team','?')}@{g.get('home_team','?')}"
            log.append(f"{matchup}  {side}: {new['name']} ({new['hand']}HP)")

    if n_changes:
        with open(slate_path, "w") as f:
            json.dump(slate, f, indent=2, default=str)

    return n_changes, log


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=str, default=None,
                        help="YYYY-MM-DD (default: today)")
    args = parser.parse_args()

    game_date = date.fromisoformat(args.date) if args.date else date.today()
    print(f"Refreshing probable pitchers for {game_date.isoformat()}")

    probables = fetch_probables(game_date)
    if not probables:
        print("  no probable pitchers returned")
        return 0

    # Patch both the dated slate and latest.json (which mirror each other).
    data_dir = Path("frontend/public/data")
    paths = [data_dir / f"{game_date.isoformat()}.json", data_dir / "latest.json"]
    total_changes = 0
    for p in paths:
        n, log = apply_to_slate(p, probables)
        if n:
            total_changes += n
            print(f"  {p.name}: {n} pitcher field(s) updated")
            for line in log:
                print(f"    {line}")
    if not total_changes:
        print("  no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
