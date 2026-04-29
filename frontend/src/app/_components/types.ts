export type LookbackKey = "L5" | "L10";

export interface RecentAB {
  date: string;
  pitcher_name: string;
  pitch_arm: string;
  pitch_type: string;
  ev: number;
  angle: number;
  distance: number | null;
  result: string;
}

export interface ScoreSet {
  composite: number;
  batter_score: number;
  pitcher_score: number;
  env_score: number;
  exit_velo: number;
  barrel_pct: number;
  fb_pct: number;
  hard_hit_pct: number;
  data_quality: string;
  recent_abs: RecentAB[];
}

export interface PitchDetailEntry {
  usage_pct: number;
  weight: number;
  barrel_rate: number;
  fb_rate: number;
  hard_hit_rate: number;
  avg_exit_velo: number;
  count?: number;
}

export interface PitcherInfo {
  name: string;
  hand: string;
  id?: number | null;
  profile?: PitcherProfile | null;
}

export interface PitcherStatRow {
  ip: number | null;
  bf: number;
  baa: number | null;
  woba: number | null;
  slg: number | null;
  iso: number | null;
  whip: number | null;
  hr: number;
  hr_per_9: number | null;
  bb_pct: number | null;
  whiff_pct: number | null;
  k_pct: number | null;
  meatball_pct: number | null;
  barrel_pct: number | null;
  hard_hit_pct: number | null;
  fb_pct: number | null;
  hr_fb_pct: number | null;
  pullair_pct: number | null;
}

export interface PitcherArsenalEntry {
  type: string;
  name: string;
  usage_pct: number;
  avg_velo?: number | null;
  avg_spin?: number | null;
  whiff_pct: number;
  count: number;
}

export interface PitcherProfile {
  rows: { season: PitcherStatRow; vs_L: PitcherStatRow; vs_R: PitcherStatRow };
  arsenal: PitcherArsenalEntry[];
  wins: number;
  losses: number;
  games_started: number;
}

export interface PitcherStats {
  fb_rate: number;
  hr_fb_rate: number;
  hr_per_9: number;
  ip: number;
  total_hrs: number;
  avg_velo?: number;
  avg_spin?: number;
  avg_vert_break?: number;
  avg_horiz_break?: number;
}

export interface PlayerData {
  name: string;
  batter_hand: string;
  opp_pitcher: string;
  pitcher_hand: string;
  platoon?: number;
  game_num?: number;
  batter_side: "home" | "away";
  pitch_types: string[];
  pitch_detail: Record<string, PitchDetailEntry>;
  pitcher_stats: PitcherStats;
  scores: Record<LookbackKey, ScoreSet>;
  season_stats?: Record<string, SeasonStats>;
  season_profile?: {
    barrel: number;
    ev: number;
    fb: number;
    hard_hit: number;
    bip_count: number;
    hrs: number;
    iso: number;
    pull_barrel?: number;
    pull_air?: number;
  };
  bvp_stats?: {
    career: {
      abs: number;
      hits: number;
      hrs: number;
      ba: number;
      slg: number;
      iso: number;
      k_pct: number;
      pa?: number;
      ops?: number | string;
    };
    recent_abs: Array<{
      date: string;
      pitch_type: string;
      ev: number;
      angle: number;
      result: string;
    }>;
  };
}

export interface PitchTypeSeason {
  type_name: string;
  count: number;
  usage_pct: number;
  ba: number;
  slg: number;
  iso: number;
  woba: number;
  hr: number;
  k_pct: number;
  whiff_pct: number;
}

export interface SeasonStats {
  pitcher: Record<string, PitchTypeSeason>;
  batter: Record<string, PitchTypeSeason>;
}

export interface GameEnvironment {
  park_factor: number;
  temperature_f: number | null;
  wind_speed_mph: number | null;
  wind_direction: number | null;
  wind_score: number;
  humidity: number | null;
  pressure_hpa: number | null;
  is_dome: boolean;
  is_retractable?: boolean;
  roof_closed?: boolean;
  park_norm: number;
  temp_norm: number;
  wind_norm: number;
  humid_norm: number;
  pressure_norm?: number;
  env_score: number;
}

// ── Team vs Pitch Mix ───────────────────────────────────────────────────
// Raw per-PA history for a batter-pitcher career head-to-head. The
// frontend aggregates any (Season × Range × Type × selectedPitchTypes)
// slice dynamically via a pure function. See team-pitch-mix-page.tsx.

export type PAResult =
  | "single" | "double" | "triple" | "home_run"
  | "walk" | "hit_by_pitch"
  | "strikeout" | "strikeout_double_play"
  | "sac_fly" | "sac_bunt" | "intent_walk" | "catcher_interf"
  | "field_out" | "force_out" | "grounded_into_double_play"
  | "fielders_choice" | "fielders_choice_out" | "double_play"
  | "field_error" | "sac_fly_double_play" | string;

export interface PAHistoryEntry {
  date: string;           // "2025-06-14"
  season: number;         // 2025
  pitcher_hand: "R" | "L" | null; // hand of the pitcher faced
  pitch_type: string | null;      // terminating pitch type
  pitches_seen: number;
  is_bbe: boolean;
  ev: number | null;
  la: number | null;
  bat_speed: number | null;
  is_barrel: boolean;
  is_hard_hit: boolean;
  result: PAResult;
  bases: 0 | 1 | 2 | 3 | 4;
  woba_value: number;
}

export interface TeamPitchMixPitcher {
  name: string;
  hand: string;
  pitch_mix_vs_rhb: Record<string, number>; // usage fraction 0-1
  pitch_mix_vs_lhb: Record<string, number>;
}

export interface TeamPitchMixBatter {
  id: number;
  name: string;
  batter_hand: string;    // "R" | "L" | "S"
  order: number | null;   // null = bench/projected, number = lineup slot
  pos: string;
  pa_history: PAHistoryEntry[];
}

export interface TeamPitchMixSide {
  pitcher: TeamPitchMixPitcher;
  lineup_status: "posted" | "projected" | "tbd";
  batters: TeamPitchMixBatter[];
}

export interface TeamPitchMix {
  away: TeamPitchMixSide; // away batters vs home pitcher
  home: TeamPitchMixSide; // home batters vs away pitcher
}

export interface GameData {
  game_pk: number;
  away_team: string;
  home_team: string;
  game_time?: string;
  away_pitcher: PitcherInfo;
  home_pitcher: PitcherInfo;
  environment: GameEnvironment;
  players: PlayerData[];
  team_pitch_mix?: TeamPitchMix;
}

export interface ModelData {
  date: string;
  generated_at: string;
  games: GameData[];
}
