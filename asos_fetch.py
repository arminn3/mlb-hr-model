#!/usr/bin/env python3
"""
ASOS METAR fetcher — Iowa State ASOS archive.

For a given stadium + date, returns hourly observed weather at the
nearest major airport. Free, reliable, used by pro meteorologists.

This is the ground-truth layer for historical backtesting. Open-Meteo
forecasts are fine for day-of-game predictions, but for measuring model
accuracy against actual HR outcomes we want the real observed weather,
not a forecast that may or may not have verified.

Reference: https://mesonet.agron.iastate.edu/ASOS/
"""
from __future__ import annotations

import argparse
import csv
import io
import math
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import requests

# ── Stadium → nearest ICAO airport (hourly METAR station) ────────────────
# Chose closest major airport for each park. Distances in miles.
# Minor League / Sutter Health (Oakland 2026) → KSMF (Sacramento Exec 3mi)
STADIUM_TO_ICAO = {
    "ARI": "KPHX", "AZ":  "KPHX",                  # Chase Field ← 3mi
    "ATL": "KATL",                                   # Truist ← 10mi
    "BAL": "KBWI",                                   # Camden ← 10mi
    "BOS": "KBOS",                                   # Fenway ← 4mi
    "CHC": "KORD",                                   # Wrigley ← 14mi
    "CWS": "KMDW",                                   # Rate Field ← 4mi
    "CIN": "KCVG",                                   # GABP ← 13mi
    "CLE": "KCLE",                                   # Progressive ← 10mi
    "COL": "KDEN",                                   # Coors ← 21mi
    "DET": "KDTW",                                   # Comerica ← 20mi
    "HOU": "KHOU",                                   # Minute Maid ← 9mi
    "KC":  "KMCI",                                   # Kauffman ← 12mi
    "LAA": "KSNA",                                   # Angel Stadium ← 3mi
    "LAD": "KBUR",                                   # Dodger ← 8mi
    "MIA": "KMIA",                                   # loanDepot ← 6mi
    "MIL": "KMKE",                                   # AmFam ← 6mi
    "MIN": "KMSP",                                   # Target Field ← 9mi
    "NYM": "KLGA",                                   # Citi ← 5mi
    "NYY": "KLGA",                                   # Yankee ← 7mi
    "OAK": "KOAK", "ATH": "KSMF",                    # 2026 move to Sutter/Sacramento
    "PHI": "KPHL",                                   # Citizens Bank ← 5mi
    "PIT": "KPIT",                                   # PNC ← 10mi
    "SDP": "KSAN", "SD": "KSAN",                    # Petco ← 3mi
    "SF":  "KSFO",                                   # Oracle ← 10mi
    "SEA": "KBFI",                                   # T-Mobile ← 5mi (Boeing Field)
    "STL": "KSTL",                                   # Busch ← 13mi
    "TB":  "KTPA",                                   # Tropicana ← 15mi
    "TEX": "KDFW",                                   # Globe Life ← 10mi
    "TOR": "CYYZ",                                   # Rogers ← 15mi (Toronto Pearson)
    "WSH": "KDCA",                                   # Nationals ← 3mi
}

# ── Parse ASOS hourly response ──────────────────────────────────────────
@dataclass
class AsosObservation:
    station: str
    valid_utc: datetime            # observation time, UTC
    temp_f: Optional[float]
    dewpoint_f: Optional[float]
    relative_humidity: Optional[float]
    wind_speed_mph: Optional[float]
    wind_dir_deg: Optional[float]
    wind_gust_mph: Optional[float]
    pressure_hpa: Optional[float]  # station pressure, derived from altimeter
    precip_in: Optional[float]


def _magnus_rh(temp_f: Optional[float], dewpoint_f: Optional[float]) -> Optional[float]:
    """Relative humidity from temp + dew point (Magnus approximation)."""
    if temp_f is None or dewpoint_f is None:
        return None
    t_c = (temp_f - 32) * 5 / 9
    d_c = (dewpoint_f - 32) * 5 / 9
    a, b = 17.625, 243.04
    return 100 * math.exp(a * d_c / (b + d_c)) / math.exp(a * t_c / (b + t_c))


def _altimeter_to_hpa(alti_inhg: Optional[float]) -> Optional[float]:
    """Convert altimeter setting (inHg) to hPa. Note this is QNH-equivalent,
       not station pressure — for altitude-correct density we'd need to
       de-correct using ICAO barometric formula + elevation, but for our
       purposes the QNH is close enough because we're using the result
       with measured temperature at station elevation."""
    if alti_inhg is None:
        return None
    return alti_inhg * 33.8639


def _to_float(s: str) -> Optional[float]:
    if s in ("M", "", "T", "trace"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def fetch_asos(
    station: str,
    game_date: date,
    tz: str = "Etc/UTC",
    retries: int = 2,
) -> list[AsosObservation]:
    """Pull all hourly METAR observations for the station on game_date
       (± 1 day to cover tz boundaries). Returns empty list on failure.

       See: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"""
    start = game_date - timedelta(days=1)
    end = game_date + timedelta(days=1)
    url = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
    params = {
        "station": station,
        "data": "tmpf,dwpf,sknt,drct,alti,mslp,gust,p01i",
        "year1": start.year, "month1": start.month, "day1": start.day,
        "year2": end.year,   "month2": end.month,   "day2": end.day,
        "tz": tz,
        "format": "onlycomma",
        "latlon": "no",
        "elev": "no",
        "missing": "M",
        "trace": "T",
        "direct": "no",
        "report_type": "3",  # hourly / routine
    }

    for attempt in range(retries + 1):
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            text = r.text
            break
        except Exception:
            if attempt == retries:
                return []
            time.sleep(1.5)

    out: list[AsosObservation] = []
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or header[0] != "station":
        return []
    # Expected header: station,valid,tmpf,dwpf,sknt,drct,alti,mslp,gust,p01i
    idx = {name: i for i, name in enumerate(header)}

    for row in reader:
        if len(row) < len(header):
            continue
        try:
            valid = datetime.strptime(row[idx["valid"]], "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        temp_f = _to_float(row[idx["tmpf"]])
        dew_f = _to_float(row[idx["dwpf"]])
        knots = _to_float(row[idx["sknt"]])
        gust_k = _to_float(row[idx["gust"]])
        out.append(AsosObservation(
            station=row[idx["station"]],
            valid_utc=valid,
            temp_f=temp_f,
            dewpoint_f=dew_f,
            relative_humidity=_magnus_rh(temp_f, dew_f),
            wind_speed_mph=None if knots is None else round(knots * 1.15078, 1),
            wind_dir_deg=_to_float(row[idx["drct"]]),
            wind_gust_mph=None if gust_k is None else round(gust_k * 1.15078, 1),
            pressure_hpa=_altimeter_to_hpa(_to_float(row[idx["alti"]])),
            precip_in=_to_float(row[idx["p01i"]]),
        ))
    return out


def nearest_to_hour(
    obs: list[AsosObservation],
    target_utc: datetime,
    max_delta_minutes: int = 90,
) -> Optional[AsosObservation]:
    """Pick the observation closest to target_utc. Reject if >max minutes away."""
    if not obs:
        return None
    best = min(obs, key=lambda o: abs((o.valid_utc - target_utc).total_seconds()))
    if abs((best.valid_utc - target_utc).total_seconds()) > max_delta_minutes * 60:
        return None
    return best


# ── Stadium-level convenience ────────────────────────────────────────────
def fetch_for_game(
    home_team: str,
    game_date: date,
    game_hour_utc: int = 23,
) -> Optional[AsosObservation]:
    """Get the single observation nearest to game time for a stadium.
       Default game_hour_utc=23 ≈ 7 PM ET; use actual game time when known."""
    icao = STADIUM_TO_ICAO.get(home_team)
    if not icao:
        return None
    obs = fetch_asos(icao, game_date)
    target = datetime(game_date.year, game_date.month, game_date.day,
                      game_hour_utc, 0)
    return nearest_to_hour(obs, target)


# ── CLI smoke test ──────────────────────────────────────────────────────
def _smoke():
    """Quick sanity check on a recent date."""
    team = "NYY"
    d = date(2026, 4, 18)
    obs = fetch_for_game(team, d, game_hour_utc=23)
    if obs is None:
        print(f"No obs for {team} on {d}")
        return
    print(f"Station: {obs.station}")
    print(f"Valid:   {obs.valid_utc} UTC")
    print(f"Temp:    {obs.temp_f}°F (dew {obs.dewpoint_f}°F, RH {obs.relative_humidity:.0f}%)")
    print(f"Wind:    {obs.wind_speed_mph} mph @ {obs.wind_dir_deg}° (gust {obs.wind_gust_mph})")
    print(f"Pres:    {obs.pressure_hpa} hPa")
    print(f"Precip:  {obs.precip_in} in")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--team", default=None, help="MLB abbr (e.g. NYY)")
    p.add_argument("--date", default=None, help="YYYY-MM-DD")
    p.add_argument("--hour", type=int, default=23, help="game hour UTC (default 23 ≈ 7 PM ET)")
    args = p.parse_args()
    if not args.team:
        _smoke()
    else:
        d = datetime.strptime(args.date, "%Y-%m-%d").date()
        obs = fetch_for_game(args.team, d, game_hour_utc=args.hour)
        if obs is None:
            print(f"No observation for {args.team} on {args.date} within 90 min.")
        else:
            print(f"{obs.station} {obs.valid_utc}  T={obs.temp_f}F  "
                  f"wind={obs.wind_speed_mph}mph@{obs.wind_dir_deg}°  "
                  f"RH={obs.relative_humidity:.0f}%  P={obs.pressure_hpa:.1f}hPa")
