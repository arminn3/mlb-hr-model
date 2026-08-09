"""NFL Anytime-TD model.

For every skill player in a week's games, estimate P(scores a TD). The model
is deliberately explainable — display == score, same discipline as the MLB side:

  expected_team_TDs   = f(implied team total)              # game environment
  player_TD_share     = 0.6*RZ-opportunity share + 0.4*team-TD share  # usage (gate)
  role_dvp_mult       = opp vulnerability vs the player's DEPTH ROLE   # matchup (lead)
  usage_gate          = clamp(RZ-share / floor, 0..1)      # kills low-volume flukes
  expected_player_TDs = expected_team_TDs * player_TD_share * role_dvp_mult * usage_gate
  anytime_TD_prob     = 1 - exp(-expected_player_TDs)      # Poisson P(>=1)

Depth roles (WR1/WR2/WR3/…, RB1/RB2/…, TE1/…) are usage-based (ranked within
team+position). Defense-vs-role vulnerability is a TD-weighted blend (TDs + yards
+ opportunities allowed to that role, per game), regressed toward the parent
position for thin samples, then ranked 1-32 per role (#highest = softest).

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


def _kickoff(gametime) -> str:
    """'20:15' -> '8:15 pm EST' (nflverse gametime is ET). Time only — the
    frontend derives the day label (Today/Tomorrow/weekday) from `gameday`."""
    try:
        h, m = map(int, str(gametime).split(":"))
        ampm = "am" if h < 12 else "pm"
        return f"{h % 12 or 12}:{m:02d} {ampm} EST"
    except Exception:
        return ""


def _game_logs(prior: pd.DataFrame, role_map: dict, name_map: dict):
    """Build per-game logs from PBP.

    Returns (player_logs, role_vs_def):
      player_logs[pid]          -> chronological list of that player's game rows
      role_vs_def[defteam][role]-> chronological list of the opposing role-holder's
                                   game rows vs that defense ("QB1s vs PHI").
    Each row carries passing/rushing/receiving lines + atd (any TD that game).
    """
    g = prior
    meta = g.drop_duplicates("game_id").set_index("game_id")[["home_team"]]

    def _agg(idcol, **cols):
        d = g[g[idcol].notna()]
        out = d.groupby([idcol, "game_id"]).agg(**cols).reset_index()
        return out.rename(columns={idcol: "pid"})

    pas = _agg("passer_player_id", pass_att=("pass_attempt", "sum"), cmp=("complete_pass", "sum"),
               pass_yds=("passing_yards", "sum"), pass_td=("pass_touchdown", "sum"),
               pass_int=("interception", "sum"))
    rush = _agg("rusher_player_id", rush_att=("rush_attempt", "sum"),
                rush_yds=("rushing_yards", "sum"), rush_td=("rush_touchdown", "sum"))
    rec = _agg("receiver_player_id", targets=("pass_attempt", "size"), rec=("complete_pass", "sum"),
               rec_yds=("receiving_yards", "sum"), rec_td=("pass_touchdown", "sum"))

    def _side(idcol):
        d = g[g[idcol].notna()][[idcol, "game_id", "posteam", "defteam", "game_date", "week"]]
        return d.rename(columns={idcol: "pid"})
    who = pd.concat([_side("passer_player_id"), _side("rusher_player_id"), _side("receiver_player_id")],
                    ignore_index=True).drop_duplicates(["pid", "game_id"])

    log = (who.merge(pas, on=["pid", "game_id"], how="left")
              .merge(rush, on=["pid", "game_id"], how="left")
              .merge(rec, on=["pid", "game_id"], how="left")
              .merge(meta, left_on="game_id", right_index=True, how="left").fillna(0))
    log["home"] = log["posteam"] == log["home_team"]
    log["atd"] = ((log.get("rush_td", 0) + log.get("rec_td", 0)) > 0).astype(int)
    log["role"] = log["pid"].map(role_map)
    log["name"] = log["pid"].map(name_map)

    STAT = ["pass_att", "cmp", "pass_yds", "pass_td", "pass_int",
            "rush_att", "rush_yds", "rush_td", "targets", "rec", "rec_yds", "rec_td"]

    def _row(r, with_name=False):
        d = {"date": str(r["game_date"])[:10], "week": int(r["week"]),
             "opp": r["defteam"], "home": bool(r["home"]), "atd": int(r["atd"])}
        for s in STAT:
            d[s] = int(round(float(r[s])))
        if with_name:
            d["name"] = r["name"]
            d["team"] = r["posteam"]
        return d

    player_logs = {
        pid: [_row(r) for _, r in grp.sort_values("week").iterrows()]
        for pid, grp in log.groupby("pid")
    }
    # role-vs-defense: one row per (defense, role, game) — the opposing role-holder
    # who actually had the volume that game (keeps QB backups / spot-fills out).
    log["usage"] = log[["pass_att", "rush_att", "targets"]].sum(axis=1)
    rvd_src = (log.dropna(subset=["role"])
                  .sort_values("usage", ascending=False)
                  .drop_duplicates(["defteam", "role", "game_id"]))
    role_vs_def: dict = {}
    for (dteam, role), grp in rvd_src.groupby(["defteam", "role"]):
        role_vs_def.setdefault(dteam, {})[role] = [
            _row(r, with_name=True) for _, r in grp.sort_values("week").iterrows()
        ]
    return player_logs, role_vs_def


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
    espn_map = (dict(zip(players["gsis_id"], players["espn_id"]))
                if "espn_id" in players.columns else {})
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

    # ── usage-based depth roles (WR1/WR2/…, over ALL players with touches) ────
    usage = pd.DataFrame({"targets": targets, "carries": carries}).fillna(0)
    usage["touches"] = usage["targets"] + usage["carries"]
    R = pd.DataFrame(index=usage.index)
    R["team"] = R.index.map(team_of.to_dict())
    R["position"] = R.index.map(pos_map)
    R = R.dropna(subset=["team", "position"])
    R = R[R["position"].isin(C.SCORING_POSITIONS)]
    # ranking metric: WR/TE by targets, everyone else by touches
    R["metric"] = [
        usage.at[i, "targets"] if pos in ("WR", "TE") else usage.at[i, "touches"]
        for i, pos in zip(R.index, R["position"])
    ]
    R["rank_in"] = R.groupby(["team", "position"])["metric"].rank(ascending=False, method="first")

    def _role(pos: str, rk: float):
        tiers = C.ROLE_TIERS.get(pos)
        if not tiers:
            return None
        i = int(rk) - 1
        return tiers[i] if i < len(tiers) else None  # deeper than last tier -> no role (dropped)

    R["role"] = [_role(p, rk) for p, rk in zip(R["position"], R["rank_in"])]
    role_map = R["role"].to_dict()
    P["role"] = P.index.map(role_map)

    # per-game logs (player log + role-vs-defense log)
    player_logs, role_vs_def = _game_logs(prior, role_map, name_map)

    # ── defense-vs-ROLE vulnerability (TD-weighted blend, regressed) ──────────
    tds_df["position"] = tds_df["pid"].map(pos_map)
    tds_df = tds_df[tds_df["position"].isin(C.SCORING_POSITIONS)].copy()
    tds_df["role"] = tds_df["pid"].map(role_map)
    def_games = prior.groupby("defteam")["game_id"].nunique().rename("def_games")

    rec_o = rec[["defteam", "receiver_player_id", "yards_gained"]].rename(columns={"receiver_player_id": "pid"})
    rush_o = rush[["defteam", "rusher_player_id", "yards_gained"]].rename(columns={"rusher_player_id": "pid"})
    opp_df = pd.concat([rec_o, rush_o], ignore_index=True).dropna(subset=["defteam"])
    opp_df["role"] = opp_df["pid"].map(role_map)
    opp_df["position"] = opp_df["pid"].map(pos_map)

    def _vuln(key: str) -> pd.DataFrame:
        """Per (defteam, key): TD/yards/opp allowed per game, blended into a
        vulnerability ratio vs the key's league average (>1 soft, <1 tough)."""
        td = tds_df.dropna(subset=[key]).groupby(["defteam", key]).size().rename("td")
        yd = opp_df.dropna(subset=[key]).groupby(["defteam", key])["yards_gained"].sum().rename("yd")
        op = opp_df.dropna(subset=[key]).groupby(["defteam", key]).size().rename("op")
        d = pd.concat([td, yd, op], axis=1).fillna(0).reset_index().rename(columns={key: "key"})
        d = d.merge(def_games, left_on="defteam", right_index=True)
        for c in ("td", "yd", "op"):
            d[c + "_rate"] = d[c] / d["def_games"]
        lg = d.groupby("key")[["td_rate", "yd_rate", "op_rate"]].mean().rename(columns=lambda c: "lg_" + c)
        d = d.merge(lg, left_on="key", right_index=True)
        ratio = lambda a, b: (d[a] / d[b].replace(0, np.nan)).fillna(1.0)
        d["blend"] = (C.DVP_TD_WEIGHT * ratio("td_rate", "lg_td_rate")
                      + C.DVP_YDS_WEIGHT * ratio("yd_rate", "lg_yd_rate")
                      + C.DVP_OPP_WEIGHT * ratio("op_rate", "lg_op_rate"))
        return d

    role_v = _vuln("role")
    pos_blend = {(r.defteam, r.key): r.blend for r in _vuln("position").itertuples()}
    parent_of = {role: pos for pos, tiers in C.ROLE_TIERS.items() for role in tiers}

    role_mult, rank_rows = {}, []
    for r in role_v.itertuples():
        pb = pos_blend.get((r.defteam, parent_of.get(r.key)), 1.0)
        w = r.td / (r.td + C.DVP_REGRESSION_PRIOR)      # regress thin role samples to position
        regressed = w * r.blend + (1 - w) * pb
        role_mult[(r.defteam, r.key)] = float(np.clip(regressed, C.DVP_MULT_MIN, C.DVP_MULT_MAX))
        rank_rows.append((r.key, r.defteam, regressed))
    rr = pd.DataFrame(rank_rows, columns=["role", "defteam", "reg"])
    # rank per role: #1 = toughest (lowest), highest = softest (matches "#32 vs WR2")
    rr["rank"] = rr.groupby("role")["reg"].rank(ascending=True, method="min").astype(int)
    role_rank = {(r.defteam, r.role): r.rank for r in rr.itertuples()}
    role_rank_total = rr.groupby("role").size().to_dict()

    def exp_team_tds(implied_total: float) -> float:
        v = (implied_total - C.TD_POINT_BASELINE) * C.TD_PER_POINT
        return float(np.clip(v, C.EXP_TEAM_TDS_MIN, C.EXP_TEAM_TDS_MAX))

    # ── build the week's games ───────────────────────────────────────────────
    sched = load_schedules(season)

    # team W-L records coming into the week (result = home_score - away_score)
    wins: dict = {}
    losses: dict = {}
    for r in sched[(sched["week"] < week) & sched["result"].notna()].itertuples():
        if r.result == 0:
            continue
        home_won = r.result > 0
        for t, won in ((r.home_team, home_won), (r.away_team, not home_won)):
            (wins if won else losses)[t] = (wins if won else losses).get(t, 0) + 1
    record = lambda t: f"{wins.get(t, 0)}-{losses.get(t, 0)}"

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
                role = r["role"]
                if not isinstance(role, str):  # None/NaN — deeper than WR3/RB2/TE2, drop
                    continue
                rz_share = r["rz_opps"] / trz
                td_share = r["tds"] / ttd
                share = C.SHARE_RZ_WEIGHT * rz_share + C.SHARE_TD_WEIGHT * td_share
                # matchup LEAD: opponent's vulnerability to THIS depth role
                rmult = role_mult.get((opp, role), 1.0)
                # usage GATE: only bites below the RZ-share floor (kills low-vol flukes)
                usage_gate = min(1.0, rz_share / C.USAGE_FLOOR) if C.USAGE_FLOOR > 0 else 1.0
                exp_p = eteam * share * rmult * usage_gate
                prob = 1 - math.exp(-exp_p)
                gp = max(int(r["games"]), 1)
                _espn = espn_map.get(pid)
                game_players.append({
                    "name": r["name"], "gsis_id": pid, "team": team, "pos": r["position"],
                    "espn_id": str(int(_espn)) if _espn == _espn and _espn else None,  # NaN-safe
                    "role": role, "opponent": opp, "is_home": is_home,
                    "score": round(prob, 4),
                    "expected_tds": round(exp_p, 3),
                    "opp_rank_vs_role": int(role_rank.get((opp, role), 0)),
                    "opp_rank_total": int(role_rank_total.get(role, C.NUM_TEAMS)),
                    "role_dvp_mult": round(float(rmult), 2),
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
                    "implied_team_total": imp,
                    "game_log": player_logs.get(pid, []),
                    "role_vs_def_log": role_vs_def.get(opp, {}).get(role, []),
                })
        game_players.sort(key=lambda p: p["score"], reverse=True)
        games.append({
            "game_id": g.game_id, "away_team": away, "home_team": home,
            "roof": getattr(g, "roof", None),
            "total_line": total, "spread_line": spread,
            "away_implied": away_imp, "home_implied": home_imp,
            "kickoff": _kickoff(getattr(g, "gametime", "")),
            "gameday": str(getattr(g, "gameday", "")),
            "away_record": record(away), "home_record": record(home),
            "players": game_players,
        })
    meta = {"sport": "nfl", "market": "anytime_td", "season": season, "week": week}
    return meta, games
