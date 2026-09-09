// NFL slate types — mirror the JSON written by nfl/main.py (Anytime-TD market).

export interface GameLogRow {
  date: string;
  week: number;
  opp: string;
  home: boolean;
  atd: number;            // 1 = scored a TD that game
  pass_att: number;
  cmp: number;
  pass_yds: number;
  pass_td: number;
  pass_int: number;
  rush_att: number;
  rush_yds: number;
  rush_td: number;
  targets: number;
  rec: number;
  rec_yds: number;
  rec_td: number;
  name?: string;          // present on role-vs-defense rows (the role-holder)
  team?: string;
  espn_id?: string | null; // role-holder espn id (role-vs-defense rows)
  headshot?: string | null; // role-holder headshot URL (nflverse)
  out?: string[];         // key players who were out (0 snaps) that game
}

export interface NflPlayer {
  name: string;
  gsis_id: string;
  team: string;
  pos: string;
  espn_id: string | null; // for the player headshot
  headshot?: string | null; // nflverse headshot URL (preferred over espn_id)
  role: string;           // usage-based depth role, e.g. "WR2", "RB1"
  opponent: string;
  is_home: boolean;
  score: number;          // anytime-TD probability (0-1)
  expected_tds: number;
  opp_rank_vs_role: number;   // opponent's rank vs this role (highest = softest)
  opp_rank_total: number;     // # of defenses ranked for this role (usually 32)
  role_dvp_mult: number;      // matchup multiplier (>1 soft, <1 tough)
  hit_rate_season: number;
  hit_rate_l5: number;
  games: number;
  tds: number;
  rz_opp_share: number;   // share of team red-zone opportunities (0-1)
  usage_share: number;    // share of team touches (targets+carries), overall (0-1)
  rz_targets_pg: number;
  inside10_carries_pg: number;
  targets_pg: number;
  carries_pg: number;
  air_yards: number;
  snap_pct: number;       // 0-1
  implied_team_total: number;
  game_log: GameLogRow[];         // this player's games (chronological)
  role_vs_def_log: GameLogRow[];  // opposing role-holders vs this player's opponent
  key_teammates?: string[];       // dropdown options for the offense "Without Players" filter
  key_defenders?: string[];       // dropdown options for the defense "Without Players" filter
  lineup_splits?: LineupSplits | null; // Game-Overview split table (QB/RB1/WR1/TE1 starters only)
}

// One row of the Game-Overview "Lineups" split table — a per-game average.
export interface LineupSplit {
  games: number;
  pass_att: number; cmp: number; pass_yds: number; pass_td: number; pass_int: number;
  rush_att: number; rush_yds: number; rush_td: number;
  targets: number; rec: number; rec_yds: number; rec_td: number;
  pass_yd_a: number; rush_yd_a: number; td: number;
}

export interface LineupSplits {
  season: LineupSplit | null;
  home: LineupSplit | null;
  vs_opp: LineupSplit | null;      // null if the two teams haven't met in the loaded window
  last_season: LineupSplit | null; // null for rookies with no prior-season NFL games
  season_year: number;             // calendar year the "season"/"home" rows cover
  last_season_year: number;        // calendar year the "last_season" row covers
}

export interface AtsRecord { record: string; pct: number | null } // e.g. {record:"4-6-1", pct:0.4}
export interface AtsSplits { total: AtsRecord; home: AtsRecord; away: AtsRecord; favored: AtsRecord; underdog: AtsRecord }
export interface LastGameResult {
  date: string; opp: string; home: boolean;
  team_score: number; opp_score: number; won: boolean;
  cover: "w" | "l" | "p"; // ATS result for that game
}

export interface NflGame {
  game_id: string;
  away_team: string;
  home_team: string;
  roof: string | null;
  surface: string | null;
  stadium: string | null;
  weather_temp: number | null; // null until real-time forecast data exists
  weather_wind: number | null;
  kickoff: string;        // time only, e.g. "1:00 pm EST"
  gameday: string;        // ISO date, e.g. "2025-11-09" (for the Today/weekday label)
  total_line: number;
  spread_line: number;
  away_implied: number;
  home_implied: number;
  away_record: string;    // e.g. "8-2"
  home_record: string;
  away_ats: Record<string, AtsSplits>; // keyed by year, e.g. "2026"/"2025" — this season is legitimately 0-0 pre-season
  home_ats: Record<string, AtsSplits>;
  away_last5: Record<string, LastGameResult[]>; // most recent first, capped at 5 — real completed games only
  home_last5: Record<string, LastGameResult[]>;

  // Touchdowns tab (no odds — stats only).
  away_offense_split: Record<string, OffenseSplitYear>; // keyed by year, e.g. "2026"/"2025"
  home_offense_split: Record<string, OffenseSplitYear>;
  away_against: Record<string, Record<string, AgainstRoleStats>>; // year -> role ("All"/"QB"/"RB1"/...) -> stats
  home_against: Record<string, Record<string, AgainstRoleStats>>;
  away_rushers: RusherRow[];
  home_rushers: RusherRow[];
  away_receivers: ReceiverRow[];
  home_receivers: ReceiverRow[];

  players: NflPlayer[];
}

export interface OffenseSplitYear {
  pass_att: number; rush_att: number; pass_att_pct: number; rush_att_pct: number;
  rz_pass_att: number; rz_rush_att: number; rz_pass_att_pct: number; rz_rush_att_pct: number;
}

export interface AgainstRoleStats {
  td: number;
  rush_td: number | null; rush_td_rank: number | null;
  rush_yds: number | null; rush_yds_rank: number | null;
  rec_td: number | null; rec_td_rank: number | null;
  rec_yds: number | null; rec_yds_rank: number | null;
  rank_total: number;
}

export interface RusherYearStats {
  games: number; td: number; rush_td: number; rz_rush_att: number; rush_yds: number; rush_att: number;
  rz_rush_share: number | null;
}
export interface ReceiverYearStats {
  games: number; td: number; rec_td: number; rz_targets: number; rec_yds: number; targets: number;
  rz_tgt_share: number | null;
}
export interface RusherRow { gsis_id: string; name: string; role: string; by_year: Record<string, RusherYearStats> }
export interface ReceiverRow { gsis_id: string; name: string; role: string; by_year: Record<string, ReceiverYearStats> }

export interface NflSlate {
  sport: string;
  market: string;
  season: number;
  week: number;
  generated_at: string;
  games: NflGame[];
}
