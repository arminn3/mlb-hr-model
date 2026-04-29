"""
Data fetching layer: MLB Stats API, pybaseball (Statcast), The Odds API.
"""

import json
import os
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import requests
from pybaseball import statcast_batter, statcast_pitcher, playerid_lookup
from thefuzz import fuzz

import config

# ── Caches ───────────────────────────────────────────────────────────────────
_player_id_cache: dict[str, Optional[int]] = {}
_player_info_cache: dict[int, dict] = {}

MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
ODDS_CACHE_FILE = Path("odds_cache.json")

ROTOWIRE_LINEUPS_URL = "https://www.rotowire.com/baseball/daily-lineups.php"
_rotowire_cache: Optional[dict] = None  # team-pair → pitcher dicts, fetched once per process


# ═══════════════════════════════════════════════════════════════════════════════
# Rotowire fallback (for pitchers MLB API hasn't published yet)
# ═══════════════════════════════════════════════════════════════════════════════

# MLB API uses "AZ"; Rotowire uses "ARI". Normalize both to "AZ".
_ROTOWIRE_TEAM_FIXUPS = {"ARI": "AZ"}


def _slug_to_name(slug: str) -> str:
    """Convert Rotowire URL slug ('cristopher-sanchez-16500') to display name."""
    parts = slug.split("-")
    # Strip trailing numeric Rotowire id
    while parts and parts[-1].isdigit():
        parts.pop()
    return " ".join(p.capitalize() for p in parts)


def _normalize_abbr(abbr: str) -> str:
    return _ROTOWIRE_TEAM_FIXUPS.get(abbr, abbr)


def _fetch_rotowire_pitchers() -> dict:
    """Scrape Rotowire's daily lineups page. Returns dict keyed by
    (away_abbr, home_abbr) → {away_pitcher: {name, hand}, home_pitcher: ...}.

    Names are expanded from URL slugs so abbreviated displays like 'C. Sanchez'
    become 'Cristopher Sanchez' — important for downstream MLB ID lookup.
    """
    global _rotowire_cache
    if _rotowire_cache is not None:
        return _rotowire_cache
    import re
    try:
        r = requests.get(
            ROTOWIRE_LINEUPS_URL,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
            timeout=15,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"  Rotowire fetch failed: {e}")
        _rotowire_cache = {}
        return _rotowire_cache

    html = r.text
    chunks = re.split(r'<div class="lineup is-mlb', html)[1:]
    pitcher_block_re = re.compile(
        r'lineup__player-highlight[^"]*">\s*<div class="lineup__player-highlight-name">\s*'
        r'<a href="/baseball/player/([a-z0-9\-]+)"[^>]*>([^<]+)</a>\s*'
        r'<span class="lineup__throws">([LRS])</span>'
    )
    out: dict = {}
    for chunk in chunks:
        # Truncate at next game container to avoid bleed-over
        end = chunk.find('<div class="lineup is-')
        if end != -1:
            chunk = chunk[:end]
        abbrs = re.findall(r'class="lineup__abbr">([A-Z]{2,4})<', chunk)
        pitchers = pitcher_block_re.findall(chunk)
        if len(abbrs) < 2 or len(pitchers) < 2:
            continue
        away_abbr = _normalize_abbr(abbrs[0])
        home_abbr = _normalize_abbr(abbrs[1])
        out[(away_abbr, home_abbr)] = {
            "away_pitcher": {
                "name": _slug_to_name(pitchers[0][0]),
                "hand": pitchers[0][2],
            },
            "home_pitcher": {
                "name": _slug_to_name(pitchers[1][0]),
                "hand": pitchers[1][2],
            },
        }
    _rotowire_cache = out
    return out


def _lookup_pitcher_mlb_id(name: str) -> Optional[int]:
    """Look up an active pitcher's MLB ID by name. Returns None if not found."""
    try:
        url = f"{MLB_API_BASE}/people/search?names={requests.utils.quote(name)}&sportIds=1"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        people = resp.json().get("people", [])
        # Prefer pitcher with matching last name + active status
        for p in people:
            pos = (p.get("primaryPosition") or {}).get("abbreviation", "")
            if pos == "P":
                return p.get("id")
        # Fallback: first active person
        for p in people:
            if p.get("active"):
                return p.get("id")
        return people[0].get("id") if people else None
    except Exception:
        return None


def _augment_with_rotowire(games: list[dict]) -> int:
    """Fill in missing probable pitchers from Rotowire. Returns count filled."""
    needs_lookup = any(
        g.get("away_pitcher") is None or g.get("home_pitcher") is None
        for g in games
    )
    if not needs_lookup:
        return 0

    print("  MLB API has gaps; checking Rotowire for projected starters...")
    rw = _fetch_rotowire_pitchers()
    if not rw:
        return 0

    filled = 0
    for g in games:
        key = (g["away_team"], g["home_team"])
        rw_game = rw.get(key)
        if not rw_game:
            continue
        for slot in ("away_pitcher", "home_pitcher"):
            if g.get(slot) is not None:
                continue  # MLB already had it; trust them
            rw_p = rw_game.get(slot)
            if not rw_p:
                continue
            pid = _lookup_pitcher_mlb_id(rw_p["name"])
            if pid is None:
                print(f"    {key[0]}@{key[1]} {slot}: '{rw_p['name']}' (Rotowire) — MLB ID lookup failed, skipping")
                continue
            g[slot] = {"id": pid, "name": rw_p["name"], "hand": rw_p["hand"], "source": "rotowire"}
            print(f"    {key[0]}@{key[1]} {slot}: {rw_p['name']} (Rotowire projected)")
            filled += 1
    return filled


# ═══════════════════════════════════════════════════════════════════════════════
# MLB Stats API
# ═══════════════════════════════════════════════════════════════════════════════

def get_todays_schedule(game_date: date = None) -> list[dict]:
    """
    Fetch today's MLB schedule with probable pitchers.

    Returns list of dicts:
        {
            "game_pk": int,
            "away_team": str,
            "home_team": str,
            "away_team_id": int,
            "home_team_id": int,
            "away_pitcher": {"id": int, "name": str, "hand": str} | None,
            "home_pitcher": {"id": int, "name": str, "hand": str} | None,
        }
    """
    if game_date is None:
        game_date = date.today()

    url = (
        f"{MLB_API_BASE}/schedule"
        f"?date={game_date.isoformat()}&sportId=1"
        f"&hydrate=probablePitcher,team,lineups"
    )
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    games = []
    for date_entry in data.get("dates", []):
        for game in date_entry.get("games", []):
            # Skip postponed/cancelled games
            status = game.get("status", {}).get("detailedState", "")
            if status in ("Postponed", "Cancelled", "Suspended"):
                continue

            away = game.get("teams", {}).get("away", {})
            home = game.get("teams", {}).get("home", {})

            # Parse lineups if available
            lineups = game.get("lineups", {})
            away_lineup = [
                {"id": p["id"], "name": p.get("fullName", "")}
                for p in lineups.get("awayPlayers", [])
            ]
            home_lineup = [
                {"id": p["id"], "name": p.get("fullName", "")}
                for p in lineups.get("homePlayers", [])
            ]

            venue = game.get("venue", {})
            games.append({
                "game_pk": game["gamePk"],
                "away_team": away.get("team", {}).get("abbreviation", ""),
                "home_team": home.get("team", {}).get("abbreviation", ""),
                "away_team_id": away.get("team", {}).get("id"),
                "home_team_id": home.get("team", {}).get("id"),
                "game_status": status,
                "game_datetime_utc": game.get("gameDate", ""),  # ISO UTC
                "venue_id": venue.get("id"),
                "venue_name": venue.get("name", ""),
                "away_pitcher": _parse_pitcher(away.get("probablePitcher")),
                "home_pitcher": _parse_pitcher(home.get("probablePitcher")),
                "away_lineup": away_lineup,
                "home_lineup": home_lineup,
            })

    _augment_with_rotowire(games)
    return games


def get_team_roster(team_id: int) -> list[dict]:
    """
    Get active roster position players (non-pitchers) for a team.
    Returns list of {"id": int, "name": str}.
    """
    try:
        url = f"{MLB_API_BASE}/teams/{team_id}/roster?rosterType=active"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        roster = resp.json().get("roster", [])
        return [
            {"id": p["person"]["id"], "name": p["person"]["fullName"]}
            for p in roster
            if p.get("position", {}).get("abbreviation", "") != "P"
        ]
    except Exception:
        return []


def _parse_pitcher(pitcher_data: Optional[dict]) -> Optional[dict]:
    """Extract pitcher id, name, hand from MLB API pitcher object."""
    if not pitcher_data:
        return None
    pid = pitcher_data["id"]
    name = pitcher_data.get("fullName", "")
    hand = pitcher_data.get("pitchHand", {}).get("code", "")
    if not hand:
        hand = get_pitcher_hand(pid)
    return {"id": pid, "name": name, "hand": hand}


def get_pitcher_hand(pitcher_id: int) -> str:
    """Fallback to fetch pitcher throwing hand from MLB Stats API."""
    info = _get_person_info(pitcher_id)
    return info.get("pitchHand", {}).get("code", "R")


def get_batter_hand(batter_id: int) -> str:
    """Fetch batter batting side from MLB Stats API."""
    info = _get_person_info(batter_id)
    return info.get("batSide", {}).get("code", "R")


def get_batter_team_id(batter_id: int) -> Optional[int]:
    """Get the batter's current team ID."""
    info = _get_person_info(batter_id)
    return info.get("currentTeam", {}).get("id")


def _get_person_info(player_id: int) -> dict:
    """Fetch and cache player info from MLB Stats API."""
    if player_id in _player_info_cache:
        return _player_info_cache[player_id]

    url = f"{MLB_API_BASE}/people/{player_id}?hydrate=currentTeam"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    people = resp.json().get("people", [])
    info = people[0] if people else {}
    _player_info_cache[player_id] = info
    return info


# ═══════════════════════════════════════════════════════════════════════════════
# pybaseball / Statcast
# ═══════════════════════════════════════════════════════════════════════════════

# Bulk statcast cache — loaded once, filtered per player
_bulk_statcast_cache: Optional[pd.DataFrame] = None
_bulk_statcast_date: Optional[str] = None

# Bulk 2025 season cache — loaded once for all players
_bulk_2025_cache: Optional[pd.DataFrame] = None


def load_bulk_statcast(lookback_days: int = None) -> pd.DataFrame:
    """
    Pull ALL statcast data for the lookback window in one call.
    Returns the full DataFrame cached in memory.
    """
    global _bulk_statcast_cache, _bulk_statcast_date
    if lookback_days is None:
        lookback_days = max(config.BATTER_LOOKBACK_DAYS, config.PITCHER_LOOKBACK_DAYS)

    end_dt = date.today().isoformat()
    start_dt = (date.today() - timedelta(days=lookback_days)).isoformat()
    cache_key = f"{start_dt}_{end_dt}"

    if _bulk_statcast_cache is not None and _bulk_statcast_date == cache_key:
        return _bulk_statcast_cache

    from pybaseball import statcast
    print(f"  Loading bulk Statcast data ({start_dt} to {end_dt})...", end=" ")
    try:
        df = statcast(start_dt=start_dt, end_dt=end_dt)
        if df is not None and not df.empty:
            # Filter out spring training — only keep regular season games
            if "game_type" in df.columns:
                before = len(df)
                df = df[df["game_type"] == "R"].copy()
                print(f"Filtered spring training: {before} → {len(df)} rows (regular season only).")
            _bulk_statcast_cache = df
            _bulk_statcast_date = cache_key
            print(f"{len(df)} rows loaded.")
            return df
    except Exception as e:
        print(f"FAILED ({e})")
    return pd.DataFrame()


def get_batter_statcast(player_id: int, lookback_days: int = None) -> pd.DataFrame:
    """Get batter data from bulk cache — no individual API call needed."""
    bulk = _bulk_statcast_cache
    if bulk is not None and not bulk.empty:
        return bulk[bulk["batter"] == player_id].copy()

    # Fallback to individual call if bulk not loaded
    if lookback_days is None:
        lookback_days = config.BATTER_LOOKBACK_DAYS
    end_dt = date.today().isoformat()
    start_dt = (date.today() - timedelta(days=lookback_days)).isoformat()
    time.sleep(1)
    try:
        df = statcast_batter(start_dt, end_dt, player_id)
        return df if df is not None else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


def get_pitcher_statcast(player_id: int, lookback_days: int = None) -> pd.DataFrame:
    """Get pitcher data from bulk cache — no individual API call needed."""
    bulk = _bulk_statcast_cache
    if bulk is not None and not bulk.empty:
        return bulk[bulk["pitcher"] == player_id].copy()

    # Fallback to individual call if bulk not loaded
    if lookback_days is None:
        lookback_days = config.PITCHER_LOOKBACK_DAYS
    end_dt = date.today().isoformat()
    start_dt = (date.today() - timedelta(days=lookback_days)).isoformat()
    time.sleep(1)
    try:
        df = statcast_pitcher(start_dt, end_dt, player_id)
        return df if df is not None else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


def load_bulk_2025() -> pd.DataFrame:
    """Load ALL 2025 season Statcast data in one pull. Much faster than per-player."""
    global _bulk_2025_cache
    if _bulk_2025_cache is not None:
        return _bulk_2025_cache

    dates = config.SEASON_DATES.get(2025)
    if not dates:
        return pd.DataFrame()

    from pybaseball import statcast
    print(f"  Loading bulk 2025 season data...", end=" ")
    try:
        df = statcast(start_dt=dates[0], end_dt=dates[1])
        if df is not None and not df.empty:
            if "game_type" in df.columns:
                # Include regular season + postseason (exclude spring training)
                df = df[df["game_type"].isin(["R", "F", "D", "L", "W"])].copy()
            _bulk_2025_cache = df
            print(f"{len(df)} rows loaded.")
            return df
    except Exception as e:
        print(f"FAILED ({e})")
    return pd.DataFrame()


def get_season_statcast(
    player_id: int, player_type: str, season: int
) -> pd.DataFrame:
    """
    Get full-season Statcast data for a player.
    For 2025: uses bulk cache (fast). For other seasons: per-player CSV cache.
    """
    # For 2025, use bulk cache — instant filter instead of slow CSV read
    if season == 2025 and _bulk_2025_cache is not None and not _bulk_2025_cache.empty:
        col = "batter" if player_type == "batter" else "pitcher"
        return _bulk_2025_cache[_bulk_2025_cache[col] == player_id].copy()

    # Fallback to per-player CSV cache for other seasons
    cache_dir = Path(config.STATCAST_CACHE_DIR)
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / f"{player_type}_{player_id}_{season}.csv"

    if cache_file.exists():
        age = time.time() - cache_file.stat().st_mtime
        if age < config.STATCAST_CACHE_TTL:
            try:
                return pd.read_csv(cache_file)
            except Exception:
                pass

    dates = config.SEASON_DATES.get(season)
    if not dates:
        return pd.DataFrame()
    start_dt = dates[0]
    end_dt = dates[1] or date.today().isoformat()

    time.sleep(1)
    try:
        if player_type == "pitcher":
            df = statcast_pitcher(start_dt, end_dt, player_id)
        else:
            df = statcast_batter(start_dt, end_dt, player_id)

        if df is not None and not df.empty:
            df.to_csv(cache_file, index=False)
            return df
    except Exception:
        pass
    return pd.DataFrame()


# ═══════════════════════════════════════════════════════════════════════════════
# The Odds API
# ═══════════════════════════════════════════════════════════════════════════════

def get_hr_prop_lines() -> list[dict]:
    """
    Fetch today's batter HR prop lines from The Odds API.

    Returns list of dicts:
        {
            "player_name": str,
            "over_odds": int | None,
            "under_odds": int | None,
            "point": float,
            "bookmaker": str,
            "event_home_team": str,
            "event_away_team": str,
        }
    """
    if not config.ODDS_API_KEY:
        print("[WARN] ODDS_API_KEY not set — skipping prop line fetch.")
        return []

    # Check cache
    cached = _read_odds_cache()
    if cached is not None:
        return cached

    # Step 1: get today's MLB events
    events_url = (
        f"{ODDS_API_BASE}/sports/baseball_mlb/events"
        f"?apiKey={config.ODDS_API_KEY}"
    )
    resp = requests.get(events_url, timeout=15)
    resp.raise_for_status()
    events = resp.json()

    all_props: list[dict] = []

    # Step 2: for each event, fetch HR prop odds
    for event in events:
        event_id = event["id"]
        home_team = event.get("home_team", "")
        away_team = event.get("away_team", "")

        odds_url = (
            f"{ODDS_API_BASE}/sports/baseball_mlb/events/{event_id}/odds"
            f"?apiKey={config.ODDS_API_KEY}"
            f"&regions=us&markets=batter_home_runs&oddsFormat=american"
        )
        try:
            odds_resp = requests.get(odds_url, timeout=15)
            odds_resp.raise_for_status()
            odds_data = odds_resp.json()
        except Exception:
            continue

        # Collect all odds per player per bookmaker
        # Filter: use preferred books if available, else fallbacks, always exclude bad ones
        all_bookmakers = odds_data.get("bookmakers", [])
        allowed_keys = set(config.PREFERRED_BOOKMAKERS + config.FALLBACK_BOOKMAKERS)
        excluded_keys = set(config.EXCLUDED_BOOKMAKERS)
        filtered_books = [
            b for b in all_bookmakers
            if b.get("key") not in excluded_keys
        ]
        # Prefer preferred books if any are present
        preferred = [b for b in filtered_books if b.get("key") in set(config.PREFERRED_BOOKMAKERS)]
        if preferred:
            filtered_books = preferred

        player_books: dict[str, list[dict]] = {}
        for bookmaker in filtered_books:
            book_name = bookmaker.get("title", "")
            for market in bookmaker.get("markets", []):
                if market.get("key") != "batter_home_runs":
                    continue
                # Parse this bookmaker's outcomes into per-player dicts
                book_players: dict[str, dict] = {}
                for outcome in market.get("outcomes", []):
                    player = outcome.get("description", "")
                    if not player:
                        continue
                    if player not in book_players:
                        book_players[player] = {
                            "over": None, "under": None,
                            "point": outcome.get("point", 0.5),
                            "book": book_name,
                        }
                    if outcome.get("name") == "Over":
                        book_players[player]["over"] = outcome.get("price")
                    elif outcome.get("name") == "Under":
                        book_players[player]["under"] = outcome.get("price")

                for player, bdata in book_players.items():
                    player_books.setdefault(player, []).append(bdata)

        # For each player, pick the best line:
        # 1. Prefer books with both over AND under (proper two-sided line)
        # 2. Among those, pick the best (highest) over odds
        # 3. Fall back to one-sided if no two-sided lines exist
        for player, books in player_books.items():
            two_sided = [b for b in books if b["over"] is not None and b["under"] is not None]
            candidates = two_sided if two_sided else books

            best_over = None
            best_over_book = ""
            best_under = None
            best_under_book = ""
            point = 0.5

            for b in candidates:
                if b["over"] is not None and (best_over is None or b["over"] > best_over):
                    best_over = b["over"]
                    best_over_book = b["book"]
                    point = b["point"]
                if b["under"] is not None and (best_under is None or b["under"] > best_under):
                    best_under = b["under"]
                    best_under_book = b["book"]

            all_props.append({
                "player_name": player,
                "over_odds": best_over,
                "under_odds": best_under,
                "over_book": best_over_book,
                "under_book": best_under_book,
                "point": point,
                "event_home_team": home_team,
                "event_away_team": away_team,
                "books_count": len(books),
            })

        time.sleep(0.5)  # be polite to the API

    _write_odds_cache(all_props)
    return all_props


def _read_odds_cache() -> Optional[list[dict]]:
    """Return cached odds if the cache file exists and is fresh."""
    if not ODDS_CACHE_FILE.exists():
        return None
    try:
        with open(ODDS_CACHE_FILE) as f:
            cache = json.load(f)
        ts = cache.get("timestamp", 0)
        if time.time() - ts < config.ODDS_CACHE_TTL:
            return cache.get("data", [])
    except Exception:
        pass
    return None


def _write_odds_cache(data: list[dict]) -> None:
    """Write odds data to cache file."""
    with open(ODDS_CACHE_FILE, "w") as f:
        json.dump({"timestamp": time.time(), "data": data}, f)


# ═══════════════════════════════════════════════════════════════════════════════
# Player ID Resolution
# ═══════════════════════════════════════════════════════════════════════════════

def resolve_player_id(player_name: str) -> Optional[int]:
    """
    Resolve an Odds API player name to an MLBAM player ID.

    Uses MLB Stats API search endpoint (fast, handles accents/suffixes).
    Falls back to pybaseball fuzzy lookup if needed.
    Caches results to avoid repeated lookups.
    """
    if player_name in _player_id_cache:
        return _player_id_cache[player_name]

    # Try MLB Stats API search first (fast and reliable)
    mlbam_id = _search_mlb_api(player_name)
    if mlbam_id:
        _player_id_cache[player_name] = mlbam_id
        return mlbam_id

    # Fallback: pybaseball lookup
    mlbam_id = _pybaseball_lookup(player_name)
    _player_id_cache[player_name] = mlbam_id
    return mlbam_id


def _search_mlb_api(player_name: str) -> Optional[int]:
    """Search for a player using the MLB Stats API search endpoint."""
    try:
        # Clean the name for search
        clean = player_name.strip()
        url = (
            f"{MLB_API_BASE}/people/search"
            f"?names={requests.utils.quote(clean)}"
            f"&sportIds=1&active=true&hydrate=currentTeam"
        )
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        rows = resp.json().get("people", [])

        if not rows:
            # Try without suffix
            suffixes = {"jr.", "jr", "sr.", "sr", "ii", "iii", "iv"}
            parts = clean.split()
            clean_parts = [p for p in parts if p.lower().rstrip(".") not in suffixes]
            if len(clean_parts) != len(parts) and len(clean_parts) >= 2:
                fallback_name = " ".join(clean_parts)
                url2 = (
                    f"{MLB_API_BASE}/people/search"
                    f"?names={requests.utils.quote(fallback_name)}"
                    f"&sportIds=1&active=true&hydrate=currentTeam"
                )
                resp2 = requests.get(url2, timeout=10)
                resp2.raise_for_status()
                rows = resp2.json().get("people", [])

        if rows:
            # Pick the best match — prefer active MLB players
            for person in rows:
                if person.get("active", False):
                    pid = person["id"]
                    # Cache the full person info too
                    _player_info_cache[pid] = person
                    return pid
            # If no active player, take first result
            pid = rows[0]["id"]
            _player_info_cache[pid] = rows[0]
            return pid
    except Exception:
        pass
    return None


def _pybaseball_lookup(player_name: str) -> Optional[int]:
    """Fallback player lookup via pybaseball."""
    parts = player_name.strip().split()
    suffixes = {"jr.", "jr", "sr.", "sr", "ii", "iii", "iv"}
    clean_parts = [p for p in parts if p.lower().rstrip(".") not in suffixes]

    if len(clean_parts) < 2:
        return None

    first = clean_parts[0]
    last = " ".join(clean_parts[1:])

    try:
        results = playerid_lookup(last, first, fuzzy=True)
        if results is None or results.empty:
            return None
        if "mlb_played_last" in results.columns:
            results = results.sort_values("mlb_played_last", ascending=False)
        return int(results.iloc[0]["key_mlbam"])
    except Exception:
        return None


def find_batter_game(
    batter_id: int, schedule: list[dict]
) -> Optional[dict]:
    """
    Given a batter ID, find which game they're in today and return
    the opposing pitcher info.

    Returns:
        {
            "game_pk": int,
            "opposing_pitcher": {"id": int, "name": str, "hand": str},
            "batter_side": "home" | "away",
        }
    or None if the batter's team isn't playing.
    """
    team_id = get_batter_team_id(batter_id)
    if team_id is None:
        return None

    for game in schedule:
        if team_id == game.get("home_team_id"):
            pitcher = game.get("away_pitcher")
            if pitcher:
                return {
                    "game_pk": game["game_pk"],
                    "opposing_pitcher": pitcher,
                    "batter_side": "home",
                }
        elif team_id == game.get("away_team_id"):
            pitcher = game.get("home_pitcher")
            if pitcher:
                return {
                    "game_pk": game["game_pk"],
                    "opposing_pitcher": pitcher,
                    "batter_side": "away",
                }
    return None
