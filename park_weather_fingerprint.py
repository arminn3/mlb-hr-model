#!/usr/bin/env python3
"""
Build a park-level weather fingerprint from 10 seasons of historical data.

For each park × temperature bucket × wind bucket, computes the empirical
HR rate relative to that park's baseline — the same approach OVERcast uses.
Unlike the physics model, this makes no assumptions: it just asks "when
conditions at THIS park were similar to today, what happened?"

Source: cache/historical_backtest.csv (built by historical_backtest.py)
Output: frontend/public/data/park_weather_fingerprint.json

Usage:
    python3 park_weather_fingerprint.py
    python3 park_weather_fingerprint.py --min-games 10  # looser threshold
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev

_CSV = Path("cache/historical_backtest.csv")
_OUT = Path("frontend/public/data/park_weather_fingerprint.json")
_MIN_GAMES_DEFAULT = 12


# ── Condition buckets ────────────────────────────────────────────────────────

TEMP_BUCKETS: list[tuple[str, str, float | None, float | None]] = [
    ("cold",  "<55°F",    None, 55.0),
    ("cool",  "55–70°F",  55.0, 70.0),
    ("mild",  "70–80°F",  70.0, 80.0),
    ("warm",  "80–90°F",  80.0, 90.0),
    ("hot",   ">90°F",    90.0, None),
]

# wind_term = wind projected onto HP→CF axis × height correction (mph at ~30m)
# Positive = blowing out toward CF (helps HRs), negative = blowing in (hurts)
WIND_BUCKETS: list[tuple[str, str, float, float]] = [
    ("strong_in",    "Strong In  >8mph",   -999.0, -8.0),
    ("moderate_in",  "Mod In  3–8mph",      -8.0,  -3.0),
    ("calm_cross",   "Calm / Cross  ±3mph", -3.0,   3.0),
    ("moderate_out", "Mod Out  3–8mph",      3.0,   8.0),
    ("strong_out",   "Strong Out  >8mph",    8.0,  999.0),
]


def _temp_bucket(t: float) -> str:
    for key, _, lo, hi in TEMP_BUCKETS:
        if (lo is None or t >= lo) and (hi is None or t < hi):
            return key
    return "mild"


def _wind_bucket(w: float) -> str:
    for key, _, lo, hi in WIND_BUCKETS:
        if lo <= w < hi:
            return key
    return "calm_cross"


def _safe(s: str) -> float | None:
    try:
        return float(s) if s not in ("", "nan", "None") else None
    except (ValueError, TypeError):
        return None


# ── Main ─────────────────────────────────────────────────────────────────────

def build(min_games: int = _MIN_GAMES_DEFAULT) -> None:
    rows: list[dict] = []
    with _CSV.open() as f:
        for r in csv.DictReader(f):
            temp = _safe(r.get("temp_f", ""))
            wind = _safe(r.get("wind_term", ""))
            hr_rate = _safe(r.get("hr_rate", ""))
            if temp is None or wind is None or hr_rate is None:
                continue
            rows.append({
                "park": r["home_team"],
                "season": int(r.get("season", 0)),
                "temp_f": temp,
                "wind_term": wind,
                "hr_rate": hr_rate,
                "hrs_hit": int(r.get("hrs_hit", 0)),
                "total_batters": int(r.get("total_batters", 0)),
            })

    print(f"Loaded {len(rows):,} games with complete weather data")

    league_hr_rate = mean(r["hr_rate"] for r in rows)
    seasons = sorted({r["season"] for r in rows})

    # Per-park baseline
    by_park: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_park[r["park"]].append(r)

    park_baseline: dict[str, float] = {
        park: mean(g["hr_rate"] for g in games)
        for park, games in by_park.items()
        if len(games) >= 20
    }

    # Per-park × bucket empirical factor
    bucket_map: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        tb = _temp_bucket(r["temp_f"])
        wb = _wind_bucket(r["wind_term"])
        bucket_map[(r["park"], tb, wb)].append(r)

    parks_out: dict[str, dict] = {}
    for park, games in sorted(by_park.items()):
        if park not in park_baseline:
            continue
        baseline = park_baseline[park]
        conditions: dict[str, dict] = {}
        for tb, t_label, *_ in TEMP_BUCKETS:
            for wb, w_label, *_ in WIND_BUCKETS:
                bucket = bucket_map.get((park, tb, wb), [])
                if len(bucket) < min_games:
                    continue
                rates = [g["hr_rate"] for g in bucket]
                avg_rate = mean(rates)
                factor = avg_rate / baseline if baseline > 0 else 1.0
                pct_delta = (factor - 1.0) * 100.0
                se = (stdev(rates) / math.sqrt(len(rates))) if len(rates) > 1 else 0.0
                conditions[f"{tb}__{wb}"] = {
                    "temp_key": tb,
                    "wind_key": wb,
                    "temp_label": t_label,
                    "wind_label": w_label,
                    "hr_factor": round(factor, 3),
                    "hr_pct_delta": round(pct_delta, 1),
                    "avg_hr_rate": round(avg_rate, 4),
                    "n_games": len(bucket),
                    "std_err_pct": round(se * 100, 1),
                }

        parks_out[park] = {
            "n_games": len(games),
            "baseline_hr_rate": round(baseline, 4),
            "conditions": conditions,
        }
        n_cond = len(conditions)
        print(f"  {park:4s}  n={len(games):4d}  baseline={baseline:.4f}  "
              f"{n_cond} condition buckets")

    payload = {
        "league_hr_rate": round(league_hr_rate, 4),
        "seasons": f"{min(seasons)}–{max(seasons)}",
        "total_games": len(rows),
        "min_games_threshold": min_games,
        "parks": parks_out,
    }

    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {_OUT}  ({_OUT.stat().st_size // 1024} KB)")

    # ── Sample output ────────────────────────────────────────────────────
    print("\n── Top condition effects per sample park ──")
    for park in ("CHC", "COL", "SF", "NYY", "BOS"):
        fp = parks_out.get(park)
        if not fp or not fp["conditions"]:
            continue
        print(f"\n{park} (n={fp['n_games']}, baseline={fp['baseline_hr_rate']:.4f})")
        top = sorted(fp["conditions"].values(),
                     key=lambda x: abs(x["hr_pct_delta"]), reverse=True)[:4]
        for c in top:
            sign = "+" if c["hr_pct_delta"] >= 0 else ""
            print(f"  {c['temp_label']:10s} × {c['wind_label']:22s}: "
                  f"{sign}{c['hr_pct_delta']:.1f}%  (n={c['n_games']})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-games", type=int, default=_MIN_GAMES_DEFAULT)
    args = ap.parse_args()
    build(min_games=args.min_games)
