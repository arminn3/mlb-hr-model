import os
from dotenv import load_dotenv

load_dotenv()

# ── API Keys ─────────────────────────────────────────────────────────────────
ODDS_API_KEY: str = os.getenv("ODDS_API_KEY", "")

# ── Lookback Windows ─────────────────────────────────────────────────────────
BATTER_LOOKBACK_DAYS: int = 60
PITCHER_LOOKBACK_DAYS: int = 120

# ── Pitch Mix Thresholds ─────────────────────────────────────────────────────
PITCH_MIN_USAGE_PCT: float = 0.12      # ignore pitches below 12% usage
PITCH_ELEVATED_USAGE_PCT: float = 0.45  # pitches at 45%+ get elevated weight

# ── Plate Appearance Sample Size ─────────────────────────────────────────────
MIN_PA_PER_PITCH_TYPE: int = 5  # last N total BIP (balls in play) vs pitcher hand
LOOKBACK_WINDOWS: list = [5, 10]  # pre-compute scores at each lookback

# ── Pitch Usage Weight Tiers ─────────────────────────────────────────────────
# Checked top-down: first matching threshold wins.
# (min_usage, multiplier)
PITCH_WEIGHT_TIERS: list = [
    (0.45, 2.0),   # 45%+ → dominant pitch, 2x weight
    (0.25, 1.3),   # 25-44% → significant pitch, 1.3x weight
    (0.12, 1.0),   # 12-24% → baseline
    # <12% → dropped entirely in get_pitch_mix()
]

# ── Batter Metric Weights (sum to 1.0) ──────────────────────────────────────
# Fly ball rate and barrel rate weighted highest — HRs need the ball airborne
# with power behind it.
BATTER_WEIGHTS: dict = {
    "avg_exit_velo": 0.15,
    "barrel_rate": 0.30,
    "fly_ball_rate": 0.35,
    "hard_hit_rate": 0.20,
}

# ── Pitcher Metric Weights (sum to 1.0) ─────────────────────────────────────
PITCHER_WEIGHTS: dict = {
    "fb_rate_allowed": 0.25,
    "hr_per_fb_rate": 0.40,
    "hr_per_ip": 0.20,
    "total_hrs_norm": 0.15,
}

# ── Composite Blend ──────────────────────────────────────────────────────────
# Default weights — overridden by ML weights if available
_DEFAULT_WEIGHTS = {
    "batter": 0.45,
    "matchup": 0.25,
    "pitcher": 0.20,
    "environment": 0.10,
}

def _load_ml_weights() -> dict:
    """Load ML-learned weights if available, otherwise use defaults."""
    import json
    from pathlib import Path
    ml_file = Path("results/ml_weights.json")
    if ml_file.exists():
        try:
            with open(ml_file) as f:
                weights = json.load(f)
            # Validate they sum to ~1.0
            total = sum(weights.values())
            if 0.95 <= total <= 1.05:
                return weights
        except Exception:
            pass
    return _DEFAULT_WEIGHTS

_ACTIVE_WEIGHTS = _load_ml_weights()
BATTER_COMPOSITE_WEIGHT: float = _ACTIVE_WEIGHTS["batter"]
MATCHUP_QUALITY_WEIGHT: float = _ACTIVE_WEIGHTS["matchup"]
PITCHER_COMPOSITE_WEIGHT: float = _ACTIVE_WEIGHTS["pitcher"]
ENVIRONMENT_COMPOSITE_WEIGHT: float = _ACTIVE_WEIGHTS["environment"]

# ── Statcast Constants ───────────────────────────────────────────────────────
BARREL_VALUE: int = 6              # launch_speed_angle == 6 means barrel
FLY_BALL_LA_MIN: float = 25.0     # launch angle range for fly balls
FLY_BALL_LA_MAX: float = 50.0
HARD_HIT_THRESHOLD: float = 95.0  # mph exit velo for "hard hit"

# ── Normalization Ranges (for 0-1 scaling) ───────────────────────────────────
# Fixed empirical ranges so scores are comparable day-to-day.
NORM_RANGES: dict = {
    "avg_exit_velo": (80.0, 100.0),
    "barrel_rate": (0.0, 0.25),
    "fly_ball_rate": (0.15, 0.55),
    "hard_hit_rate": (0.20, 0.65),
    # Pitcher vulnerability ranges calibrated to MLB averages:
    # League avg FB% (bb_type) ~12%, HR/FB ~12%, HR/9 ~1.2
    # Ranges set so league avg = ~0.5, vulnerable (15%+ HR/FB) = 0.65+
    "fb_rate_allowed": (0.04, 0.20),    # 12% avg -> 0.50, 16%+ -> 0.75
    "hr_per_fb_rate": (0.0, 0.24),      # 12% avg -> 0.50, 18%+ -> 0.75
    "hr_per_ip": (0.0, 2.4),            # 1.2 avg -> 0.50, 1.8+ -> 0.75
    "total_hrs_norm": (0.0, 0.5),       # scaled tighter so HR count matters more
}

# ── Fuzzy Match Threshold ────────────────────────────────────────────────────
FUZZY_MATCH_SCORE: int = 85

# ── Allowed Bookmakers (Odds API key names) ──────────────────────────────────
# Preferred books — if available, only use these
PREFERRED_BOOKMAKERS: list = [
    "fanduel",
    "draftkings",
    "fanatics",
    "betmgm",
    "bet365",
]
# Free tier fallbacks — used when preferred books aren't available
FALLBACK_BOOKMAKERS: list = [
    "bovada",        # most mainstream of the free-tier books
    "betonlineag",
]
# Books to always exclude (unreliable one-sided lines)
EXCLUDED_BOOKMAKERS: list = [
    "betrivers",
]

# ── Environment Weights (sum to 1.0) ─────────────────────────────────────────
ENVIRONMENT_WEIGHTS: dict = {
    "park_factor": 0.30,    # was 0.50 — important but weather should matter more
    "temperature": 0.20,    # warm air = lower density = more carry
    "wind_score": 0.30,     # wind is the #1 game-day variable for HRs
    "humidity": 0.10,       # humid air is slightly less dense
    "pressure": 0.10,       # lower pressure = thinner air = more carry
}

# ── Park HR Factors (100 = neutral) ──────────────────────────────────────────
# Source: Baseball Savant Statcast park factors + FanGraphs/FantasyPros 2026
# KC updated for 2026 dimension changes (fences moved in 8-10 ft, walls lowered)
# Format: {"overall": X, "L": X, "R": X} — L = left-handed batters, R = right-handed
# LHB pull to right field, RHB pull to left field — short porches matter differently
PARK_HR_FACTORS: dict = {
    "LAD": {"overall": 137, "L": 140, "R": 134},
    "CIN": {"overall": 116, "L": 120, "R": 112},
    "NYY": {"overall": 117, "L": 130, "R": 105},  # short RF porch = huge LHB boost
    "BAL": {"overall": 110, "L": 115, "R": 106},
    "PHI": {"overall": 115, "L": 118, "R": 112},
    "HOU": {"overall": 112, "L": 110, "R": 114},
    "LAA": {"overall": 111, "L": 108, "R": 114},
    "TOR": {"overall": 109, "L": 112, "R": 106},
    "SDP": {"overall": 109, "L": 106, "R": 112},
    "COL": {"overall": 115, "L": 118, "R": 112},
    "NYM": {"overall": 105, "L": 103, "R": 107},
    "MIL": {"overall": 104, "L": 108, "R": 100},
    "DET": {"overall": 102, "L": 100, "R": 104},
    "MIN": {"overall": 100, "L": 98,  "R": 102},
    "CWS": {"overall": 96,  "L": 94,  "R": 98},
    "CLE": {"overall": 96,  "L": 98,  "R": 94},
    "ATL": {"overall": 95,  "L": 93,  "R": 97},
    "CHC": {"overall": 95,  "L": 100, "R": 90},   # wind-dependent, LHB slight edge
    "SEA": {"overall": 94,  "L": 90,  "R": 98},
    "ARI": {"overall": 92,  "L": 94,  "R": 90},   "AZ": {"overall": 92, "L": 94, "R": 90},
    "MIA": {"overall": 91,  "L": 88,  "R": 94},
    "WSH": {"overall": 91,  "L": 93,  "R": 89},
    "TEX": {"overall": 91,  "L": 89,  "R": 93},
    "BOS": {"overall": 87,  "L": 80,  "R": 95},   # Green Monster helps RHB, hurts LHB
    "STL": {"overall": 78,  "L": 76,  "R": 80},
    "KC":  {"overall": 90,  "L": 92,  "R": 88},   # 2026 new dimensions
    "PIT": {"overall": 66,  "L": 62,  "R": 70},
    "SF":  {"overall": 75,  "L": 70,  "R": 80},   # triples alley kills LHB power
    "TB":  {"overall": 95,  "L": 93,  "R": 97},
    "OAK": {"overall": 108, "L": 110, "R": 106},  # Sutter Health Park 2026
}

# ── Stadium Coordinates ──────────────────────────────────────────────────────
STADIUM_COORDS: dict = {
    "BAL": (39.2842, -76.6224), "BOS": (42.3463, -71.0958),
    "NYY": (40.8297, -73.9262), "TB":  (27.7683, -82.6540),
    "TOR": (43.6418, -79.3901), "CWS": (41.8300, -87.6346),
    "CLE": (41.4963, -81.6860), "DET": (42.3384, -83.0481),
    "KC":  (39.0519, -94.4807), "MIN": (44.9821, -93.2784),
    "HOU": (29.7570, -95.3562), "LAA": (33.8006, -117.8834),
    "OAK": (37.7515, -122.2007),"SEA": (47.5915, -122.3329),
    "TEX": (32.7478, -97.0840), "ATL": (33.8908, -84.4682),
    "MIA": (25.7783, -80.2204), "NYM": (40.7573, -73.8462),
    "PHI": (39.9062, -75.1675), "WSH": (38.8731, -77.0080),
    "CHC": (41.9477, -87.6560), "CIN": (39.0975, -84.5071),
    "MIL": (43.0280, -87.9715), "PIT": (40.4471, -80.0064),
    "STL": (38.6226, -90.1928), "ARI": (33.4456, -112.0674), "AZ": (33.4456, -112.0674),
    "COL": (39.7562, -104.9949),"LAD": (34.0738, -118.2408),
    "SDP": (32.7075, -117.1575),"SF":  (37.7786, -122.3897),
}

# ── Environment Normalization ────────────────────────────────────────────────
NORM_RANGES_ENV: dict = {
    "park_factor": (80.0, 120.0),     # narrower range — less extreme scaling
    "temperature": (40.0, 95.0),      # cold to hot (Fahrenheit)
    "wind_score": (-15.0, 15.0),      # headwind to tailwind (mph)
    "humidity": (20.0, 90.0),         # dry to humid (%)
    "pressure": (1030.0, 980.0),      # inverted: lower pressure = higher score
}

# ── Season Dates ─────────────────────────────────────────────────────────────
SEASON_DATES: dict = {
    2025: ("2025-03-27", "2025-09-28"),
    2026: ("2026-03-26", None),  # None = use today's date
}

# ── Statcast Cache ───────────────────────────────────────────────────────────
STATCAST_CACHE_DIR: str = "statcast_cache"
STATCAST_CACHE_TTL: int = 21600  # 6 hours

# ── Odds API Cache TTL (seconds) ─────────────────────────────────────────────
ODDS_CACHE_TTL: int = 7200  # 2 hours
