"""One-off: re-score Brandon Lowe for 2026-04-14 using Mikolas instead of Poulin.
The Nats used Poulin as a 1-inning opener; Mikolas was the bulk pitcher.
"""
import json
from datetime import date
from pathlib import Path

from data_fetchers import (
    get_batter_statcast,
    get_pitcher_statcast,
    get_season_statcast,
    get_batter_hand,
    load_bulk_statcast,
)
from model import score_batter_multi_lookback
from metrics import calc_pitch_type_stats
import config

LOWE_ID = 664040  # Brandon Lowe
MIKOLAS_ID = 571945
MIKOLAS_NAME = "Miles Mikolas"
MIKOLAS_HAND = "R"
GAME_DATE = date(2026, 4, 14)

PATH = Path("frontend/public/data/2026-04-14.json")
data = json.loads(PATH.read_text())

# Find Lowe's entry and his game
target_game = None
target_player = None
for g in data["games"]:
    for p in g["players"]:
        if p["name"] == "Brandon Lowe":
            target_game = g
            target_player = p
            break
    if target_player:
        break

if not target_player:
    raise SystemExit("Lowe not found in 2026-04-14.json")

print(f"Found Lowe in {target_game['away_team']}@{target_game['home_team']}, currently vs {target_player['opp_pitcher']}")

# Bulk-load statcast for the window
print("Loading statcast...")
load_bulk_statcast()
batter_df = get_batter_statcast(LOWE_ID)
pitcher_df = get_pitcher_statcast(MIKOLAS_ID)

# CRITICAL: filter to PRE-4/14 only — we want Lowe's L5 as it was on 4/14,
# not including games he played after.
import pandas as pd
if batter_df is not None and not batter_df.empty and "game_date" in batter_df.columns:
    batter_df = batter_df[pd.to_datetime(batter_df["game_date"]) < pd.Timestamp("2026-04-14")].copy()
    print(f"  Filtered batter_df to pre-4/14: {len(batter_df)} rows")
if pitcher_df is not None and not pitcher_df.empty and "game_date" in pitcher_df.columns:
    pitcher_df = pitcher_df[pd.to_datetime(pitcher_df["game_date"]) < pd.Timestamp("2026-04-14")].copy()
batter_season = get_season_statcast(LOWE_ID, "batter", 2025)
pitcher_season = get_season_statcast(MIKOLAS_ID, "pitcher", 2025)
batter_hand = get_batter_hand(LOWE_ID)

env = target_game.get("environment", {})
env_data = {
    "env_score": env.get("env_score", 0.5),
    "park_factor": env.get("park_factor", 100),
    "temp_f": env.get("temp_f", 70),
    "wind_out_mph": env.get("wind_out_mph", 0),
}

scores = score_batter_multi_lookback(
    batter_df, pitcher_df, MIKOLAS_HAND, batter_hand,
    env_data=env_data, season_df=batter_season, pitcher_season_df=pitcher_season,
)

# Format the scores dict the same way main.py does
def fmt(result):
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
        "pitch_abs": result.get("pitch_abs", {}),
    }

new_scores = {k: fmt(v) for k, v in scores.items()}

# Patch target_player
target_player["opp_pitcher"] = MIKOLAS_NAME
target_player["pitcher_hand"] = MIKOLAS_HAND
target_player["scores"] = new_scores
# Update platoon
target_player["platoon"] = 1 if batter_hand != MIKOLAS_HAND else 0

print(f"\nOLD composite (L5): had 0.133 vs Poulin")
print(f"NEW composite (L5): {new_scores['L5']['composite']} vs Mikolas")
print(f"  batter: {new_scores['L5']['batter_score']}, pitcher: {new_scores['L5']['pitcher_score']}")
print(f"  barrel: {new_scores['L5']['barrel_pct']}%  EV: {new_scores['L5']['exit_velo']}")

PATH.write_text(json.dumps(data, indent=2, default=str))
print(f"\nPatched {PATH}")
