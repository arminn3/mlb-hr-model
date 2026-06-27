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
  ld_pct: number;
  gb_pct: number;
  hard_hit_pct: number;
  data_quality: string;
  recent_abs: RecentAB[];
  xwoba?: number;
  sweet_spot?: number;
  avg_la?: number;
  blast_pct?: number;
  pull_brl?: number;
  swstr?: number;
  bip?: number;
}

export interface ZoneEntry {
  zone: number;
  bip: number;
  hrs: number;
  barrels: number;
  barrel_rate: number;
  hr_rate: number;
  hard_hits: number;
}

export interface PitchDetailEntry {
  usage_pct: number;
  weight: number;
  barrel_rate: number;
  fb_rate: number;
  ld_rate?: number;
  gb_rate?: number;
  hard_hit_rate: number;
  avg_exit_velo: number;
  avg_launch_angle?: number | null;
  count?: number;
  whiff_pct?: number;
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
  bbe?: number;
  ba?: number | null;
  woba?: number | null;
  slg?: number | null;
  iso?: number | null;
  hr?: number;
  bb_pct?: number | null;
  k_pct?: number | null;
}

export interface PitcherGameLog {
  date: string;
  bf: number;
  hits: number;
  hr: number;
  k: number;
  bb: number;
  woba: number | null;
}

export interface PitcherProfile {
  rows: { season: PitcherStatRow; vs_L: PitcherStatRow; vs_R: PitcherStatRow };
  arsenal: PitcherArsenalEntry[];
  arsenal_vs_L?: PitcherArsenalEntry[];
  arsenal_vs_R?: PitcherArsenalEntry[];
  recent_logs_vs_L?: PitcherGameLog[];
  recent_logs_vs_R?: PitcherGameLog[];
  /** Rolling stat rows over the pitcher's most recent N starts. Each entry
   *  has three sub-rows so the vs LHB / vs RHB filter works inside any window. */
  windows?: Partial<Record<
    "last_1" | "last_3" | "last_5" | "last_7" | "last_10",
    { season: PitcherStatRow; vs_L?: PitcherStatRow; vs_R?: PitcherStatRow }
  >>;
  wins: number;
  losses: number;
  games_started: number;
  data_year?: number;
}

export interface PitcherStats {
  fb_rate: number;
  gb_rate: number;
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
  batter_zones?: ZoneEntry[];
  pitcher_zones?: ZoneEntry[];
  pitcher_zone_freq?: { zone: number; count: number; pct: number }[];
  season_stats?: Record<string, SeasonStats>;
  season_profile?: {
    barrel: number;
    ev: number;
    fb: number;
    ld: number;
    gb: number;
    hard_hit: number;
    bip_count: number;
    hrs: number;
    iso: number;
    pull_barrel?: number;
    pull_air?: number;
    xwoba?: number;
    sweet_spot?: number;
    avg_la?: number;
    blast?: number;
    season_abs?: RecentAB[];
  };
  /** 3-year aggregate (2024+2025+current) of season_profile-shape stats,
   *  BIP-weighted merged with the existing season_profile. Used by the
   *  Test sub-tab on the Rankings page. */
  three_year_profile?: {
    barrel: number;
    ev: number;
    fb: number;
    ld?: number;
    gb?: number;
    hard_hit?: number;
    bip_count: number;
    hrs?: number;
    iso?: number;
    pull_barrel?: number;
    pull_air?: number;
    xwoba?: number;
    sweet_spot?: number;
    avg_la?: number;
    blast?: number;
    years?: string;
  };
  matchup_swstr?: number;
  pitcher_data_year?: number;
  hr_signals?: {
    barrel_heat: boolean;
    pull_power: boolean;
    drought: {
      bips_since_hr: number;
      expected_gap: number;
      z_score: number;
      triggered: boolean;
    } | null;
    pitcher_vulnerable: boolean;
    park_friendly: boolean;
  } | null;
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
  wind_gust_mph?: number | null;
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
  weather_hr_pct?: number;
  park_hr_pct?: number;
  combined_hr_pct?: number;
  empirical_hr_pct?: number;
  empirical_n_games?: number;
  empirical_temp_label?: string | null;
  empirical_wind_label?: string | null;
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

export interface BullpenEntry {
  id: number;
  name: string;
  last_date: string;
  days_rest: number;
  pitches: number;
  ip: string;
  status: "fresh" | "available" | "questionable" | "tired";
  era: number | null;
  hr9: number | null;
  k_pct: number | null;
  whip: number | null;
  g: number | null;
}

export interface BullpenQuality {
  tier: 1 | 2 | 3;
  label: "Elite" | "Average" | "Vulnerable";
  avg_era: number | null;
  avg_hr9: number | null;
  avg_k_pct: number | null;
  tired_count: number;
}

export interface TeamBullpen {
  arms: BullpenEntry[];
  quality: BullpenQuality;
}

export interface GameData {
  game_pk: number;
  away_team: string;
  home_team: string;
  game_time?: string;
  game_time_sort?: number;
  game_status?: string;
  game_status_reason?: string;
  away_pitcher: PitcherInfo;
  home_pitcher: PitcherInfo;
  environment: GameEnvironment;
  players: PlayerData[];
  team_pitch_mix?: TeamPitchMix;
  bullpen?: { away: TeamBullpen; home: TeamBullpen };
}

export interface ModelData {
  date: string;
  generated_at: string;
  games: GameData[];
}
