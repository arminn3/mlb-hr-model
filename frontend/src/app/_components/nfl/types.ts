// NFL slate types — mirror the JSON written by nfl/main.py (Anytime-TD market).

export interface NflPlayer {
  name: string;
  gsis_id: string;
  team: string;
  pos: string;
  opponent: string;
  is_home: boolean;
  score: number;          // anytime-TD probability (0-1)
  expected_tds: number;
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
  dvp_rank: number;       // 1 = softest matchup vs this position
  dvp_mult: number;
  implied_team_total: number;
}

export interface NflGame {
  game_id: string;
  away_team: string;
  home_team: string;
  roof: string | null;
  total_line: number;
  spread_line: number;
  away_implied: number;
  home_implied: number;
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
