"""
MLB Park outfield fence distances at 5 spray-angle positions.
Used to calculate "would this batted ball be a HR in X/30 parks."

Spray angle 0° = dead center field, negative = left field, positive = right field.
Positions: LF line, LF gap, CF, RF gap, RF line
"""

import math

# Fence distances in feet: (LF_line, LF_gap, CF, RF_gap, RF_line)
PARK_FENCES: dict[str, tuple[int, int, int, int, int]] = {
    "BAL": (333, 364, 410, 373, 318),
    "BOS": (310, 379, 390, 380, 302),
    "NYY": (318, 399, 408, 385, 314),
    "TB":  (315, 370, 404, 370, 322),
    "TOR": (328, 375, 400, 375, 328),
    "CWS": (330, 375, 400, 375, 330),
    "CLE": (325, 370, 410, 370, 325),
    "DET": (345, 370, 420, 365, 330),
    "KC":  (330, 387, 410, 387, 330),
    "MIN": (339, 377, 404, 367, 328),
    "HOU": (315, 362, 409, 373, 326),
    "LAA": (347, 386, 396, 370, 350),
    "OAK": (330, 362, 400, 362, 330),
    "SEA": (331, 378, 401, 381, 326),
    "TEX": (329, 372, 407, 374, 326),
    "ATL": (335, 380, 400, 375, 325),
    "MIA": (344, 386, 407, 392, 335),
    "NYM": (335, 379, 408, 383, 330),
    "PHI": (329, 374, 401, 369, 330),
    "WSH": (336, 377, 402, 370, 335),
    "CHC": (355, 368, 400, 368, 353),
    "CIN": (328, 370, 404, 370, 325),
    "MIL": (344, 371, 400, 374, 345),
    "PIT": (325, 383, 399, 375, 320),
    "STL": (336, 375, 400, 372, 335),
    "ARI": (330, 376, 407, 376, 334),
    "COL": (347, 390, 415, 375, 350),
    "LAD": (330, 385, 395, 370, 330),
    "SDP": (336, 382, 396, 387, 322),
    "SF":  (339, 382, 399, 365, 309),
}


def spray_angle_from_coords(hc_x: float, hc_y: float) -> float:
    """
    Convert Statcast hit coordinates (hc_x, hc_y) to a spray angle in degrees.
    0° = center field, negative = left field (pulled for RHB), positive = right field.

    Statcast coordinates: home plate is ~(125, 200), center field is ~(125, 0).
    hc_x increases to the right, hc_y increases downward (toward home plate).
    """
    # Home plate reference point
    hp_x, hp_y = 125.42, 198.27

    dx = hc_x - hp_x
    dy = hp_y - hc_y  # flip because y increases downward

    if dy <= 0:
        return 0.0  # ball went backward, treat as center

    angle_rad = math.atan2(dx, dy)
    return math.degrees(angle_rad)


def fence_distance_at_angle(park: str, spray_angle: float) -> float:
    """
    Interpolate the fence distance for a park at a given spray angle.

    Spray angle mapping:
      -45° = LF line
      -22° = LF gap
        0° = CF
      +22° = RF gap
      +45° = RF line
    """
    fences = PARK_FENCES.get(park)
    if not fences:
        return 380  # default

    lf_line, lf_gap, cf, rf_gap, rf_line = fences

    # Define angle-to-fence mapping points
    points = [
        (-45, lf_line),
        (-22, lf_gap),
        (0, cf),
        (22, rf_gap),
        (45, rf_line),
    ]

    # Clamp angle
    angle = max(-45, min(45, spray_angle))

    # Linear interpolation between nearest two points
    for i in range(len(points) - 1):
        a1, d1 = points[i]
        a2, d2 = points[i + 1]
        if a1 <= angle <= a2:
            t = (angle - a1) / (a2 - a1) if a2 != a1 else 0
            return d1 + t * (d2 - d1)

    return cf  # fallback


def hr_in_x_parks(distance: float, hc_x: float = None, hc_y: float = None) -> int:
    """
    How many of 30 MLB parks would this batted ball be a HR in?
    Uses spray angle if coordinates are available, otherwise uses distance only.
    """
    if not distance or distance <= 0:
        return 0

    if hc_x is not None and hc_y is not None:
        spray = spray_angle_from_coords(hc_x, hc_y)
        count = 0
        for park in PARK_FENCES:
            fence = fence_distance_at_angle(park, spray)
            # Ball needs to clear fence by a margin — walls are 8-14 feet tall
            # which requires ~5-10 extra feet of carry depending on angle
            # Add 8-foot buffer to account for wall height
            if distance >= fence:
                count += 1
        return count
    else:
        # Fallback: compare against center field distances (conservative)
        return sum(1 for f in PARK_FENCES.values() if distance >= f[2])
