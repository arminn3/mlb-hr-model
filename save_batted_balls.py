#!/usr/bin/env python3
"""
Save all hard-hit air balls for a given date to a JSON file.
This creates a permanent record of batted ball data for the live feed.

Usage:
    python save_batted_balls.py                # yesterday
    python save_batted_balls.py --date 2026-04-04
"""

import argparse
import json
import requests
from datetime import date, timedelta
from pathlib import Path


def fetch_batted_balls(game_date: str) -> dict:
    """Fetch all hard-hit air balls from MLB API for a given date."""

    # Get schedule
    url = f"https://statsapi.mlb.com/api/v1/schedule?date={game_date}&sportId=1&hydrate=team,linescore,scoringplays"
    sched = requests.get(url, timeout=30).json()

    games = []
    all_plays = []
    total_hrs = 0

    for date_entry in sched.get("dates", []):
        for game in date_entry.get("games", []):
            status = game.get("status", {}).get("detailedState", "")
            away = game.get("teams", {}).get("away", {}).get("team", {}).get("abbreviation", "")
            home = game.get("teams", {}).get("home", {}).get("team", {}).get("abbreviation", "")
            linescore = game.get("linescore", {})
            game_pk = game.get("gamePk")

            # Count HRs from scoring plays
            for sp in game.get("scoringPlays", []):
                if sp.get("result", {}).get("event") == "Home Run":
                    total_hrs += 1

            teams = linescore.get("teams", {})
            games.append({
                "gamePk": game_pk,
                "away": away,
                "home": home,
                "status": status,
                "awayScore": teams.get("away", {}).get("runs", 0),
                "homeScore": teams.get("home", {}).get("runs", 0),
            })

            # Skip games that haven't started
            if status in ("Scheduled", "Pre-Game", "Warmup", "Postponed"):
                continue

            # Fetch play-by-play
            try:
                feed_url = f"https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"
                feed = requests.get(feed_url, timeout=30).json()
                all_play_data = feed.get("liveData", {}).get("plays", {}).get("allPlays", [])

                for play in all_play_data:
                    matchup = play.get("matchup", {})
                    result = play.get("result", {})
                    about = play.get("about", {})

                    # Find batted ball with hit data
                    batted_ball = None
                    for event in play.get("playEvents", []):
                        if event.get("hitData", {}).get("launchSpeed"):
                            batted_ball = event
                            break

                    if not batted_ball:
                        continue

                    hit_data = batted_ball["hitData"]
                    ev = hit_data.get("launchSpeed", 0)
                    angle = hit_data.get("launchAngle", 0)
                    dist = hit_data.get("totalDistance", 0)

                    # Only hard-hit air balls (90+ EV, 20+ degrees)
                    if ev < 90 or angle < 20:
                        continue

                    is_hr = result.get("event") == "Home Run"
                    is_near = not is_hr and ev >= 95 and 25 <= angle <= 35

                    all_plays.append({
                        "batter": matchup.get("batter", {}).get("fullName", "Unknown"),
                        "pitcher": matchup.get("pitcher", {}).get("fullName", "Unknown"),
                        "game": f"{away}@{home}",
                        "ev": round(ev, 1),
                        "angle": round(angle, 0),
                        "distance": round(dist, 0) if dist else 0,
                        "result": result.get("event", ""),
                        "inning": about.get("inning", 0),
                        "timestamp": about.get("startTime", ""),
                        "isHR": is_hr,
                        "isNearHR": is_near,
                    })
            except Exception as e:
                print(f"  Error fetching {away}@{home}: {e}")

    # Sort by timestamp descending
    all_plays.sort(key=lambda p: p.get("timestamp", ""), reverse=True)

    return {
        "date": game_date,
        "games": games,
        "plays": all_plays,
        "totalHRs": total_hrs,
        "nearHRs": sum(1 for p in all_plays if p["isNearHR"]),
        "hardHitAir": sum(1 for p in all_plays if p["ev"] >= 95 and p["angle"] >= 25),
        "totalAirBalls": len(all_plays),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None, help="Date to fetch (YYYY-MM-DD), default yesterday")
    args = parser.parse_args()

    game_date = args.date or (date.today() - timedelta(days=1)).isoformat()

    print(f"Fetching batted ball data for {game_date}...")
    data = fetch_batted_balls(game_date)

    print(f"  {len(data['games'])} games, {data['totalAirBalls']} air balls, {data['totalHRs']} HRs, {data['nearHRs']} near HRs")

    # Save to results and frontend
    for directory in ["results", "frontend/public/data/results"]:
        Path(directory).mkdir(parents=True, exist_ok=True)
        out_path = Path(directory) / f"livefeed-{game_date}.json"
        with open(out_path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  Saved to {out_path}")


if __name__ == "__main__":
    main()
