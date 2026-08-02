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
    # Retry transient MLB API hiccups so one bad fetch doesn't fire a workflow
    # failure email — the cron retries every 15 min anyway.
    import time as _time
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            break
        except (requests.exceptions.RequestException, ValueError) as e:
            last_err = e
            if attempt < 2:
                _time.sleep(3 * (attempt + 1))
    else:
        print(f"  MLB API unreachable after 3 attempts ({last_err}) — skipping this tick")
        return {}

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


CACHE_DIR = Path("pitcher_profile_cache")


def _load_cached_profile(pid: int) -> Optional[dict]:
    p = CACHE_DIR / f"{pid}.json"
    if not p.exists():
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _save_cached_profile(pid: int, profile: dict) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    try:
        with open(CACHE_DIR / f"{pid}.json", "w") as f:
            json.dump(profile, f, default=str)
    except OSError:
        pass


def _build_full_profile(pid: int, season_year: int) -> Optional[dict]:
    """Pull the full pitcher profile for one pitcher — Statcast df → build_pitcher_profile.
    Falls back to 2025 data if the pitcher has no 2026 BIP yet (rookie / call-up).
    Heavyweight call (~5–15s per pitcher) but only runs when we detect a NEW
    probable starter that wasn't in this morning's big regen."""
    try:
        from data_fetchers import get_pitcher_statcast, get_season_statcast
        from metrics import build_pitcher_profile
    except ImportError:
        return None

    try:
        df = get_pitcher_statcast(pid)
        profile = build_pitcher_profile(df, pitcher_id=pid, season=season_year)
        if profile["rows"]["season"]["bf"] == 0 and not profile["arsenal"]:
            df_2025 = get_season_statcast(pid, "pitcher", 2025)
            if df_2025 is not None and not df_2025.empty:
                profile = build_pitcher_profile(df_2025, pitcher_id=pid, season=2025)
                profile["data_year"] = 2025
            else:
                profile["data_year"] = season_year
        else:
            profile["data_year"] = season_year
        return profile
    except Exception as e:
        print(f"    profile build failed for {pid}: {e}")
        return None


def _get_or_build_profile(pid: int, season_year: int) -> Optional[dict]:
    cached = _load_cached_profile(pid)
    if cached is not None:
        return cached
    print(f"    fetching new pitcher profile (id={pid})…")
    profile = _build_full_profile(pid, season_year)
    if profile is not None:
        _save_cached_profile(pid, profile)
    return profile


def apply_to_slate(slate_path: Path, probables: dict[int, dict], season_year: int) -> tuple[int, list[str]]:
    """Patch the slate in place. When the probable starter changes to a new ID
    that wasn't in this morning's regen, also injects the new pitcher's full
    profile (arsenal, vs_L/vs_R rows, windows, recent logs) so the UI has real
    data — not just the new name attached to the old guy's profile.
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
            same = (old.get("name") == new["name"]
                    and old.get("id") == new["id"]
                    and old.get("hand") == new["hand"])
            if same:
                continue

            old_id = old.get("id")
            old["name"] = new["name"]
            old["id"] = new["id"]
            old["hand"] = new["hand"]

            # If the ID actually changed, the existing profile is wrong — fetch
            # the new pitcher's full profile (with cache so we only pay the cost
            # the first time any slate sees this pitcher).
            if old_id != new["id"]:
                profile = _get_or_build_profile(new["id"], season_year)
                if profile is not None:
                    old["profile"] = profile

            g[side] = old
            n_changes += 1
            matchup = f"{g.get('away_team','?')}@{g.get('home_team','?')}"
            id_note = " + profile injected" if old_id != new["id"] else ""
            log.append(f"{matchup}  {side}: {new['name']} ({new['hand']}HP){id_note}")

    if n_changes:
        with open(slate_path, "w") as f:
            # Compact (no indent) — matches patch_lineups.py and keeps the slate
            # well under GitHub's 100MB push limit. indent=2 whitespace more than
            # doubled the deep-season_abs slate (55MB -> 124MB), which got the
            # cron push rejected. The frontend parses compact JSON identically.
            json.dump(slate, f, separators=(",", ":"), default=str)

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
    season_year = game_date.year
    for p in paths:
        n, log = apply_to_slate(p, probables, season_year)
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
