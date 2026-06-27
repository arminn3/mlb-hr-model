"""Compute 3-year batter profile for every player on a slate.

Powers the Test sub-tab on the Rankings page. Mirrors how main.py builds
`season_profile` (BIP-level Statcast aggregated vs the opposing pitcher's
hand), but pulls 2024 + 2025 + current-season data instead of 2025 + current.

Strategy:
  1. Pull 2024 bulk Statcast once (~90s first time, cached to parquet).
  2. Read today's slate JSON.
  3. For each game.players[i], look up their MLB ID via team_pitch_mix
     batters by name.
  4. Filter bulk-2024 to that batter vs the opposing pitcher's hand at the
     BIP level (same filter main.py uses for season_profile).
  5. Aggregate the same fields season_profile carries.
  6. Merge with the existing slate season_profile via BIP-weighted means —
     gets us the 3-yr aggregate without re-fetching 2025 + 2026 Statcast.
  7. Write the merged result into player["three_year_profile"].

Usage:
    python3 compute_three_year_batter.py --date 2026-06-27
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd


def _agg_profile(bip: pd.DataFrame) -> dict:
    """Build a season_profile-shaped dict from a filtered BIP DataFrame.

    Mirrors the aggregation in main.py around line 608–663 so the resulting
    three_year_profile carries the same field names + meanings as
    season_profile (the frontend can swap them interchangeably).
    """
    if bip is None or bip.empty:
        return {"barrel": 0, "ev": 0, "fb": 0, "ld": 0, "gb": 0, "hard_hit": 0,
                "bip_count": 0, "hrs": 0, "iso": 0, "pull_barrel": 0, "pull_air": 0,
                "xwoba": 0.0, "sweet_spot": 0.0, "avg_la": 0.0, "blast": 0.0}

    n = len(bip)
    out: dict = {"bip_count": n}
    out["ev"] = round(float(bip["launch_speed"].mean()), 1)
    if "launch_speed_angle" in bip.columns:
        out["barrel"] = round(float((bip["launch_speed_angle"] == 6).sum() / n * 100), 1)
    else:
        out["barrel"] = 0
    if "launch_angle" in bip.columns:
        la = bip["launch_angle"]
        out["fb"] = round(float(((la >= 25) & (la <= 50)).sum() / n * 100), 1)
        out["ld"] = round(float(((la >= 10) & (la < 25)).sum() / n * 100), 1)
        out["gb"] = round(float((la < 10).sum() / n * 100), 1)
        sweet_mask = (la >= 8) & (la <= 32)
        out["sweet_spot"] = round(float(sweet_mask.sum() / n * 100), 1)
        out["avg_la"] = round(float(la.dropna().mean()), 1) if la.dropna().size else 0.0
    else:
        out["fb"] = out["ld"] = out["gb"] = out["sweet_spot"] = out["avg_la"] = 0
    out["hard_hit"] = round(float((bip["launch_speed"] >= 95).sum() / n * 100), 1)
    if "bat_speed" in bip.columns:
        bs = bip["bat_speed"]
        ls = bip["launch_speed"]
        out["blast"] = round(float(((bs >= 75) & (ls >= 95)).sum() / n * 100), 1)
    else:
        out["blast"] = 0.0
    if "estimated_woba_using_speedangle" in bip.columns:
        xw = bip["estimated_woba_using_speedangle"].dropna()
        out["xwoba"] = round(float(xw.mean()), 3) if len(xw) else 0.0
    else:
        out["xwoba"] = 0.0
    if {"hc_x", "hc_y", "stand", "launch_speed_angle", "launch_angle"}.issubset(bip.columns):
        sub = bip.dropna(subset=["hc_x", "hc_y"])
        if len(sub):
            spray = np.degrees(np.arctan2(sub["hc_x"].astype(float) - 125.42,
                                          198.27 - sub["hc_y"].astype(float)))
            pulled = ((sub["stand"] == "R") & (spray < -15)) | ((sub["stand"] == "L") & (spray > 15))
            barrel_mask = sub["launch_speed_angle"] == 6
            air_mask = sub["launch_angle"] >= 10
            out["pull_barrel"] = round(float((pulled & barrel_mask).sum() / n * 100), 1)
            out["pull_air"]    = round(float((pulled & air_mask).sum() / n * 100), 1)
        else:
            out["pull_barrel"] = out["pull_air"] = 0
    else:
        out["pull_barrel"] = out["pull_air"] = 0
    if "events" in bip.columns:
        out["hrs"] = int((bip["events"] == "home_run").sum())
        non_ab = bip["events"].isin({"walk", "hit_by_pitch", "intent_walk", "sac_fly", "sac_bunt"})
        ab = int((~non_ab).sum())
        if ab:
            bases = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
            tb = sum(bases.get(e, 0) for e in bip["events"])
            hits = int(bip["events"].isin({"single", "double", "triple", "home_run"}).sum())
            out["iso"] = round(float(tb / ab - hits / ab), 3)
        else:
            out["iso"] = 0.0
    else:
        out["hrs"] = 0
        out["iso"] = 0.0
    return out


def _bip_weighted_merge(season: dict, prior: dict) -> dict:
    """Combine two profiles using BIP-weighted means.

    Avoids re-aggregating the 2025 + 2026 Statcast we already paid for —
    main.py wrote `season_profile` with the right vs-hand filter, so we can
    just fold 2024 into it.
    """
    s_n = int(season.get("bip_count") or 0)
    p_n = int(prior.get("bip_count") or 0)
    total = s_n + p_n
    if total == 0:
        return season

    def w(field: str, dp: int = 1) -> float:
        sv = float(season.get(field) or 0)
        pv = float(prior.get(field) or 0)
        v = (sv * s_n + pv * p_n) / total
        return round(v, dp)

    merged = {
        "bip_count": total,
        "barrel": w("barrel"),
        "ev": w("ev"),
        "fb": w("fb"),
        "ld": w("ld"),
        "gb": w("gb"),
        "hard_hit": w("hard_hit"),
        "sweet_spot": w("sweet_spot"),
        "avg_la": w("avg_la"),
        "blast": w("blast"),
        "xwoba": w("xwoba", dp=3),
        "pull_barrel": w("pull_barrel"),
        "pull_air": w("pull_air"),
        "iso": w("iso", dp=3),
        # HRs sum across years rather than being averaged.
        "hrs": int(season.get("hrs", 0) or 0) + int(prior.get("hrs", 0) or 0),
        # Years contributing — useful for the frontend to badge low-sample seasons.
        "years": "2024+2025+2026",
    }
    return merged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="Slate date YYYY-MM-DD")
    args = ap.parse_args()
    target = date.fromisoformat(args.date)

    slate_path = Path("frontend/public/data") / f"{target.isoformat()}.json"
    if not slate_path.exists():
        print(f"slate not found: {slate_path}", file=sys.stderr)
        return 1

    slate = json.loads(slate_path.read_text())
    print(f"loaded {slate_path} ({slate_path.stat().st_size:,} bytes)")

    # Pull 2024 once, slice per player in memory.
    from data_fetchers import load_bulk_2024
    df_2024 = load_bulk_2024()
    if df_2024.empty:
        print("ERROR: bulk 2024 statcast empty — abort", file=sys.stderr)
        return 1
    print(f"  bulk 2024 frame: {len(df_2024):,} rows, "
          f"{df_2024['batter'].nunique() if 'batter' in df_2024.columns else '?'} unique batters")

    total_players = 0
    injected = 0
    skipped_no_id = 0
    skipped_no_season = 0

    for g in slate.get("games", []):
        # name → MLB ID via team_pitch_mix
        id_by_name: dict[str, int] = {}
        for side_key in ("away", "home"):
            for b in g.get("team_pitch_mix", {}).get(side_key, {}).get("batters", []):
                if b.get("name") and b.get("id"):
                    id_by_name[b["name"]] = int(b["id"])

        for player in g.get("players", []):
            total_players += 1
            name = player.get("name")
            opp_hand = player.get("pitcher_hand")  # opposing pitcher hand
            season_prof = player.get("season_profile") or {}

            mlb_id = id_by_name.get(name)
            if not mlb_id:
                skipped_no_id += 1
                continue
            if not season_prof or not opp_hand:
                skipped_no_season += 1
                continue

            # Slice 2024 to this batter, vs same opposing hand, BIPs only.
            sub = df_2024[df_2024["batter"] == mlb_id]
            sub = sub[(sub["p_throws"] == opp_hand)
                      & (sub["launch_speed"].notna())
                      & (sub["events"].notna())]
            prof_2024 = _agg_profile(sub)
            three_yr = _bip_weighted_merge(season_prof, prof_2024)
            player["three_year_profile"] = three_yr
            injected += 1

    print()
    print(f"players: {total_players} | injected: {injected} | "
          f"no_id: {skipped_no_id} | no_season: {skipped_no_season}")

    # Also write to latest.json mirror.
    out_paths = [slate_path]
    latest = slate_path.parent / "latest.json"
    if latest.exists():
        out_paths.append(latest)
    for p in out_paths:
        p.write_text(json.dumps(slate, separators=(",", ":")))
        print(f"wrote {p} ({p.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
