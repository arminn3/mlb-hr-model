#!/usr/bin/env python3
"""
Weather Backtest — Phase 3 of the HR weather model research.

For every historical game we have (26 days of results ≈ 250-400 games),
compare three predictions against the actual HRs hit in that game:

  1. current       — the ad-hoc formula in environment-view.tsx
  2. physics       — the humid-air-density + vector-wind model from
                     WEATHER_MODEL_RESEARCH.md
  3. naive_park    — park_factor only (no weather)

Output: a CSV of per-game rows + a summary report showing which model
correlates best with actual HR rates, plus the empirical k_ρ and k_wind
coefficients implied by the data.

Usage:
    python3 weather_backtest.py

    # with a specific date range:
    python3 weather_backtest.py --since 2026-04-01

    # export CSV only:
    python3 weather_backtest.py --csv weather_backtest.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from statistics import mean, stdev
from typing import Optional

from asos_fetch import STADIUM_TO_ICAO, fetch_asos, nearest_to_hour, AsosObservation

# ── ASOS cache ──────────────────────────────────────────────────────────
# One file per (station, month-range) keyed JSON blob. Keeps backtest
# reruns fast and avoids hammering the free Iowa State API.
_ASOS_CACHE_DIR = Path(".asos_cache")


def _asos_cache_load(station: str, start: date, end: date) -> Optional[list[AsosObservation]]:
    _ASOS_CACHE_DIR.mkdir(exist_ok=True)
    key = f"{station}_{start.isoformat()}_{end.isoformat()}.json"
    p = _ASOS_CACHE_DIR / key
    if not p.exists():
        return None
    data = json.loads(p.read_text())
    return [AsosObservation(
        station=r["station"],
        valid_utc=datetime.fromisoformat(r["valid_utc"]),
        temp_f=r["temp_f"], dewpoint_f=r["dewpoint_f"],
        relative_humidity=r["relative_humidity"],
        wind_speed_mph=r["wind_speed_mph"], wind_dir_deg=r["wind_dir_deg"],
        wind_gust_mph=r["wind_gust_mph"], pressure_hpa=r["pressure_hpa"],
        precip_in=r["precip_in"],
    ) for r in data]


def _asos_cache_save(station: str, start: date, end: date, obs: list[AsosObservation]) -> None:
    _ASOS_CACHE_DIR.mkdir(exist_ok=True)
    key = f"{station}_{start.isoformat()}_{end.isoformat()}.json"
    data = [{
        "station": o.station, "valid_utc": o.valid_utc.isoformat(),
        "temp_f": o.temp_f, "dewpoint_f": o.dewpoint_f,
        "relative_humidity": o.relative_humidity,
        "wind_speed_mph": o.wind_speed_mph, "wind_dir_deg": o.wind_dir_deg,
        "wind_gust_mph": o.wind_gust_mph, "pressure_hpa": o.pressure_hpa,
        "precip_in": o.precip_in,
    } for o in obs]
    (_ASOS_CACHE_DIR / key).write_text(json.dumps(data))

# ── Park HP → CF bearing (degrees from true north, 0=N, 90=E) ───────────
# Approximate values from MLB ballpark orientation sources. Verify via
# Google Maps azimuth if you need exact numbers. "Bearing" here is the
# compass heading of the home-plate-to-center-field line.
PARK_CF_BEARING = {
    "ARI": 23, "AZ": 23, "ATL": 25, "BAL": 32, "BOS": 45, "CHC": 30,
    "CIN": 10, "CLE": 0,  "COL": 0,  "CWS": 35, "DET": 150,
    "HOU": 345, "KC": 45, "LAA": 60, "LAD": 20, "MIA": 40, "MIL": 45,
    "MIN": 90, "NYM": 25, "NYY": 75, "OAK": 60, "ATH": 60,
    "PHI": 0, "PIT": 115, "SDP": 0, "SD": 0, "SF": 90, "SEA": 60,
    "STL": 55, "TB": 45, "TEX": 20, "TOR": 0, "WSH": 25,
}

# ── Humid-air density (physics-consistent) ──────────────────────────────
def saturation_vapor_pressure_hpa(t_c: float) -> float:
    """Arden Buck equation — hPa from °C. More accurate than Tetens."""
    return 6.1121 * math.exp((18.678 - t_c / 234.5) * (t_c / (257.14 + t_c)))


def humid_air_density_kg_m3(
    temp_f: Optional[float],
    pressure_hpa: Optional[float],
    rh_pct: Optional[float],
) -> Optional[float]:
    """Humid-air density at ground level. Returns None if inputs missing.
       Reference: Density of Air (Wikipedia); Arden Buck (1981)."""
    if temp_f is None or pressure_hpa is None:
        return None
    t_c = (temp_f - 32) * 5 / 9
    t_k = t_c + 273.15
    p_pa = pressure_hpa * 100.0  # station pressure, Pa

    rh = rh_pct if rh_pct is not None else 50.0  # fallback
    p_sat = saturation_vapor_pressure_hpa(t_c) * 100  # Pa
    p_v = (rh / 100.0) * p_sat
    p_d = p_pa - p_v

    # ρ = (P_d·M_d + P_v·M_v) / (R·T)
    M_d = 0.028965  # kg/mol
    M_v = 0.018016
    R = 8.31446
    rho = (p_d * M_d + p_v * M_v) / (R * t_k)
    return rho

# ── Wind vector projection ──────────────────────────────────────────────
def wind_out_component(
    wind_mph: Optional[float],
    wind_dir_from_deg: Optional[float],
    park: str,
) -> float:
    """Project wind onto HP→CF axis. + = tailwind (blowing toward OF).
       Returns 0 if inputs missing or park unknown."""
    if wind_mph is None or wind_dir_from_deg is None:
        return 0.0
    beta = PARK_CF_BEARING.get(park)
    if beta is None:
        return 0.0
    # Met convention: wind comes FROM that direction. Vector it blows
    # TO is (dir + 180) mod 360.
    to_rad = math.radians((wind_dir_from_deg + 180) % 360)
    w_x = wind_mph * math.sin(to_rad)   # +E
    w_y = wind_mph * math.cos(to_rad)   # +N
    cf_rad = math.radians(beta)
    cf_x = math.sin(cf_rad)
    cf_y = math.cos(cf_rad)
    return w_x * cf_x + w_y * cf_y

# ── Predictions ─────────────────────────────────────────────────────────
@dataclass
class Prediction:
    current_pct: float       # our ad-hoc formula (weather % boost)
    physics_pct: float       # physics-based weather % boost
    park_pct: float          # park-only

    current_combined: float
    physics_combined: float


def predict_current(env: dict) -> float:
    """Mirrors weatherPct() in environment-view.tsx (our current formula)."""
    if env.get("is_dome"):
        return 0.0
    pct = (env.get("wind_score") or 0) * 1.2
    t = env.get("temperature_f")
    if t is not None:
        if t > 72:
            pct += (t - 72) * 0.3
        if t < 55:
            pct -= (55 - t) * 0.4
    h = env.get("humidity")
    if h is not None and h > 60:
        pct += (h - 60) * 0.05
    return round(pct, 2)


# Physics-based weather boost — Phase 4 model from the research brief.
# E_density * E_wind, expressed as a percent delta vs sea-level-70F-dry.
# Coefficients k_rho and k_wind are what we want to CALIBRATE from this
# backtest. Start with the research-suggested values; the backtest will
# report the empirically-best values.
RHO_REFERENCE = 1.225  # kg/m³, ICAO standard dry air sea level
K_RHO = 2.5            # Nathan/Coors-calibrated starting point
K_WIND = 2.0           # HR rate per mph tailwind amplification
WIND_HEIGHT_CORRECTION = 1.19  # 10m → 30m log profile


def predict_physics(env: dict, home_team: str,
                    k_rho: float = K_RHO,
                    k_wind: float = K_WIND) -> float:
    """Physics-based weather boost as a %. Returns 0 for domes."""
    if env.get("is_dome"):
        return 0.0
    rho = humid_air_density_kg_m3(
        env.get("temperature_f"),
        env.get("pressure_hpa"),
        env.get("humidity"),
    )
    density_pct = 0.0
    if rho and rho > 0:
        # E_density = (ρ₀/ρ)^k — convert to percent boost vs reference
        density_pct = ((RHO_REFERENCE / rho) ** k_rho - 1.0) * 100.0

    w_out = wind_out_component(
        env.get("wind_speed_mph"),
        env.get("wind_direction"),
        home_team,
    ) * WIND_HEIGHT_CORRECTION

    wind_pct = k_wind * w_out  # k_wind is already in HR-rate units (%/mph)
    return round(density_pct + wind_pct, 2)


def park_pct_from_env(env: dict) -> float:
    pf = env.get("park_factor", 100)
    return round((pf - 100) * 1.0, 2)


# ── Load data ───────────────────────────────────────────────────────────
@dataclass
class GameRow:
    date: str
    game_pk: int
    matchup: str
    home_team: str
    away_team: str
    # environment
    temp_f: Optional[float]
    wind_mph: Optional[float]
    wind_dir: Optional[float]
    wind_score: Optional[float]
    humidity: Optional[float]
    pressure_hpa: Optional[float]
    park_factor: Optional[float]
    is_dome: bool
    # predictions
    current_pct: float
    physics_pct: float
    park_pct: float
    # outcomes
    total_batters: int          # number of batters scored in the slate
    hrs_hit: int                # number of HRs hit in this game
    hr_rate: float              # hrs_hit / total_batters (approx per-game HR prob)


def _prefetch_asos(dates: list[str], stations: set[str]) -> dict:
    """Pull one range of ASOS observations per unique station,
       cache to disk, return {station -> list[AsosObservation]}."""
    if not dates:
        return {}
    start = datetime.strptime(dates[0], "%Y-%m-%d").date()
    end = datetime.strptime(dates[-1], "%Y-%m-%d").date()
    out = {}
    for s in sorted(stations):
        cached = _asos_cache_load(s, start, end)
        if cached is not None:
            out[s] = cached
            continue
        print(f"  [ASOS] fetching {s} {start} → {end} ...", flush=True)
        obs = fetch_asos(s, start)  # API takes single-day range; loop:
        full: list[AsosObservation] = []
        # Fetch whole window by stepping 7 days at a time to stay polite
        d = start
        from datetime import timedelta
        while d <= end:
            chunk_end = min(d + timedelta(days=6), end)
            chunk = fetch_asos(s, d)  # fetches d-1..d+1 actually, overlap ok
            full.extend(chunk)
            d = chunk_end + timedelta(days=1)
            time.sleep(0.4)
        # Dedupe by valid_utc
        seen = set()
        dedup: list[AsosObservation] = []
        for o in full:
            if o.valid_utc not in seen:
                seen.add(o.valid_utc)
                dedup.append(o)
        dedup.sort(key=lambda o: o.valid_utc)
        _asos_cache_save(s, start, end, dedup)
        out[s] = dedup
    return out


def _parse_game_time_et(game_time_str: str) -> tuple[int, int]:
    """Parse '11:10 AM ET' → (hour, minute) in 24h ET."""
    if not game_time_str:
        return (19, 0)  # default 7 PM ET
    s = game_time_str.strip()
    am_pm = "PM" if "PM" in s.upper() else "AM"
    tm = s.split()[0]  # "11:10"
    hh, mm = tm.split(":")
    h, m = int(hh), int(mm)
    if am_pm == "PM" and h != 12:
        h += 12
    if am_pm == "AM" and h == 12:
        h = 0
    return (h, m)


def et_to_utc_hour(et_hour: int) -> int:
    """ET → UTC for the 2026 March-April window (all EDT = UTC-4).
       Returns UTC hour in 0..23 (rolling over modulo 24)."""
    return (et_hour + 4) % 24


def _enrich_with_asos(env: dict, home_team: str, game_date_str: str,
                       obs_by_station: dict, game_time_et: str = "") -> dict:
    """If slate env is missing temp/wind, patch from ASOS.
       Returns a NEW dict (doesn't mutate input)."""
    # Only patch outdoor games with missing weather
    if env.get("is_dome"):
        return env
    if env.get("temperature_f") is not None and env.get("wind_speed_mph") is not None:
        return env
    icao = STADIUM_TO_ICAO.get(home_team)
    if not icao:
        return env
    # Iowa State archive stores under stripped code (e.g. "LGA" not "KLGA").
    # Try both forms to be resilient.
    station_obs = obs_by_station.get(icao) or obs_by_station.get(icao.lstrip("KC"))
    if not station_obs:
        return env

    # Target time from actual game time when available
    et_hour, et_min = _parse_game_time_et(game_time_et)
    utc_hour = et_to_utc_hour(et_hour)
    gdate = datetime.strptime(game_date_str, "%Y-%m-%d")
    # For ET games after ~8 PM, UTC rolls past midnight → next-day date
    target = datetime(gdate.year, gdate.month, gdate.day, utc_hour, et_min)
    if utc_hour < et_hour:  # rolled past midnight UTC
        from datetime import timedelta
        target = target + timedelta(days=1)
    obs = nearest_to_hour(station_obs, target, max_delta_minutes=90)
    if obs is None:
        return env

    # Build a patched env dict
    patched = dict(env)
    if patched.get("temperature_f") is None:
        patched["temperature_f"] = obs.temp_f
    if patched.get("wind_speed_mph") is None:
        patched["wind_speed_mph"] = obs.wind_speed_mph
    if patched.get("wind_direction") is None:
        patched["wind_direction"] = obs.wind_dir_deg
    if patched.get("humidity") is None and obs.relative_humidity is not None:
        patched["humidity"] = obs.relative_humidity
    if patched.get("pressure_hpa") is None:
        patched["pressure_hpa"] = obs.pressure_hpa
    # Recompute a simple wind_score if the slate has none
    if patched.get("wind_score") in (None, 0) and obs.wind_speed_mph and obs.wind_dir_deg is not None:
        from math import cos, radians
        from weather_backtest import wind_out_component as _wo
        w = _wo(obs.wind_speed_mph, obs.wind_dir_deg, home_team)
        patched["wind_score"] = round(w, 1)
    return patched


def load_game_rows(repo_root: Path, use_asos: bool = True) -> list[GameRow]:
    """Walk all paired (slate, results) files and produce per-game rows."""
    rows: list[GameRow] = []
    slate_dir = repo_root / "frontend" / "public" / "data"
    results_dir = repo_root / "results"

    # Only dates where we have BOTH a slate and a results file
    slate_dates = {p.stem for p in slate_dir.glob("2026-*.json")}
    result_dates = {p.stem for p in results_dir.glob("2026-*.json")
                    if not p.stem.startswith("livefeed-")
                    and p.stem != "cumulative"
                    and p.stem != "ml_analysis"
                    and p.stem != "ml_weights"
                    and p.stem != "backtest_weights"
                    and p.stem != "projection_model"
                    and p.stem != "matchup_v2_weights"
                    and p.stem != "k_projections"}
    dates = sorted(slate_dates & result_dates)

    # Pre-fetch ASOS for all stations we'll need (one API pass per station,
    # cached to disk). Skips entirely if --no-asos.
    asos_by_station: dict = {}
    if use_asos and dates:
        stations = {STADIUM_TO_ICAO.get(team) for team in STADIUM_TO_ICAO}
        stations = {s for s in stations if s}
        # Iowa State archive strips leading K in some responses; normalize here
        asos_by_station = _prefetch_asos(dates, stations)

    for d in dates:
        try:
            slate = json.loads((slate_dir / f"{d}.json").read_text())
            result = json.loads((results_dir / f"{d}.json").read_text())
        except Exception:
            continue

        # Count HRs per matchup
        hr_by_matchup: dict[str, int] = {}
        for h in result.get("hr_hitters", []):
            m = h.get("matchup", "")
            hr_by_matchup[m] = hr_by_matchup.get(m, 0) + 1

        for g in slate.get("games", []):
            env = g.get("environment", {})
            home = g.get("home_team", "")
            away = g.get("away_team", "")
            matchup = f"{away}@{home}"
            n_batters = len(g.get("players", []))
            if n_batters == 0:
                continue
            hrs = hr_by_matchup.get(matchup, 0)

            # Enrich from ASOS if slate is missing weather (uses actual
            # game time parsed from the slate instead of a default hour).
            if use_asos:
                env = _enrich_with_asos(env, home, d, asos_by_station,
                                        game_time_et=g.get("game_time", ""))

            current = predict_current(env)
            physics = predict_physics(env, home)
            parkp = park_pct_from_env(env)

            rows.append(GameRow(
                date=d,
                game_pk=g.get("game_pk", 0),
                matchup=matchup,
                home_team=home,
                away_team=away,
                temp_f=env.get("temperature_f"),
                wind_mph=env.get("wind_speed_mph"),
                wind_dir=env.get("wind_direction"),
                wind_score=env.get("wind_score"),
                humidity=env.get("humidity"),
                pressure_hpa=env.get("pressure_hpa"),
                park_factor=env.get("park_factor"),
                is_dome=bool(env.get("is_dome")),
                current_pct=current,
                physics_pct=physics,
                park_pct=parkp,
                total_batters=n_batters,
                hrs_hit=hrs,
                hr_rate=hrs / max(1, n_batters),
            ))
    return rows

# ── Correlation helpers ─────────────────────────────────────────────────
def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = mean(xs), mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return num / (dx * dy) if dx and dy else 0.0


def bucket_rate(rows: list[GameRow], predictor, n_bins=5) -> list[tuple]:
    """Split rows into n_bins equal-count buckets by predictor value.
       Return (bin_low, bin_high, mean_pred, mean_hr_rate, n_games) per bin."""
    if not rows:
        return []
    sr = sorted(rows, key=predictor)
    bins = []
    bin_size = len(sr) // n_bins
    for i in range(n_bins):
        chunk = sr[i * bin_size : (i + 1) * bin_size if i < n_bins - 1 else len(sr)]
        if not chunk:
            continue
        preds = [predictor(r) for r in chunk]
        rates = [r.hr_rate for r in chunk]
        bins.append((
            min(preds),
            max(preds),
            mean(preds),
            mean(rates),
            len(chunk),
        ))
    return bins

# ── k calibration — crude grid search ───────────────────────────────────
def calibrate_k_rho_k_wind(rows: list[GameRow]) -> tuple[float, float, float]:
    """Grid search for k_rho and k_wind that maximize correlation of
       physics_pct with actual hr_rate. Returns (best_k_rho, best_k_wind, best_r)."""
    # Only rows with full weather data
    usable = [r for r in rows if not r.is_dome
              and r.temp_f is not None
              and r.pressure_hpa is not None
              and r.humidity is not None
              and r.wind_mph is not None
              and r.wind_dir is not None]
    if len(usable) < 30:
        return (K_RHO, K_WIND, 0.0)

    best = (K_RHO, K_WIND, -2.0)
    for k_rho in [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]:
        for k_wind in [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0]:
            preds = []
            rates = []
            for r in usable:
                # re-run physics with candidate k's
                env = {
                    "is_dome": r.is_dome,
                    "temperature_f": r.temp_f,
                    "pressure_hpa": r.pressure_hpa,
                    "humidity": r.humidity,
                    "wind_speed_mph": r.wind_mph,
                    "wind_direction": r.wind_dir,
                }
                p = predict_physics(env, r.home_team, k_rho=k_rho, k_wind=k_wind)
                preds.append(p)
                rates.append(r.hr_rate)
            rho = pearson(preds, rates)
            if rho > best[2]:
                best = (k_rho, k_wind, rho)
    return best

# ── Main ────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="Earliest date to include (YYYY-MM-DD)")
    ap.add_argument("--csv", default="weather_backtest.csv",
                    help="Output CSV path")
    ap.add_argument("--no-asos", action="store_true",
                    help="Skip ASOS METAR enrichment (slate-only)")
    args = ap.parse_args()

    repo = Path(__file__).resolve().parent
    rows = load_game_rows(repo, use_asos=not args.no_asos)
    if args.since:
        rows = [r for r in rows if r.date >= args.since]
    if not rows:
        print("No rows loaded.")
        return

    # Write CSV
    with open(args.csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "date", "matchup", "home_team", "is_dome",
            "temp_f", "wind_mph", "wind_dir", "wind_score",
            "humidity", "pressure_hpa", "park_factor",
            "current_pct", "physics_pct", "park_pct",
            "hrs_hit", "total_batters", "hr_rate",
        ])
        writer.writeheader()
        for r in rows:
            writer.writerow({k: getattr(r, k) for k in writer.fieldnames})
    print(f"Wrote {len(rows)} game rows to {args.csv}")

    # ── Summary ─────────────────────────────────────────────────────────
    print(f"\n{'═'*64}")
    print(f"  Weather Backtest Summary — {len(rows)} games")
    print(f"{'═'*64}")
    dates = sorted({r.date for r in rows})
    print(f"  Date range: {dates[0]} → {dates[-1]}  ({len(dates)} days)")
    print(f"  Total HRs: {sum(r.hrs_hit for r in rows)}")
    print(f"  Games with missing weather: "
          f"{sum(1 for r in rows if r.temp_f is None or r.wind_mph is None)}")
    print(f"  Domes: {sum(1 for r in rows if r.is_dome)}")

    # Correlation of each model's predicted boost with actual HR rate
    print(f"\n  Pearson correlation (predicted % boost vs actual HR/batter rate):")
    for label, key in [
        ("current   (ad-hoc formula)", lambda r: r.current_pct),
        ("physics   (Arden Buck + vector wind)", lambda r: r.physics_pct),
        ("park only (no weather)", lambda r: r.park_pct),
        ("combined current (current + park)", lambda r: r.current_pct + r.park_pct),
        ("combined physics (physics + park)", lambda r: r.physics_pct + r.park_pct),
    ]:
        preds = [key(r) for r in rows]
        rates = [r.hr_rate for r in rows]
        r = pearson(preds, rates)
        print(f"    {label:<45s}  r = {r:+.4f}")

    # Bucket analysis — physics combined
    print(f"\n  Bucket analysis — physics+park quintiles:")
    print(f"    {'bin':<8} {'low%':>8} {'high%':>8} {'mean pred%':>12} "
          f"{'mean HR/bat':>14} {'n games':>10}")
    bins = bucket_rate(rows, lambda r: r.physics_pct + r.park_pct, n_bins=5)
    for i, (lo, hi, mp, mr, n) in enumerate(bins):
        print(f"    Q{i+1:<7}{lo:>8.2f}{hi:>8.2f}{mp:>12.2f}{mr:>14.4f}{n:>10}")

    # Calibrate k_rho, k_wind
    print(f"\n  Calibrating k_rho and k_wind (grid search)...")
    best_rho, best_wind, best_r = calibrate_k_rho_k_wind(rows)
    print(f"    Best k_rho  = {best_rho}")
    print(f"    Best k_wind = {best_wind}")
    print(f"    Best pearson r = {best_r:+.4f}")
    print(f"\n  Research-brief starting values were k_rho={K_RHO}, k_wind={K_WIND}")

    print(f"\n{'═'*64}")
    print(f"  Interpretation")
    print(f"{'═'*64}")
    print(f"""
  - Whichever model has higher |r| is more predictive at the per-game level.
  - Per-game HR rates are VERY noisy (~0.01–0.06 rate, only ~30 batters per
    game). Expect small r values even for a correct model; r > 0.10 is
    already meaningful at this sample size.
  - If physics r > current r: good evidence to swap the formula.
  - If bucket Q1 HR rate < bucket Q5 HR rate monotonically, the model
    orders games correctly (what we actually care about for picks).
  - Best calibrated k_rho, k_wind override the research-brief starting
    values when we swap formulas in environment.py.
""")


if __name__ == "__main__":
    main()
