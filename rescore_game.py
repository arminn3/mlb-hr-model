"""Targeted re-score for pitching changes.

When a probable starter changes after the morning slate was generated, that
game's batters are still scored against the OLD pitcher — the rankings for that
lineup are wrong. This re-scores ONLY the affected game(s) against the current
starter, reusing main.run_model's exact scoring path (only_game_pks), then
merges the result back into the existing slate so the other games are untouched
(and stay frozen if the slate is locked).

Usage:
    python3 rescore_game.py                       # auto: rescore games whose starter changed vs live probables
    python3 rescore_game.py --date 2026-07-04
    python3 rescore_game.py --games 822882,824334 # explicit game_pks
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

import requests

from main import run_model  # importing main also sets the global socket timeout
from data_fetchers import MLB_API_BASE

DATA_DIR = Path("frontend/public/data")


def _live_probables(game_date: date) -> dict:
    """{game_pk: {'away': (id, name), 'home': (id, name)}} from the MLB schedule."""
    url = (
        f"{MLB_API_BASE}/schedule?sportId=1&date={game_date.isoformat()}"
        "&hydrate=probablePitcher,team"
    )
    out: dict = {}
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        for d in r.json().get("dates", []):
            for g in d.get("games", []):
                ap = g["teams"]["away"].get("probablePitcher") or {}
                hp = g["teams"]["home"].get("probablePitcher") or {}
                out[g["gamePk"]] = {
                    "away": (ap.get("id"), ap.get("fullName")),
                    "home": (hp.get("id"), hp.get("fullName")),
                }
    except Exception as e:
        print(f"WARNING: could not fetch live probables ({e})")
    return out


def _detect_changed(slate: dict, live: dict) -> set:
    """game_pks where the slate's starter id differs from the live probable."""
    changed = set()
    for g in slate.get("games", []):
        lv = live.get(g["game_pk"])
        if not lv:
            continue
        for side, key in (("away", "away_pitcher"), ("home", "home_pitcher")):
            live_id, live_name = lv[side]
            if not live_id:
                continue  # MLB hasn't posted a probable yet — don't clobber
            if (g.get(key) or {}).get("id") != live_id:
                changed.add(g["game_pk"])
                print(f"  change: {g['away_team']}@{g['home_team']} {side} "
                      f"{(g.get(key) or {}).get('name')} -> {live_name}")
    return changed


def main() -> None:
    ap = argparse.ArgumentParser(description="Targeted rescore for pitching changes")
    ap.add_argument("--date", type=str, default=None)
    ap.add_argument("--games", type=str, default=None, help="comma-separated game_pks")
    args = ap.parse_args()

    game_date = date.fromisoformat(args.date) if args.date else date.today()
    dated = DATA_DIR / f"{game_date.isoformat()}.json"
    if not dated.exists():
        print(f"No slate at {dated}")
        sys.exit(1)
    slate = json.loads(dated.read_text())

    if args.games:
        target = {int(x) for x in args.games.split(",") if x.strip()}
    else:
        target = _detect_changed(slate, _live_probables(game_date))

    if not target:
        print("No pitching changes to rescore.")
        return

    print(f"Rescoring {len(target)} game(s) vs current starters: {sorted(target)}")
    fresh_games, _ = run_model(game_date, only_game_pks=target)
    fresh_by_pk = {g["game_pk"]: g for g in fresh_games}
    if not fresh_by_pk:
        print("Rescore produced no games (no scoreable batters?) — slate unchanged.")
        return

    replaced = 0
    merged = []
    for g in slate["games"]:
        repl = fresh_by_pk.get(g["game_pk"])
        if repl is not None:
            merged.append(repl)
            replaced += 1
        else:
            merged.append(g)
    slate["games"] = merged

    out_paths = [dated, DATA_DIR / "latest.json"]
    root = Path(f"hr_props_{game_date.isoformat()}.json")
    if root.exists():
        out_paths.append(root)
    for path in out_paths:
        path.write_text(json.dumps(slate, indent=2, default=str))

    print(f"Rescored + merged {replaced} game(s). Updated: "
          + ", ".join(p.name for p in out_paths))


if __name__ == "__main__":
    main()
