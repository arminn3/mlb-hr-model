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
}

export interface NflPlayer {
  name: string;
  gsis_id: string;
  team: string;
  pos: string;
  espn_id: string | null; // for the player headshot
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
  rz_targets_pg: number;
  inside10_carries_pg: number;
  targets_pg: number;
  carries_pg: number;
  air_yards: number;
  snap_pct: number;       // 0-1
  implied_team_total: number;
  game_log: GameLogRow[];         // this player's games (chronological)
  role_vs_def_log: GameLogRow[];  // opposing role-holders vs this player's opponent
}

export interface NflGame {
  game_id: string;
  away_team: string;
  home_team: string;
  roof: string | null;
  kickoff: string;        // e.g. "Sun 1:00 PM ET"
  total_line: number;
  spread_line: number;
  away_implied: number;
  home_implied: number;
  away_record: string;    // e.g. "8-2"
  home_record: string;
  players: NflPlayer[];
}

export interface NflSlate {
  sport: string;
  market: string;
  season: number;
  week: number;
  generated_at: string;
  games: NflGame[];
}
