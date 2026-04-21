#!/usr/bin/env python3
"""
Build frontend/public/data/weather_research.json — compact summary of
the 10-season weather-vs-HR findings for display on the Environment tab's
Research view.

Source: cache/historical_backtest.csv (produced by historical_backtest.py).
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean


_CSV = Path("cache/historical_backtest.csv")
_CALIB = Path("environment_calibration.json")
_OUT = Path("frontend/public/data/weather_research.json")


def _safe_float(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def main():
    rows = []
    with _CSV.open() as f:
        for r in csv.DictReader(f):
            rows.append(r)
    print(f"Loaded {len(rows):,} rows from {_CSV}")

    # Global baselines
    valid = [r for r in rows if _safe_float(r["hr_rate"]) is not None]
    baseline_hr = mean(_safe_float(r["hr_rate"]) for r in valid)
    total_hrs = sum(int(r["hrs_hit"]) for r in rows if r["hrs_hit"])
    total_pas = sum(int(r["total_batters"]) for r in rows if r["total_batters"])
    seasons = sorted(set(int(r["season"]) for r in rows if r["season"]))

    # ── By temperature bucket ────────────────────────────────────────────
    temp_buckets = {
        "Cold (<55°F)":   (None, 55),
        "Cool (55-70°F)": (55, 70),
        "Mild (70-80°F)": (70, 80),
        "Warm (80-90°F)": (80, 90),
        "Hot (>90°F)":    (90, None),
    }
    by_temp = []
    for lbl, (lo, hi) in temp_buckets.items():
        bkt = []
        for r in valid:
            t = _safe_float(r["temp_f"])
            if t is None: continue
            if lo is not None and t < lo: continue
            if hi is not None and t >= hi: continue
            bkt.append(_safe_float(r["hr_rate"]))
        if bkt:
            m = mean(bkt)
            pct_vs_avg = (m / baseline_hr - 1) * 100
            by_temp.append({"label": lbl, "n": len(bkt), "hr_rate": m,
                            "vs_league_pct": round(pct_vs_avg, 1)})

    # ── By wind-out projection bucket ────────────────────────────────────
    wind_buckets = [
        ("Strong In (wind ≤ -10)",   -999, -10),
        ("Mild In (-10 to -3)",      -10, -3),
        ("Neutral (-3 to +3)",       -3, 3),
        ("Mild Out (+3 to +10)",     3, 10),
        ("Strong Out (wind ≥ +10)",  10, 999),
    ]
    by_wind = []
    for lbl, lo, hi in wind_buckets:
        bkt = []
        for r in valid:
            w = _safe_float(r["wind_term"])
            if w is None: continue
            if w < lo or w >= hi: continue
            bkt.append(_safe_float(r["hr_rate"]))
        if bkt:
            m = mean(bkt)
            pct_vs_avg = (m / baseline_hr - 1) * 100
            by_wind.append({"label": lbl, "n": len(bkt), "hr_rate": m,
                            "vs_league_pct": round(pct_vs_avg, 1)})

    # ── By park (raw hr_rate, for a "park-factor flavor" display) ────────
    by_park = defaultdict(list)
    for r in valid:
        by_park[r["home_team"]].append(_safe_float(r["hr_rate"]))
    park_rankings = []
    for park, rates in by_park.items():
        if len(rates) < 50: continue
        m = mean(rates)
        pct_vs_avg = (m / baseline_hr - 1) * 100
        park_rankings.append({
            "park": park, "n": len(rates),
            "hr_rate": m, "vs_league_pct": round(pct_vs_avg, 1),
        })
    park_rankings.sort(key=lambda x: -x["hr_rate"])

    # ── Extreme conditions — best / worst (bucket games by combined
    # density_term + wind_term sign) ─────────────────────────────────────
    # Simple bucketing: hot (>80°F) + wind-out (>+5) vs cold (<55°F) + wind-in (<-5)
    hot_wind_out = []
    cold_wind_in = []
    for r in valid:
        t = _safe_float(r["temp_f"]); w = _safe_float(r["wind_term"])
        if t is None or w is None: continue
        rate = _safe_float(r["hr_rate"])
        if t >= 80 and w >= 5: hot_wind_out.append(rate)
        if t <= 55 and w <= -5: cold_wind_in.append(rate)
    extreme = {
        "hot_wind_out": {
            "n": len(hot_wind_out),
            "hr_rate": mean(hot_wind_out) if hot_wind_out else None,
            "vs_league_pct": round(((mean(hot_wind_out) / baseline_hr) - 1) * 100, 1) if hot_wind_out else None,
        },
        "cold_wind_in": {
            "n": len(cold_wind_in),
            "hr_rate": mean(cold_wind_in) if cold_wind_in else None,
            "vs_league_pct": round(((mean(cold_wind_in) / baseline_hr) - 1) * 100, 1) if cold_wind_in else None,
        },
    }

    # ── Load calibration for per-park sensitivities + CV ────────────────
    calib = {}
    if _CALIB.exists():
        with _CALIB.open() as f:
            calib = json.load(f)

    meta = calib.get("meta", {})
    parks_calib = calib.get("parks", {})
    park_wind_sens = []
    for park, data in parks_calib.items():
        park_wind_sens.append({
            "park": park,
            "n": data.get("n"),
            "sens_raw": round(data.get("sens_raw") or 0, 3),
            "sens_ship": round(data.get("sens_ship") or 1, 3),
            "p_val": round(data.get("p_val") or 1, 4) if data.get("p_val") is not None else None,
            "significant": (data.get("p_val") is not None and data.get("p_val") < 0.10),
        })
    park_wind_sens.sort(key=lambda x: -x["sens_ship"])

    cv = meta.get("cross_validation", {}).get("per_season", [])

    out = {
        "dataset": {
            "n_games": len(rows),
            "total_hrs": total_hrs,
            "total_pas": total_pas,
            "seasons": seasons,
            "baseline_hr_rate": round(baseline_hr, 4),
        },
        "global_coefficients": {
            "K_RHO": meta.get("K_RHO"),
            "K_WIND": meta.get("K_WIND"),
        },
        "hr_rate_by_temperature": by_temp,
        "hr_rate_by_wind": by_wind,
        "park_hr_rate_ranking": park_rankings,
        "park_wind_sensitivity": park_wind_sens,
        "extreme_conditions": extreme,
        "cross_validation": cv,
    }

    _OUT.parent.mkdir(parents=True, exist_ok=True)
    with _OUT.open("w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {_OUT} ({_OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
