#!/usr/bin/env python3
"""
Historical Statcast → per-game aggregation.

For a year range (default 2015-2024), pull Statcast pitch-by-pitch via
pybaseball (cached to cache/statcast_{year}.parquet via fetch_season()
from backtest_hr_weights.py) and aggregate to per-game rows:

    game_pk, game_date, home_team, away_team, hrs_hit, total_batters

Output: cache/games_2015_2024.parquet (~25k rows, ~10 MB).

Usage:
    python3 historical_data.py                        # 2015-2024
    python3 historical_data.py --start 2018 --end 2024
    python3 historical_data.py --year 2020            # single year
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from backtest_hr_weights import fetch_season


# Normalize Statcast team codes to match config/park tables.
# Statcast uses e.g. CHN/CHW/LAN/SDN/SFN/WAS/KCR/TBR — we standardize
# to the 3-letter codes used in config.py and PARK_CF_BEARING.
_TEAM_ALIAS = {
    "CHN": "CHC", "CHA": "CWS", "CHW": "CWS",
    "LAN": "LAD", "LAA": "LAA",
    "SDN": "SDP", "SD":  "SDP",
    "SFN": "SF",  "SFG": "SF",
    "WAS": "WSH",
    "KCR": "KC",
    "TBR": "TB",  "TBA": "TB",
    "NYN": "NYM", "NYA": "NYY",
    "ANA": "LAA",
    "AZ":  "ARI",
    "ATH": "OAK",
}


def _norm_team(code: str) -> str:
    if not isinstance(code, str):
        return code
    return _TEAM_ALIAS.get(code, code)


def aggregate_year(year: int) -> pd.DataFrame:
    """Aggregate one season's pitch-level parquet into per-game rows.

    Per-game output columns:
        game_pk, game_date, season, home_team, away_team,
        hrs_hit, total_batters
    """
    df = fetch_season(year)

    # Statcast marks each plate appearance's last pitch with `events`.
    # Every other row has events NaN. So events.notna() counts PAs.
    ev = df[df["events"].notna()].copy()
    ev["home_team"] = ev["home_team"].map(_norm_team)
    ev["away_team"] = ev["away_team"].map(_norm_team)

    grp = ev.groupby(["game_pk", "game_date", "home_team", "away_team"], as_index=False)
    agg = grp.agg(
        hrs_hit=("events", lambda s: (s == "home_run").sum()),
        total_batters=("events", "size"),
    )
    agg["season"] = year
    agg["game_date"] = pd.to_datetime(agg["game_date"]).dt.strftime("%Y-%m-%d")
    agg["hr_rate"] = agg["hrs_hit"] / agg["total_batters"]
    return agg[["game_pk", "game_date", "season", "home_team", "away_team",
                "hrs_hit", "total_batters", "hr_rate"]]


def build(years: list[int], out_path: Path) -> pd.DataFrame:
    """Fetch + aggregate each year independently. Retry transient pybaseball
       failures (Savant occasionally returns malformed CSV chunks). A failed
       year is logged and skipped — downstream pipeline runs on whatever
       seasons succeed."""
    import time as _time
    all_parts = []
    failed = []
    for y in years:
        print(f"\n=== {y} ===", flush=True)
        last_exc = None
        for attempt in range(3):
            try:
                agg = aggregate_year(y)
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                print(f"  [attempt {attempt+1}/3] failed: {exc}", flush=True)
                # Clear any partial parquet so next attempt refetches fresh
                cache = Path(f"cache/statcast_{y}.parquet")
                if cache.exists() and cache.stat().st_size < 1_000_000:
                    cache.unlink()
                if attempt < 2:
                    _time.sleep(30)
        if last_exc is not None:
            print(f"  [SKIP {y}] after 3 attempts: {last_exc}", flush=True)
            failed.append(y)
            continue
        print(f"  {y}: {len(agg):,} games, "
              f"{agg['hrs_hit'].sum():,} HRs, "
              f"{agg['total_batters'].sum():,} PAs, "
              f"league HR rate = {agg['hrs_hit'].sum()/agg['total_batters'].sum():.4f}",
              flush=True)
        all_parts.append(agg)

    if not all_parts:
        raise RuntimeError("No seasons succeeded")

    combined = pd.concat(all_parts, ignore_index=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_parquet(out_path)
    print(f"\nWrote {len(combined):,} rows → {out_path}")
    if failed:
        print(f"FAILED seasons: {failed}  (re-run to retry)")
    return combined


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2015)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--year", type=int, help="Single year (overrides start/end)")
    ap.add_argument("--out", default="cache/games_2015_2024.parquet")
    args = ap.parse_args()

    if args.year:
        years = [args.year]
    else:
        years = list(range(args.start, args.end + 1))

    out_path = Path(args.out)
    build(years, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
