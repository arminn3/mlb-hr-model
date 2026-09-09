"""NFL Anytime-TD model.

For every skill player in a week's games, estimate P(scores a TD). The model
is deliberately explainable — display == score, same discipline as the MLB side:

  expected_team_TDs   = f(implied team total)              # game environment
  player_TD_share     = 0.5*RZ-opportunity share + 0.25*usage share + 0.25*team-TD share
  role_dvp_mult       = opp vulnerability vs the player's DEPTH ROLE   # matchup (lead)
  usage_gate          = clamp(RZ-share / floor, 0..1)      # kills low-volume flukes
  expected_player_TDs = expected_team_TDs * player_TD_share * role_dvp_mult * usage_gate
  anytime_TD_prob     = 1 - exp(-expected_player_TDs)      # Poisson P(>=1)

Depth roles (WR1/WR2/WR3/…, RB1/RB2/…, TE1/…) are usage-based (ranked within
team+position). Defense-vs-role vulnerability blends four signals allowed to
that role, per game: TDs (0.50) + yards (0.15) + usage-share allowed (0.15) +
RZ-usage-share allowed (0.20) — "usage-share" is the role's SHARE of the
defense's total touches/RZ-touches allowed, not a raw count, so pace doesn't
skew it. Regressed toward the parent position for thin samples, then ranked
1-32 per role (#highest = softest).

All inputs derived from nflverse PBP for the season up to (not including) the
target week — i.e. only information available before kickoff. Empirical Anytime-
TD hit rate (season + last-5) is carried alongside as the track record.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import config as C
from .data_fetchers import load_pbp, load_schedules, load_snap_counts, load_players, load_rosters, load_depth_charts


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


def _availability(season: int, week: int):
    """Key players per team + who was OUT (took 0 snaps) each prior week.

    Returns (key_off, key_def, off_active, def_active):
      key_off[team]            -> top skill players by season snaps (display names)
      key_def[team]            -> top defenders by season snaps (display names)
      off_active[(team, week)] -> set of offensive players who took a snap that week
      def_active[(team, week)] -> set of defenders who took a snap that week
    A key player absent from their team's active set that week was out/inactive.
    """
    empty: tuple = ({}, {}, {}, {})
    try:
        sn = load_snap_counts(season)
    except Exception:
        return empty
    need = {"player", "position", "team", "week", "offense_snaps", "defense_snaps"}
    if not need.issubset(sn.columns):
        return empty
    sn = sn[sn["week"] < week]
    off = sn[sn["position"].isin({"QB", "RB", "WR", "TE", "FB"}) & (sn["offense_snaps"] > 0)]
    dfn = sn[sn["defense_snaps"] > 0]
    # A "key player" = high snap SHARE (role), not accumulated volume — so a
    # starter who missed games (injury) still ranks above a healthy backup.
    gfloor = min(3, int(sn["week"].nunique()) or 1)  # real contributor, not a 1-week fill-in

    def _key(df: pd.DataFrame, pct_col: str) -> dict:
        out: dict = {}
        for t, g in df.groupby("team"):
            agg = g.groupby("player").agg(share=(pct_col, "mean"), games=("week", "nunique"))
            agg = agg[agg["games"] >= gfloor]
            out[t] = agg.sort_values("share", ascending=False).head(8).index.tolist()
        return out
    key_off = _key(off, "offense_pct")
    key_def = _key(dfn, "defense_pct")
    off_active = off.groupby(["team", "week"])["player"].apply(set).to_dict()
    def_active = dfn.groupby(["team", "week"])["player"].apply(set).to_dict()
    return key_off, key_def, off_active, def_active


def _matchup_factors(sched: pd.DataFrame, week: int) -> tuple[dict, dict]:
    """Per-team ATS (against-the-spread) record splits and last-5-games list,
    computed from REAL completed games this season (weeks before `week`).
    Legitimately 0-0 / empty pre-season — populates as real games are played,
    no historical backfill (matches the season W-L record right above).

    ATS sign convention verified against real 2025 results: spread_line > 0
    means the HOME team is favored by that many points. A team's own spread
    is -spread_line at home, +spread_line on the road; it covers when its
    game margin plus its own spread is > 0 (push at exactly 0).
    """
    completed = sched[(sched["week"] < week) & sched["result"].notna()].sort_values("week")
    ats: dict = {}
    last5: dict = {}

    def _bucket():
        return {"w": 0, "l": 0, "p": 0}

    for r in completed.itertuples():
        for team, is_home in ((r.home_team, True), (r.away_team, False)):
            a = ats.setdefault(team, {"total": _bucket(), "home": _bucket(), "away": _bucket(),
                                       "favored": _bucket(), "underdog": _bucket()})
            team_spread = -r.spread_line if is_home else r.spread_line
            margin = r.result if is_home else -r.result
            cover = margin + team_spread
            outcome = "p" if cover == 0 else ("w" if cover > 0 else "l")
            a["total"][outcome] += 1
            a["home" if is_home else "away"][outcome] += 1
            if team_spread < 0:
                a["favored"][outcome] += 1
            elif team_spread > 0:
                a["underdog"][outcome] += 1

            opp = r.away_team if is_home else r.home_team
            team_score = r.home_score if is_home else r.away_score
            opp_score = r.away_score if is_home else r.home_score
            row = {
                "date": str(r.gameday)[:10], "opp": opp, "home": is_home,
                "team_score": int(team_score), "opp_score": int(opp_score),
                "won": bool(team_score > opp_score), "cover": outcome,
            }
            last5.setdefault(team, []).append(row)

    for team, rows in last5.items():
        last5[team] = rows[-5:][::-1]  # most recent first, capped at 5

    def _fmt(bucket: dict) -> dict:
        w, l, p = bucket["w"], bucket["l"], bucket["p"]
        n = w + l + p
        return {"record": f"{w}-{l}" + (f"-{p}" if p else ""), "pct": round(w / (w + l), 3) if (w + l) else None}

    ats_fmt = {team: {k: _fmt(v) for k, v in splits.items()} for team, splits in ats.items()}
    return ats_fmt, last5


def _team_offense_split(pbp_reg: pd.DataFrame) -> dict:
    """Per team: real pass/rush attempt counts (nflverse's own pass_attempt/
    rush_attempt flags — the official split, not a reverse-engineered one),
    overall and red-zone-only, with each pair's share of that pair's total."""
    pass_p = pbp_reg[pbp_reg["pass_attempt"] == 1].copy()
    rush_p = pbp_reg[pbp_reg["rush_attempt"] == 1].copy()
    pass_p["rz"] = pass_p["yardline_100"] <= C.RZ_YARDLINE
    rush_p["rz"] = rush_p["yardline_100"] <= C.RZ_YARDLINE
    pa = pass_p.groupby("posteam").agg(pass_att=("pass_attempt", "size"), rz_pass_att=("rz", "sum"))
    ra = rush_p.groupby("posteam").agg(rush_att=("rush_attempt", "size"), rz_rush_att=("rz", "sum"))
    df = pd.concat([pa, ra], axis=1).fillna(0)
    out: dict = {}
    for team, r in df.iterrows():
        pass_att, rush_att = int(r["pass_att"]), int(r["rush_att"])
        rz_pass, rz_rush = int(r["rz_pass_att"]), int(r["rz_rush_att"])
        tot, rz_tot = max(pass_att + rush_att, 1), max(rz_pass + rz_rush, 1)
        out[team] = {
            "pass_att": pass_att, "rush_att": rush_att,
            "pass_att_pct": round(pass_att / tot, 3), "rush_att_pct": round(rush_att / tot, 3),
            "rz_pass_att": rz_pass, "rz_rush_att": rz_rush,
            "rz_pass_att_pct": round(rz_pass / rz_tot, 3), "rz_rush_att_pct": round(rz_rush / rz_tot, 3),
        }
    return out


def _season_role_map(pbp_reg: pd.DataFrame, pos_map: dict) -> dict:
    """Usage-based role assignment for one season's own PBP — mirrors the main
    role-ranking logic in score_week (minus the depth-chart override, which is
    CURRENT-season-only). Used to evaluate a HISTORICAL season on its own
    terms: who actually held each role, and what did defenses allow them,
    rather than projecting this year's depth chart onto last year's games."""
    rec = pbp_reg[pbp_reg["receiver_player_id"].notna()]
    rush = pbp_reg[pbp_reg["rusher_player_id"].notna()]
    targets = rec.groupby("receiver_player_id").size()
    carries = rush.groupby("rusher_player_id").size()
    touches_df = pd.concat([
        rec[["game_id", "posteam", "receiver_player_id"]].rename(columns={"receiver_player_id": "pid"}),
        rush[["game_id", "posteam", "rusher_player_id"]].rename(columns={"rusher_player_id": "pid"}),
    ], ignore_index=True)
    if touches_df.empty:
        return {}
    team_of = touches_df.groupby("pid")["posteam"].agg(lambda s: s.value_counts().index[0])
    usage = pd.DataFrame({"targets": targets, "carries": carries}).fillna(0)
    usage["touches"] = usage["targets"] + usage["carries"]
    R = pd.DataFrame(index=usage.index)
    R["team"] = R.index.map(team_of.to_dict())
    R["position"] = R.index.map(pos_map)
    R = R.dropna(subset=["team", "position"])
    R = R[R["position"].isin(C.SCORING_POSITIONS)]
    R["metric"] = [usage.at[i, "targets"] if p in ("WR", "TE") else usage.at[i, "touches"]
                   for i, p in zip(R.index, R["position"])]
    R["rank_in"] = R.groupby(["team", "position"])["metric"].rank(ascending=False, method="first")

    def _role(pos: str, rk: float):
        tiers = C.ROLE_TIERS.get(pos)
        if not tiers:
            return None
        i = int(rk) - 1
        return tiers[i] if i < len(tiers) else None

    R["role"] = [_role(p, rk) for p, rk in zip(R["position"], R["rank_in"])]
    return R["role"].to_dict()


def _against_stats(pbp_reg: pd.DataFrame, role_map: dict) -> dict:
    """Per (defteam, role) — plus an 'All' combined row per defense — the real
    per-game rate allowed for TD / rush-TD / rec-TD / rush-yds / rec-yds, each
    ranked 1-N within that role. Rank 1 = allows the LEAST (toughest), highest
    = allows the MOST (softest) — same direction as role_rank elsewhere in
    this model. REC columns are None (not 0) for the QB role — QBs don't
    catch passes in this taxonomy, so it's genuinely not-applicable, not a
    real zero."""
    rec = pbp_reg[pbp_reg["receiver_player_id"].notna()].copy()
    rush = pbp_reg[pbp_reg["rusher_player_id"].notna()].copy()
    rec["role"] = rec["receiver_player_id"].map(role_map)
    rush["role"] = rush["rusher_player_id"].map(role_map)
    def_games = pbp_reg.groupby("defteam")["game_id"].nunique().rename("def_games")

    def _agg(df, td_col, yds_col, prefix):
        g = df.dropna(subset=["role"]).groupby(["defteam", "role"]).agg(
            **{f"{prefix}_td": (td_col, "sum"), f"{prefix}_yds": (yds_col, "sum")})
        return g

    rec_agg = _agg(rec, "pass_touchdown", "receiving_yards", "rec")
    rush_agg = _agg(rush, "rush_touchdown", "rushing_yards", "rush")

    all_roles = set(r for _, r in rec_agg.index) | set(r for _, r in rush_agg.index)
    all_teams = pbp_reg["defteam"].dropna().unique()
    out: dict = {t: {} for t in all_teams}

    for role in all_roles:
        idx = pd.MultiIndex.from_product([all_teams, [role]], names=["defteam", "role"])
        base = pd.DataFrame(index=all_teams)
        base["rec_td"] = rec_agg.reindex(idx)["rec_td"].droplevel("role").fillna(0) if role in {r for _, r in rec_agg.index} else 0.0
        base["rec_yds"] = rec_agg.reindex(idx)["rec_yds"].droplevel("role").fillna(0) if role in {r for _, r in rec_agg.index} else 0.0
        base["rush_td"] = rush_agg.reindex(idx)["rush_td"].droplevel("role").fillna(0) if role in {r for _, r in rush_agg.index} else 0.0
        base["rush_yds"] = rush_agg.reindex(idx)["rush_yds"].droplevel("role").fillna(0) if role in {r for _, r in rush_agg.index} else 0.0
        base = base.join(def_games).fillna({"def_games": 0})
        gp = base["def_games"].replace(0, np.nan)
        base["rush_td_pg"] = base["rush_td"] / gp
        base["rec_td_pg"] = base["rec_td"] / gp
        base["rush_yds_pg"] = base["rush_yds"] / gp
        base["rec_yds_pg"] = base["rec_yds"] / gp
        base["td_pg"] = base["rush_td_pg"].fillna(0) + base["rec_td_pg"].fillna(0)
        rec_applicable = role != "QB"
        for metric in ("rush_td_pg", "rush_yds_pg"):
            base[metric + "_rank"] = base[metric].rank(ascending=True, method="min")
        if rec_applicable:
            for metric in ("rec_td_pg", "rec_yds_pg"):
                base[metric + "_rank"] = base[metric].rank(ascending=True, method="min")

        n_teams = int(base["def_games"].gt(0).sum()) or len(all_teams)
        for team, r in base.iterrows():
            row = {
                "td": round(float(r["td_pg"]), 2),
                "rush_td": round(float(r["rush_td_pg"]), 2) if pd.notna(r["rush_td_pg"]) else None,
                "rush_td_rank": int(r["rush_td_pg_rank"]) if pd.notna(r.get("rush_td_pg_rank")) else None,
                "rush_yds": round(float(r["rush_yds_pg"]), 1) if pd.notna(r["rush_yds_pg"]) else None,
                "rush_yds_rank": int(r["rush_yds_pg_rank"]) if pd.notna(r.get("rush_yds_pg_rank")) else None,
                "rec_td": round(float(r["rec_td_pg"]), 2) if (rec_applicable and pd.notna(r["rec_td_pg"])) else None,
                "rec_td_rank": int(r["rec_td_pg_rank"]) if (rec_applicable and pd.notna(r.get("rec_td_pg_rank"))) else None,
                "rec_yds": round(float(r["rec_yds_pg"]), 1) if (rec_applicable and pd.notna(r["rec_yds_pg"])) else None,
                "rec_yds_rank": int(r["rec_yds_pg_rank"]) if (rec_applicable and pd.notna(r.get("rec_yds_pg_rank"))) else None,
                "rank_total": n_teams,
            }
            out.setdefault(team, {})[role] = row

    # "All" row per defense — every role-holder combined (all offensive skill
    # positions), same per-game-rate + rank treatment as each individual role.
    all_rec = rec.dropna(subset=["role"])
    all_rush = rush.dropna(subset=["role"])
    base = pd.DataFrame(index=all_teams)
    base["rec_td"] = all_rec.groupby("defteam")["pass_touchdown"].sum().reindex(all_teams).fillna(0)
    base["rec_yds"] = all_rec.groupby("defteam")["receiving_yards"].sum().reindex(all_teams).fillna(0)
    base["rush_td"] = all_rush.groupby("defteam")["rush_touchdown"].sum().reindex(all_teams).fillna(0)
    base["rush_yds"] = all_rush.groupby("defteam")["rushing_yards"].sum().reindex(all_teams).fillna(0)
    base = base.join(def_games).fillna({"def_games": 0})
    gp = base["def_games"].replace(0, np.nan)
    base["rush_td_pg"] = base["rush_td"] / gp
    base["rec_td_pg"] = base["rec_td"] / gp
    base["rush_yds_pg"] = base["rush_yds"] / gp
    base["rec_yds_pg"] = base["rec_yds"] / gp
    base["td_pg"] = base["rush_td_pg"].fillna(0) + base["rec_td_pg"].fillna(0)
    for metric in ("rush_td_pg", "rec_td_pg", "rush_yds_pg", "rec_yds_pg"):
        base[metric + "_rank"] = base[metric].rank(ascending=True, method="min")
    n_teams = int(base["def_games"].gt(0).sum()) or len(all_teams)
    for team, r in base.iterrows():
        out.setdefault(team, {})["All"] = {
            "td": round(float(r["td_pg"]), 2),
            "rush_td": round(float(r["rush_td_pg"]), 2) if pd.notna(r["rush_td_pg"]) else None,
            "rush_td_rank": int(r["rush_td_pg_rank"]) if pd.notna(r.get("rush_td_pg_rank")) else None,
            "rush_yds": round(float(r["rush_yds_pg"]), 1) if pd.notna(r["rush_yds_pg"]) else None,
            "rush_yds_rank": int(r["rush_yds_pg_rank"]) if pd.notna(r.get("rush_yds_pg_rank")) else None,
            "rec_td": round(float(r["rec_td_pg"]), 2) if pd.notna(r["rec_td_pg"]) else None,
            "rec_td_rank": int(r["rec_td_pg_rank"]) if pd.notna(r.get("rec_td_pg_rank")) else None,
            "rec_yds": round(float(r["rec_yds_pg"]), 1) if pd.notna(r["rec_yds_pg"]) else None,
            "rec_yds_rank": int(r["rec_yds_pg_rank"]) if pd.notna(r.get("rec_yds_pg_rank")) else None,
            "rank_total": n_teams,
        }
    return out


def _player_season_stats(pbp_reg: pd.DataFrame) -> pd.DataFrame:
    """Per-player raw SEASON TOTALS (rushing + receiving), keyed by pid — used
    to pull a CURRENT role-holder's numbers from an arbitrary season's PBP
    (e.g. last season) without recomputing roles for that season. Totals, not
    per-game rates — the frontend's Per-Game/Totals toggle divides by `games`."""
    rec = pbp_reg[pbp_reg["receiver_player_id"].notna()]
    rush = pbp_reg[pbp_reg["rusher_player_id"].notna()]
    targets = rec.groupby("receiver_player_id").size().rename("targets")
    rz_targets = rec[rec["yardline_100"] <= C.RZ_YARDLINE].groupby("receiver_player_id").size().rename("rz_targets")
    rec_td = rec.groupby("receiver_player_id")["pass_touchdown"].sum().rename("rec_td")
    rec_yds = rec.groupby("receiver_player_id")["receiving_yards"].sum().rename("rec_yds")
    carries = rush.groupby("rusher_player_id").size().rename("carries")
    rz_carries = rush[rush["yardline_100"] <= C.RZ_YARDLINE].groupby("rusher_player_id").size().rename("rz_carries")
    rush_td = rush.groupby("rusher_player_id")["rush_touchdown"].sum().rename("rush_td")
    rush_yds = rush.groupby("rusher_player_id")["rushing_yards"].sum().rename("rush_yds")
    touches = pd.concat([
        rec[["game_id", "receiver_player_id"]].rename(columns={"receiver_player_id": "pid"}),
        rush[["game_id", "rusher_player_id"]].rename(columns={"rusher_player_id": "pid"}),
    ], ignore_index=True)
    games = touches.groupby("pid")["game_id"].nunique().rename("games")
    return pd.concat([targets, rz_targets, rec_td, rec_yds, carries, rz_carries, rush_td, rush_yds, games],
                      axis=1).fillna(0)


RUSHER_ROLES = {"QB", "RB1", "RB2"}
RECEIVER_ROLES = {"WR1", "WR2", "WR3", "TE1", "TE2", "RB1", "RB2"}


def _rusher_receiver_tables(role_map: dict, team_of: dict, name_map: dict,
                             stats_by_year: dict, offense_split_by_year: dict) -> tuple[dict, dict]:
    """Per-team Rusher/Receiver stat tables (the CURRENT role-holders — QB/
    RB1/RB2 for rushers, WR1-3/TE1-2/RB1-2 for receivers), each with season
    totals for every year in `stats_by_year`. A role-holder missing from a
    given year's stats (e.g. a rookie with no prior-season games) gets an
    explicit zero-row for that year, not a fabricated number — the frontend
    shows "--" when games==0."""
    rusher: dict = {}
    receiver: dict = {}

    def _row(pid: str, role: str, df: pd.DataFrame | None):
        if df is None or pid not in df.index:
            r = {c: 0 for c in ("targets", "rz_targets", "rec_td", "rec_yds", "carries", "rz_carries", "rush_td", "rush_yds", "games")}
        else:
            r = df.loc[pid].to_dict()
        return r

    for pid, role in role_map.items():
        if not role:
            continue
        team = team_of.get(pid)
        if not team:
            continue
        name = name_map.get(pid, pid)
        by_year = {year: _row(pid, role, df) for year, df in stats_by_year.items()}

        if role in RUSHER_ROLES:
            rusher.setdefault(team, []).append({
                "gsis_id": pid, "name": name, "role": role,
                "by_year": {y: {"games": int(v["games"]), "td": int(v["rush_td"] + v["rec_td"]),
                                 "rush_td": int(v["rush_td"]), "rz_rush_att": int(v["rz_carries"]),
                                 "rush_yds": int(v["rush_yds"]), "rush_att": int(v["carries"])}
                            for y, v in by_year.items()},
            })
        if role in RECEIVER_ROLES:
            receiver.setdefault(team, []).append({
                "gsis_id": pid, "name": name, "role": role,
                "by_year": {y: {"games": int(v["games"]), "td": int(v["rush_td"] + v["rec_td"]),
                                 "rec_td": int(v["rec_td"]), "rz_targets": int(v["rz_targets"]),
                                 "rec_yds": int(v["rec_yds"]), "targets": int(v["targets"])}
                            for y, v in by_year.items()},
            })

    # RZ share = this player's RZ carries/targets as a share of their TEAM's
    # TRUE season-wide total (from _team_offense_split's real per-team RZ
    # counts across EVERY rusher/passer that team had) — NOT a sum over just
    # the role-holders in this table. Summing only the table's own rows
    # silently drops anyone missing a current role (e.g. a rookie RB1 with no
    # prior-season stats), which can inflate a backup's share past 50%+ when
    # the actual lead back isn't in the denominator at all.
    def _add_shares(by_team: dict, share_key: str, count_key: str, team_total_key: str):
        for team, players in by_team.items():
            for p in players:
                for y, v in p["by_year"].items():
                    team_split = offense_split_by_year.get(y, {}).get(team)
                    tot = team_split[team_total_key] if team_split else 0
                    v[share_key] = round(v[count_key] / tot, 3) if tot else None

    _add_shares(rusher, "rz_rush_share", "rz_rush_att", "rz_rush_att")
    _add_shares(receiver, "rz_tgt_share", "rz_targets", "rz_pass_att")
    return rusher, receiver


def _kickoff(gametime) -> str:
    """'20:15' -> '8:15 pm EST' (nflverse gametime is ET). Time only — the
    frontend derives the day label (Today/Tomorrow/weekday) from `gameday`."""
    try:
        h, m = map(int, str(gametime).split(":"))
        ampm = "am" if h < 12 else "pm"
        return f"{h % 12 or 12}:{m:02d} {ampm} EST"
    except Exception:
        return ""


GAME_STAT = ["pass_att", "cmp", "pass_yds", "pass_td", "pass_int",
             "rush_att", "rush_yds", "rush_td", "targets", "rec", "rec_yds", "rec_td"]


def _raw_game_log(pbp: pd.DataFrame) -> pd.DataFrame:
    """One row per (pid, game_id) with passing/rushing/receiving stat lines +
    home/atd — the shared building block behind both the Research-card game
    logs and the Game-Overview lineup splits (season/home/vs-opp/last-season)."""
    g = pbp
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
    return log


def _lineup_splits(season_log: pd.DataFrame, last_season_log: pd.DataFrame | None, pid: str, opponent: str,
                    season_year: int, last_season_year: int) -> dict:
    """Game-Overview 'Lineups' split rows for one starter: season, home-only,
    vs-this-specific-opponent (searched across season + last season), and last
    season. Each split is a per-game AVERAGE of the same stats as the Research
    game log, plus derived yards/attempt. A split with zero games in the
    window is omitted entirely — the frontend shows '--', never a fabricated
    number."""
    def _summarize(rows: pd.DataFrame):
        if rows.empty:
            return None
        avg = {s: round(float(rows[s].mean()), 1) for s in GAME_STAT}
        avg["games"] = int(len(rows))
        avg["pass_yd_a"] = round(avg["pass_yds"] / avg["pass_att"], 1) if avg["pass_att"] else 0.0
        avg["rush_yd_a"] = round(avg["rush_yds"] / avg["rush_att"], 1) if avg["rush_att"] else 0.0
        avg["td"] = round(float((rows["rush_td"] + rows["rec_td"] + rows["pass_td"]).mean()), 2)
        return avg

    my_season = season_log[season_log["pid"] == pid]
    my_last = last_season_log[last_season_log["pid"] == pid] if last_season_log is not None else pd.DataFrame()
    combined = pd.concat([my_season, my_last], ignore_index=True) if not my_last.empty else my_season

    return {
        "season": _summarize(my_season),
        "home": _summarize(my_season[my_season["home"]]),
        "vs_opp": _summarize(combined[combined["defteam"] == opponent]),
        "last_season": _summarize(my_last),
        # Exact calendar years the "season"/"last_season" rows cover — computed
        # here (not guessed on the frontend from today's date) since this stays
        # correct whether we're in the prior-season fallback or a real in-season week.
        "season_year": season_year,
        "last_season_year": last_season_year,
    }


def _game_logs(raw_log: pd.DataFrame, role_map: dict, name_map: dict, avail: tuple = ({}, {}, {}, {}), espn_map: dict | None = None, headshot_map: dict | None = None):
    """Build per-game display logs from a raw game log (see `_raw_game_log`).

    Returns (player_logs, role_vs_def):
      player_logs[pid]          -> chronological list of that player's game rows
      role_vs_def[defteam][role]-> chronological list of the opposing role-holder's
                                   game rows vs that defense ("QB1s vs PHI").
    Each row carries passing/rushing/receiving lines + atd (any TD that game).
    """
    log = raw_log.copy()
    log["role"] = log["pid"].map(role_map)
    log["name"] = log["pid"].map(name_map)

    STAT = GAME_STAT

    key_off, key_def, off_active, def_active = avail

    def _row(r, with_name=False):
        wk = int(r["week"])
        d = {"date": str(r["game_date"])[:10], "week": wk,
             "opp": r["defteam"], "home": bool(r["home"]), "atd": int(r["atd"])}
        for s in STAT:
            d[s] = int(round(float(r[s])))
        if with_name:
            # role-vs-defense row: key defenders of this defense who were out that week
            dteam = r["defteam"]
            active = def_active.get((dteam, wk), set())
            d["out"] = [p for p in key_def.get(dteam, []) if p not in active]
            _e = (espn_map or {}).get(r["pid"])
            d["espn_id"] = str(int(_e)) if (_e is not None and _e == _e and _e) else None
            _hs = (headshot_map or {}).get(r["pid"])
            d["headshot"] = _hs if isinstance(_hs, str) and _hs else None
            d["name"] = r["name"]
            d["team"] = r["posteam"]
        else:
            # player's own game: key offensive teammates who were out (excl. self)
            pteam = r["posteam"]
            active = off_active.get((pteam, wk), set())
            self_name = name_map.get(r["pid"])
            d["out"] = [p for p in key_off.get(pteam, []) if p not in active and p != self_name]
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
    reg = pbp[pbp["season_type"] == "REG"].copy() if len(pbp) else pbp
    prior = reg[reg["week"] < week].copy() if len(reg) else reg

    # Prior-season fallback: preseason / Week 1 with no current-season PBP yet.
    # Player form, roles, game logs and DvP come from last season's full slate;
    # the schedule + rosters still come from the requested season.
    hist, hist_week, fallback = season, week, False
    if prior is None or prior.empty:
        hist = season - 1
        hp = load_pbp(hist)
        prior = hp[hp["season_type"] == "REG"].copy()
        if prior.empty:
            raise ValueError(f"No PBP for {season} wk{week} or prior-season {hist} fallback.")
        hist_week = int(prior["week"].max()) + 1  # use the full prior season
        fallback = True

    players = load_players()
    pos_map = dict(zip(players["gsis_id"], players["position"]))
    name_map = dict(zip(players["gsis_id"], players["display_name"]))
    espn_map = (dict(zip(players["gsis_id"], players["espn_id"]))
                if "espn_id" in players.columns else {})
    # nflverse NFL.com headshot URL — ~99% coverage, far better than ESPN-id construction.
    headshot_map = (dict(zip(players["gsis_id"], players["headshot"]))
                    if "headshot" in players.columns else {})
    pfr_to_gsis = dict(zip(players["pfr_id"].dropna(), players.loc[players["pfr_id"].notna(), "gsis_id"]))
    snap_map = _snap_pct_by_gsis(hist, hist_week, pfr_to_gsis)

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

    # fallback: remap to the requested season's rosters so free-agency / trades show
    # a player on his new team (roles then re-rank within the new team).
    dc_current = None  # current depth-chart snapshot, reused below for role assignment
    if fallback:
        try:
            ros = load_rosters(season)
            gid = "gsis_id" if "gsis_id" in ros.columns else "player_id"
            # nflverse team codes drift between sources — rosters use "AZ" for
            # Arizona while PBP/schedules use "ARI". Unfixed, remapped players
            # land on a team code the schedule never matches and silently drop
            # off the slate entirely (this is how Trey McBride disappeared and
            # Zay Jones, never found in the roster snapshot so left on his old
            # "ARI" tag by the .get(pid, t) fallback, wrongly became "WR1").
            TEAM_CODE_FIX = {"AZ": "ARI"}
            team26 = dict(zip(ros[gid].dropna(),
                              ros.loc[ros[gid].notna(), "team"].map(lambda t: TEAM_CODE_FIX.get(t, t))))
            # The seasonal roster snapshot lags behind real transactions (e.g.
            # missed Stefon Diggs leaving NE for WAS entirely — he wasn't in it
            # at all, so he kept his stale 2025 "NE" tag and his old NE role).
            # The depth chart is scraped ~daily and stays current, so it wins
            # wherever it disagrees with the roster table.
            dc_current = load_depth_charts(season)
            dc_current = dc_current[dc_current["dt"] == dc_current["dt"].max()]
            team_dc = dict(zip(dc_current["gsis_id"].dropna(),
                               dc_current.loc[dc_current["gsis_id"].notna(), "team"]))
            team26 = {**team26, **team_dc}
            team_of = pd.Series({pid: team26.get(pid, t) for pid, t in team_of.items()}, name="team")
            team_of.index.name = "pid"
        except Exception:
            pass

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
    # Overall usage (targets+carries), for the general usage-share input to player_TD_share.
    P["touches"] = P["targets"] + P["carries"]
    team_touches = P.groupby("team")["touches"].sum().rename("team_touches")

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

    # Fallback role override: preseason has no real current-season usage, and
    # reverse-engineering roles from an injury-affected prior season misranks
    # anyone who missed time (a healthy-again WR1 buried behind a compiler who
    # played every game). The official depth chart reflects the team's CURRENT
    # plan, so wherever it has ANY coverage for a (team, position), it becomes
    # the SOLE authority for that slot — every player mapped there who isn't
    # explicitly listed gets dropped too, not left holding a leftover
    # usage-based label (e.g. a released/traded-away veteran's stale "TE2" from
    # 2025 stats surviving alongside the real depth chart's TE2). Usage-based
    # role_map only stays as the fallback for (team, position) pairs the
    # depth-chart scrape has zero rows for at all.
    if fallback and dc_current is not None:
        try:
            dc = dc_current[dc_current["pos_abb"].isin(C.ROLE_TIERS.keys()) & dc_current["gsis_id"].notna()]
            dc = dc.sort_values(["team", "pos_abb", "pos_rank"])
            dc_role_map = {}
            covered_groups = set()
            for (team, pos), grp in dc.groupby(["team", "pos_abb"]):
                covered_groups.add((team, pos))
                for i, pid in enumerate(grp["gsis_id"]):
                    dc_role_map[pid] = _role(pos, i + 1)
            if dc_role_map:
                # Drop anyone the usage-based ranker placed in a (team, position)
                # the depth chart covers but didn't list them for.
                for pid, team, pos in zip(R.index, R["team"], R["position"]):
                    if (team, pos) in covered_groups and pid not in dc_role_map:
                        role_map[pid] = None
                role_map = {**role_map, **dc_role_map}
        except Exception:
            pass  # keep the usage-based role_map if depth-chart data is unavailable

    P["role"] = P.index.map(role_map)

    # per-game logs (player log + role-vs-defense log)
    avail = _availability(hist, hist_week)
    key_off_map, key_def_map = avail[0], avail[1]
    season_raw_log = _raw_game_log(prior)
    player_logs, role_vs_def = _game_logs(season_raw_log, role_map, name_map, avail, espn_map, headshot_map)

    # One season further back — powers the Game-Overview "Lineups" splits
    # ('last season' row, and part of the 'vs this opponent' search window).
    last_season_raw_log = None
    lp = None
    try:
        lp = load_pbp(hist - 1)
        lp = lp[lp["season_type"] == "REG"]
        if not lp.empty:
            last_season_raw_log = _raw_game_log(lp)
        else:
            lp = None
    except Exception:
        lp = None

    # ── Touchdowns tab: team offense split, defense-vs-role table, rusher/
    # receiver stat tables — computed once per season (not per game) and
    # sliced per-team below. Keyed by the REAL calendar year (`season`/
    # `season - 1`) so the toggle always reads "2026 / 2025" — NOT `hist`/
    # `hist - 1`, which during the preseason fallback resolve to 2025/2024 and
    # showed the wrong years entirely.
    # `reg` is the TRUE current-season REG frame (empty pre-season, since the
    # fallback branch above only reassigns `prior`, never `reg`); `prior` IS
    # season-1's real data when fallback fired (hist == season - 1).
    current_season_pbp = reg
    last_full_season_pbp = prior if fallback else lp
    # A truly-empty pre-season pull is a zero-COLUMN frame (not just zero
    # rows) — calling any aggregation on it throws KeyError, so require a
    # real schema before computing. The "season" key still always gets added
    # below (empty/blank) so the frontend's year toggle always offers both
    # years, matching the Matchup Factors ATS/Last-5 precedent.
    def _usable(df):
        return df is not None and not df.empty and "receiver_player_id" in df.columns

    offense_split_by_year = {season: {}}
    stats_by_year = {season: pd.DataFrame()}
    against_by_year = {season: {}}
    if _usable(current_season_pbp):
        offense_split_by_year[season] = _team_offense_split(current_season_pbp)
        stats_by_year[season] = _player_season_stats(current_season_pbp)
        # Against-stats uses EACH season's OWN role assignments — evaluating
        # who a defense faced through a DIFFERENT season's depth chart would
        # misjudge its actual history against whoever really held that role.
        against_by_year[season] = _against_stats(current_season_pbp, _season_role_map(current_season_pbp, pos_map))
    if _usable(last_full_season_pbp):
        offense_split_by_year[season - 1] = _team_offense_split(last_full_season_pbp)
        stats_by_year[season - 1] = _player_season_stats(last_full_season_pbp)
        against_by_year[season - 1] = _against_stats(last_full_season_pbp, _season_role_map(last_full_season_pbp, pos_map))

    rusher_by_team, receiver_by_team = _rusher_receiver_tables(
        role_map, team_of.to_dict(), name_map, stats_by_year, offense_split_by_year)

    # ── defense-vs-ROLE vulnerability (TD-weighted blend, regressed) ──────────
    tds_df["position"] = tds_df["pid"].map(pos_map)
    tds_df = tds_df[tds_df["position"].isin(C.SCORING_POSITIONS)].copy()
    tds_df["role"] = tds_df["pid"].map(role_map)
    def_games = prior.groupby("defteam")["game_id"].nunique().rename("def_games")

    rec_o = rec[["defteam", "receiver_player_id", "yards_gained", "yardline_100"]].rename(columns={"receiver_player_id": "pid"})
    rush_o = rush[["defteam", "rusher_player_id", "yards_gained", "yardline_100"]].rename(columns={"rusher_player_id": "pid"})
    opp_df = pd.concat([rec_o, rush_o], ignore_index=True).dropna(subset=["defteam"])
    opp_df["role"] = opp_df["pid"].map(role_map)
    opp_df["position"] = opp_df["pid"].map(pos_map)
    rz_opp_df = opp_df[opp_df["yardline_100"] <= C.RZ_YARDLINE]

    # Usage-share denominators: ALL touches (any role/position) a defense has
    # allowed — general and red-zone-only. A role's usage-SHARE-allowed is its
    # slice of this pie, so it's pace-independent (unlike a raw per-game count).
    total_touches_by_def = opp_df.groupby("defteam").size().rename("def_total_touches")
    total_rz_by_def = rz_opp_df.groupby("defteam").size().rename("def_total_rz")

    def _vuln(key: str) -> pd.DataFrame:
        """Per (defteam, key): TD/yards allowed + usage-share allowed (general
        and red-zone), blended into a vulnerability ratio vs the key's league
        average (>1 soft, <1 tough)."""
        td = tds_df.dropna(subset=[key]).groupby(["defteam", key]).size().rename("td")
        yd = opp_df.dropna(subset=[key]).groupby(["defteam", key])["yards_gained"].sum().rename("yd")
        op = opp_df.dropna(subset=[key]).groupby(["defteam", key]).size().rename("op")
        rz_op = rz_opp_df.dropna(subset=[key]).groupby(["defteam", key]).size().rename("rz_op")
        d = pd.concat([td, yd, op, rz_op], axis=1).fillna(0).reset_index().rename(columns={key: "key"})
        d = d.merge(def_games, left_on="defteam", right_index=True)
        d = d.merge(total_touches_by_def, left_on="defteam", right_index=True, how="left")
        d = d.merge(total_rz_by_def, left_on="defteam", right_index=True, how="left")
        d[["def_total_touches", "def_total_rz"]] = d[["def_total_touches", "def_total_rz"]].fillna(0)

        d["td_rate"] = d["td"] / d["def_games"]
        d["yd_rate"] = d["yd"] / d["def_games"]
        # Usage SHARE of the defense's total touches/RZ-touches allowed — a
        # ratio of counts, so per-game normalization isn't needed (games cancel).
        d["usage_share"] = (d["op"] / d["def_total_touches"].replace(0, np.nan)).fillna(0)
        d["rz_usage_share"] = (d["rz_op"] / d["def_total_rz"].replace(0, np.nan)).fillna(0)

        lg = d.groupby("key")[["td_rate", "yd_rate", "usage_share", "rz_usage_share"]].mean().rename(columns=lambda c: "lg_" + c)
        d = d.merge(lg, left_on="key", right_index=True)
        ratio = lambda a, b: (d[a] / d[b].replace(0, np.nan)).fillna(1.0)
        d["blend"] = (C.DVP_TD_WEIGHT * ratio("td_rate", "lg_td_rate")
                      + C.DVP_YDS_WEIGHT * ratio("yd_rate", "lg_yd_rate")
                      + C.DVP_USAGE_WEIGHT * ratio("usage_share", "lg_usage_share")
                      + C.DVP_RZ_USAGE_WEIGHT * ratio("rz_usage_share", "lg_rz_usage_share"))
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
    # ATS + Last-5 for BOTH years — this season is legitimately 0-0/empty
    # pre-season, so last season's real record gives users an actual data
    # point until the current season has games of its own.
    ats_by_team, last5_by_team = _matchup_factors(sched, week)
    ats_by_year = {season: ats_by_team}
    last5_by_year = {season: last5_by_team}
    try:
        last_season_sched = load_schedules(season - 1)
        last_max_week = int(last_season_sched["week"].max()) + 1
        ats_last, last5_last = _matchup_factors(last_season_sched, last_max_week)
        ats_by_year[season - 1] = ats_last
        last5_by_year[season - 1] = last5_last
    except Exception:
        pass
    ATS_EMPTY = {k: {"record": "0-0", "pct": None} for k in ("total", "home", "away", "favored", "underdog")}

    wk = sched[sched["week"] == week].sort_values(
        [c for c in ("gameday", "gametime") if c in sched.columns])
    games = []
    for g in wk.itertuples():
        home, away = g.home_team, g.away_team
        # books may not have posted Week 1 numbers yet -> neutral baseline total.
        # (schedule fields can be NaN; NaN != NaN, so guard before float().)
        _t = getattr(g, "total_line", None)
        total = float(_t) if (_t is not None and _t == _t and _t) else (44.0 if fallback else 0.0)
        _s = getattr(g, "spread_line", None)
        spread = float(_s) if (_s is not None and _s == _s) else 0.0
        home_imp = round(total / 2 + spread / 2, 1)
        away_imp = round(total / 2 - spread / 2, 1)
        game_players = []
        for team, opp, is_home, imp in ((home, away, True, home_imp), (away, home, False, away_imp)):
            roster = P[P["team"] == team]
            trz = team_rz.get(team, 0.0) or 1.0
            ttd = team_tds.get(team, 0.0) or 1.0
            ttouch = team_touches.get(team, 0.0) or 1.0
            eteam = exp_team_tds(imp)
            for pid, r in roster.iterrows():
                role = r["role"]
                if not isinstance(role, str):  # None/NaN — deeper than WR3/RB2/TE2, drop
                    continue
                rz_share = r["rz_opps"] / trz
                usage_share = r["touches"] / ttouch
                td_share = r["tds"] / ttd
                share = (C.SHARE_RZ_WEIGHT * rz_share
                         + C.SHARE_USAGE_WEIGHT * usage_share
                         + C.SHARE_TD_WEIGHT * td_share)
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
                    "headshot": (lambda h: h if isinstance(h, str) and h else None)(headshot_map.get(pid)),
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
                    "usage_share": round(float(usage_share), 3),
                    "rz_targets_pg": round(r["rz_targets"] / gp, 2),
                    "inside10_carries_pg": round(r["inside10_carries"] / gp, 2),
                    "targets_pg": round(r["targets"] / gp, 2),
                    "carries_pg": round(r["carries"] / gp, 2),
                    "air_yards": int(r["air_yards"]),
                    "snap_pct": round(float(snap_map.get(pid, 0.0)), 3),
                    "implied_team_total": imp,
                    "game_log": player_logs.get(pid, []),
                    "role_vs_def_log": role_vs_def.get(opp, {}).get(role, []),
                    "key_teammates": [p for p in key_off_map.get(team, []) if p != r["name"]],
                    "key_defenders": key_def_map.get(opp, []),
                    # Game-Overview "Lineups" split table — only the 4 marquee
                    # starters get this (matches the reference: QB/RB1/WR1/TE1).
                    "lineup_splits": (_lineup_splits(season_raw_log, last_season_raw_log, pid, opp, hist, hist - 1)
                                      if role in ("QB", "RB1", "WR1", "TE1") else None),
                })
        game_players.sort(key=lambda p: p["score"], reverse=True)
        _str_or_none = lambda v: v if isinstance(v, str) else None
        _num_or_none = lambda v: float(v) if (v is not None and v == v) else None
        games.append({
            "game_id": g.game_id, "away_team": away, "home_team": home,
            "roof": _str_or_none(getattr(g, "roof", None)),
            "surface": _str_or_none(getattr(g, "surface", None)),
            "stadium": _str_or_none(getattr(g, "stadium", None)),
            "weather_temp": _num_or_none(getattr(g, "temp", None)),
            "weather_wind": _num_or_none(getattr(g, "wind", None)),
            "total_line": total, "spread_line": spread,
            "away_implied": away_imp, "home_implied": home_imp,
            "kickoff": _kickoff(getattr(g, "gametime", "")),
            "gameday": str(getattr(g, "gameday", "")),
            "away_record": record(away), "home_record": record(home),
            "away_ats": {y: d.get(away, ATS_EMPTY) for y, d in ats_by_year.items()},
            "home_ats": {y: d.get(home, ATS_EMPTY) for y, d in ats_by_year.items()},
            "away_last5": {y: d.get(away, []) for y, d in last5_by_year.items()},
            "home_last5": {y: d.get(home, []) for y, d in last5_by_year.items()},
            # Touchdowns tab — offense split, defense-vs-role table (the
            # OPPONENT'S, since that's who this team's offense actually faces),
            # and rusher/receiver stat tables. Both years, keyed by season.
            "away_offense_split": {y: d.get(away, {}) for y, d in offense_split_by_year.items()},
            "home_offense_split": {y: d.get(home, {}) for y, d in offense_split_by_year.items()},
            "away_against": {y: d.get(home, {}) for y, d in against_by_year.items()},
            "home_against": {y: d.get(away, {}) for y, d in against_by_year.items()},
            "away_rushers": rusher_by_team.get(away, []), "home_rushers": rusher_by_team.get(home, []),
            "away_receivers": receiver_by_team.get(away, []), "home_receivers": receiver_by_team.get(home, []),
            "players": game_players,
        })
    meta = {"sport": "nfl", "market": "anytime_td", "season": season, "week": week}
    return meta, games
