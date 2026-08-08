"""NFL Anytime-TD model config — weights & calibration constants.

Kept separate from model.py so tuning is one file (mirrors the MLB config.py).
"""
from __future__ import annotations

# Positions we score for Anytime TD.
SCORING_POSITIONS = ("WR", "RB", "TE", "FB", "QB")

# Red-zone / goal-line yardlines (yards from the end zone).
RZ_YARDLINE = 20
INSIDE_10 = 10

# Player's slice of team TDs = blend of red-zone-opportunity share and their
# actual share of team TDs so far. RZ-opportunity share is more predictive, so
# it's weighted higher.
SHARE_RZ_WEIGHT = 0.60
SHARE_TD_WEIGHT = 0.40

# Implied team total (points) -> expected offensive TDs for the game.
# ~24 implied points => ~3.1 expected TDs (rest is FGs/ST). Linear, clamped.
TD_PER_POINT = 1.0 / 6.6
TD_POINT_BASELINE = 3.5           # points assumed non-TD (a FG + noise)
EXP_TEAM_TDS_MIN = 0.5
EXP_TEAM_TDS_MAX = 4.5

# ── Depth roles (usage-based) ────────────────────────────────────────────────
# Players are ranked within (team, position) by season usage and bucketed into a
# depth role. Tier caps keep buckets from getting too sparse — anyone past the
# last explicit tier is lumped into the "+" bucket. WR ranked by targets, RB by
# touches (carries+targets), TE by targets, QB is a single role.
ROLE_TIERS = {
    "WR": ["WR1", "WR2", "WR3"],
    "RB": ["RB1", "RB2"],
    "TE": ["TE1", "TE2"],
    "QB": ["QB"],
}
# Players ranked deeper than the last tier (WR4+, RB3+, TE3+, backup QBs, FBs)
# get NO role and are dropped from the slate — only the role-holders above show.

# ── Defense-vs-ROLE vulnerability (TD-weighted blend) ─────────────────────────
# Per (defense, role) we blend three per-game rates allowed — TDs, yards,
# opportunities (targets+carries) — each normalized within the role across the 32
# defenses, weighted toward TDs (this is an Anytime-TD board).
DVP_TD_WEIGHT = 0.60
DVP_YDS_WEIGHT = 0.25
DVP_OPP_WEIGHT = 0.15

# Small-sample stabilizer: a role's vulnerability is regressed toward its parent
# position's vulnerability. Weight on the role signal = n / (n + PRIOR), where n
# is the (defense, role) TDs-allowed count. Bigger PRIOR = more regression.
DVP_REGRESSION_PRIOR = 4.0

# Role-DvP multiplier clamp — WIDER than a position mult so the matchup leads the
# ranking (#32-vs-role softness should swing the score meaningfully).
DVP_MULT_MIN = 0.55
DVP_MULT_MAX = 1.90

# Usage gate: below this red-zone-opportunity share the score is scaled down
# (a great matchup can't float a 4%-share player to the top). Only bites below
# the floor; at/above it the gate is 1.0.
USAGE_FLOOR = 0.07

NUM_TEAMS = 32

# A player needs at least this many games of usage to be scored (kills flukes).
MIN_GAMES = 2

# "Recent form" hit-rate window (games).
FORM_GAMES = 5

# Weight of inside-10 carries vs a normal RZ opportunity when computing a
# player's RZ-opportunity share (goal-line carries are the highest-value touch).
INSIDE_10_WEIGHT = 1.5
