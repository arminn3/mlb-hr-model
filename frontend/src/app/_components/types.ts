export type LookbackKey = "L5" | "L10" | "L15";

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

export interface GameData {
  game_pk: number;
  away_team: string;
  home_team: string;
  game_time?: string;
  away_pitcher: PitcherInfo;
  home_pitcher: PitcherInfo;
  environment: GameEnvironment;
  players: PlayerData[];
}

export interface ModelData {
  date: string;
  generated_at: string;
  games: GameData[];
}
