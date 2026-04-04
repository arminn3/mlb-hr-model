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
    home_team: str, game_date: date = None, game_hour_local: int = None
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
            f"&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,"
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
        humid = humidities[best_idx] if best_idx < len(humidities) else None
        pressure = pressures[best_idx] if best_idx < len(pressures) else None

        # Calculate wind HR score: positive = helps HRs, negative = hurts
        wind_score = _calc_wind_score(wind_mph, wind_dir, home_team, temp_f)

        return {
            "temperature_f": round(temp_f, 1) if temp_f is not None else None,
            "wind_speed_mph": round(wind_mph, 1) if wind_mph is not None else None,
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
_OUTFIELD_AZIMUTH: dict[str, float] = {
    "BAL": 45, "BOS": 70, "NYY": 50, "TB": 0,  # dome
    "TOR": 0,  # dome
    "CWS": 45, "CLE": 20, "DET": 35, "KC": 15, "MIN": 30,
    "HOU": 0,  # retractable, often closed
    "LAA": 45, "OAK": 50, "SEA": 0,  # retractable
    "TEX": 0,  # retractable
    "ATL": 30, "MIA": 0,  # dome
    "NYM": 45, "PHI": 50, "WSH": 35,
    "CHC": 25, "CIN": 55, "MIL": 0,  # retractable
    "PIT": 30, "STL": 45, "ARI": 0,  # retractable
    "COL": 50, "LAD": 40, "SDP": 55, "SF": 50,
}

# Fixed dome — weather never matters
_FIXED_DOME_TEAMS = {"TB", "TOR"}

# Retractable roof — weather matters when roof is open
# Roof is typically open when temp > 70°F and no rain
_RETRACTABLE_ROOF_TEAMS = {"HOU", "MIA", "ARI", "AZ", "MIL", "SEA", "TEX"}

# Combined for backward compat
_DOME_TEAMS = _FIXED_DOME_TEAMS  # only truly sealed domes


def _is_roof_likely_closed(home_team: str, temperature_f: float = None) -> bool:
    """
    Estimate if a retractable roof is closed.
    Open if: temp > 70°F (assumed no rain — we don't have precip data yet).
    """
    if home_team in _FIXED_DOME_TEAMS:
        return True
    if home_team not in _RETRACTABLE_ROOF_TEAMS:
        return False
    # AZ (Chase Field) almost always has roof closed in summer due to heat
    if home_team in ("ARI", "AZ") and temperature_f and temperature_f > 90:
        return True
    # For others: open if warm enough
    if temperature_f and temperature_f >= 70:
        return False  # roof likely open — weather applies
    return True  # cold = roof likely closed


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

    park_norm = norm(park, "park_factor")
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

    is_dome = home_team in _FIXED_DOME_TEAMS
    is_retractable = home_team in _RETRACTABLE_ROOF_TEAMS
    roof_closed = _is_roof_likely_closed(home_team, weather.get("temperature_f"))

    return {
        "park_factor": park,
        "temperature_f": weather["temperature_f"],
        "wind_speed_mph": weather["wind_speed_mph"],
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
    }
