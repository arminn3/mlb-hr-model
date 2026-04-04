#!/usr/bin/env python3
"""
Daily MLB Home Run Prop Model

Runs every morning to score batters with HR props against the specific
pitch mix and handedness matchup they face that day.

Usage:
    python main.py                    # today's games
    python main.py --date 2026-04-01  # specific date
"""

import argparse
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path

import pandas as pd
from tabulate import tabulate

from data_fetchers import (
    get_todays_schedule,
    get_batter_statcast,
    get_pitcher_statcast,
    get_season_statcast,
    get_team_roster,
    get_hr_prop_lines,
    resolve_player_id,
    find_batter_game,
    get_batter_hand,
)
from model import score_batter_multi_lookback
from metrics import calc_pitch_type_stats
from environment import calc_environment_score
import config


def _clean_for_json(obj):
    """Recursively replace NaN/Infinity with None so json.dump doesn't emit invalid tokens."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _clean_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_for_json(v) for v in obj]
    return obj


def _format_score(result: dict) -> dict:
    """Format a single lookback's score result for JSON output."""
    return {
        "composite": round(result["composite_score"], 3),
        "batter_score": round(result["batter_score"], 3),
        "pitcher_score": round(result["pitcher_score"], 3),
        "env_score": round(result.get("env_score", 0.5), 3),
        "exit_velo": round(result["weighted_exit_velo"], 1),
        "barrel_pct": round(result["weighted_barrel_rate"] * 100, 1),
        "fb_pct": round(result["weighted_fb_rate"] * 100, 1),
        "hard_hit_pct": round(result["weighted_hard_hit_rate"] * 100, 1),
        "data_quality": result["data_quality"],
        "recent_abs": result.get("recent_abs", []),
    }


# UTC offset estimates by team (hours behind UTC)
_TEAM_UTC_OFFSETS: dict[str, int] = {
    # Eastern (-4 EDT)
    "NYY": 4, "NYM": 4, "BOS": 4, "BAL": 4, "TB": 4, "TOR": 4,
    "PHI": 4, "WSH": 4, "ATL": 4, "MIA": 4, "PIT": 4, "CLE": 4, "DET": 4, "CIN": 4,
    # Central (-5 CDT)
    "CHC": 5, "CWS": 5, "MIL": 5, "MIN": 5, "KC": 5, "STL": 5, "HOU": 5, "TEX": 5,
    # Mountain (-6 MDT, except AZ which is -7 no DST)
    "COL": 6, "ARI": 7, "AZ": 7,
    # Pacific (-7 PDT)
    "LAD": 7, "LAA": 7, "SDP": 7, "SF": 7, "SEA": 7, "OAK": 7,
}


def _estimate_local_game_hour(game_datetime_utc: str, home_team: str) -> int:
    """Convert UTC game time to approximate local hour for weather targeting."""
    if not game_datetime_utc:
        return 19  # default 7 PM
    try:
        # Parse "2026-04-02T18:10:00Z"
        utc_hour = int(game_datetime_utc[11:13])
        offset = _TEAM_UTC_OFFSETS.get(home_team, 5)
        local_hour = (utc_hour - offset) % 24
        return local_hour
    except (ValueError, IndexError):
        return 19


def run_model(game_date: date = None, fast: bool = False):
    """
    Full pipeline: fetch data, score every batter with an HR prop at
    L5/L10/L15 lookbacks, return game-grouped results.
    """
    if game_date is None:
        game_date = date.today()

    print(f"Running HR prop model for {game_date.isoformat()}...")

    # ── Phase 1: Gather context ──────────────────────────────────────────────
    print("Fetching schedule...")
    schedule = get_todays_schedule(game_date)
    if not schedule:
        print("No games scheduled for this date.")
        return [], []

    print(f"  {len(schedule)} games found.")

    pitchers_available = sum(
        1 for g in schedule for side in ("away_pitcher", "home_pitcher") if g.get(side)
    )
    print(f"  {pitchers_available} probable pitchers listed.")

    # Fetch prop lines (optional — used to annotate, not to gate)
    print("Fetching HR prop lines...")
    prop_lines = get_hr_prop_lines()
    print(f"  {len(prop_lines)} player HR props found.")
    # Build a lookup: player_name -> prop data
    props_by_name: dict[str, dict] = {}
    for p in prop_lines:
        props_by_name[p["player_name"]] = p

    # Pre-compute environment data per stadium at actual game time
    print("Fetching weather data...")
    env_by_game: dict[int, dict] = {}
    game_hours: dict[int, int] = {}
    for g in schedule:
        home = g.get("home_team", "")
        if home:
            game_hour = _estimate_local_game_hour(g.get("game_datetime_utc", ""), home)
            game_hours[g["game_pk"]] = game_hour
            env = calc_environment_score(home, game_date, game_hour_local=game_hour)
            env_by_game[g["game_pk"]] = env
            print(f"  {g.get('away_team','')}@{home} ({game_hour}:00 local): "
                  f"park={env['park_factor']}, "
                  f"temp={env.get('temperature_f','?')}F, "
                  f"wind={env.get('wind_speed_mph','?')}mph")

    # ── Phase 2: Build batter list from rosters (always available) ──────────
    players_by_game: dict[int, list] = defaultdict(list)

    # Priority: lineups (if posted) > active roster > prop lines
    batters_to_score = []
    print("\nBuilding batter lists...")
    for g in schedule:
        gpk = g["game_pk"]
        home = g.get("home_team", "")
        away = g.get("away_team", "")
        away_p = g.get("away_pitcher")
        home_p = g.get("home_pitcher")
        home_lineup = g.get("home_lineup", [])
        away_lineup = g.get("away_lineup", [])

        # Use lineups if posted, otherwise pull active roster
        if home_lineup:
            home_batters = home_lineup
        else:
            home_tid = g.get("home_team_id")
            home_batters = get_team_roster(home_tid) if home_tid else []

        if away_lineup:
            away_batters = away_lineup
        else:
            away_tid = g.get("away_team_id")
            away_batters = get_team_roster(away_tid) if away_tid else []

        # Home batters face away pitcher
        if away_p:
            for player in home_batters:
                batters_to_score.append({
                    "batter_id": player["id"],
                    "batter_name": player["name"],
                    "game_pk": gpk,
                    "opp_pitcher": away_p,
                    "batter_side": "home",
                    "home_team": home,
                })
        # Away batters face home pitcher
        if home_p:
            for player in away_batters:
                batters_to_score.append({
                    "batter_id": player["id"],
                    "batter_name": player["name"],
                    "game_pk": gpk,
                    "opp_pitcher": home_p,
                    "batter_side": "away",
                    "home_team": home,
                })

        src = "lineup" if home_lineup or away_lineup else "roster"
        print(f"  {away}@{home}: {len(home_batters)} home + {len(away_batters)} away batters ({src})")

    total = len(batters_to_score)
    if total == 0:
        print("No batters found. Check schedule and roster data.")
        return [], schedule

    # Load ALL statcast data in one bulk pull (~6 seconds vs 20+ minutes)
    from data_fetchers import load_bulk_statcast
    load_bulk_statcast()

    print(f"\nScoring {total} batters...")

    # Cache pitcher statcast data to avoid re-fetching per batter
    pitcher_cache: dict[int, pd.DataFrame] = {}
    season_cache: dict[tuple, pd.DataFrame] = {}  # (player_id, season) -> df

    for i, entry in enumerate(batters_to_score, 1):
        batter_name = entry["batter_name"]
        batter_id = entry["batter_id"]
        opp_pitcher = entry["opp_pitcher"]
        pitcher_hand = opp_pitcher["hand"]
        gpk = entry["game_pk"]
        home_team = entry["home_team"]

        print(f"  [{i}/{total}] Scoring {batter_name}...", end=" ")

        batter_h = get_batter_hand(batter_id)
        if batter_h == "S":
            batter_h = "L" if pitcher_hand == "R" else "R"

        batter_df = get_batter_statcast(batter_id)
        if batter_df.empty:
            print("SKIP (no Statcast)")
            continue

        # Cache pitcher data
        pid = opp_pitcher["id"]
        if pid not in pitcher_cache:
            pitcher_cache[pid] = get_pitcher_statcast(pid)
        pitcher_df = pitcher_cache[pid]
        if pitcher_df.empty:
            print("SKIP (no pitcher Statcast)")
            continue

        env_data = calc_environment_score(
            home_team, game_date, batter_h, game_hours.get(gpk)
        )

        # Get 2025 season data for baseline (cached)
        batter_season_key = (batter_id, 2025)
        if batter_season_key not in season_cache:
            season_cache[batter_season_key] = get_season_statcast(batter_id, "batter", 2025)
        batter_2025 = season_cache[batter_season_key]

        multi_scores = score_batter_multi_lookback(
            batter_df, pitcher_df, pitcher_hand, batter_h, env_data,
            season_df=batter_2025,
        )

        l5 = multi_scores.get("L5", {})
        composite_l5 = l5.get("composite_score", 0)

        # Season-level pitch type stats (2025 + 2026) — skip in fast mode
        season_stats = {}
        if not fast:
            for season in config.SEASON_DATES:
                pitcher_season_key = (pid, season)
                if pitcher_season_key not in season_cache:
                    season_cache[pitcher_season_key] = get_season_statcast(pid, "pitcher", season)
                p_season_df = season_cache[pitcher_season_key]
                p_stats = calc_pitch_type_stats(p_season_df, "stand", batter_h) if not p_season_df.empty else {}

                batter_season_key = (batter_id, season)
                if batter_season_key not in season_cache:
                    season_cache[batter_season_key] = get_season_statcast(batter_id, "batter", season)
                b_season_df = season_cache[batter_season_key]
                b_stats = calc_pitch_type_stats(b_season_df, "p_throws", pitcher_hand) if not b_season_df.empty else {}

                season_stats[str(season)] = {"pitcher": p_stats, "batter": b_stats}

        player_obj = {
            "name": batter_name,
            "batter_hand": batter_h,
            "opp_pitcher": opp_pitcher["name"],
            "pitcher_hand": pitcher_hand,
            "batter_side": entry["batter_side"],
            "pitch_types": l5.get("pitch_types_used", []),
            "pitch_detail": l5.get("pitch_detail", {}),
            "pitcher_stats": {
                "fb_rate": round(l5.get("pitcher_fb_rate", 0) * 100, 1),
                "hr_fb_rate": round(l5.get("pitcher_hr_fb_rate", 0) * 100, 1),
                "hr_per_9": round(l5.get("pitcher_hr_per_9", 0), 2),
                "ip": round(l5.get("pitcher_ip", 0), 1),
                "total_hrs": l5.get("pitcher_total_hrs", 0),
            },
            "scores": {
                key: _format_score(result)
                for key, result in multi_scores.items()
            },
            "season_stats": season_stats,
        }

        players_by_game[gpk].append(player_obj)
        print(f"OK (L5={composite_l5:.3f})")

    # ── Phase 3: Build game-grouped output ───────────────────────────────────
    games_out = []
    for g in schedule:
        gpk = g["game_pk"]
        players = players_by_game.get(gpk, [])
        if not players:
            continue

        # Sort players by L5 composite descending
        players.sort(key=lambda p: p["scores"].get("L5", {}).get("composite", 0), reverse=True)

        # Format game time for display — always EST (UTC-4 during EDT)
        utc_time = g.get("game_datetime_utc", "")
        local_hour = game_hours.get(gpk, 19)  # local to stadium for weather
        est_hour = 19
        est_min = 0
        if utc_time and len(utc_time) > 14:
            try:
                utc_hour = int(utc_time[11:13])
                utc_min = int(utc_time[14:16])
                est_hour = (utc_hour - 4) % 24  # EDT = UTC-4
                est_min = utc_min
            except (ValueError, IndexError):
                pass
        ampm = "AM" if est_hour < 12 else "PM"
        display_hour = est_hour % 12 or 12
        game_time_display = f"{display_hour}:{est_min:02d} {ampm} ET"

        games_out.append({
            "game_pk": gpk,
            "away_team": g.get("away_team", ""),
            "home_team": g.get("home_team", ""),
            "game_time": game_time_display,
            "game_time_sort": est_hour * 60 + est_min,  # for sorting by EST
            "away_pitcher": {
                "name": g["away_pitcher"]["name"] if g.get("away_pitcher") else "TBD",
                "hand": g["away_pitcher"]["hand"] if g.get("away_pitcher") else "?",
            },
            "home_pitcher": {
                "name": g["home_pitcher"]["name"] if g.get("home_pitcher") else "TBD",
                "hand": g["home_pitcher"]["hand"] if g.get("home_pitcher") else "?",
            },
            "environment": env_by_game.get(gpk, {}),
            "players": players,
        })

    # Sort games by start time (earliest first)
    games_out.sort(key=lambda g: g.get("game_time_sort", 9999))

    return games_out, schedule


def print_results(games_out: list, game_date: date, schedule: list = None) -> None:
    """Print summary table and save JSON for the frontend."""
    total_players = sum(len(g["players"]) for g in games_out)
    if total_players == 0:
        print("\nNo batters could be scored.")
        return

    print(f"\n{'='*80}")
    print(f"  MLB HR PROP MODEL — {game_date.isoformat()}")
    print(f"  {total_players} players scored across {len(games_out)} games")
    print(f"{'='*80}\n")

    # Print per-game summaries
    for game in games_out:
        print(f"  {game['away_team']} @ {game['home_team']}  "
              f"(env: {game['environment'].get('env_score', '?')})")
        for p in game["players"][:5]:  # top 5 per game
            l5 = p["scores"].get("L5", {})
            print(f"    {p['name']:25s}  L5={l5.get('composite',0):.3f}  "
                  f"barrel={l5.get('barrel_pct',0)}%  fb={l5.get('fb_pct',0)}%")
        if len(game["players"]) > 5:
            print(f"    ... and {len(game['players'])-5} more")
        print()

    # Save JSON for the frontend
    frontend_data = {
        "date": game_date.isoformat(),
        "generated_at": pd.Timestamp.now().isoformat(),
        "games": _clean_for_json(games_out),
    }

    # Save as latest + dated archive in frontend/public/data/
    data_dir = Path("frontend/public/data")
    data_dir.mkdir(parents=True, exist_ok=True)
    dated_name = f"{game_date.isoformat()}.json"

    for path in [data_dir / "latest.json", data_dir / dated_name]:
        with open(path, "w") as f:
            json.dump(frontend_data, f, indent=2, default=str)

    # Also save a copy in the project root
    with open(f"hr_props_{game_date.isoformat()}.json", "w") as f:
        json.dump(frontend_data, f, indent=2, default=str)

    # Update the date index so the frontend knows which dates are available
    index_path = data_dir / "index.json"
    existing_dates: list[str] = []
    if index_path.exists():
        try:
            with open(index_path) as f:
                existing_dates = json.load(f).get("dates", [])
        except Exception:
            pass
    if game_date.isoformat() not in existing_dates:
        existing_dates.append(game_date.isoformat())
        existing_dates.sort(reverse=True)  # newest first
    with open(index_path, "w") as f:
        json.dump({"dates": existing_dates}, f, indent=2)

    print(f"JSON saved to {data_dir / dated_name}")
    print(f"Total players scored: {total_players}")


def main():
    parser = argparse.ArgumentParser(description="Daily MLB HR Prop Model")
    parser.add_argument(
        "--date", type=str, default=None,
        help="Game date in YYYY-MM-DD format (default: today)",
    )
    parser.add_argument(
        "--fast", action="store_true",
        help="Skip season stats for faster runtime",
    )
    args = parser.parse_args()

    game_date = date.today()
    if args.date:
        game_date = date.fromisoformat(args.date)

    games_out, schedule = run_model(game_date, fast=args.fast)
    print_results(games_out, game_date, schedule)


if __name__ == "__main__":
    main()
