"""Phase 1 NFL data spike — prove we can derive the Anytime-TD inputs from
nflverse (PBP + snap counts) on the completed 2025 season, and sanity-check the
numbers against known reality.

Derives, per the plan:
  1. Red-zone pass/rush% per team          (RZ tendency — the offense side)
  2. Defense-vs-position TD rate allowed     (DvP — the matchup side)
  3. Per-player red-zone usage               (RZ targets, inside-10 carries,
     air yards, snap share — the volume side)

Run:  python3 -m nfl.spike_2025   (or  python3 nfl/spike_2025.py)
No UI, no scoring — just validation that the pipeline is real.
"""
from __future__ import annotations

import warnings
warnings.filterwarnings("ignore")

import pandas as pd

try:
    from .data_fetchers import load_pbp, load_snap_counts, load_players
except ImportError:  # allow running as a plain script
    from data_fetchers import load_pbp, load_snap_counts, load_players

YEAR = 2025
SCORING_POS = ("WR", "RB", "TE", "FB", "QB")


def _hr(title: str) -> None:
    print("\n" + "=" * 72 + f"\n{title}\n" + "=" * 72)


def main() -> None:
    print(f"Loading {YEAR} nflverse data (cached to nfl_cache/ after first pull)…")
    pbp = load_pbp(YEAR)
    reg = pbp[pbp["season_type"] == "REG"].copy()
    print(f"  {len(pbp)} plays ({len(reg)} regular-season)")

    players = load_players()[["gsis_id", "position"]].dropna(subset=["gsis_id"])
    pos_map = dict(zip(players["gsis_id"], players["position"]))

    # ── 1. Red-zone tendencies (offense) ────────────────────────────────────
    rz = reg[(reg["yardline_100"] <= 20) & (reg["play_type"].isin(["pass", "run"]))].copy()
    rz["is_pass"] = (rz["play_type"] == "pass").astype(int)
    tend = rz.groupby("posteam")["is_pass"].agg(plays="count", pass_rate="mean")
    tend = tend[tend["plays"] >= 30]
    tend["pass_pct"] = (tend["pass_rate"] * 100).round(1)
    _hr("1. RED-ZONE PASS RATE (top 5 pass-heavy vs top 5 run-heavy)")
    top = tend.sort_values("pass_pct", ascending=False)
    print("  Most pass-heavy in RZ:")
    for team, r in top.head(5).iterrows():
        print(f"    {team:4} {r['pass_pct']:.0f}% pass  ({int(r['plays'])} RZ plays)")
    print("  Most run-heavy in RZ:")
    for team, r in top.tail(5)[::-1].iterrows():
        print(f"    {team:4} {r['pass_pct']:.0f}% pass / {100-r['pass_pct']:.0f}% rush  ({int(r['plays'])} RZ plays)")

    # ── 2. Defense-vs-position: offensive TDs allowed by position ────────────
    ptd = reg[reg["pass_touchdown"] == 1][["defteam", "receiver_player_id"]].rename(
        columns={"receiver_player_id": "scorer"})
    rtd = reg[reg["rush_touchdown"] == 1][["defteam", "rusher_player_id"]].rename(
        columns={"rusher_player_id": "scorer"})
    tds = pd.concat([ptd, rtd], ignore_index=True).dropna(subset=["scorer", "defteam"])
    tds["position"] = tds["scorer"].map(pos_map)
    tds = tds[tds["position"].isin(SCORING_POS)]
    dvp = tds.groupby(["defteam", "position"]).size().rename("tds_allowed").reset_index()
    _hr("2. DEFENSE-vs-POSITION — most TDs allowed (softest matchups) per position")
    for pos in ("WR", "RB", "TE"):
        sub = dvp[dvp["position"] == pos].sort_values("tds_allowed", ascending=False)
        worst = ", ".join(f"{r.defteam}({int(r.tds_allowed)})" for r in sub.head(5).itertuples())
        best = ", ".join(f"{r.defteam}({int(r.tds_allowed)})" for r in sub.tail(3).itertuples())
        print(f"  vs {pos}:  softest → {worst}")
        print(f"           toughest → {best}")

    # ── 3. Per-player red-zone usage (volume) ───────────────────────────────
    rec = reg[reg["receiver_player_id"].notna()]
    rush = reg[reg["rusher_player_id"].notna()]
    rz_tgt = (rec[rec["yardline_100"] <= 20]
              .groupby(["receiver_player_id", "receiver_player_name"]).size()
              .rename("rz_targets").reset_index())
    in10 = (rush[rush["yardline_100"] <= 10]
            .groupby(["rusher_player_id", "rusher_player_name"]).size()
            .rename("inside10_carries").reset_index())
    air = rec.groupby("receiver_player_name")["air_yards"].sum().rename("air_yards")

    _hr("3. PLAYER RED-ZONE USAGE (2025 regular season)")
    print("  Top 10 red-zone target leaders:")
    for r in rz_tgt.sort_values("rz_targets", ascending=False).head(10).itertuples():
        pos = pos_map.get(r.receiver_player_id, "?")
        ay = air.get(r.receiver_player_name, 0)
        print(f"    {r.receiver_player_name:22} {pos:3} {int(r.rz_targets):3} RZ tgts   {int(ay):>5} air yds")
    print("  Top 10 inside-the-10 carry leaders (goal-line backs):")
    for r in in10.sort_values("inside10_carries", ascending=False).head(10).itertuples():
        pos = pos_map.get(r.rusher_player_id, "?")
        print(f"    {r.rusher_player_name:22} {pos:3} {int(r.inside10_carries):3} carries inside 10")

    # ── snap share (proves the snap source works) ───────────────────────────
    snaps = load_snap_counts(YEAR)
    snaps_reg = snaps[snaps.get("game_type", "REG") == "REG"] if "game_type" in snaps else snaps
    off = (snaps_reg[snaps_reg["position"].isin(SCORING_POS)]
           .groupby(["player", "position"])["offense_pct"].mean().rename("snap_pct").reset_index())
    _hr("SNAP SHARE (top 8 offensive snap% among skill players, season avg)")
    for r in off.sort_values("snap_pct", ascending=False).head(8).itertuples():
        print(f"    {r.player:22} {r.position:3} {r.snap_pct*100:.0f}% offensive snaps")

    print("\n✅ Spike complete — all four inputs derived from nflverse 2025 data.")


if __name__ == "__main__":
    main()
