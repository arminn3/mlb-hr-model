"""
Pitcher Strikeouts Projection Model (MVP v0)

Standalone from the HR model — reads the existing slate JSON to get
tonight's pitchers, projects their K total, writes output to a
separate file for the frontend.

Does NOT touch any HR-model files. Only reuses read-only helpers
from data_fetchers.py.

Usage: python k_model.py [--date 2026-04-13]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime
from pathlib import Path

import pandas as pd

# Reused read-only from existing pipeline — no modifications
from data_fetchers import (
    get_pitcher_statcast,
    get_season_statcast,
    resolve_player_id,
    get_team_roster,
    get_batter_statcast,
)

# League-average constants (MLB ~2024/2025 season averages)
LEAGUE_AVG_K_PCT = 0.225       # ~22.5% of plate appearances end in K
LEAGUE_AVG_SWSTR_PCT = 0.105   # ~10.5% swinging-strike rate
DEFAULT_IP_PER_START = 5.5     # fallback when recent start data is thin


def compute_pitcher_k_metrics(pitcher_name: str, pitcher_hand: str) -> dict | None:
    """
    Pull season-level K metrics for a pitcher from Statcast.
    Returns dict with k_pct, swstr_pct, k_per_9, ip_per_start, total_ip.
    Returns None if we can't resolve or have no data.
    """
    pid = resolve_player_id(pitcher_name)
    if not pid:
        return None

    # Try current season first, fall back to 2025 for early April
    df = get_pitcher_statcast(pid)
    year_used = 2026
    if df is None or df.empty or len(df) < 50:
        df_2025 = get_season_statcast(pid, start_year=2025, end_year=2025, role="pitcher")
        if df_2025 is not None and not df_2025.empty:
            # Blend: weight 2026 by its pitch count, rest from 2025
            if df is None or df.empty:
                df = df_2025
                year_used = 2025
            else:
                df = pd.concat([df, df_2025])
                year_used = "blend"

    if df is None or df.empty:
        return None

    # Compute K%: strikeouts / total plate appearances
    # events is set on the last pitch of a PA — count unique PAs
    if "events" not in df.columns:
        return None
    pa_df = df[df["events"].notna() & (df["events"] != "")]
    pa_count = len(pa_df)
    if pa_count == 0:
        return None
    k_count = int((pa_df["events"] == "strikeout").sum())
    k_pct = k_count / pa_count

    # SwStr% = swinging strikes / total pitches
    if "description" in df.columns:
        swinging_misses = df["description"].isin(
            ["swinging_strike", "swinging_strike_blocked"]
        ).sum()
        total_pitches = len(df)
        swstr_pct = float(swinging_misses / total_pitches) if total_pitches else 0.0
    else:
        swstr_pct = LEAGUE_AVG_SWSTR_PCT

    # IP = outs / 3. Outs from events: field_out, strikeout, grounded_into_double_play, etc.
    # Rough proxy: count PAs that ended in outs
    out_events = {
        "field_out", "strikeout", "strikeout_double_play", "grounded_into_double_play",
        "double_play", "force_out", "fielders_choice", "fielders_choice_out",
        "sac_fly", "sac_bunt", "caught_stealing_2b", "caught_stealing_3b",
        "caught_stealing_home",
    }
    outs = int(pa_df["events"].isin(out_events).sum())
    total_ip = outs / 3.0

    # Starts counted via unique game_date + game_pk
    if "game_pk" in df.columns:
        starts = df["game_pk"].nunique()
    else:
        starts = max(1, int(total_ip / DEFAULT_IP_PER_START))
    ip_per_start = total_ip / starts if starts > 0 else DEFAULT_IP_PER_START

    # K/9 = (K / IP) * 9
    k_per_9 = (k_count / total_ip * 9) if total_ip > 0 else 0.0

    return {
        "pitcher_name": pitcher_name,
        "pitcher_hand": pitcher_hand,
        "pitcher_id": pid,
        "k_pct": round(float(k_pct), 4),
        "swstr_pct": round(float(swstr_pct), 4),
        "k_per_9": round(float(k_per_9), 2),
        "ip_per_start": round(float(ip_per_start), 2),
        "total_ip": round(float(total_ip), 1),
        "starts": int(starts),
        "strikeouts_total": k_count,
        "pa_faced": pa_count,
        "data_source": str(year_used),
    }


def compute_team_k_pct(team_abbr: str, opposing_pitcher_hand: str) -> float | None:
    """
    Rough estimate of a team's K% against pitchers of opposing_pitcher_hand.
    MVP: skips actual lineup fetching and uses league avg as fallback.
    TODO: populate via team rosters + per-batter K rates in v1.
    """
    # MVP: return None to signal "use league average"
    # Future: fetch team roster, average each hitter's K% vs this hand
    return None


def project_k_total(
    pitcher_metrics: dict,
    expected_ip: float | None = None,
    team_k_adjustment: float = 1.0,
) -> dict:
    """
    Project K total for a start.

    Formula: K = IP × (K/9 / 9) × team_adjustment
    Where team_adjustment = opposing_team_k_pct / league_avg_k_pct
    Default adjustment = 1.0 when team data unavailable.
    """
    ip = expected_ip if expected_ip is not None else pitcher_metrics.get(
        "ip_per_start", DEFAULT_IP_PER_START
    )
    # Guardrails — Statcast IP calc is often incomplete (missing some
    # games/PAs). Starters who only show 3-4 IP per start in scraped data
    # are usually averaging 5.5-6 IP in reality. Floor at 5.0 for starters.
    ip = max(5.0, min(7.5, ip))

    k_per_9 = pitcher_metrics.get("k_per_9", 0)
    projected_ks = ip * (k_per_9 / 9.0) * team_k_adjustment

    return {
        "projected_k": round(projected_ks, 2),
        "expected_ip": round(ip, 2),
        "k_per_9_used": k_per_9,
        "team_adjustment": round(team_k_adjustment, 3),
    }


def process_slate(slate_path: str, out_path: str) -> None:
    """Main entry — read slate, project Ks for each starter, save output."""
    with open(slate_path) as f:
        slate = json.load(f)

    slate_date = slate.get("date", str(date.today()))
    games = slate.get("games", [])

    # Collect unique pitchers from the slate
    pitcher_tasks: list[tuple[str, str, str, str]] = []  # (name, hand, team, opp_team)
    seen = set()
    for g in games:
        away_team = g.get("away_team", "")
        home_team = g.get("home_team", "")
        # Note: away pitcher faces home team, home pitcher faces away team
        ap = g.get("away_pitcher", {})
        if ap.get("name") and ap["name"] != "TBD" and ap["name"] not in seen:
            pitcher_tasks.append((ap["name"], ap.get("hand", "R"), away_team, home_team))
            seen.add(ap["name"])
        hp = g.get("home_pitcher", {})
        if hp.get("name") and hp["name"] != "TBD" and hp["name"] not in seen:
            pitcher_tasks.append((hp["name"], hp.get("hand", "R"), home_team, away_team))
            seen.add(hp["name"])

    print(f"K model: projecting for {len(pitcher_tasks)} starters on {slate_date}")

    results: list[dict] = []
    for i, (name, hand, team, opp) in enumerate(pitcher_tasks, 1):
        print(f"  [{i}/{len(pitcher_tasks)}] {name} ({hand}) — {team} @ {opp}", flush=True)
        try:
            metrics = compute_pitcher_k_metrics(name, hand)
            if metrics is None:
                print(f"    skipped: no data")
                continue

            team_k_pct = compute_team_k_pct(opp, hand)
            team_adj = (team_k_pct / LEAGUE_AVG_K_PCT) if team_k_pct else 1.0

            proj = project_k_total(metrics, team_k_adjustment=team_adj)

            results.append({
                **metrics,
                **proj,
                "team": team,
                "opposing_team": opp,
                "opposing_team_k_pct": team_k_pct,
            })
        except Exception as e:
            print(f"    error: {e}")
            continue

        # Be polite to Statcast API
        time.sleep(0.5)

    # Sort by projected Ks descending
    results.sort(key=lambda r: -r.get("projected_k", 0))

    output = {
        "date": slate_date,
        "generated_at": datetime.utcnow().isoformat(),
        "pitchers": results,
        "league_avg_k_pct": LEAGUE_AVG_K_PCT,
        "league_avg_swstr_pct": LEAGUE_AVG_SWSTR_PCT,
    }

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    # Also write to frontend public path
    frontend_path = Path("frontend/public/data/k_projections.json")
    frontend_path.parent.mkdir(parents=True, exist_ok=True)
    with open(frontend_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nK projections saved to {out_path} and {frontend_path}")
    print("\nTop 10 by projected Ks:")
    for p in results[:10]:
        print(f"  {p['pitcher_name']:<25} proj={p['projected_k']}  (K/9={p['k_per_9']}, IP={p['expected_ip']}, starts={p['starts']})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None, help="Date (YYYY-MM-DD), default latest")
    parser.add_argument("--out", default="results/k_projections.json")
    args = parser.parse_args()

    if args.date:
        slate_path = f"frontend/public/data/{args.date}.json"
    else:
        slate_path = "frontend/public/data/latest.json"

    if not Path(slate_path).exists():
        print(f"Slate file not found: {slate_path}")
        sys.exit(1)

    process_slate(slate_path, args.out)


if __name__ == "__main__":
    main()
