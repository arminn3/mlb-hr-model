"""
Environment factors: park HR factor, weather conditions (temp, wind, humidity).
Weather data from Open-Meteo (free, no API key needed).
"""

from datetime import date, datetime
from typing import Optional

import numpy as np
import requests

import config


def get_park_factor(home_team: str, batter_hand: str = None) -> float:
    """
    Get HR park factor for the home team's stadium.
    If batter_hand is provided ('L' or 'R'), return the handedness-specific factor.
    Otherwise return the overall factor. 100 = neutral.
    """
    entry = config.PARK_HR_FACTORS.get(home_team, {"overall": 100, "L": 100, "R": 100})
    if isinstance(entry, (int, float)):
        return float(entry)
    if batter_hand and batter_hand in entry:
        return float(entry[batter_hand])
    return float(entry.get("overall", 100))


def get_game_weather(
    home_team: str, game_date: date = None, game_hour_local: int = None,
    coords_override: tuple = None,
) -> dict[str, Optional[float]]:
    """
    Fetch weather conditions at game time from Open-Meteo.

    Returns:
        temperature_f: temperature in Fahrenheit
        wind_speed_mph: wind speed in mph
        wind_direction: wind direction in degrees (0-360)
        humidity: relative humidity %
        wind_score: estimated HR impact of wind (-15 to +15 mph equivalent)
    """
    defaults = {
        "temperature_f": None,
        "wind_speed_mph": None,
        "wind_direction": None,
        "humidity": None,
        "pressure_hpa": None,
        "wind_score": 0.0,
    }

    if game_date is None:
        game_date = date.today()

    coords = config.STADIUM_COORDS.get(home_team)
    if not coords:
        return defaults

    lat, lon = coords

    try:
        # Use timezone=auto so Open-Meteo returns hours in the stadium's local time
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,"
            f"relative_humidity_2m,surface_pressure"
            f"&temperature_unit=fahrenheit"
            f"&wind_speed_unit=mph"
            f"&timezone=auto"
        )
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        temps = hourly.get("temperature_2m", [])
        winds = hourly.get("wind_speed_10m", [])
        wind_dirs = hourly.get("wind_direction_10m", [])
        wind_gusts = hourly.get("wind_gusts_10m", [])
        humidities = hourly.get("relative_humidity_2m", [])
        pressures = hourly.get("surface_pressure", [])

        # Use actual game start hour if provided, otherwise default to 7 PM local
        target_hour = game_hour_local if game_hour_local is not None else 19
        best_idx = _find_closest_hour(times, game_date, target_hour)

        if best_idx is None:
            return defaults

        temp_f = temps[best_idx] if best_idx < len(temps) else None
        wind_mph = winds[best_idx] if best_idx < len(winds) else None
        wind_dir = wind_dirs[best_idx] if best_idx < len(wind_dirs) else None
        wind_gust = wind_gusts[best_idx] if best_idx < len(wind_gusts) else None
        humid = humidities[best_idx] if best_idx < len(humidities) else None
        pressure = pressures[best_idx] if best_idx < len(pressures) else None

        # Calculate wind HR score: positive = helps HRs, negative = hurts.
        # Score still uses sustained wind to keep the model unchanged; gust is
        # a display-only field for now (user must explicitly opt into using
        # gusts for scoring per the no-auto-changes rule).
        wind_score = _calc_wind_score(wind_mph, wind_dir, home_team, temp_f)

        return {
            "temperature_f": round(temp_f, 1) if temp_f is not None else None,
            "wind_speed_mph": round(wind_mph, 1) if wind_mph is not None else None,
            "wind_gust_mph": round(wind_gust, 1) if wind_gust is not None else None,
            "wind_direction": round(wind_dir, 0) if wind_dir is not None else None,
            "humidity": round(humid, 0) if humid is not None else None,
            "pressure_hpa": round(pressure, 1) if pressure is not None else None,
            "wind_score": round(wind_score, 1),
        }
    except Exception:
        return defaults


def _find_closest_hour(
    times: list[str], game_date: date, target_hour: int
) -> Optional[int]:
    """Find index of the hourly data closest to target hour on game date."""
    # Try exact match first
    target_str = f"{game_date.isoformat()}T{target_hour:02d}:00"
    for i, t in enumerate(times):
        if t == target_str:
            return i

    # Fallback: find the closest hour on the game date to target
    date_prefix = game_date.isoformat()
    best_idx = None
    best_diff = 999
    for i, t in enumerate(times):
        if t.startswith(date_prefix):
            try:
                hour = int(t[11:13])
                diff = abs(hour - target_hour)
                if diff < best_diff:
                    best_diff = diff
                    best_idx = i
            except (ValueError, IndexError):
                if best_idx is None:
                    best_idx = i
    return best_idx


# ── Wind direction to HR impact ──────────────────────────────────────────────
# Most MLB stadiums face roughly NE (batter faces pitcher toward center field).
# Wind blowing OUT to center (from home plate toward CF) helps HRs.
# This is a simplification — each park has a different orientation.

# Stadium outfield direction in degrees (approximate azimuth to center field)
# Compass bearing (degrees from north) from home plate to center field
# Researched from ballparks.com orientation diagrams, Baseball Almanac,
# Wikipedia stadium articles, and satellite imagery cross-checks.
# Verified April 2026 — accounts for new stadiums (Truist Park, Globe Life
# Field, LoanDepot Park) that replaced older venues at different orientations.
_OUTFIELD_AZIMUTH: dict[str, float] = {
    # AL East
    "BAL": 30,   # Oriole Park — NNE
    "BOS": 45,   # Fenway Park — NE
    "NYY": 75,   # Yankee Stadium — ENE
    "TB":  45,   # Tropicana Field — NE (fixed dome, wind zeroed)
    "TOR":  0,   # Rogers Centre — N (fixed dome, wind zeroed)
    # AL Central
    "CWS": 135,  # Rate Field — SE (home plate in NW corner)
    "CLE":   0,  # Progressive Field — N
    "DET": 150,  # Comerica Park — SSE (most south-oriented MLB park)
    "KC":  45,   # Kauffman Stadium — NE
    "MIN": 90,   # Target Field — E (confirmed "aligned east")
    # AL West
    "HOU": 345,  # Daikin Park / Minute Maid — NNW (retractable)
    "LAA":  45,  # Angel Stadium — NE
    "OAK":  60,  # Oakland Coliseum — ENE
    "SEA":  45,  # T-Mobile Park — NE (retractable)
    "TEX":  45,  # Globe Life Field — NE (retractable, new stadium 2020)
    # NL East
    "ATL": 135,  # Truist Park — SE (new stadium 2017, differs from Turner Field)
    "MIA": 120,  # LoanDepot Park — ESE (retractable, new stadium 2012)
    "NYM":  30,  # Citi Field — NNE
    "PHI":  15,  # Citizens Bank Park — NNE
    "WSH":  30,  # Nationals Park — NNE
    # NL Central
    "CHC":  30,  # Wrigley Field — NNE
    "CIN": 120,  # Great American Ball Park — ESE (river beyond RF)
    "MIL": 135,  # American Family Field — SE (retractable)
    "PIT": 120,  # PNC Park — ESE
    "STL":  60,  # Busch Stadium — ENE
    # NL West
    "ARI":   0,  # Chase Field — N (retractable)
    "COL":   0,  # Coors Field — N (confirmed due north)
    "LAD":  30,  # Dodger Stadium — NNE
    "SDP":   0,  # Petco Park — N (confirmed due north)
    "SF":   90,  # Oracle Park — E (confirmed "faces due east")
}

# Fixed dome — weather never matters
_FIXED_DOME_TEAMS = {"TB", "TOR"}

# Retractable roof teams and their tendencies:
# TEX (Globe Life) — almost always closed, default state is closed
# MIA (LoanDepot) — closes frequently, especially when humid or <80°F
# HOU (Minute Maid) — closes when hot (>90) or cold (<65) or rain
# ARI/AZ (Chase Field) — closes when hot (>90) or cold
# MIL (American Family) — closes when cold (<65) or rain
# SEA (T-Mobile) — closes when cold (<60) or rain
_RETRACTABLE_ROOF_TEAMS = {"HOU", "MIA", "ARI", "AZ", "MIL", "SEA", "TEX"}

# Teams that almost always play with roof closed
_DEFAULT_CLOSED_TEAMS = {"TEX", "MIA"}

_DOME_TEAMS = _FIXED_DOME_TEAMS


def _is_roof_likely_closed(home_team: str, temperature_f: float = None) -> bool:
    """
    Estimate if a retractable roof is closed.
    Each stadium has different tendencies.
    """
    if home_team in _FIXED_DOME_TEAMS:
        return True
    if home_team not in _RETRACTABLE_ROOF_TEAMS:
        return False
    # TEX and MIA almost always play with roof closed
    if home_team in _DEFAULT_CLOSED_TEAMS:
        # Only open in rare perfect conditions: 75-82°F, dry
        if temperature_f and 75 <= temperature_f <= 82:
            return False  # might be open in perfect weather
        return True  # closed by default
    # AZ (Chase Field) — closed when hot or cold
    if home_team in ("ARI", "AZ"):
        if temperature_f and 65 <= temperature_f <= 85:
            return False
        return True
    # HOU — closed when hot or cold
    if home_team == "HOU":
        if temperature_f and 65 <= temperature_f <= 85:
            return False
        return True
    # MIL, SEA — closed when cold
    if temperature_f and temperature_f >= 65:
        return False
    return True


def _calc_wind_score(
    wind_mph: Optional[float],
    wind_dir: Optional[float],
    home_team: str,
    temperature_f: Optional[float] = None,
) -> float:
    """
    Estimate wind's HR impact as a score from -15 (strong headwind) to
    +15 (strong tailwind blowing out).

    Wind blowing in the same direction as the outfield azimuth = tailwind = +.
    Wind blowing opposite = headwind = -.
    """
    if wind_mph is None or wind_dir is None:
        return 0.0

    # Fixed domes: wind never matters
    if home_team in _FIXED_DOME_TEAMS:
        return 0.0

    # Retractable roofs: wind only matters if roof is open
    if home_team in _RETRACTABLE_ROOF_TEAMS:
        if _is_roof_likely_closed(home_team, temperature_f):
            return 0.0

    outfield_az = _OUTFIELD_AZIMUTH.get(home_team, 45)

    # Angle between wind direction and outfield direction
    # Wind direction = where wind comes FROM, so wind blowing toward
    # outfield means wind_dir is roughly opposite of outfield_az
    # (i.e., wind coming from home plate toward CF)
    blowing_toward = (wind_dir + 180) % 360  # direction wind is blowing TO
    angle_diff = abs(blowing_toward - outfield_az)
    if angle_diff > 180:
        angle_diff = 360 - angle_diff

    # cos(0) = 1.0 (perfect tailwind), cos(180) = -1.0 (perfect headwind)
    alignment = np.cos(np.radians(angle_diff))

    # Score = wind speed * alignment factor
    return float(wind_mph * alignment)


import math

# ── Physics-based weather HR boost ───────────────────────────────────────
# Based on WEATHER_MODEL_RESEARCH.md — humid-air density via Arden Buck,
# vector wind projection onto HP→CF, calibrated coefficients from
# weather_backtest.py grid search (2026 season, 329 games). See the
# research brief for the full derivation.
_RHO_REFERENCE = 1.225          # kg/m³, ICAO sea-level dry air standard
_K_RHO = 1.5                    # density exponent; empirically calibrated
_K_WIND = 0.5                   # HR % per mph of out-projected tailwind
_WIND_HEIGHT_CORRECTION = 1.19  # 10m → 30m log profile
_EV_REF = 100.0                 # mph

# Park factor contains BOTH structural effects (dimensions, wall heights,
# humidor) and typical-weather effects (Coors altitude, LA warmth, SF
# marine layer). Since our physics weather model re-applies today's
# density on top, using the raw park delta double-counts the weather
# component. This share isolates the structural portion so the two stack
# additively instead of overlapping. Tune via backtest.
_PARK_STRUCTURAL_SHARE = 0.55

# ── Per-park wind sensitivity ────────────────────────────────────────────
# How much ambient 10m wind actually translates to carry at each park.
# 1.0 = league-average. Higher = wind matters more than the linear model
# assumes (open stadium, prevailing fetch over water, elevated bleachers).
# Lower = wind is dampened by geometry, enclosure, altitude, or swirling
# patterns that decorrelate from the nearest airport's reading. Values
# informed by Nathan's physics articles, Weather Applied Metrics per-park
# wind correlations, and Wrigley's historical wind/HR logs.
_PARK_WIND_SENSITIVITY: dict[str, float] = {
    # High sensitivity — wind is a bigger lever than average
    "CHC": 1.7,   # Wrigley — lake gusts, open bleachers, the canonical wind park
    "KC":  1.2,   # Kauffman — open, flat, prairie winds carry
    "BOS": 1.15,  # Fenway — Monster bounces but mostly additive
    "CIN": 1.1,   # Great American — short RF porch, river fetch
    "MIN": 1.1,   # Target — open, cold dense-air amplifier
    "CWS": 1.1,   # Rate Field — exposed corners
    "DET": 1.1,   # Comerica — vast open OF
    "CLE": 1.1,   # Progressive — lake proximity
    # Baseline
    "STL": 1.0, "NYM": 1.0, "PHI": 1.0, "WSH": 1.0,
    "BAL": 1.0, "PIT": 1.0, "ATL": 1.0, "LAA": 1.0,
    # Dampened — wind matters less than linear model assumes
    "NYY": 0.9,   # Yankee — geometry (short RF) dominates, not wind
    "LAD": 0.9,   # Dodger — mild climate, light typical wind
    "SDP": 0.85,  # Petco — marine layer dampens carry
    "OAK": 0.9,   # Coliseum — mild bay wind (Sutter 2026 TBD)
    "COL": 0.75,  # Coors — altitude effect dominates, wind is smaller lever
    "SF":  0.55,  # Oracle — notorious swirling coastal, low wind↔HR correlation
    # Retractable roofs — sensitivity only applies when roof is open
    "SEA": 0.7, "ARI": 0.7, "AZ": 0.7,
    "TEX": 0.7, "MIA": 0.7, "HOU": 0.7, "MIL": 0.7,
    # Fixed domes — zeroed upstream, included for completeness
    "TB": 0.0, "TOR": 0.0,
}


def _park_wind_sensitivity(home_team: str) -> float:
    return _PARK_WIND_SENSITIVITY.get(home_team, 1.0)


def _load_calibration() -> None:
    """If `environment_calibration.json` exists (written by
       `historical_backtest.py`), override the hardcoded `_K_RHO`,
       `_K_WIND`, and `_PARK_WIND_SENSITIVITY` with data-calibrated
       values. Hardcoded values remain as a compile-time fallback so
       the module still works if the JSON is deleted."""
    import json
    from pathlib import Path
    global _K_RHO, _K_WIND
    path = Path(__file__).resolve().parent / "environment_calibration.json"
    if not path.exists():
        return
    try:
        with path.open() as f:
            calib = json.load(f)
    except (OSError, ValueError):
        return
    meta = calib.get("meta", {})
    if isinstance(meta.get("K_RHO"), (int, float)):
        _K_RHO = float(meta["K_RHO"])
    if isinstance(meta.get("K_WIND"), (int, float)):
        _K_WIND = float(meta["K_WIND"])
    sens = calib.get("PARK_WIND_SENSITIVITY_SHRUNK", {})
    for park, mult in sens.items():
        if isinstance(mult, (int, float)):
            _PARK_WIND_SENSITIVITY[park] = float(mult)


_load_calibration()


def _saturation_vapor_pressure_hpa(t_c: float) -> float:
    """Arden Buck (1981). More accurate than Tetens at extremes."""
    return 6.1121 * math.exp((18.678 - t_c / 234.5) * (t_c / (257.14 + t_c)))


def _humid_air_density_kg_m3(
    temp_f: Optional[float],
    pressure_hpa: Optional[float],
    rh_pct: Optional[float],
) -> Optional[float]:
    """Humid-air density at station level. None if inputs missing."""
    if temp_f is None or pressure_hpa is None:
        return None
    t_c = (temp_f - 32) * 5 / 9
    t_k = t_c + 273.15
    p_pa = pressure_hpa * 100.0
    rh = rh_pct if rh_pct is not None else 50.0
    p_sat = _saturation_vapor_pressure_hpa(t_c) * 100
    p_v = (rh / 100.0) * p_sat
    p_d = p_pa - p_v
    M_d = 0.028965  # kg/mol dry air
    M_v = 0.018016  # kg/mol water vapor
    R = 8.31446
    return (p_d * M_d + p_v * M_v) / (R * t_k)


def _wind_out_component(
    wind_mph: Optional[float],
    wind_dir_from_deg: Optional[float],
    home_team: str,
) -> float:
    """Project wind onto HP→CF axis. +tailwind, -headwind, 0 crosswind."""
    if wind_mph is None or wind_dir_from_deg is None:
        return 0.0
    beta = _OUTFIELD_AZIMUTH.get(home_team)
    if beta is None:
        return 0.0
    # Met convention: wind comes FROM that direction. The velocity vector
    # blows TO (dir + 180) mod 360.
    to_rad = math.radians((wind_dir_from_deg + 180.0) % 360.0)
    w_x = wind_mph * math.sin(to_rad)
    w_y = wind_mph * math.cos(to_rad)
    cf_rad = math.radians(beta)
    cf_x = math.sin(cf_rad)
    cf_y = math.cos(cf_rad)
    return w_x * cf_x + w_y * cf_y


def calc_weather_hr_pct(
    temp_f: Optional[float],
    wind_mph: Optional[float],
    wind_dir_deg: Optional[float],
    humidity: Optional[float],
    pressure_hpa: Optional[float],
    home_team: str,
    is_dome_or_roofed: bool = False,
) -> dict:
    """
    Physics-based weather HR boost vs league-average environment.
    Returns dict with components so the UI/backtest can audit the math.

      density_pct: % boost from humid-air density vs sea-level reference
      wind_pct:    % boost from projected tailwind component
      total_pct:   combined (density + wind)
    """
    if is_dome_or_roofed:
        return {"density_pct": 0.0, "wind_pct": 0.0, "total_pct": 0.0}

    rho = _humid_air_density_kg_m3(temp_f, pressure_hpa, humidity)
    if rho and rho > 0:
        density_pct = ((_RHO_REFERENCE / rho) ** _K_RHO - 1.0) * 100.0
    else:
        density_pct = 0.0

    w_out = _wind_out_component(wind_mph, wind_dir_deg, home_team) * _WIND_HEIGHT_CORRECTION
    w_out *= _park_wind_sensitivity(home_team)
    wind_pct = _K_WIND * w_out  # already %/mph HR-rate units

    total = density_pct + wind_pct
    return {
        "density_pct": round(density_pct, 2),
        "wind_pct": round(wind_pct, 2),
        "total_pct": round(total, 2),
    }


def calc_environment_score(
    home_team: str, game_date: date = None, batter_hand: str = None,
    game_hour_local: int = None,
) -> dict:
    """
    Compute environment factor scores for a game.
    If batter_hand is provided, uses handedness-specific park factor.

    Returns dict with raw values, normalized scores, and combined env score.
    """
    if game_date is None:
        game_date = date.today()

    park = get_park_factor(home_team, batter_hand)
    weather = get_game_weather(home_team, game_date, game_hour_local)

    # Normalize each factor to 0-1
    def norm(value, key):
        if value is None:
            return 0.5  # neutral if unknown
        lo, hi = config.NORM_RANGES_ENV[key]
        return float(np.clip((value - lo) / (hi - lo), 0.0, 1.0))

    is_dome = home_team in _FIXED_DOME_TEAMS
    is_retractable = home_team in _RETRACTABLE_ROOF_TEAMS
    roof_closed = _is_roof_likely_closed(home_team, weather.get("temperature_f"))

    park_norm = norm(park, "park_factor")

    # Dome/roof closed: only park factor matters — weather is irrelevant
    if is_dome or roof_closed:
        temp_norm = 0.5   # neutral
        wind_norm = 0.5   # neutral
        humid_norm = 0.5  # neutral
        pressure_norm = 0.5
    else:
        temp_norm = norm(weather["temperature_f"], "temperature")
        wind_norm = norm(weather["wind_score"], "wind_score")
        humid_norm = norm(weather["humidity"], "humidity")
        pressure_norm = norm(weather["pressure_hpa"], "pressure")

    # Weighted environment score
    env_score = (
        config.ENVIRONMENT_WEIGHTS["park_factor"] * park_norm
        + config.ENVIRONMENT_WEIGHTS["temperature"] * temp_norm
        + config.ENVIRONMENT_WEIGHTS["wind_score"] * wind_norm
        + config.ENVIRONMENT_WEIGHTS["humidity"] * humid_norm
        + config.ENVIRONMENT_WEIGHTS["pressure"] * pressure_norm
    )

    # Physics-based weather HR boost (independent of the heuristic env_score
    # above — this is the authoritative weather signal for the UI and for
    # any downstream HR probability adjustment).
    weather_boost = calc_weather_hr_pct(
        temp_f=weather.get("temperature_f"),
        wind_mph=weather.get("wind_speed_mph"),
        wind_dir_deg=weather.get("wind_direction"),
        humidity=weather.get("humidity"),
        pressure_hpa=weather.get("pressure_hpa"),
        home_team=home_team,
        is_dome_or_roofed=(is_dome or roof_closed),
    )
    # Park contribution — only the structural share to avoid double-counting
    # typical weather that the park factor already embeds.
    park_hr_pct = round((park - 100.0) * _PARK_STRUCTURAL_SHARE, 2)
    combined_hr_pct = round(weather_boost["total_pct"] + park_hr_pct, 2)

    return {
        "park_factor": park,
        "temperature_f": weather["temperature_f"],
        "wind_speed_mph": weather["wind_speed_mph"],
        "wind_gust_mph": weather.get("wind_gust_mph"),
        "wind_direction": weather["wind_direction"],
        "wind_score": weather["wind_score"],
        "humidity": weather["humidity"],
        "pressure_hpa": weather["pressure_hpa"],
        "is_dome": is_dome,
        "is_retractable": is_retractable,
        "roof_closed": roof_closed,
        "park_norm": round(park_norm, 3),
        "temp_norm": round(temp_norm, 3),
        "wind_norm": round(wind_norm, 3),
        "humid_norm": round(humid_norm, 3),
        "pressure_norm": round(pressure_norm, 3),
        "env_score": round(env_score, 3),
        # Physics weather model (WEATHER_MODEL_RESEARCH.md)
        "weather_density_pct": weather_boost["density_pct"],
        "weather_wind_pct": weather_boost["wind_pct"],
        "weather_hr_pct": weather_boost["total_pct"],
        "park_hr_pct": park_hr_pct,
        "combined_hr_pct": combined_hr_pct,
    }
