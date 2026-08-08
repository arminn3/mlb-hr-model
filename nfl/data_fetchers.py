"""NFL data fetchers — thin cached wrappers over nfl_data_py (nflverse data).

Mirrors the MLB `statcast_cache` pattern: pull once from nflverse, cache to
`nfl_cache/` as parquet, reuse on subsequent runs. Self-contained — never
imports the MLB modules.

Library note: local dev is Python 3.9, where nflreadpy (3.10+, polars) can't
install, so we use nfl_data_py (pandas — same underlying nflverse data, and
consistent with the pandas-based MLB pipeline). The derived metrics live in the
spike/model, not the fetcher, so we can swap to nflreadpy later (e.g. on a 3.11
cron) without touching the analytics.

Availability caveat (nfl_data_py is in maintenance): its `player_stats` endpoint
(import_weekly_data / import_seasonal_data) 404s for recent seasons, but PBP,
schedules, snap_counts, and players all resolve — and PBP is rich enough to
derive the weekly/seasonal stats ourselves.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import nfl_data_py as nfl

CACHE_DIR = Path(__file__).resolve().parent.parent / "nfl_cache"
CACHE_DIR.mkdir(exist_ok=True)


def _cached(key: str, loader) -> pd.DataFrame:
    """Return the cached parquet for `key`, or load + cache it."""
    fp = CACHE_DIR / f"{key}.parquet"
    if fp.exists():
        return pd.read_parquet(fp)
    df = loader()
    try:
        df.to_parquet(fp)
    except Exception as e:  # parquet write is best-effort; don't fail the pull
        print(f"[nfl_cache] warning: could not cache {key}: {e}")
    return df


def load_pbp(year: int) -> pd.DataFrame:
    """Play-by-play for one season (the primary source: RZ tendencies, TDs,
    per-player targets/carries/air-yards, defense-vs-position)."""
    return _cached(f"pbp_{year}", lambda: nfl.import_pbp_data([year], downcast=True, cache=False))


def load_snap_counts(year: int) -> pd.DataFrame:
    """Weekly snap counts (offense_snaps / offense_pct) — for snap share."""
    return _cached(f"snaps_{year}", lambda: nfl.import_snap_counts([year]))


def load_schedules(year: int) -> pd.DataFrame:
    """Game schedule: kickoff, roof/surface, spread/total (game environment)."""
    return _cached(f"sched_{year}", lambda: nfl.import_schedules([year]))


def load_players() -> pd.DataFrame:
    """All-time player table — used to map gsis_id -> position for DvP."""
    return _cached("players", lambda: nfl.import_players())
