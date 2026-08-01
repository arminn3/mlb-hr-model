#!/usr/bin/env python3
"""
Daily MLB Home Run Prop Model

Runs every morning to score batters with HR props against the specific
pitch mix and handedness matchup they face that day.

Usage:
    python main.py                    # today's games
    python main.py --date 2026-04-01  # specific date
"""

from __future__ import annotations  # PEP 563 — keeps `X | None` annotations lazy so this runs on Python 3.9 too

import argparse
import json
import math
import re
import shutil
import socket
import subprocess
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

# Global socket timeout — pybaseball / requests calls have no read timeout by
# default, so a single slow Baseball Savant / MLB API response can hang the
# whole slate run indefinitely (it stalled ~13 min on one batter on 2026-06-30).
# This caps per-recv inactivity at 60s; legit large transfers keep streaming so
# they're unaffected, while true hangs raise (caught by the fetchers → empty df,
# player scored at low confidence) instead of blocking forever.
socket.setdefaulttimeout(60)

import numpy as np
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
    get_bullpen_freshness_bulk,
)
from model import score_batter_multi_lookback, _ab_extras
from metrics import calc_pitch_type_stats, build_batter_pa_history, get_pitch_mix, build_pitcher_profile
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


# Pitcher overrides — set manually when the probable pitcher changes after the
# schedule is fetched. Key: team abbreviation (home or away). Value: dict with
# "name", "hand" ("R"/"L"), and optionally "id" (MLB player ID).
# Clear this dict after regen; it only applies to the current run.
PITCHER_OVERRIDES: dict[str, dict] = {}


def _compute_zone_stats(df: pd.DataFrame) -> list:
    """Per-zone (1-9) BIP stats from a pre-filtered DataFrame."""
    zones = []
    for z in range(1, 10):
        if df is None or df.empty:
            zones.append({"zone": z, "bip": 0, "hrs": 0, "barrels": 0, "barrel_rate": 0.0, "hr_rate": 0.0, "hard_hits": 0})
            continue
        z_rows = df[df["zone"] == z]
        bip = len(z_rows)
        hrs = int((z_rows["events"] == "home_run").sum()) if "events" in z_rows.columns and bip > 0 else 0
        barrels = int((z_rows["launch_speed_angle"] == 6).sum()) if "launch_speed_angle" in z_rows.columns and bip > 0 else 0
        hard_hits = int((z_rows["launch_speed"] >= 95).sum()) if bip > 0 else 0
        zones.append({
            "zone": z, "bip": bip, "hrs": hrs, "barrels": barrels, "hard_hits": hard_hits,
            "barrel_rate": round(barrels / bip * 100, 1) if bip > 0 else 0.0,
            "hr_rate": round(hrs / bip * 100, 1) if bip > 0 else 0.0,
        })
    return zones


def _compute_pitcher_zone_freq(df: pd.DataFrame, batter_hand: str) -> list:
    """Per-zone (1-9) pitch frequency from ALL pitches (not just BIP), filtered by batter hand."""
    if df is None or df.empty or "zone" not in df.columns:
        return [{"zone": z, "count": 0, "pct": 0.0} for z in range(1, 10)]
    filtered = df[df["stand"] == batter_hand].copy() if "stand" in df.columns else df.copy()
    # Only zones 1-9 (in-zone) for the grid; exclude 11-14 (out-of-zone) from total
    # so pct is relative to all pitches thrown (in and out of zone)
    total = len(filtered)
    result = []
    for z in range(1, 10):
        count = int((filtered["zone"] == z).sum())
        result.append({"zone": z, "count": count, "pct": round(count / total * 100, 1) if total > 0 else 0.0})
    return result


def _pitcher_score_from_profile_row(row: dict) -> float:
    """Compute pitcher_score directly from a profile vs-hand row (vs_L or vs_R).

    Foundation per research: ISO + HR/9 vs that batter handedness are the two
    biggest signals of how vulnerable a pitcher is. Everything else is supporting.
    Skubal vs LHB illustrates why: ISO .205, HR/9 2.16 (both elite-vulnerable)
    while overall ISO .119, HR/9 0.55 looks fine.

    Weights:
      ISO vs hand     35%   ← foundation
      HR/9 vs hand    35%   ← foundation
      HR/FB%          15%   ← supporting (HRs per opportunity)
      FB% allowed     10%   ← supporting (opportunity volume)
      HR volume        5%   ← tie-breaker
    """
    def n(v, lo, hi):
        if v is None: return 0.5
        return max(0.0, min(1.0, (v - lo) / (hi - lo)))

    iso        = float(row.get("iso")       or 0.0)
    hr_per_9   = float(row.get("hr_per_9")  or 0.0)
    hr_fb_pct  = float(row.get("hr_fb_pct") or 0.0) / 100.0
    fb_pct     = float(row.get("fb_pct")    or 0.0) / 100.0
    hr_count   = float(row.get("hr")        or 0.0)

    # ISO range: league avg ~.150, elite power suppressor ~.080, vulnerable .200+
    f_iso    = n(iso,       0.08, 0.24)
    f_hr9    = n(hr_per_9,  0.0,  2.4)
    f_hrfb   = n(hr_fb_pct, 0.0,  0.24)
    f_fb     = n(fb_pct,    0.04, 0.20)
    f_hrtot  = n(hr_count / 20.0, 0.0, 1.0)

    return f_iso * 0.35 + f_hr9 * 0.35 + f_hrfb * 0.15 + f_fb * 0.10 + f_hrtot * 0.05


def _apply_pitcher_split_override(players_by_game: dict, schedule: list, pitcher_profiles: dict) -> int:
    """Walk every player and override pitcher_score / composite using the
    pitcher profile's vs-hand row when sample is sufficient (BF >= 30).

    Returns the number of overrides applied. Required because
    calc_pitcher_metrics' hand-split blend has a bug that leaves pitchers
    with strong reverse splits (Skubal vs LHB) showing overall-pitcher stats.
    """
    MIN_BF = 30
    fixed = 0
    for g in schedule:
        gpk = g.get("game_pk")
        players = players_by_game.get(gpk, [])
        for player in players:
            bs = player.get("batter_side", "away")
            opp_side = "away_pitcher" if bs == "home" else "home_pitcher"
            opp_pid = (g.get(opp_side) or {}).get("id")
            profile = pitcher_profiles.get(opp_pid) if opp_pid else None
            if not profile:
                continue
            batter_hand = player.get("batter_hand", "R")
            row_key = "vs_L" if batter_hand == "L" else "vs_R"
            row = profile.get("rows", {}).get(row_key, {})
            bf = int(row.get("bf") or 0)
            if bf < MIN_BF:
                continue

            new_pitcher_score = round(_pitcher_score_from_profile_row(row), 3)

            # Override pitcher_score + recompute composite for every lookback.
            # composite_new = composite_old + (new - old) * pitcher_weight
            w_p = config.PITCHER_COMPOSITE_WEIGHT
            for lb in ("L5", "L10"):
                s = player.get("scores", {}).get(lb)
                if not s: continue
                old_pitcher = float(s.get("pitcher_score") or 0.0)
                delta = (new_pitcher_score - old_pitcher) * w_p
                s["pitcher_score"] = new_pitcher_score
                s["composite"]     = round(float(s.get("composite") or 0.0) + delta, 3)
            fixed += 1
    return fixed


def _format_score(result: dict) -> dict:
    """Format a single lookback's score result for JSON output.

    Note: display stats read from `pool_*` (raw last-N BBE rates) — these are
    what "last 5/10" actually means at a glance. Scoring still uses the
    pitch-mix-weighted `weighted_*` values internally (see model.py Step 5),
    so batter_score may not exactly reconstruct from the displayed pct values.
    User-approved tradeoff — they wanted honest L5/L10 columns.
    """
    return {
        "composite": round(result["composite_score"], 3),
        "batter_score": round(result["batter_score"], 3),
        "pitcher_score": round(result["pitcher_score"], 3),
        "env_score": round(result.get("env_score", 0.5), 3),
        "exit_velo": round(result.get("pool_exit_velo", result["weighted_exit_velo"]), 1),
        "barrel_pct": round(result.get("pool_barrel_rate", result["weighted_barrel_rate"]) * 100, 1),
        "fb_pct": round(result.get("pool_fb_rate", result["weighted_fb_rate"]) * 100, 1),
        "ld_pct": round(result.get("pool_ld_rate", result["weighted_ld_rate"]) * 100, 1),
        "gb_pct": round(result.get("pool_gb_rate", result["weighted_gb_rate"]) * 100, 1),
        "hard_hit_pct": round(result.get("pool_hard_hit_rate", result["weighted_hard_hit_rate"]) * 100, 1),
        "data_quality": result["data_quality"],
        "recent_abs": result.get("recent_abs", []),
        "pitch_abs": result.get("pitch_abs", {}),
        "xwoba": result.get("xwoba", 0.0),
        "sweet_spot": result.get("sweet_spot", 0.0),
        "avg_la": result.get("avg_la", 0.0),
        "blast_pct": result.get("blast_pct", 0.0),
        "pull_brl": result.get("pull_brl", 0.0),
        "swstr": round(result.get("matchup_swstr", 0.0), 1),
        "bip": result.get("bip_count", 0),
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


def _calc_splits_vs_hand(batter_df, pitcher_hand: str) -> dict | None:
    """Batter's season line vs a pitcher hand: AB, BA, HR, % of HRs, K%, BB%,
    TB per hit. Powers the batter-detail 'Splits vs [hand]' card."""
    if batter_df is None or batter_df.empty or "p_throws" not in batter_df.columns or "events" not in batter_df.columns:
        return None
    pa_all = batter_df[batter_df["events"].notna()]
    if pa_all.empty:
        return None
    total_hr = int((pa_all["events"] == "home_run").sum())
    vs = pa_all[pa_all["p_throws"] == pitcher_hand]
    ev = vs["events"]
    pa = len(ev)
    if pa == 0:
        return None
    hits_set = {"single", "double", "triple", "home_run"}
    hits = int(ev.isin(hits_set).sum())
    hr = int((ev == "home_run").sum())
    bb = int(ev.isin({"walk", "intent_walk"}).sum())
    hbp = int((ev == "hit_by_pitch").sum())
    sf = int(ev.isin({"sac_fly", "sac_fly_double_play"}).sum())
    k = int(ev.isin({"strikeout", "strikeout_double_play"}).sum())
    ab = pa - bb - hbp - sf
    singles = int((ev == "single").sum())
    doubles = int((ev == "double").sum())
    triples = int((ev == "triple").sum())
    tb = singles + 2 * doubles + 3 * triples + 4 * hr
    return {
        "hand": pitcher_hand,
        "ab": ab,
        "ba": round(hits / ab, 3) if ab > 0 else None,
        "hr": hr,
        "pct_of_hrs": round(hr / total_hr * 100) if total_hr > 0 else None,
        "k_pct": round(k / pa * 100) if pa > 0 else None,
        "bb_pct": round(bb / pa * 100) if pa > 0 else None,
        "tb_per_hit": round(tb / hits, 2) if hits > 0 else None,
    }


def _calc_bvp(batter_df, batter_2025, pitcher_id, batter_id=None) -> dict:
    """Calculate batter vs specific pitcher head-to-head stats.
    Uses MLB Stats API for career stats + Statcast for recent BIP detail."""
    import pandas as pd
    import requests

    empty = {"career": {"abs": 0, "hits": 0, "hrs": 0, "ba": 0, "slg": 0, "iso": 0, "k_pct": 0, "pa": 0, "ops": "0"}, "recent_abs": []}

    # Career stats from MLB Stats API (all-time BvP)
    career = empty["career"].copy()
    if batter_id and pitcher_id:
        try:
            url = f"https://statsapi.mlb.com/api/v1/people/{batter_id}/stats?stats=vsPlayer&opposingPlayerId={pitcher_id}&group=hitting"
            resp = requests.get(url, timeout=5)
            if resp.ok:
                data = resp.json()
                for split_group in data.get("stats", []):
                    for s in split_group.get("splits", []):
                        stat = s.get("stat", {})
                        n_ab = stat.get("atBats", 0)
                        if n_ab > 0:
                            career = {
                                "abs": n_ab,
                                "hits": stat.get("hits", 0),
                                "hrs": stat.get("homeRuns", 0),
                                "ba": float(stat.get("avg", "0") or "0"),
                                "slg": float(stat.get("slg", "0") or "0"),
                                "iso": round(float(stat.get("slg", "0") or "0") - float(stat.get("avg", "0") or "0"), 3),
                                "k_pct": round(stat.get("strikeOuts", 0) / max(n_ab + stat.get("baseOnBalls", 0), 1) * 100, 1),
                                "pa": n_ab + stat.get("baseOnBalls", 0) + stat.get("hitByPitch", 0),
                                "ops": stat.get("ops", "0"),
                            }
        except Exception:
            pass

    # Recent BIP from Statcast (2025-2026)
    frames = []
    if batter_df is not None and not batter_df.empty and "pitcher" in batter_df.columns:
        frames.append(batter_df[batter_df["pitcher"] == pitcher_id])
    if batter_2025 is not None and not batter_2025.empty and "pitcher" in batter_2025.columns:
        frames.append(batter_2025[batter_2025["pitcher"] == pitcher_id])

    recent = []
    if frames:
        combined = pd.concat(frames).drop_duplicates(
            subset=["game_date", "at_bat_number", "pitch_number"] if "pitch_number" in frames[0].columns else ["game_date", "at_bat_number"]
        )
        bip = combined.dropna(subset=["launch_speed"]).copy()
        if not bip.empty:
            bip["game_date"] = bip["game_date"].astype(str)
            bip = bip.sort_values("game_date", ascending=False).head(10)
            for _, row in bip.iterrows():
                recent.append({
                    "date": str(row.get("game_date", ""))[:10],
                    "pitch_type": str(row.get("pitch_name", row.get("pitch_type", ""))),
                    "ev": round(float(row.get("launch_speed", 0)), 1),
                    "angle": round(float(row.get("launch_angle", 0)), 1),
                    "result": str(row.get("events", "")) if pd.notna(row.get("events")) else "",
                })

    return {"career": career, "recent_abs": recent}


def _compute_hr_signals(
    batter_df,
    batter_2025,
    season_profile: dict,
    pitcher_hr_per_9: float,
    park_factor: float,
) -> dict:
    """Compute the 5-signal HR indicator from research-validated predictors."""
    # Combine 2026 + 2025 BIP, sorted oldest→newest
    frames = [d for d in [batter_2025, batter_df] if d is not None and not d.empty]
    if not frames:
        return None
    bip = pd.concat(frames, ignore_index=True)
    bip["game_date"] = pd.to_datetime(bip.get("game_date", pd.Series(dtype="datetime64[ns]")), errors="coerce")
    bip = bip.dropna(subset=["launch_speed"]).sort_values("game_date").reset_index(drop=True)
    if bip.empty:
        return None

    # ── Signal 1: Barrel in last 5 game-dates ──
    recent_dates = sorted(bip["game_date"].dropna().unique())[-5:]
    recent = bip[bip["game_date"].isin(recent_dates)]
    barrel_heat = False
    if "launch_speed_angle" in recent.columns:
        barrel_heat = bool((recent["launch_speed_angle"].fillna(0) == 6).any())
    if not barrel_heat and "launch_speed" in recent.columns and "launch_angle" in recent.columns:
        barrel_heat = bool(
            ((recent["launch_speed"] >= 98) & recent["launch_angle"].between(18, 32)).any()
        )

    # ── Signal 2: Pull-power tendency (66.5% HR rate on pulled barrels) ──
    pull_air = season_profile.get("pull_air", 0) or 0
    pull_barrel = season_profile.get("pull_barrel", 0) or 0
    pull_power = pull_air >= 28 or pull_barrel >= 12

    # ── Signal 3: HR drought (bips since last HR vs personal expected gap) ──
    drought_info = None
    if "events" in bip.columns:
        total_bip = len(bip)
        total_hrs = int((bip["events"] == "home_run").sum())
        if total_hrs > 0:
            expected_gap = round(total_bip / total_hrs, 1)
            hr_indices = bip.index[bip["events"] == "home_run"].tolist()
            bips_since = total_bip - hr_indices[-1] - 1
            z = round((bips_since - expected_gap) / max(expected_gap * 0.8, 1), 2)
            drought_info = {
                "bips_since_hr": bips_since,
                "expected_gap": expected_gap,
                "z_score": z,
                "triggered": bips_since > expected_gap,
            }

    # ── Signal 4: Pitcher vulnerable (HR/9 > league avg ~1.3) ──
    pitcher_vulnerable = (pitcher_hr_per_9 or 0) > 1.3

    # ── Signal 5: Park boosts HRs (park factor > 105) ──
    park_friendly = (park_factor or 100) > 105

    return {
        "barrel_heat": barrel_heat,
        "pull_power": pull_power,
        "drought": drought_info,
        "pitcher_vulnerable": pitcher_vulnerable,
        "park_friendly": park_friendly,
    }


def run_model(game_date: date = None, fast: bool = False, only_game_pks=None):
    """
    Full pipeline: fetch data, score every batter with an HR prop at
    L5/L10 lookbacks, return game-grouped results.

    only_game_pks: if set, score ONLY the batters in those games and return just
    those games. Used by rescore_game.py to re-score a single game's lineup
    against a newly-announced starter (pitching change) without touching the
    other 14 games. The scoring path is identical — this only narrows the input.
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

    # Apply manual pitcher overrides (e.g. opener, bullpen game, late swap)
    if PITCHER_OVERRIDES:
        for g in schedule:
            for side in ("away_team", "home_team"):
                team = g.get(side, "")
                if team in PITCHER_OVERRIDES:
                    pitcher_side = "away_pitcher" if side == "away_team" else "home_pitcher"
                    ov = PITCHER_OVERRIDES[team]
                    g[pitcher_side] = {"name": ov["name"], "hand": ov["hand"], "id": ov.get("id")}
                    print(f"  [OVERRIDE] {team} pitcher → {ov['name']} ({ov['hand']}HP)")

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
    seen_player_ids = set()  # prevent duplicates across doubleheader games
    matchup_game_count: dict[str, int] = {}  # track game number for doubleheaders
    print("\nBuilding batter lists...")
    for g in schedule:
        gpk = g["game_pk"]
        status = g.get("game_status", "")
        home = g.get("home_team", "")
        away = g.get("away_team", "")
        away_p = g.get("away_pitcher")
        home_p = g.get("home_pitcher")

        # Track doubleheader game numbers
        team_key = f"{away}@{home}"
        matchup_game_count[team_key] = matchup_game_count.get(team_key, 0) + 1
        game_num = matchup_game_count[team_key]
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

        # Deduplicate batters by ID within each game AND across games (doubleheaders)
        seen_ids = set()

        # Home batters face away pitcher
        if away_p:
            for player in home_batters:
                if player["id"] not in seen_ids:
                    seen_ids.add(player["id"])
                    batters_to_score.append({
                        "batter_id": player["id"],
                        "batter_name": player["name"],
                        "game_pk": gpk,
                        "opp_pitcher": away_p,
                        "batter_side": "home",
                        "home_team": home,
                        "game_num": game_num,
                    })
        # Away batters face home pitcher
        if home_p:
            for player in away_batters:
                if player["id"] not in seen_ids:
                    seen_ids.add(player["id"])
                    batters_to_score.append({
                        "batter_id": player["id"],
                        "batter_name": player["name"],
                        "game_pk": gpk,
                        "opp_pitcher": home_p,
                        "batter_side": "away",
                        "home_team": home,
                        "game_num": game_num,
                    })

        src = "lineup" if home_lineup or away_lineup else "roster"
        print(f"  {away}@{home}: {len(home_batters)} home + {len(away_batters)} away batters ({src})")

    # Targeted rescore: keep only the requested games' batters (pitching-change
    # re-score). games_out then contains just those games (empty ones are
    # skipped downstream), which the caller merges into the existing slate.
    if only_game_pks is not None:
        batters_to_score = [b for b in batters_to_score if b["game_pk"] in only_game_pks]

    total = len(batters_to_score)
    if total == 0:
        print("No batters found. Check schedule and roster data.")
        return [], schedule

    # Load ALL statcast data in bulk pulls (~30 seconds total vs 20+ minutes per-player)
    from data_fetchers import load_bulk_statcast, load_bulk_2025
    load_bulk_statcast()
    load_bulk_2025()

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
        # Don't skip — score them even with empty data (they'll get low confidence)

        # Cache pitcher data
        pid = opp_pitcher["id"]
        if pid not in pitcher_cache:
            pitcher_cache[pid] = get_pitcher_statcast(pid)
        pitcher_df = pitcher_cache[pid]

        env_data = calc_environment_score(
            home_team, game_date, batter_h, game_hours.get(gpk)
        )

        # Get 2025 season data for baseline (cached)
        batter_season_key = (batter_id, 2025)
        if batter_season_key not in season_cache:
            season_cache[batter_season_key] = get_season_statcast(batter_id, "batter", 2025)
        batter_2025 = season_cache[batter_season_key]

        # Get pitcher 2025 season data for pitch mix blending
        pitcher_season_key = (pid, 2025)
        if pitcher_season_key not in season_cache:
            season_cache[pitcher_season_key] = get_season_statcast(pid, "pitcher", 2025)
        pitcher_2025 = season_cache[pitcher_season_key]

        # If pitcher has no 2026 data, use 2025 season data. If 2025 is also
        # empty (MLB debut / rookie), still score the batter on their own
        # profile — model.py will flag data_quality=NO_PITCH_DATA and default
        # matchup/pitcher components to neutral 0.5 instead of dropping them.
        if pitcher_df.empty:
            if pitcher_2025 is not None and not pitcher_2025.empty:
                pitcher_df = pitcher_2025
                print("(using 2025 pitcher data)")
            else:
                print("(no pitcher Statcast — scoring batter-only)")

        try:
            multi_scores = score_batter_multi_lookback(
                batter_df, pitcher_df, pitcher_hand, batter_h, env_data,
                season_df=batter_2025, pitcher_season_df=pitcher_2025,
            )
        except Exception as e:
            print(f"ERROR scoring: {e}")
            continue

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

        # BvP (Batter vs Pitcher) history
        bvp_stats = _calc_bvp(batter_df, batter_2025, pid, batter_id=batter_id)

        # Season splits vs today's pitcher hand (AB/BA/HR/%HR/K%/BB%/TB-per-hit)
        splits_vs_hand = _calc_splits_vs_hand(batter_df, pitcher_hand)

        # Pitcher pitch quality metrics
        pitcher_quality = {"avg_velo": 0, "avg_spin": 0, "avg_vert_break": 0, "avg_horiz_break": 0}
        if not pitcher_df.empty:
            velo = pitcher_df["release_speed"].dropna()
            spin = pitcher_df["release_spin_rate"].dropna()
            vert = pitcher_df["pfx_z"].dropna()
            horiz = pitcher_df["pfx_x"].dropna()
            pitcher_quality = {
                "avg_velo": round(float(velo.mean()), 1) if len(velo) > 0 else 0,
                "avg_spin": round(float(spin.mean()), 0) if len(spin) > 0 else 0,
                "avg_vert_break": round(float(vert.mean()), 2) if len(vert) > 0 else 0,
                "avg_horiz_break": round(float(horiz.mean()), 2) if len(horiz) > 0 else 0,
            }

        # Platoon indicator: 1 = opposite hand (advantage), 0 = same hand
        platoon = 1 if batter_h != pitcher_hand else 0

        # Season-long batter profile (ALL BIP, not just L5)
        # Used for the Matchup Analysis page (HRP-style)
        season_profile = {"barrel": 0, "ev": 0, "fb": 0, "hard_hit": 0, "bip_count": 0, "hrs": 0, "iso": 0, "pull_barrel": 0, "pull_air": 0, "xwoba": 0.0, "sweet_spot": 0.0}
        all_bip_frames = []
        if not batter_df.empty:
            hand_bip = batter_df[(batter_df["p_throws"] == pitcher_hand) & (batter_df["launch_speed"].notna()) & (batter_df["events"].notna())]
            if not hand_bip.empty:
                all_bip_frames.append(hand_bip)
        if batter_2025 is not None and not batter_2025.empty:
            hand_bip_25 = batter_2025[(batter_2025["p_throws"] == pitcher_hand) & (batter_2025["launch_speed"].notna()) & (batter_2025["events"].notna())]
            if not hand_bip_25.empty:
                all_bip_frames.append(hand_bip_25)
        if all_bip_frames:
            all_bip = pd.concat(all_bip_frames)
            n = len(all_bip)
            season_profile["bip_count"] = n
            season_profile["ev"] = round(float(all_bip["launch_speed"].mean()), 1)
            if "launch_speed_angle" in all_bip.columns:
                season_profile["barrel"] = round(float((all_bip["launch_speed_angle"] == 6).sum() / n * 100), 1)
            if "launch_angle" in all_bip.columns:
                season_profile["fb"] = round(float(((all_bip["launch_angle"] >= 25) & (all_bip["launch_angle"] <= 50)).sum() / n * 100), 1)
                season_profile["ld"] = round(float(((all_bip["launch_angle"] >= 10) & (all_bip["launch_angle"] < 25)).sum() / n * 100), 1)
                season_profile["gb"] = round(float((all_bip["launch_angle"] < 10).sum() / n * 100), 1)
            season_profile["hard_hit"] = round(float((all_bip["launch_speed"] >= 95).sum() / n * 100), 1)
            # Blast% — approx Statcast: fast swing (bat_speed >= 75) producing hard contact (EV >= 95)
            if "bat_speed" in all_bip.columns:
                bs = all_bip["bat_speed"]
                ls = all_bip["launch_speed"]
                season_profile["blast"] = round(float(((bs >= 75) & (ls >= 95)).sum() / n * 100), 1)
            if "launch_angle" in all_bip.columns:
                sweet_mask = (all_bip["launch_angle"] >= 8) & (all_bip["launch_angle"] <= 32)
                season_profile["sweet_spot"] = round(float(sweet_mask.sum() / n * 100), 1)
                _la_vals = all_bip["launch_angle"].dropna()
                season_profile["avg_la"] = round(float(_la_vals.mean()), 1) if len(_la_vals) > 0 else 0.0
            if "estimated_woba_using_speedangle" in all_bip.columns:
                xw_vals = all_bip["estimated_woba_using_speedangle"].dropna()
                if len(xw_vals) > 0:
                    season_profile["xwoba"] = round(float(xw_vals.mean()), 3)
            if {"hc_x", "hc_y", "stand", "launch_speed_angle", "launch_angle"}.issubset(all_bip.columns):
                sub = all_bip.dropna(subset=["hc_x", "hc_y"])
                if len(sub) > 0:
                    spray = np.degrees(np.arctan2(sub["hc_x"].astype(float) - 125.42, 198.27 - sub["hc_y"].astype(float)))
                    pulled = ((sub["stand"] == "R") & (spray < -15)) | ((sub["stand"] == "L") & (spray > 15))
                    barrel_mask = sub["launch_speed_angle"] == 6
                    air_mask = sub["launch_angle"] >= 10
                    season_profile["pull_barrel"] = round(float((pulled & barrel_mask).sum() / n * 100), 1)
                    season_profile["pull_air"] = round(float((pulled & air_mask).sum() / n * 100), 1)
            if "events" in all_bip.columns:
                season_profile["hrs"] = int((all_bip["events"] == "home_run").sum())
                hits_mask = all_bip["events"].isin({"single", "double", "triple", "home_run"})
                non_ab = all_bip["events"].isin({"walk", "hit_by_pitch", "intent_walk", "sac_fly", "sac_bunt"})
                ab = (~non_ab).sum()
                if ab > 0:
                    bases = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
                    total_bases = sum(bases.get(e, 0) for e in all_bip["events"])
                    ba = hits_mask.sum() / ab
                    slg = total_bases / ab
                    season_profile["iso"] = round(float(slg - ba), 3)
            # season_abs = AB log for the batter card. Same-hand block FIRST
            # (last N vs the opposing hand — the matchup-relevant default and
            # the pool score-utils slices for L15/L20/L25), then an opposite-
            # hand block (last N) appended so the Pitch Arm filter pulls real
            # data when a user toggles to the other hand. pitch_arm is tagged
            # from each row's actual p_throws.
            # N=400/hand (was 50): store the batter's FULL current-season BBE per
            # hand, with reach-back into last season built in — `all_bip` already
            # merges 2026 + 2025 (see above), sorted newest-first, so when 2026 is
            # thin (rookies, rare pitches, early season) the tail fills from 2025.
            # 50 was starving rare-pitch / wide-window (L20/L25) views: an everyday
            # hitter's newest 50 same-hand BBE is ~4 weeks, so a low-usage pitch
            # like a splitter showed 1 where the reference sites (rudebets) show the
            # whole season's 10. 400 is a safety ceiling above a full same-hand
            # season (~270). The slate-prune keeps the size cost contained.
            _SEASON_ABS_PER_HAND = 400
            _sort_cols = ["game_date", "at_bat_number"] if "at_bat_number" in all_bip.columns else ["game_date"]

            def _build_abs(pool_df):
                if pool_df is None or pool_df.empty:
                    return []
                _pool = pool_df.sort_values(_sort_cols, ascending=False).head(_SEASON_ABS_PER_HAND)
                out = []
                for _, _r in _pool.iterrows():
                    out.append({
                        "date": str(_r.get("game_date", ""))[:10],
                        "pitcher_name": str(_r.get("player_name", "")),
                        "pitch_arm": str(_r.get("p_throws", pitcher_hand)),
                        "pitch_type": str(_r.get("pitch_name", _r.get("pitch_type", ""))),
                        "ev": round(float(_r.get("launch_speed", 0) or 0), 1),
                        "angle": round(float(_r.get("launch_angle", 0) or 0), 1),
                        "distance": round(float(_r.get("hit_distance_sc", 0) or 0), 0)
                            if pd.notna(_r.get("hit_distance_sc")) else None,
                        "result": str(_r.get("events", "")),
                        **_ab_extras(_r),
                    })
                return out

            # Opposite-hand pool (for the Pitch Arm "other hand" view).
            _off_hand = "L" if pitcher_hand == "R" else "R"
            _off_frames = []
            if not batter_df.empty:
                _ob = batter_df[(batter_df["p_throws"] == _off_hand) & (batter_df["launch_speed"].notna()) & (batter_df["events"].notna())]
                if not _ob.empty:
                    _off_frames.append(_ob)
            if batter_2025 is not None and not batter_2025.empty:
                _ob25 = batter_2025[(batter_2025["p_throws"] == _off_hand) & (batter_2025["launch_speed"].notna()) & (batter_2025["events"].notna())]
                if not _ob25.empty:
                    _off_frames.append(_ob25)
            _all_off = pd.concat(_off_frames) if _off_frames else pd.DataFrame()

            season_profile["season_abs"] = _build_abs(all_bip) + _build_abs(_all_off)

        # Zone grids — batter hot zones and pitcher vulnerable zones (pitch location 1-9)
        _bz_frames = []
        for _d in [batter_df, batter_2025]:
            if _d is not None and not _d.empty and "zone" in _d.columns and "launch_speed" in _d.columns and "p_throws" in _d.columns:
                _f = _d[(_d["p_throws"] == pitcher_hand) & _d["launch_speed"].notna()]
                if not _f.empty:
                    _bz_frames.append(_f)
        _bz_df = pd.concat(_bz_frames, ignore_index=True) if _bz_frames else pd.DataFrame()
        batter_zones = _compute_zone_stats(_bz_df)

        # Pitcher zones — use 2026 only when it has enough BIP; backfill 2025 for thin pitchers
        _MIN_PITCHER_ZONE_BIP = 20
        _pz_26 = pd.DataFrame()
        if not pitcher_df.empty and "zone" in pitcher_df.columns and "launch_speed" in pitcher_df.columns:
            _pz_26 = pitcher_df[pitcher_df["launch_speed"].notna()].copy()
            if "stand" in _pz_26.columns:
                _pz_26 = _pz_26[_pz_26["stand"] == batter_h]
        _pz_26_bip = int(_pz_26["zone"].between(1, 9).sum()) if not _pz_26.empty and "zone" in _pz_26.columns else 0

        if _pz_26_bip >= _MIN_PITCHER_ZONE_BIP:
            _pz_df = _pz_26
        else:
            _pz_frames = [_pz_26] if not _pz_26.empty else []
            if pitcher_2025 is not None and not pitcher_2025.empty and "zone" in pitcher_2025.columns and "launch_speed" in pitcher_2025.columns:
                _pz_25 = pitcher_2025[pitcher_2025["launch_speed"].notna()].copy()
                if "stand" in _pz_25.columns:
                    _pz_25 = _pz_25[_pz_25["stand"] == batter_h]
                if not _pz_25.empty:
                    _pz_frames.append(_pz_25)
            _pz_df = pd.concat(_pz_frames, ignore_index=True) if _pz_frames else pd.DataFrame()
        pitcher_zones = _compute_zone_stats(_pz_df)

        # Pitcher pitch frequency by zone — all pitches vs this batter hand
        _pfreq_df = pitcher_df if not pitcher_df.empty else pd.DataFrame()
        if _pfreq_df.empty and pitcher_2025 is not None and not pitcher_2025.empty:
            _pfreq_df = pitcher_2025
        pitcher_zone_freq = _compute_pitcher_zone_freq(_pfreq_df, batter_h)

        player_obj = {
            "name": batter_name,
            "batter_hand": batter_h,
            "opp_pitcher": opp_pitcher["name"],
            "pitcher_hand": pitcher_hand,
            "platoon": platoon,
            "game_num": entry.get("game_num", 1),
            "bvp_stats": bvp_stats,
            "splits_vs_hand": splits_vs_hand,
            "batter_side": entry["batter_side"],
            "pitch_types": l5.get("pitch_types_used", []),
            "pitch_detail": l5.get("pitch_detail", {}),
            "matchup_swstr": round(l5.get("matchup_swstr", 0.0), 1),
            "pitcher_stats": {
                "fb_rate": round(l5.get("pitcher_fb_rate", 0) * 100, 1),
                "gb_rate": round(l5.get("pitcher_gb_rate", 0) * 100, 1),
                "hr_fb_rate": round(l5.get("pitcher_hr_fb_rate", 0) * 100, 1),
                "hr_per_9": round(l5.get("pitcher_hr_per_9", 0), 2),
                "ip": round(l5.get("pitcher_ip", 0), 1),
                "total_hrs": l5.get("pitcher_total_hrs", 0),
                **pitcher_quality,
            },
            "scores": {
                key: _format_score(result)
                for key, result in multi_scores.items()
            },
            "season_stats": season_stats,
            "season_profile": season_profile,
            "hr_signals": _compute_hr_signals(
                batter_df, batter_2025, season_profile,
                pitcher_hr_per_9=round(l5.get("pitcher_hr_per_9", 0), 2),
                park_factor=env_data.get("park_factor", 100),
            ),
            "batter_zones": batter_zones,
            "pitcher_zones": pitcher_zones,
            "pitcher_zone_freq": pitcher_zone_freq,
        }

        players_by_game[gpk].append(player_obj)
        print(f"OK (L5={composite_l5:.3f})")

    # ── Phase 2.5: Build full pitcher profiles (one per pitcher) ─────────────
    print("Building pitcher profiles...")
    pitcher_profiles: dict[int, dict] = {}
    season_year = game_date.year
    seen_pids: set[int] = set()
    for g in schedule:
        for side in ("away_pitcher", "home_pitcher"):
            p = g.get(side) or {}
            pid = p.get("id")
            if not pid or pid in seen_pids:
                continue
            seen_pids.add(pid)
            df = pitcher_cache.get(pid)
            if df is None:
                df = get_pitcher_statcast(pid)
                pitcher_cache[pid] = df
            profile = build_pitcher_profile(df, pitcher_id=pid, season=season_year)
            # If no 2026 data, fall back to 2025 season data
            if profile["rows"]["season"]["bf"] == 0 and not profile["arsenal"]:
                key_2025 = (pid, 2025)
                if key_2025 not in season_cache:
                    season_cache[key_2025] = get_season_statcast(pid, "pitcher", 2025)
                df_2025 = season_cache[key_2025]
                if df_2025 is not None and not df_2025.empty:
                    profile = build_pitcher_profile(df_2025, pitcher_id=pid, season=2025)
                    profile["data_year"] = 2025
                else:
                    profile["data_year"] = season_year
            else:
                profile["data_year"] = season_year
            pitcher_profiles[pid] = profile

            # Persist each profile to disk so refresh_pitchers.py can hit a cache
            # instead of redoing the heavyweight build for known pitchers.
            try:
                cache_dir = Path("pitcher_profile_cache")
                cache_dir.mkdir(exist_ok=True)
                with open(cache_dir / f"{pid}.json", "w") as f:
                    json.dump(profile, f, default=str)
            except (OSError, ValueError):
                pass

    # ── Phase 2.6: Override pitcher_score using profile vs-hand row ──────────
    # The hand-split blend in calc_pitcher_metrics is unreliable for pitchers
    # with strong reverse splits (Skubal: HR/9 2.16 vs LHB but 0.55 overall).
    # Profile rows have correct vs_L / vs_R stats — use them directly.
    n_overrides = _apply_pitcher_split_override(players_by_game, schedule, pitcher_profiles)
    if n_overrides:
        print(f"Applied {n_overrides} hand-split pitcher_score overrides")

    # ── Phase 3: Build game-grouped output ───────────────────────────────────
    games_out = []
    for g in schedule:
        gpk = g["game_pk"]
        players = players_by_game.get(gpk, [])
        if not players:
            continue

        # Sort players by L5 composite descending
        players.sort(key=lambda p: p["scores"].get("L5", {}).get("composite", 0), reverse=True)

        # Inject pitcher_data_year so batter views can flag 2025 fallback profiles
        for player in players:
            bs = player.get("batter_side", "away")
            opp_side = "away_pitcher" if bs == "home" else "home_pitcher"
            opp_pitcher_info = g.get(opp_side) or {}
            opp_pid = opp_pitcher_info.get("id")
            player["pitcher_data_year"] = (
                pitcher_profiles.get(opp_pid, {}).get("data_year", season_year)
                if opp_pid else season_year
            )

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

        team_pitch_mix = _build_team_pitch_mix_block(g)

        games_out.append({
            "game_pk": gpk,
            "away_team": g.get("away_team", ""),
            "home_team": g.get("home_team", ""),
            "game_num": matchup_game_count.get(f"{g.get('away_team','')}@{g.get('home_team','')}", 1),
            "game_time": game_time_display,
            "game_time_sort": est_hour * 60 + est_min,  # for sorting by EST
            "away_pitcher": {
                "name": g["away_pitcher"]["name"] if g.get("away_pitcher") else "TBD",
                "hand": g["away_pitcher"]["hand"] if g.get("away_pitcher") else "?",
                "id": g["away_pitcher"].get("id") if g.get("away_pitcher") else None,
                "profile": pitcher_profiles.get(
                    g["away_pitcher"].get("id") if g.get("away_pitcher") else None
                ),
            },
            "home_pitcher": {
                "name": g["home_pitcher"]["name"] if g.get("home_pitcher") else "TBD",
                "hand": g["home_pitcher"]["hand"] if g.get("home_pitcher") else "?",
                "id": g["home_pitcher"].get("id") if g.get("home_pitcher") else None,
                "profile": pitcher_profiles.get(
                    g["home_pitcher"].get("id") if g.get("home_pitcher") else None
                ),
            },
            "environment": env_by_game.get(gpk, {}),
            "team_pitch_mix": team_pitch_mix,
            "players": players,
        })

    # Sort games by start time (earliest first)
    games_out.sort(key=lambda g: g.get("game_time_sort", 9999))

    # ── Bullpen freshness ────────────────────────────────────────────────────
    print("Fetching bullpen freshness...")
    all_team_ids = []
    team_abbr_to_id: dict[str, int] = {}
    starter_ids: set[int] = set()
    for g in schedule:
        for side in ("away", "home"):
            tid = g.get(f"{side}_team_id")
            abbr = g.get(f"{side}_team", "")
            if tid:
                all_team_ids.append(tid)
                team_abbr_to_id[abbr] = tid
            pitcher = g.get(f"{side}_pitcher")
            if pitcher and pitcher.get("id"):
                starter_ids.add(pitcher["id"])

    bullpen_data = get_bullpen_freshness_bulk(
        list(set(all_team_ids)), game_date, starter_ids=starter_ids
    )

    # Attach to each game by team_id lookup
    empty = {"arms": [], "quality": {"tier": 2, "label": "Average", "avg_era": None, "avg_hr9": None, "avg_k_pct": None, "tired_count": 0}}
    for game in games_out:
        away_id = team_abbr_to_id.get(game["away_team"])
        home_id = team_abbr_to_id.get(game["home_team"])
        game["bullpen"] = {
            "away": bullpen_data.get(away_id, empty) if away_id else empty,
            "home": bullpen_data.get(home_id, empty) if home_id else empty,
        }
    print(f"  Bullpen data attached for {len(bullpen_data)} teams.")

    return games_out, schedule


def _build_team_pitch_mix_block(g: dict) -> dict:
    """Build the team_pitch_mix block for the 'Team vs Pitch Mix' tab.

    For each lineup batter, emits the batter's recent PA history (not
    head-to-head). Each PA row is tagged with pitcher_hand + pitch_type
    so the frontend filters:
       - Season (2025 / 2026)
       - Range × Type (L5..L25 Games / PAs / BBE, or full Season)
       - vs All / vs RHP / vs LHP
       - pitch-type chips (what the opposing pitcher throws today)

    Opposing pitcher's arsenal is shown for context — pitch_mix_vs_rhb
    and pitch_mix_vs_lhb tell the user which pitch types matter today.
    """
    away_p = g.get("away_pitcher") or {}
    home_p = g.get("home_pitcher") or {}
    away_p_id = away_p.get("id")
    home_p_id = home_p.get("id")

    def _pitcher_career(pitcher_id):
        if not pitcher_id:
            return pd.DataFrame()
        parts = []
        df_26 = get_pitcher_statcast(pitcher_id)
        if df_26 is not None and not df_26.empty:
            parts.append(df_26)
        df_25 = get_season_statcast(pitcher_id, "pitcher", 2025)
        if df_25 is not None and not df_25.empty:
            parts.append(df_25)
        if not parts:
            return pd.DataFrame()
        return pd.concat(parts, ignore_index=True)

    def _batter_career(batter_id):
        if not batter_id:
            return pd.DataFrame()
        parts = []
        df_26 = get_batter_statcast(batter_id)
        if df_26 is not None and not df_26.empty:
            parts.append(df_26)
        df_25 = get_season_statcast(batter_id, "batter", 2025)
        if df_25 is not None and not df_25.empty:
            parts.append(df_25)
        if not parts:
            return pd.DataFrame()
        return pd.concat(parts, ignore_index=True)

    def _batter_recent_pa_count(batter_id) -> int:
        """Count batter's 2026 PAs — used to rank projected-lineup batters
           so the most-used hitters float to the top (top-9 = likely
           starters, rest = bench)."""
        if not batter_id:
            return 0
        df = get_batter_statcast(batter_id)
        if df is None or df.empty or "events" not in df.columns:
            return 0
        return int(df["events"].notna().sum())

    def _side(pitcher: dict, pitcher_id, lineup: list,
              lineup_posted: bool) -> dict:
        if not lineup:
            return {
                "pitcher": {
                    "name": pitcher.get("name", "TBD"),
                    "hand": pitcher.get("hand", "?"),
                    "pitch_mix_vs_rhb": {},
                    "pitch_mix_vs_lhb": {},
                },
                "lineup_status": "tbd",
                "batters": [],
            }

        # Pitcher's pitch mix (context for today's matchup), split by batter
        # hand. Use raw mix (no ≥12% threshold) so rare pitches still appear
        # as pills — they start unselected on the frontend, but the user can
        # click to include them in stats.
        def _raw_mix(pdf, hand):
            if pdf is None or pdf.empty or "stand" not in pdf.columns:
                return {}
            f = pdf[pdf["stand"] == hand].dropna(subset=["pitch_type"])
            if f.empty:
                return {}
            counts = f["pitch_type"].value_counts()
            total = counts.sum()
            if total == 0:
                return {}
            return {str(k): round(float(v) / float(total), 4) for k, v in counts.items()}

        mix_r: dict = {}
        mix_l: dict = {}
        if pitcher_id:
            pdf = _pitcher_career(pitcher_id)
            if not pdf.empty:
                mix_r = _raw_mix(pdf, "R")
                mix_l = _raw_mix(pdf, "L")

        # Include every active-roster batter so key hitters aren't silently
        # dropped. For projected lineups (no posted batting order yet), rank
        # by 2026 PA count — most-used hitters float up as "likely starters"
        # (order 1-9) so the Starters Only filter surfaces Yordan-type names
        # instead of alphabetical luck of the draw.
        if not lineup_posted:
            ranked = sorted(
                [bp for bp in lineup if bp.get("id") is not None],
                key=lambda bp: _batter_recent_pa_count(bp["id"]),
                reverse=True,
            )
        else:
            ranked = [bp for bp in lineup if bp.get("id") is not None]

        batters_out = []
        for idx, bp in enumerate(ranked):
            bid = bp["id"]
            bname = bp.get("name", "?")
            bhand = get_batter_hand(bid) or bp.get("hand", "?")
            bdf = _batter_career(bid)
            pa_history = build_batter_pa_history(bdf, max_rows=120) if not bdf.empty else []
            # Posted lineup → actual batting order 1-9 (bench = None).
            # Projected lineup → every roster batter gets a rank slot so
            # platoon starters (Goldschmidt vs LHP, etc.) aren't dropped.
            # They're sorted by 2026 PA count already, so likely starters
            # appear first; Starters Only keeps them all since none are null.
            order = idx + 1
            batters_out.append({
                "id": bid,
                "name": bname,
                "batter_hand": bhand,
                "order": order,
                "pos": bp.get("pos") or bp.get("position") or "",
                "pa_history": pa_history,
            })

        return {
            "pitcher": {
                "name": pitcher.get("name", "TBD"),
                "hand": pitcher.get("hand", "?"),
                "pitch_mix_vs_rhb": mix_r,
                "pitch_mix_vs_lhb": mix_l,
            },
            "lineup_status": "posted" if lineup_posted else "projected",
            "batters": batters_out,
        }

    home_lineup = g.get("home_lineup") or []
    away_lineup = g.get("away_lineup") or []
    home_posted = bool(home_lineup)
    away_posted = bool(away_lineup)

    if not home_lineup:
        tid = g.get("home_team_id")
        home_lineup = get_team_roster(tid) if tid else []
    if not away_lineup:
        tid = g.get("away_team_id")
        away_lineup = get_team_roster(tid) if tid else []

    return {
        "away": _side(home_p, home_p_id, away_lineup, away_posted),
        "home": _side(away_p, away_p_id, home_lineup, home_posted),
    }


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
    # SLATE-WIDE LOCK: once the first scheduled game of the day starts, ALL
    # rankings for ALL games freeze. Composite/batter/pitcher/env scores stay
    # identical for the rest of the day. The only allowed post-lock "change"
    # is the UI filtering out batters who aren't playing (Refresh Lineups
    # button) — that's a display-side filter, not a re-score.
    data_dir = Path("frontend/public/data")
    data_dir.mkdir(parents=True, exist_ok=True)
    dated_name = f"{game_date.isoformat()}.json"
    dated_path = data_dir / dated_name

    from datetime import datetime, timezone
    first_game_utc: datetime | None = None
    for g in schedule:
        utc_str = g.get("game_datetime_utc", "")
        if utc_str:
            try:
                t = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
                if first_game_utc is None or t < first_game_utc:
                    first_game_utc = t
            except ValueError:
                pass

    now_utc = datetime.now(timezone.utc)
    slate_locked = first_game_utc is not None and now_utc >= first_game_utc

    if first_game_utc:
        first_et_hour = (first_game_utc.hour - 4) % 24
        first_et_min = first_game_utc.minute
        ampm = "AM" if first_et_hour < 12 else "PM"
        display_h = first_et_hour % 12 or 12
        print(f"  First game: {display_h}:{first_et_min:02d} {ampm} ET  |  Slate locked: {slate_locked}")

    if dated_path.exists() and slate_locked:
        # First game has started — freeze ALL existing scores so global rankings never drift.
        # Only brand-new games not previously in the data get fresh scores.
        try:
            with open(dated_path) as f:
                existing = json.load(f)
            existing_games = {g["game_pk"]: g for g in existing.get("games", [])}

            merged_games = []
            new_game_pks = {g["game_pk"] for g in games_out}
            for game in games_out:
                gpk = game["game_pk"]
                if gpk in existing_games:
                    merged_games.append(existing_games[gpk])
                else:
                    merged_games.append(game)

            for gpk, existing_game in existing_games.items():
                if gpk not in new_game_pks:
                    merged_games.append(existing_game)

            games_out = merged_games
            frontend_data["games"] = _clean_for_json(games_out)
            print(f"  Slate frozen: {len(existing_games)} games locked, rankings will not change.")
        except Exception as e:
            print(f"  WARNING: slate lock failed ({e}) — writing fresh data.")

    for path in [data_dir / "latest.json", dated_path]:
        with open(path, "w") as f:
            json.dump(frontend_data, f, indent=2, default=str)

    # Also save a copy in the project root
    with open(f"hr_props_{game_date.isoformat()}.json", "w") as f:
        json.dump(frontend_data, f, indent=2, default=str)

    # ── Automatic data-integrity check ────────────────────────────────────────
    # Runs the internal validator on the slate we just wrote (arsenal leaks,
    # stat-vs-pool mismatches, bad values, thin depth). Advisory: prints a clear
    # PASS/FAIL so a bad slate is caught here instead of by a user on the site.
    try:
        import validate_slate
        _rep = validate_slate.Report()
        validate_slate.check_internal(frontend_data, _rep)
        if _rep.errors:
            print(f"\n⚠️  DATA VALIDATION: {len(_rep.errors)} integrity errors in {dated_name}:")
            for _e in _rep.errors[:25]:
                print("   " + _e)
            if len(_rep.errors) > 25:
                print(f"   … and {len(_rep.errors) - 25} more (run: python validate_slate.py --date {game_date.isoformat()})")
        else:
            print(f"✅ DATA VALIDATION: {dated_name} passed ({_rep.checked} pools checked).")
    except Exception as _ve:
        print(f"  (data validation skipped: {_ve})")

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

    # ── Three-year batter profile injection ────────────────────────────────
    # Keeps the Test sub-tab on the Rankings page populated. Runs as a
    # subprocess so a failure (e.g., MLB API blip pulling the 2024 bulk
    # frame on the runner) doesn't kill the whole regen — the rest of the
    # slate is still good and a manual re-run can patch the 3-yr field.
    print()
    print("Injecting 3-year batter profile for Test tab...")
    rc = subprocess.run(
        [sys.executable, "compute_three_year_batter.py",
         "--date", game_date.isoformat()],
        cwd=Path(__file__).resolve().parent,
        check=False,
    ).returncode
    if rc != 0:
        print(f"  [three-yr injector] exited {rc} — Test tab will be empty until next regen")

    # Keep the site lean: only the 4 newest slates stay on disk / in the deploy.
    _prune_old_slates(data_dir, keep=4)


def _prune_old_slates(data_dir: Path, keep: int = 4) -> None:
    """Keep only the `keep` most-recent dated slate JSONs served by the site;
    delete older ones and rebuild index.json to list only what remains.

    Each full slate is ~25MB, so the whole `public/data` dir (and every Vercel
    deploy) was ballooning ~25MB/day. Past slates are needed only transiently to
    grade the next day's results — and that grading (`_refresh_results_and_ml`)
    runs BEFORE this, on the same invocation, while yesterday's slate is still
    present. The compact `results/` reports (the real season-long history the
    Results tab + ML learn from) are a separate tree and are never touched here.

    Retention decision: last 3 days + tomorrow = the 4 newest dated slates.
    latest.json and all non-dated files are left alone."""
    date_re = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
    dated = sorted(
        (p for p in data_dir.glob("*.json") if date_re.match(p.name)),
        key=lambda p: p.name, reverse=True,
    )
    for p in dated[keep:]:
        try:
            p.unlink()
            print(f"[prune] removed old slate {p.name}")
        except OSError as e:
            print(f"[prune] could not remove {p.name}: {e}")
    kept_dates = sorted((p.stem for p in dated[:keep]), reverse=True)
    with open(data_dir / "index.json", "w") as f:
        json.dump({"dates": kept_dates}, f, indent=2)
    print(f"[prune] index.json now lists {len(kept_dates)} dates: {kept_dates}")


def _refresh_results_and_ml(game_date: date) -> None:
    """Reconcile yesterday's predictions vs actual HRs and refresh ML analysis,
    then sync the result files into the frontend public dir.

    Failures here are non-fatal — slate gen still proceeds. The user wanted
    these to auto-update on every slate gen so we don't keep accumulating
    backfill debt the way we did 4/23-4/26."""
    yesterday = game_date - timedelta(days=1)
    repo = Path(__file__).resolve().parent
    py = sys.executable

    print(f"[auto-refresh] reconciling results for {yesterday.isoformat()}...")
    rc = subprocess.run(
        [py, "results_tracker.py", "--date", yesterday.isoformat()],
        cwd=repo, check=False,
    ).returncode
    if rc != 0:
        print(f"[auto-refresh] results_tracker exited {rc} — continuing")

    print("[auto-refresh] retraining ML analysis...")
    rc = subprocess.run([py, "ml_trainer.py"], cwd=repo, check=False).returncode
    if rc != 0:
        print(f"[auto-refresh] ml_trainer exited {rc} — continuing")

    # Sync results/ → frontend/public/data/results/ so the dashboard sees them
    src = repo / "results"
    dst = repo / "frontend" / "public" / "data" / "results"
    if src.exists() and dst.exists():
        for f in src.glob("*.json"):
            shutil.copy2(f, dst / f.name)
        print(f"[auto-refresh] synced {src} → {dst}")


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
    parser.add_argument(
        "--skip-auto-results", action="store_true",
        help="Skip auto-running results_tracker and ml_trainer before slate gen",
    )
    args = parser.parse_args()

    game_date = date.today()
    if args.date:
        game_date = date.fromisoformat(args.date)

    if not args.skip_auto_results:
        _refresh_results_and_ml(game_date)

    games_out, schedule = run_model(game_date, fast=args.fast)
    print_results(games_out, game_date, schedule)


if __name__ == "__main__":
    main()
