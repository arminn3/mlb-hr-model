"""NFL Anytime-TD model.

For every skill player in a week's games, estimate P(scores a TD). The model
is deliberately explainable — display == score, same discipline as the MLB side:

  expected_team_TDs   = f(implied team total)          # game environment
  player_TD_share     = 0.6*RZ-opportunity share + 0.4*actual team-TD share
  dvp_mult            = opponent TDs-allowed-to-position vs league avg
  expected_player_TDs = expected_team_TDs * player_TD_share * dvp_mult
  anytime_TD_prob     = 1 - exp(-expected_player_TDs)  # Poisson P(>=1)

All inputs derived from nflverse PBP for the season up to (not including) the
target week — i.e. only information available before kickoff. Empirical Anytime-
TD hit rate (season + last-5) is carried alongside as the track record.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import config as C
from .data_fetchers import load_pbp, load_schedules, load_snap_counts, load_players


def _fair_american(p: float) -> int:
    """Fair (no-vig) American odds implied by probability p."""
    p = min(max(p, 1e-4), 0.9999)
    if p >= 0.5:
        return int(round(-100 * p / (1 - p)))
    return int(round(100 * (1 - p) / p))


def _offensive_tds(reg: pd.DataFrame) -> pd.DataFrame:
    """One row per offensive (pass/rush) TD: game_id, week, scorer, defteam."""
    ptd = reg[reg["pass_touchdown"] == 1][["game_id", "week", "posteam", "defteam", "receiver_player_id"]]
    ptd = ptd.rename(columns={"receiver_player_id": "pid"})
    rtd = reg[reg["rush_touchdown"] == 1][["game_id", "week", "posteam", "defteam", "rusher_player_id"]]
    rtd = rtd.rename(columns={"rusher_player_id": "pid"})
    return pd.concat([ptd, rtd], ignore_index=True).dropna(subset=["pid", "defteam"])


def _snap_pct_by_gsis(season: int, week: int, pfr_to_gsis: dict) -> dict:
    """Season-to-date average offensive snap% keyed by gsis_id (best effort)."""
    try:
        sn = load_snap_counts(season)
    except Exception:
        return {}
    if "pfr_player_id" not in sn.columns or "offense_pct" not in sn.columns:
        return {}
    sn = sn[sn["week"] < week]
    sn = sn.assign(gsis=sn["pfr_player_id"].map(pfr_to_gsis)).dropna(subset=["gsis"])
    return sn.groupby("gsis")["offense_pct"].mean().to_dict()


def score_week(season: int, week: int) -> tuple[dict, list]:
    """Return (meta, games) for the Anytime-TD slate of one week."""
    pbp = load_pbp(season)
    reg = pbp[pbp["season_type"] == "REG"].copy()
    prior = reg[reg["week"] < week].copy()
    if prior.empty:
        raise ValueError(f"No prior-week data for {season} wk{week} (need week >= 2).")

    players = load_players()
    pos_map = dict(zip(players["gsis_id"], players["position"]))
    name_map = dict(zip(players["gsis_id"], players["display_name"]))
    pfr_to_gsis = dict(zip(players["pfr_id"].dropna(), players.loc[players["pfr_id"].notna(), "gsis_id"]))
    snap_map = _snap_pct_by_gsis(season, week, pfr_to_gsis)

    # ── per-player usage (season to date) ────────────────────────────────────
    rec = prior[prior["receiver_player_id"].notna()]
    rush = prior[prior["rusher_player_id"].notna()]

    def _cnt(df, idcol, mask=None, name="n"):
        d = df if mask is None else df[mask]
        return d.groupby(df.loc[d.index, idcol]).size().rename(name)

    targets = rec.groupby("receiver_player_id").size().rename("targets")
    rz_targets = rec[rec["yardline_100"] <= C.RZ_YARDLINE].groupby("receiver_player_id").size().rename("rz_targets")
    air = rec.groupby("receiver_player_id")["air_yards"].sum().rename("air_yards")
    carries = rush.groupby("rusher_player_id").size().rename("carries")
    rz_carries = rush[rush["yardline_100"] <= C.RZ_YARDLINE].groupby("rusher_player_id").size().rename("rz_carries")
    in10 = rush[rush["yardline_100"] <= C.INSIDE_10].groupby("rusher_player_id").size().rename("inside10_carries")

    # games played + team (from touches), and per-game TD hit list
    touches = pd.concat([
        rec[["game_id", "week", "posteam", "receiver_player_id"]].rename(columns={"receiver_player_id": "pid"}),
        rush[["game_id", "week", "posteam", "rusher_player_id"]].rename(columns={"rusher_player_id": "pid"}),
    ], ignore_index=True)
    games_played = touches.groupby("pid")["game_id"].nunique().rename("games")
    # a player's team = the team they took the most touches for
    team_of = touches.groupby("pid")["posteam"].agg(lambda s: s.value_counts().index[0]).rename("team")

    tds_df = _offensive_tds(prior)
    player_tds = tds_df.groupby("pid").size().rename("tds")
    # per-(player,game) scored, for hit rate + last-5
    scored_pg = tds_df.groupby(["pid", "game_id"]).size().reset_index(name="g_tds")
    # order games by week per player for last-5
    game_week = touches.drop_duplicates(["pid", "game_id"])[["pid", "game_id", "week"]]
    pg = game_week.merge(scored_pg, on=["pid", "game_id"], how="left")
    pg["scored"] = (pg["g_tds"].fillna(0) > 0).astype(int)

    hit_season = pg.groupby("pid")["scored"].mean().rename("hit_rate_season")

    def _last5(s):
        return s.sort_values("week").tail(C.FORM_GAMES)["scored"].mean()
    hit_l5 = pg.groupby("pid").apply(_last5).rename("hit_rate_l5")

    P = pd.concat([targets, rz_targets, air, carries, rz_carries, in10,
                   games_played, team_of, player_tds, hit_season, hit_l5], axis=1).fillna(0)
    P.index.name = "pid"
    P = P[P["games"] >= C.MIN_GAMES]
    P["position"] = P.index.map(pos_map)
    P["name"] = P.index.map(lambda i: name_map.get(i, i))
    P = P[P["position"].isin(C.SCORING_POSITIONS)]

    # RZ-opportunity units (goal-line carries weighted up)
    P["rz_opps"] = P["rz_targets"] + P["rz_carries"] + (C.INSIDE_10_WEIGHT - 1) * P["inside10_carries"]
    team_rz = P.groupby("team")["rz_opps"].sum().rename("team_rz_opps")
    team_tds = P.groupby("team")["tds"].sum().rename("team_tds")

    # ── defense-vs-position multiplier ───────────────────────────────────────
    tds_df["position"] = tds_df["pid"].map(pos_map)
    tds_df = tds_df[tds_df["position"].isin(C.SCORING_POSITIONS)]
    def_games = prior.groupby("defteam")["game_id"].nunique().rename("def_games")
    dvp = tds_df.groupby(["defteam", "position"]).size().rename("td_allowed").reset_index()
    dvp = dvp.merge(def_games, left_on="defteam", right_index=True)
    dvp["rate"] = dvp["td_allowed"] / dvp["def_games"]
    league_rate = dvp.groupby("position")["rate"].mean().rename("lg_rate")
    dvp = dvp.merge(league_rate, left_on="position", right_index=True)
    dvp["mult"] = (dvp["rate"] / dvp["lg_rate"]).clip(C.DVP_MULT_MIN, C.DVP_MULT_MAX)
    # rank (1 = softest / most TDs allowed) per position
    dvp["rank"] = dvp.groupby("position")["td_allowed"].rank(ascending=False, method="min").astype(int)
    dvp_mult = {(r.defteam, r.position): r.mult for r in dvp.itertuples()}
    dvp_rank = {(r.defteam, r.position): r.rank for r in dvp.itertuples()}

    def exp_team_tds(implied_total: float) -> float:
        v = (implied_total - C.TD_POINT_BASELINE) * C.TD_PER_POINT
        return float(np.clip(v, C.EXP_TEAM_TDS_MIN, C.EXP_TEAM_TDS_MAX))

    # ── build the week's games ───────────────────────────────────────────────
    sched = load_schedules(season)
    wk = sched[sched["week"] == week]
    games = []
    for g in wk.itertuples():
        home, away = g.home_team, g.away_team
        total, spread = float(g.total_line or 0), float(g.spread_line or 0)
        home_imp = round(total / 2 + spread / 2, 1)
        away_imp = round(total / 2 - spread / 2, 1)
        game_players = []
        for team, opp, is_home, imp in ((home, away, True, home_imp), (away, home, False, away_imp)):
            roster = P[P["team"] == team]
            trz = team_rz.get(team, 0.0) or 1.0
            ttd = team_tds.get(team, 0.0) or 1.0
            eteam = exp_team_tds(imp)
            for pid, r in roster.iterrows():
                rz_share = r["rz_opps"] / trz
                td_share = r["tds"] / ttd
                share = C.SHARE_RZ_WEIGHT * rz_share + C.SHARE_TD_WEIGHT * td_share
                mult = dvp_mult.get((opp, r["position"]), 1.0)
                exp_p = eteam * share * mult
                prob = 1 - math.exp(-exp_p)
                gp = max(int(r["games"]), 1)
                game_players.append({
                    "name": r["name"], "gsis_id": pid, "team": team, "pos": r["position"],
                    "opponent": opp, "is_home": is_home,
                    "score": round(prob, 4),
                    "fair_odds": _fair_american(prob),
                    "expected_tds": round(exp_p, 3),
                    "hit_rate_season": round(float(r["hit_rate_season"]), 3),
                    "hit_rate_l5": round(float(r["hit_rate_l5"]), 3),
                    "games": gp, "tds": int(r["tds"]),
                    "rz_opp_share": round(float(rz_share), 3),
                    "rz_targets_pg": round(r["rz_targets"] / gp, 2),
                    "inside10_carries_pg": round(r["inside10_carries"] / gp, 2),
                    "targets_pg": round(r["targets"] / gp, 2),
                    "carries_pg": round(r["carries"] / gp, 2),
                    "air_yards": int(r["air_yards"]),
                    "snap_pct": round(float(snap_map.get(pid, 0.0)), 3),
                    "dvp_rank": int(dvp_rank.get((opp, r["position"]), 0)),
                    "dvp_mult": round(float(mult), 2),
                    "implied_team_total": imp,
                })
        game_players.sort(key=lambda p: p["score"], reverse=True)
        games.append({
            "game_id": g.game_id, "away_team": away, "home_team": home,
            "roof": getattr(g, "roof", None),
            "total_line": total, "spread_line": spread,
            "away_implied": away_imp, "home_implied": home_imp,
            "players": game_players,
        })
    meta = {"sport": "nfl", "market": "anytime_td", "season": season, "week": week}
    return meta, games
