#!/usr/bin/env python3
from __future__ import annotations
"""
Results Tracker — Compares model predictions to actual HR outcomes.

Runs after games complete. Checks who actually hit HRs via MLB Stats API,
cross-references against the model's rankings, and logs accuracy data.

Usage:
    python results_tracker.py                    # check today
    python results_tracker.py --date 2026-04-02  # check specific date
"""

import argparse
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

# Weighted-average outfield fence distances per park (LF + 2*CF + RF) / 4
PARK_FENCE_DIST: dict[str, int] = {
    "BAL": 376, "BOS": 360, "NYY": 356, "TB": 375, "TOR": 371,
    "CWS": 369, "CLE": 378, "DET": 410, "KC": 373, "MIN": 371,
    "HOU": 380, "LAA": 373, "OAK": 368, "SEA": 375, "TEX": 369,
    "ATL": 369, "MIA": 376, "NYM": 374, "PHI": 369, "WSH": 367,
    "CHC": 366, "CIN": 368, "MIL": 375, "PIT": 364, "STL": 367,
    "ARI": 370, "AZ": 370, "COL": 380, "LAD": 363, "SD": 361,
    "SDP": 361, "SF": 364,
}


# Deduplicated — only 30 unique parks
_UNIQUE_PARK_DISTS = {
    "BAL": 376, "BOS": 360, "NYY": 356, "TB": 375, "TOR": 371,
    "CWS": 369, "CLE": 378, "DET": 410, "KC": 373, "MIN": 371,
    "HOU": 380, "LAA": 373, "OAK": 368, "SEA": 375, "TEX": 369,
    "ATL": 369, "MIA": 376, "NYM": 374, "PHI": 369, "WSH": 367,
    "CHC": 366, "CIN": 368, "MIL": 375, "PIT": 364, "STL": 367,
    "ARI": 370, "COL": 380, "LAD": 363, "SDP": 361, "SF": 364,
}


def hr_in_x_parks(distance: float) -> int:
    """How many of 30 MLB parks would this batted ball be a HR in?"""
    if not distance or distance <= 0:
        return 0
    return sum(1 for d in _UNIQUE_PARK_DISTS.values() if distance >= d)


def get_actual_hrs(game_date: date) -> list[dict]:
    """
    Pull all home runs hit on a given date from the MLB Stats API.
    Returns list of {batter_name, batter_id, pitcher_name, team, game_pk, inning, exit_velo, distance}
    """
    url = (
        f"https://statsapi.mlb.com/api/v1/schedule"
        f"?date={game_date.isoformat()}&sportId=1&hydrate=scoringplays"
    )
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    hrs = []
    for date_entry in data.get("dates", []):
        for game in date_entry.get("games", []):
            gpk = game["gamePk"]
            status = game.get("status", {}).get("detailedState", "")
            if status not in ("Final", "Game Over", "Completed Early"):
                continue

            scoring = game.get("scoringPlays", [])
            for play in scoring:
                result = play.get("result", {})
                event = result.get("event", "")
                if event != "Home Run":
                    continue

                matchup = play.get("matchup", {})
                batter = matchup.get("batter", {})
                pitcher = matchup.get("pitcher", {})

                hrs.append({
                    "batter_name": batter.get("fullName", ""),
                    "batter_id": batter.get("id", 0),
                    "pitcher_name": pitcher.get("fullName", ""),
                    "team": play.get("about", {}).get("halfInning", ""),
                    "game_pk": gpk,
                    "inning": play.get("about", {}).get("inning", 0),
                    "description": result.get("description", ""),
                })

    return hrs


def get_near_hrs(game_date: date) -> list[dict]:
    """
    Pull near-HRs from Statcast: balls in play with HR-like exit velo and
    launch angle that didn't leave the park. These are warning track shots
    that confirm the model identified the right matchup.

    Criteria: EV >= 95 mph, launch angle 25-35 degrees, NOT a home run.
    """
    from pybaseball import statcast
    try:
        df = statcast(start_dt=game_date.isoformat(), end_dt=game_date.isoformat())
        if df is None or df.empty:
            return []

        # Near-HR rule (matches frontend Live Feed):
        # Would this ball have been a HR in at least 10 of 30 MLB parks?
        # Uses each park's weighted fence distance from PARK_FENCE_DIST.
        # Requires angle > 10° to exclude grounders that travel on
        # bounces. Single clean rule — retired the EV/angle gymnastics.
        import numpy as np
        ev = pd.to_numeric(df["launch_speed"], errors="coerce").fillna(0).values
        la = pd.to_numeric(df["launch_angle"], errors="coerce").fillna(0).values
        dist = pd.to_numeric(df["hit_distance_sc"], errors="coerce").fillna(0).values
        is_hr = df["events"].astype(str).values == "home_run"

        parks_count = np.array([sum(1 for pd_ in _UNIQUE_PARK_DISTS.values() if d >= pd_)
                                 for d in dist])
        mask = (parks_count >= 10) & (la > 10) & ~is_hr
        near = df[mask].copy()

        # Reverse lookup batter names from MLB API
        from data_fetchers import _get_person_info
        results = []
        for _, row in near.iterrows():
            batter_id = int(row.get("batter", 0))
            try:
                info = _get_person_info(batter_id)
                batter_name = info.get("fullName", f"ID:{batter_id}")
            except Exception:
                batter_name = f"ID:{batter_id}"
            ev_val = float(row["launch_speed"]) if pd.notna(row.get("launch_speed")) else 0
            la_val = float(row["launch_angle"]) if pd.notna(row.get("launch_angle")) else 0
            dist_val = float(row["hit_distance_sc"]) if pd.notna(row.get("hit_distance_sc")) else 0
            from park_dimensions import hr_in_x_parks as hr_parks_calc
            hc_x_val = float(row["hc_x"]) if pd.notna(row.get("hc_x")) else None
            hc_y_val = float(row["hc_y"]) if pd.notna(row.get("hc_y")) else None
            parks = hr_parks_calc(dist_val, hc_x_val, hc_y_val) if dist_val > 0 else 0
            # Only include if it would be a HR in at least 1 park
            if parks == 0:
                continue
            results.append({
                "batter_name": batter_name,
                "batter_id": batter_id,
                "ev": round(ev_val, 1),
                "angle": round(la_val, 1),
                "distance": round(dist_val, 0) if dist_val > 0 else None,
                "hr_in_parks": parks,
                "result": str(row.get("events", "") if pd.notna(row.get("events")) else ""),
                "pitcher_name": str(row.get("player_name", "") if pd.notna(row.get("player_name")) else ""),
            })
        return results
    except Exception as e:
        print(f"  [WARN] get_near_hrs failed: {e}")
        return []


# ── Season + Form scoring (mirrors score-utils.ts exactly) ───────────────────
_EV_LO, _EV_HI = 92.0, 102.0
_BRL_LO, _BRL_HI = 0.0, 0.25
_FB_LO, _FB_HI = 0.15, 0.55


def _norm(v: float, lo: float, hi: float) -> float:
    return max(0.0, min(1.0, (v - lo) / (hi - lo)))


def _compute_season_score(player: dict) -> dict | None:
    sp = player.get("season_profile")
    if not sp or sp.get("bip_count", 0) < 20:
        return None
    barrel_n = _norm(sp["barrel"] / 100, _BRL_LO, _BRL_HI)
    fb_n = _norm(sp["fb"] / 100, _FB_LO, _FB_HI)
    ev_n = _norm(sp["ev"], _EV_LO, _EV_HI)
    batter = barrel_n * 0.55 + fb_n * 0.25 + ev_n * 0.20
    l10 = player.get("scores", {}).get("L10", {})
    return {
        "batter": batter,
        "pitcher": l10.get("pitcher_score", 0.5),
        "env": l10.get("env_score", 0.5),
    }


def _form_batter_from_scoreset(s: dict, season_batter: float) -> float:
    brl = s.get("barrel_pct")
    fb = s.get("fb_pct")
    ev = s.get("exit_velo")
    if brl is None or fb is None or ev is None:
        return season_batter
    return (_norm(brl / 100, _BRL_LO, _BRL_HI) * 0.55
            + _norm(fb / 100, _FB_LO, _FB_HI) * 0.25
            + _norm(ev, _EV_LO, _EV_HI) * 0.20)


def _compute_combined_score(player: dict) -> float:
    """Balanced Edge — geometric mean across 5 factors. Mirrors TS combinedScore
    in ml-rankings.tsx. Weakness in any single factor drags the score down."""
    scores = player.get("scores", {})
    l5 = scores.get("L5") or {}
    l10 = scores.get("L10") or {}
    if not l5 and not l10:
        return 0.0
    s = l10 if l10 else l5

    def n(v, lo, hi):
        if v is None: return 0.5
        return max(0.05, min(1.0, (v - lo) / (hi - lo)))

    f_l10 = n((l10 or s).get("batter_score", 0.5), 0.2, 0.8)
    f_l5  = n((l5  or l10).get("batter_score", 0.5), 0.2, 0.8)
    f_pit = n(s.get("pitcher_score", 0.5), 0.2, 0.8)
    f_env = n(s.get("env_score", 0.5), 0.2, 0.8)

    pd = player.get("pitch_detail") or {}
    wb_brl = wb_hh = wt = 0.0
    for dd in pd.values():
        u = dd.get("usage_pct", 0) or 0
        wt += u
        wb_brl += (dd.get("barrel_rate", 0) or 0) * u
        wb_hh  += (dd.get("hard_hit_rate", 0) or 0) * u
    if wt > 0:
        wb_brl /= wt; wb_hh /= wt
    f_mix = (n(wb_brl, 5, 35) + n(wb_hh, 20, 60)) / 2

    return (f_l10 * f_l5 * f_pit * f_env * f_mix) ** (1/5)


def load_model_predictions(game_date: date) -> dict:
    """Load the model's predictions for a given date."""
    path = Path(f"frontend/public/data/{game_date.isoformat()}.json")
    if not path.exists():
        path = Path(f"hr_props_{game_date.isoformat()}.json")
    if not path.exists():
        return {}

    with open(path) as f:
        return json.load(f)


def compare_results(game_date: date) -> dict:
    """
    Compare model predictions to actual HR outcomes.
    Returns a detailed report.
    """
    # Load predictions
    predictions = load_model_predictions(game_date)
    if not predictions or "games" not in predictions:
        return {"error": f"No model data for {game_date.isoformat()}"}

    # Get completed game statuses to filter out postponed/suspended
    # Use game_pk to match since abbreviations aren't always available
    completed_game_pks = set()
    postponed_game_pks = set()
    try:
        sched_url = f"https://statsapi.mlb.com/api/v1/schedule?date={game_date.isoformat()}&sportId=1"
        sched_resp = requests.get(sched_url, timeout=15)
        sched_data = sched_resp.json()
        for d in sched_data.get("dates", []):
            for g in d.get("games", []):
                status = g.get("status", {}).get("detailedState", "")
                gpk = g.get("gamePk", 0)
                if status in ("Final", "Game Over", "Completed Early"):
                    completed_game_pks.add(gpk)
                elif status in ("Postponed", "Cancelled", "Suspended"):
                    postponed_game_pks.add(gpk)
    except Exception:
        pass

    # Fetch every player who actually had a plate appearance per game.
    # Anyone in the slate's player list who's NOT in this set didn't play
    # (scratched, bench, called up but unused, etc.) and must be excluded
    # from tier denominators so hit-rates aren't artificially deflated.
    players_who_batted: set[str] = set()
    for gpk in completed_game_pks:
        try:
            box_url = f"https://statsapi.mlb.com/api/v1/game/{gpk}/boxscore"
            box_resp = requests.get(box_url, timeout=15)
            box = box_resp.json()
            for side in ("home", "away"):
                team = box.get("teams", {}).get(side, {})
                for pid, info in (team.get("players") or {}).items():
                    stats = info.get("stats", {}).get("batting") or {}
                    pa = (stats.get("plateAppearances") or 0) + (stats.get("atBats") or 0)
                    if pa > 0:
                        name = (info.get("person") or {}).get("fullName")
                        if name:
                            players_who_batted.add(name)
        except Exception:
            continue
    print(f"Players who actually batted on {game_date}: {len(players_who_batted)}")

    # Build ranked lists — exclude postponed/cancelled games only
    lookback_results = {}
    for lb in ["L5", "L10"]:
        players_lb = []
        for game in predictions["games"]:
            gpk = game.get("game_pk", 0)
            # Skip postponed/suspended/cancelled games
            if gpk in postponed_game_pks:
                continue
            matchup = f"{game['away_team']}@{game['home_team']}"
            for player in game["players"]:
                # Skip players who never batted today (scratched / bench / unused call-ups).
                # If we couldn't fetch any box scores, players_who_batted is empty —
                # fall back to including everyone so we don't accidentally zero out the day.
                if players_who_batted and player["name"] not in players_who_batted:
                    continue
                scores = player.get("scores", {}).get(lb, player.get("scores", {}).get("L5", {}))
                players_lb.append({
                    "name": player["name"],
                    "composite": scores.get("composite", 0),
                    "batter_score": scores.get("batter_score", 0),
                    "pitcher_score": scores.get("pitcher_score", 0),
                    "env_score": scores.get("env_score", 0),
                    "barrel_pct": scores.get("barrel_pct", 0),
                    "fb_pct": scores.get("fb_pct", 0),
                    "hard_hit_pct": scores.get("hard_hit_pct", 0),
                    "exit_velo": scores.get("exit_velo", 0),
                    "opp_pitcher": player.get("opp_pitcher", ""),
                    "matchup": matchup,
                })
        # Deduplicate by player name — keep highest composite if duplicate
        seen = {}
        for p in players_lb:
            if p["name"] not in seen or p["composite"] > seen[p["name"]]["composite"]:
                seen[p["name"]] = p
        players_lb = list(seen.values())
        players_lb.sort(key=lambda x: x["composite"], reverse=True)
        for i, p in enumerate(players_lb):
            p["rank"] = i + 1
        lookback_results[lb] = players_lb

    # Use L5 as primary (for backward compat), but track all
    all_players = lookback_results["L5"]

    # Get actual HRs
    actual_hrs = get_actual_hrs(game_date)
    hr_names = {hr["batter_name"] for hr in actual_hrs}

    # Get near-HRs (warning track shots)
    near_hrs = get_near_hrs(game_date)
    near_hr_names = {n["batter_name"] for n in near_hrs} - hr_names  # exclude actual HR hitters

    # Cross-reference
    hits = []
    near_hits = []  # ranked players who had near-HRs but not actual HRs
    misses = []
    surprise_hrs = []

    player_names = {p["name"] for p in all_players}

    for player in all_players:
        # Check actual HR
        hit = any(player["name"] in hr or hr in player["name"] for hr in hr_names)
        # Check near-HR
        near = any(player["name"] in n or n in player["name"] for n in near_hr_names)

        if hit:
            hits.append(player)
        elif near:
            near_hits.append(player)
        else:
            misses.append(player)

    # HRs by players not in our rankings
    for hr in actual_hrs:
        matched = False
        for p_name in player_names:
            if p_name in hr["batter_name"] or hr["batter_name"] in p_name:
                matched = True
                break
        if not matched:
            surprise_hrs.append(hr)

    # Accuracy by tier — for each lookback window
    tier_accuracy = {}
    tier_accuracy_by_lookback = {}
    for lb, lb_players in lookback_results.items():
        lb_tiers = {
            "top_10": lb_players[:10],
            "top_20": lb_players[:20],
            "top_30": lb_players[:30],
            "all": lb_players,
        }
        lb_accuracy = {}
        for tier_name, tier_players in lb_tiers.items():
            tier_hits = [p for p in tier_players if any(
                p["name"] in hr or hr in p["name"] for hr in hr_names
            )]
            lb_accuracy[tier_name] = {
                "total": len(tier_players),
                "hits": len(tier_hits),
                "rate": round(len(tier_hits) / len(tier_players) * 100, 1) if tier_players else 0,
            }
        tier_accuracy_by_lookback[lb] = lb_accuracy

    # Use L5 as the primary tier_accuracy (backward compat)
    tier_accuracy = tier_accuracy_by_lookback.get("L5", {})

    # Find which lookback performed best on this date
    best_lookback = "L5"
    best_top20 = 0
    for lb, acc in tier_accuracy_by_lookback.items():
        rate = acc.get("top_20", {}).get("rate", 0)
        if rate > best_top20:
            best_top20 = rate
            best_lookback = lb

    # Average composite of HR hitters vs non-hitters
    hr_composites = [p["composite"] for p in hits]
    non_hr_composites = [p["composite"] for p in misses]
    avg_hr_composite = round(sum(hr_composites) / len(hr_composites), 3) if hr_composites else 0
    avg_non_hr_composite = round(sum(non_hr_composites) / len(non_hr_composites), 3) if non_hr_composites else 0

    # Near-HR tier accuracy (HR + near-HR combined) using L5
    tier_accuracy_with_near = {}
    l5_tiers = {"top_10": all_players[:10], "top_20": all_players[:20], "top_30": all_players[:30], "all": all_players}
    for tier_name, tier_players in l5_tiers.items():
        tier_hr_or_near = [p for p in tier_players if any(
            p["name"] in n or n in p["name"] for n in (hr_names | near_hr_names)
        )]
        tier_accuracy_with_near[tier_name] = {
            "total": len(tier_players),
            "hits": len(tier_hr_or_near),
            "rate": round(len(tier_hr_or_near) / len(tier_players) * 100, 1) if tier_players else 0,
        }

    # ── Balanced Edge ranked list ────────────────────────────────────────────
    combined_raw = []
    for game in predictions["games"]:
        if game.get("game_pk", 0) in postponed_game_pks:
            continue
        matchup = f"{game['away_team']}@{game['home_team']}"
        for player in game["players"]:
            if players_who_batted and player["name"] not in players_who_batted:
                continue
            combined_raw.append({
                "name": player["name"],
                "composite": _compute_combined_score(player),
                "opp_pitcher": player.get("opp_pitcher", ""),
                "matchup": matchup,
            })
    seen_combined: dict[str, dict] = {}
    for p in combined_raw:
        if p["name"] not in seen_combined or p["composite"] > seen_combined[p["name"]]["composite"]:
            seen_combined[p["name"]] = p
    combined_players = list(seen_combined.values())
    combined_players.sort(key=lambda x: x["composite"], reverse=True)
    for i, p in enumerate(combined_players):
        p["rank"] = i + 1

    def _name_match(a: str, b: str) -> bool:
        return a in b or b in a

    combined_tiers = {
        "top_10": combined_players[:10],
        "top_20": combined_players[:20],
        "top_30": combined_players[:30],
        "all": combined_players,
    }
    combined_tier_accuracy: dict[str, dict] = {}
    for tier_name, tier_players in combined_tiers.items():
        tier_hits = [p for p in tier_players if any(_name_match(p["name"], hr) for hr in hr_names)]
        combined_tier_accuracy[tier_name] = {
            "total": len(tier_players),
            "hits": len(tier_hits),
            "rate": round(len(tier_hits) / len(tier_players) * 100, 1) if tier_players else 0,
        }

    # ── HR Signal tier accuracy ───────────────────────────────────────────────
    # For each player in the dated JSON, count their triggered signals (0-5)
    # and check if they hit a HR. Group into tiers: 1, 2, 3, 4, 5 signals.

    signal_buckets: dict[int, list[dict]] = {1: [], 2: [], 3: [], 4: [], 5: []}
    for game in predictions["games"]:
        if game.get("game_pk", 0) in postponed_game_pks:
            continue
        for player in game["players"]:
            sig = player.get("hr_signals")
            if not sig:
                continue
            flags = [
                bool(sig.get("barrel_heat")),
                bool(sig.get("pull_power")),
                bool((sig.get("drought") or {}).get("triggered")),
                bool(sig.get("pitcher_vulnerable")),
                bool(sig.get("park_friendly")),
            ]
            count = sum(flags)
            if count >= 1:
                name = player["name"]
                hit_hr = any(_name_match(name, hr) for hr in hr_names)
                entry = {"name": name, "signals": count, "hit_hr": hit_hr}
                signal_buckets[count].append(entry)

    hr_signal_accuracy: dict[str, dict] = {}
    for sig_count in range(1, 6):
        bucket = signal_buckets[sig_count]
        if not bucket:
            continue
        hrs_in_bucket = [e for e in bucket if e["hit_hr"]]
        hr_signal_accuracy[f"{sig_count}_of_5"] = {
            "players": len(bucket),
            "hr_count": len(hrs_in_bucket),
            "hr_rate": round(len(hrs_in_bucket) / len(bucket) * 100, 1),
            "names": [e["name"] for e in bucket],
            "hr_names": [e["name"] for e in hrs_in_bucket],
        }

    report = {
        "date": game_date.isoformat(),
        "players_who_batted": sorted(players_who_batted),
        "total_players_ranked": len(all_players),
        "total_hrs_hit": len(actual_hrs),
        "total_near_hrs": len(near_hits),
        "model_hits": len(hits),
        "best_lookback": best_lookback,
        "tier_accuracy_by_lookback": tier_accuracy_by_lookback,
        "model_near_hits": len(near_hits),
        "tier_accuracy": tier_accuracy,
        "tier_accuracy_with_near": tier_accuracy_with_near,
        "avg_composite_hr_hitters": avg_hr_composite,
        "avg_composite_non_hitters": avg_non_hr_composite,
        "composite_separation": round(avg_hr_composite - avg_non_hr_composite, 3),
        "hr_hitters": [
            {"name": p["name"], "rank": p["rank"], "composite": p["composite"],
             "opp_pitcher": p["opp_pitcher"], "matchup": p["matchup"]}
            for p in hits
        ],
        "hr_hitters_l10": [
            {"name": p["name"], "rank": p["rank"], "composite": p["composite"],
             "opp_pitcher": p["opp_pitcher"], "matchup": p["matchup"]}
            for p in lookback_results.get("L10", [])
            if p["name"] in hr_names
        ],
        "near_hr_hitters": [
            {"name": p["name"], "rank": p["rank"], "composite": p["composite"],
             "opp_pitcher": p["opp_pitcher"], "matchup": p["matchup"]}
            for p in near_hits
        ],
        "near_hr_events": [
            {"batter": n["batter_name"], "ev": n["ev"], "angle": n["angle"],
             "distance": n["distance"], "hr_in_parks": n.get("hr_in_parks", 0),
             "result": n["result"], "pitcher": n["pitcher_name"]}
            for n in near_hrs
        ],
        "surprise_hrs": [
            {"name": hr["batter_name"], "pitcher": hr["pitcher_name"],
             "description": hr["description"]}
            for hr in surprise_hrs
        ],
        "hr_signal_accuracy": hr_signal_accuracy,
        "combined_tier_accuracy": combined_tier_accuracy,
        "combined_hr_hitters": [
            {"name": p["name"], "rank": p["rank"], "composite": round(p["composite"], 3),
             "opp_pitcher": p["opp_pitcher"], "matchup": p["matchup"]}
            for p in combined_players
            if any(_name_match(p["name"], hr) for hr in hr_names)
        ],
    }

    return report


def save_report(report: dict, game_date: date):
    """Save the daily report to a tracking file."""
    reports_dir = Path("results")
    reports_dir.mkdir(exist_ok=True)

    # Save individual day report
    day_file = reports_dir / f"{game_date.isoformat()}.json"
    with open(day_file, "w") as f:
        json.dump(report, f, indent=2)

    # Append to cumulative tracking file
    cumulative_file = reports_dir / "cumulative.json"
    cumulative = []
    if cumulative_file.exists():
        with open(cumulative_file) as f:
            cumulative = json.load(f)

    # Remove existing entry for this date if re-running
    cumulative = [r for r in cumulative if r.get("date") != game_date.isoformat()]
    cumulative.append(report)
    cumulative.sort(key=lambda x: x["date"])

    with open(cumulative_file, "w") as f:
        json.dump(cumulative, f, indent=2)

    # Also save to frontend public folder
    fe_dir = Path("frontend/public/data/results")
    fe_dir.mkdir(parents=True, exist_ok=True)
    with open(fe_dir / f"{game_date.isoformat()}.json", "w") as f:
        json.dump(report, f, indent=2)
    with open(fe_dir / "cumulative.json", "w") as f:
        json.dump(cumulative, f, indent=2)

    return day_file, cumulative_file


def print_report(report: dict):
    """Print a human-readable summary."""
    if "error" in report:
        print(f"ERROR: {report['error']}")
        return

    print(f"\n{'='*70}")
    print(f"  RESULTS TRACKER — {report['date']}")
    print(f"{'='*70}")
    print(f"\n  Players ranked: {report['total_players_ranked']}")
    print(f"  Total HRs hit: {report['total_hrs_hit']}")
    print(f"  Model caught: {report['model_hits']}")
    print(f"  Surprise HRs (not ranked): {report.get('surprise_hrs', 0) if isinstance(report.get('surprise_hrs'), int) else len(report.get('surprise_hrs', []))}")

    print(f"\n  TIER ACCURACY:")
    for tier, data in report["tier_accuracy"].items():
        print(f"    {tier:>8s}: {data['hits']}/{data['total']} = {data['rate']}%")

    print(f"\n  COMPOSITE SEPARATION:")
    print(f"    HR hitters avg:     {report['avg_composite_hr_hitters']}")
    print(f"    Non-HR hitters avg: {report['avg_composite_non_hitters']}")
    print(f"    Separation:         {report['composite_separation']}")
    if report['composite_separation'] > 0:
        print(f"    ✓ Model correctly ranks HR hitters higher on average")
    else:
        print(f"    ✗ Model does NOT rank HR hitters higher — weights need tuning")

    print(f"\n  HR HITTERS IN RANKINGS:")
    for p in report.get("hr_hitters", []):
        print(f"    #{p['rank']:3d}  {p['name']:25s}  {p['composite']:.3f}  vs {p['opp_pitcher']}")

    surprise = report.get("surprise_hrs", [])
    if isinstance(surprise, list) and surprise:
        print(f"\n  SURPRISE HRs (not in rankings):")
        for hr in surprise:
            print(f"    {hr['name']:25s}  vs {hr.get('pitcher', '')}")

    print()


def main():
    parser = argparse.ArgumentParser(description="MLB HR Model Results Tracker")
    parser.add_argument("--date", type=str, default=None)
    args = parser.parse_args()

    if args.date:
        game_date = date.fromisoformat(args.date)
    else:
        # Default to yesterday — results are for completed games
        game_date = date.today() - timedelta(days=1)

    print(f"Checking results for {game_date.isoformat()}...")
    report = compare_results(game_date)
    print_report(report)

    day_file, cum_file = save_report(report, game_date)
    print(f"Saved to {day_file}")
    print(f"Cumulative: {cum_file}")


if __name__ == "__main__":
    main()
