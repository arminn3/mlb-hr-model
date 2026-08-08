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

# Defense-vs-position multiplier: opponent's TDs-allowed-to-position rate vs the
# league average for that position. Clamped so one soft/tough game can't dominate.
DVP_MULT_MIN = 0.60
DVP_MULT_MAX = 1.60

# A player needs at least this many games of usage to be scored (kills flukes).
MIN_GAMES = 2

# "Recent form" hit-rate window (games).
FORM_GAMES = 5

# Weight of inside-10 carries vs a normal RZ opportunity when computing a
# player's RZ-opportunity share (goal-line carries are the highest-value touch).
INSIDE_10_WEIGHT = 1.5
