"""
Patch the lineup info in an already-generated slate JSON, without touching scores.

Use case: main.py ran in the morning before lineups posted. By game time the
real lineups are out (or games are over). We want the slate to show only
actual starters in real batting order, but keep every score / scaling /
pitch-breakdown bit-identical to the morning run.

Usage:
    python3 patch_lineups.py --date 2026-04-27
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from data_fetchers import get_todays_schedule


SLATE_PATHS = [
    Path("frontend/public/data"),
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Patch posted lineups into a slate JSON.")
    p.add_argument("--date", required=True, help="Slate date in YYYY-MM-DD")
    return p.parse_args()


def load_slate(date_str: str) -> tuple[Path, dict]:
    for base in SLATE_PATHS:
        path = base / f"{date_str}.json"
        if path.exists():
            with open(path) as f:
                return path, json.load(f)
    raise FileNotFoundError(f"No slate JSON found for {date_str}")


def patch_side(side_block: dict, posted_lineup: list[dict]) -> tuple[int, int]:
    """Update one side's batters in place. Returns (matched, missing_from_pool)."""
    if not posted_lineup:
        return (0, 0)

    pool_by_name = {b["name"]: b for b in side_block.get("batters", [])}
    new_batters: list[dict] = []
    missing = 0

    for order_idx, person in enumerate(posted_lineup, start=1):
        name = person["name"]
        existing = pool_by_name.get(name)
        if existing is None:
            print(f"    ⚠ posted starter not in candidate pool: {name} (order {order_idx})")
            missing += 1
            continue
        # Preserve everything; just overwrite the order to the real batting order.
        patched = dict(existing)
        patched["order"] = order_idx
        new_batters.append(patched)

    side_block["batters"] = new_batters
    side_block["lineup_status"] = "posted"
    return (len(new_batters), missing)


def main() -> int:
    args = parse_args()
    # Validate date format early
    y, m, d = args.date.split("-")
    target_date = date(int(y), int(m), int(d))

    slate_path, slate = load_slate(args.date)
    print(f"loaded {slate_path} ({slate_path.stat().st_size:,} bytes)")

    print(f"fetching MLB schedule for {target_date}...")
    api_games = get_todays_schedule(target_date)
    api_by_pk = {g["game_pk"]: g for g in api_games}
    print(f"  api returned {len(api_games)} games")

    total_patched = 0
    total_missing = 0
    games_skipped = 0

    for game in slate.get("games", []):
        gpk = game["game_pk"]
        away_abbr = game.get("away_team", "?")
        home_abbr = game.get("home_team", "?")
        api_game = api_by_pk.get(gpk)
        if api_game is None:
            print(f"{away_abbr} @ {home_abbr}: NOT in API response — skipping")
            games_skipped += 1
            continue

        away_lineup = api_game.get("away_lineup", [])
        home_lineup = api_game.get("home_lineup", [])

        if not away_lineup and not home_lineup:
            print(f"{away_abbr} @ {home_abbr}: no posted lineups — skipping")
            games_skipped += 1
            continue

        tpm = game.get("team_pitch_mix", {})
        a_matched, a_missing = patch_side(tpm.get("away", {}), away_lineup)
        h_matched, h_missing = patch_side(tpm.get("home", {}), home_lineup)
        total_patched += a_matched + h_matched
        total_missing += a_missing + h_missing

        prior_a = len([b for b in tpm.get("away", {}).get("batters", [])])
        prior_h = len([b for b in tpm.get("home", {}).get("batters", [])])
        print(
            f"{away_abbr} @ {home_abbr}: "
            f"away {a_matched}/{len(away_lineup)} matched, "
            f"home {h_matched}/{len(home_lineup)} matched"
        )

    with open(slate_path, "w") as f:
        json.dump(slate, f, separators=(",", ":"))

    print()
    print(f"patched: {total_patched} starters across {len(slate['games']) - games_skipped} games")
    if total_missing:
        print(f"warnings: {total_missing} posted starters were not in the original candidate pool")
    if games_skipped:
        print(f"skipped: {games_skipped} games had no posted lineup or no API match")
    print(f"wrote {slate_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
