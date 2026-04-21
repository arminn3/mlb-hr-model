#!/usr/bin/env python3
"""
Bulk ASOS fetcher — per-(station, year) pulls for historical backtest.

Fetches all hourly METAR observations at each stadium's nearest ICAO
airport for Mar 1 → Nov 1 of each target year. Cached to
.asos_cache/{station}_{year}.json so downstream joiners are local/fast.

Coverage: 30 stations × N years = 30N requests. At 1.0 req/sec this
takes ~5 min for 10 years. Iowa State ASOS is a free public archive
and tolerates this load.

Usage:
    python3 historical_asos.py                              # 2015-2024 all parks
    python3 historical_asos.py --start 2020 --end 2024
    python3 historical_asos.py --station KORD --year 2019  # single
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import requests

from asos_fetch import (
    STADIUM_TO_ICAO,
    _altimeter_to_hpa,
    _magnus_rh,
    _to_float,
)


_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
_CACHE_DIR = Path(".asos_cache")
_SLEEP_BETWEEN_REQUESTS = 1.0  # seconds


def _cache_path(station: str, year: int) -> Path:
    return _CACHE_DIR / f"{station}_{year}.json"


def fetch_station_year(
    station: str,
    year: int,
    force: bool = False,
    verbose: bool = True,
) -> list[dict]:
    """Fetch March-November hourly obs for one station+year.

    Caches to .asos_cache/{station}_{year}.json. Returns list of dicts
    with keys: valid_utc (ISO), temp_f, dewpoint_f, relative_humidity,
    wind_speed_mph, wind_dir_deg, wind_gust_mph, pressure_hpa, precip_in.
    """
    path = _cache_path(station, year)
    if path.exists() and not force:
        with path.open() as f:
            return json.load(f)

    params = {
        "station": station,
        "data": "tmpf,dwpf,sknt,drct,alti,mslp,gust,p01i",
        "year1": year, "month1": 3, "day1": 1,
        "year2": year, "month2": 11, "day2": 1,
        "tz": "Etc/UTC",
        "format": "onlycomma",
        "latlon": "no",
        "elev": "no",
        "missing": "M",
        "trace": "T",
        "direct": "no",
        "report_type": "3",
    }

    for attempt in range(3):
        try:
            r = requests.get(_URL, params=params, timeout=60)
            r.raise_for_status()
            text = r.text
            break
        except Exception as exc:
            if attempt == 2:
                if verbose:
                    print(f"  [FAIL] {station} {year}: {exc}", file=sys.stderr)
                return []
            time.sleep(2.0)
    else:
        return []

    out: list[dict] = []
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or header[0] != "station":
        if verbose:
            print(f"  [EMPTY] {station} {year}: no header", file=sys.stderr)
        return []
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
        out.append({
            "valid_utc": valid.isoformat(),
            "temp_f": temp_f,
            "dewpoint_f": dew_f,
            "relative_humidity": _magnus_rh(temp_f, dew_f),
            "wind_speed_mph": None if knots is None else round(knots * 1.15078, 1),
            "wind_dir_deg": _to_float(row[idx["drct"]]),
            "wind_gust_mph": None if gust_k is None else round(gust_k * 1.15078, 1),
            "pressure_hpa": _altimeter_to_hpa(_to_float(row[idx["alti"]])),
            "precip_in": _to_float(row[idx["p01i"]]),
        })

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(out, f)
    if verbose:
        print(f"  [OK] {station} {year}: {len(out):,} obs → {path}")
    return out


def run_bulk(years: list[int], stations: Optional[list[str]] = None) -> None:
    if stations is None:
        stations = sorted(set(STADIUM_TO_ICAO.values()))

    total = len(stations) * len(years)
    done = 0
    started = time.time()

    for station in stations:
        for year in years:
            done += 1
            path = _cache_path(station, year)
            if path.exists():
                print(f"[{done}/{total}] {station} {year} — cached, skipping")
                continue
            print(f"[{done}/{total}] {station} {year} — fetching...")
            fetch_station_year(station, year)
            time.sleep(_SLEEP_BETWEEN_REQUESTS)

    elapsed = time.time() - started
    print(f"\nDone. {total} station-years in {elapsed:.1f}s ({elapsed/60:.1f} min)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2015)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--year", type=int, help="Single year (overrides range)")
    ap.add_argument("--station", type=str, help="Single ICAO station")
    args = ap.parse_args()

    years = [args.year] if args.year else list(range(args.start, args.end + 1))
    stations = [args.station] if args.station else None
    run_bulk(years, stations)
    return 0


if __name__ == "__main__":
    sys.exit(main())
