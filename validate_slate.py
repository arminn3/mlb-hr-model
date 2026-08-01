#!/usr/bin/env python3
"""
Slate data-integrity validator.

Automated accuracy check for a generated slate JSON. Two layers:

  1. INTERNAL checks (fast, no network) — run on EVERY batter, every regen.
     Catch the bug classes we've actually hit:
       - arsenal leak     : a batted ball off a pitch the opposing pitcher
                            doesn't throw (the sweeper/slider contamination)
       - stat mismatch    : displayed barrel%/HH%/FB%/EV don't match a
                            recompute over the exact at-bats shown
       - bad values       : EV / LA / rates / composite out of physical range
       - missing fields   : recent_abs rows missing ev / angle / lsa / etc.
       - hand purity      : default matchup pool has a wrong-handed pitcher
       - thin depth       : a batter with games but a suspiciously small pool

  2. LIVE Statcast cross-check (network, sampled) — proves we're pulling the
     correct at-bats from Statcast: for a random sample of batters, pull their
     Statcast fresh and confirm our recent_abs are the real last-N BBE vs the
     opposing hand off the pitcher's arsenal (dates + EV + results line up).

Usage:
    python validate_slate.py --date 2026-07-31
    python validate_slate.py --date 2026-07-31 --live 8    # + cross-check 8 batters
    python validate_slate.py --file frontend/public/data/latest.json

Exit code 0 = clean, 1 = failures found (so a pipeline/cron can gate on it).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import date
from pathlib import Path

# Statcast pitch_name -> code, so a batted ball's pitch_type (a name) can be
# checked against the pitcher's arsenal (keyed by code in pitch_detail).
PITCH_NAME_TO_CODE = {
    "4-Seam Fastball": "FF", "Four-Seam Fastball": "FF", "Sinker": "SI",
    "Cutter": "FC", "Changeup": "CH", "Curveball": "CU", "Knuckle Curve": "KC",
    "Slider": "SL", "Sweeper": "ST", "Slurve": "SV", "Split-Finger": "FS",
    "Splitter": "FS", "Forkball": "FO", "Knuckleball": "KN", "Eephus": "EP",
    "Slow Curve": "CS", "Screwball": "SC",
}

# Tolerances for the stat-vs-pool recompute (percentage points / mph).
RATE_TOL = 1.1   # barrel%/HH%/FB% — allow rounding of one AB in a 10-ball pool
EV_TOL = 0.6     # avg EV mph


class Report:
    """Collects findings by severity. ERROR fails the run; WARN is advisory."""
    def __init__(self):
        self.errors: list[str] = []
        self.warns: list[str] = []
        self.checked = 0

    def error(self, msg: str):
        self.errors.append(msg)

    def warn(self, msg: str):
        self.warns.append(msg)


def _recompute(abs_list: list[dict]) -> dict | None:
    """Recompute the displayed batter stats from the exact at-bats shown, using
    the SAME definitions as the app (barrel = lsa 6, HH = EV>=95, FB = standard
    fly LA 25-50 any EV, EV = mean). FB% and HH% are separate stats — FB is
    never EV-gated."""
    n = len(abs_list)
    if n == 0:
        return None
    ev_sum = brl = hh = fb = 0
    for a in abs_list:
        ev = float(a.get("ev") or 0)
        la = float(a.get("angle") or 0)
        ev_sum += ev
        if a.get("lsa") == 6:
            brl += 1
        if ev >= 95:
            hh += 1
        if 25 <= la <= 50:   # standard FB% — all flies, any EV (never EV-gated)
            fb += 1
    return {
        "exit_velo": round(ev_sum / n, 1),
        "barrel_pct": round(brl / n * 100, 1),
        "hard_hit_pct": round(hh / n * 100, 1),
        "fb_pct": round(fb / n * 100, 1),
    }


REQUIRED_AB_FIELDS = ("ev", "angle", "result", "pitch_type", "pitch_arm", "lsa")


def check_internal(data: dict, rep: Report) -> None:
    for game in data.get("games", []):
        for p in game.get("players", []):
            name = p.get("name", "?")
            arsenal = set((p.get("pitch_detail") or {}).keys())
            for lb in ("L5", "L10"):
                s = (p.get("scores") or {}).get(lb)
                if not s:
                    continue
                abs_list = s.get("recent_abs") or []
                if not abs_list:
                    continue
                rep.checked += 1

                # 1. Arsenal leak — every pitch must be one the pitcher throws.
                if arsenal:
                    for a in abs_list:
                        code = PITCH_NAME_TO_CODE.get(str(a.get("pitch_type")))
                        if code and code not in arsenal:
                            rep.error(f"[arsenal-leak] {name} {lb}: {a.get('pitch_type')} "
                                      f"({code}) not in arsenal {sorted(arsenal)} (date {a.get('date')})")
                            break

                # 2. Stat-vs-pool mismatch — displayed numbers must equal a
                #    recompute over the exact at-bats shown.
                rc = _recompute(abs_list)
                if rc:
                    for key, tol in (("exit_velo", EV_TOL), ("barrel_pct", RATE_TOL),
                                     ("hard_hit_pct", RATE_TOL), ("fb_pct", RATE_TOL)):
                        shown = s.get(key)
                        if shown is None:
                            continue
                        if abs(float(shown) - rc[key]) > tol:
                            rep.error(f"[stat-mismatch] {name} {lb} {key}: shown {shown} "
                                      f"vs recompute {rc[key]} over {len(abs_list)} ABs")

                # 3. Value ranges + 4. required fields.
                for a in abs_list:
                    for f in REQUIRED_AB_FIELDS:
                        if a.get(f) is None:
                            rep.warn(f"[missing-field] {name} {lb}: AB {a.get('date')} missing '{f}'")
                    ev = a.get("ev")
                    la = a.get("angle")
                    if ev is not None and not (0 <= float(ev) <= 125):
                        rep.error(f"[bad-ev] {name} {lb}: EV {ev} out of range (date {a.get('date')})")
                    if la is not None and not (-90 <= float(la) <= 90):
                        rep.error(f"[bad-la] {name} {lb}: LA {la} out of range (date {a.get('date')})")

                # 5. Hand purity — the default matchup pool should be the
                #    opposing pitcher's hand only.
                phand = p.get("pitcher_hand")
                if phand in ("L", "R"):
                    off = [a for a in abs_list if str(a.get("pitch_arm")) not in (phand, "")]
                    if off:
                        rep.warn(f"[hand-mix] {name} {lb}: {len(off)}/{len(abs_list)} ABs "
                                 f"not vs {phand}HP")

                # composite range
                comp = s.get("composite")
                if comp is not None and not (0 <= float(comp) <= 1.01):
                    rep.error(f"[bad-composite] {name} {lb}: composite {comp}")

            # 6. Thin depth — season_abs should carry real history per hand.
            sab = (p.get("season_profile") or {}).get("season_abs") or []
            if sab:
                by_hand: dict[str, int] = {}
                for a in sab:
                    by_hand[a.get("pitch_arm", "?")] = by_hand.get(a.get("pitch_arm", "?"), 0) + 1
                phand = p.get("pitcher_hand")
                if phand in ("L", "R") and by_hand.get(phand, 0) < 10 and len(sab) >= 20:
                    rep.warn(f"[thin-depth] {name}: only {by_hand.get(phand,0)} vs {phand}HP in season_abs")


def check_live(data: dict, sample: int, rep: Report) -> None:
    """Cross-check a random sample of batters against fresh Statcast."""
    try:
        import warnings
        warnings.filterwarnings("ignore")
        from pybaseball import statcast_batter, playerid_lookup
    except Exception as e:  # pragma: no cover
        rep.warn(f"[live] pybaseball unavailable ({e}); skipping cross-check")
        return

    players = [p for g in data.get("games", []) for p in g.get("players", [])
               if (p.get("scores") or {}).get("L10", {}).get("recent_abs")]
    random.shuffle(players)
    season = int(str(data.get("date", "2026"))[:4])
    checked = 0
    for p in players:
        if checked >= sample:
            break
        name = p.get("name", "")
        parts = name.replace(".", "").split()
        if len(parts) < 2:
            continue
        first, last = parts[0], parts[-1]
        try:
            lk = playerid_lookup(last, first)
            ids = lk[lk["key_mlbam"].notna()]["key_mlbam"].tolist() if lk is not None else []
            if len(ids) != 1:  # ambiguous / not found — skip, don't false-alarm
                continue
            bid = int(ids[0])
            df = statcast_batter(f"{season}-03-01", data.get("date"), bid)
        except Exception:
            continue
        if df is None or len(df) == 0:
            continue
        df = df[df["launch_speed"].notna()]
        phand = p.get("pitcher_hand")
        arsenal = set((p.get("pitch_detail") or {}).keys())
        pool = df[(df["p_throws"] == phand) & (df["pitch_type"].isin(arsenal))] if phand in ("L", "R") else df
        pool = pool.sort_values(["game_date"], ascending=False).head(10)
        our_abs = (p.get("scores") or {}).get("L10", {}).get("recent_abs", [])[:10]
        # Compare the SET of (date, rounded EV) — order/dupes aside — as a
        # robust "are these the same balls" signal.
        theirs = {(str(r.game_date)[:10], round(float(r.launch_speed), 0))
                  for r in pool.itertuples()}
        ours = {(str(a.get("date")), round(float(a.get("ev") or 0), 0)) for a in our_abs}
        overlap = len(ours & theirs)
        checked += 1
        if overlap < max(1, int(0.7 * len(ours))):  # <70% of our balls confirmed
            rep.error(f"[live-mismatch] {name}: only {overlap}/{len(ours)} of our L10 balls "
                      f"match a fresh Statcast pull (arsenal {sorted(arsenal)} vs {phand}HP)")
        else:
            rep.warn(f"[live-ok] {name}: {overlap}/{len(ours)} L10 balls confirmed vs Statcast")
    if checked == 0:
        rep.warn("[live] no batters could be id-resolved for cross-check")


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate a slate JSON for data integrity.")
    ap.add_argument("--date", type=str, default=None, help="slate date YYYY-MM-DD")
    ap.add_argument("--file", type=str, default=None, help="explicit slate JSON path")
    ap.add_argument("--live", type=int, default=0, help="cross-check N random batters vs live Statcast")
    args = ap.parse_args()

    path = Path(args.file) if args.file else Path(
        f"frontend/public/data/{(args.date or date.today().isoformat())}.json")
    if not path.exists():
        print(f"❌ slate not found: {path}")
        return 1

    data = json.loads(path.read_text())
    rep = Report()
    print(f"Validating {path.name} ({len(data.get('games', []))} games) …")
    check_internal(data, rep)
    if args.live > 0:
        print(f"Cross-checking {args.live} batters against live Statcast …")
        check_live(data, args.live, rep)

    print(f"\nInternal pools checked: {rep.checked}")
    if rep.warns:
        print(f"\n⚠️  {len(rep.warns)} warnings:")
        for w in rep.warns[:40]:
            print("   " + w)
        if len(rep.warns) > 40:
            print(f"   … and {len(rep.warns) - 40} more")
    if rep.errors:
        print(f"\n❌ {len(rep.errors)} ERRORS (data would be wrong on the site):")
        for e in rep.errors[:60]:
            print("   " + e)
        if len(rep.errors) > 60:
            print(f"   … and {len(rep.errors) - 60} more")
        print("\nFAILED — do not ship this slate until these are resolved.")
        return 1

    print("\n✅ PASSED — no data-integrity errors found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
