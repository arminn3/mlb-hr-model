import type { GameEnvironment } from "./types";

// MLB team ID mapping for logo URLs
const TEAM_IDS: Record<string, number> = {
  ARI: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CIN: 113, CLE: 114,
  COL: 115, CWS: 145, DET: 116, HOU: 117, KC: 118, LAA: 108, LAD: 119,
  MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, OAK: 133, ATH: 133,
  PHI: 143, PIT: 134, SD: 135, SDP: 135, SEA: 136, SF: 137, STL: 138,
  TB: 139, TEX: 140, TOR: 141, WSH: 120, AZ: 109,
};

function teamLogoUrl(abbr: string): string {
  const id = TEAM_IDS[abbr] || 0;
  return `https://www.mlb.com/assets/images/team/svg/${id}.svg`;
}

function envRating(score: number): { label: string; color: string; border: string } {
  if (score >= 0.65) return { label: "Excellent", color: "text-accent-green", border: "border-accent-green" };
  if (score >= 0.50) return { label: "Good", color: "text-accent-green", border: "border-accent-green" };
  if (score >= 0.35) return { label: "Average", color: "text-accent-yellow", border: "border-accent-yellow" };
  return { label: "Poor", color: "text-accent-red", border: "border-accent-red" };
}

function windLabel(score: number, isDome: boolean): string {
  if (isDome) return "Dome";
  if (score > 5) return "OUT (strong)";
  if (score > 2) return "OUT (mild)";
  if (score < -5) return "IN (strong)";
  if (score < -2) return "IN (mild)";
  return "Neutral";
}

export function GameHeader({
  awayTeam,
  homeTeam,
  gameTime,
  env,
}: {
  awayTeam: string;
  homeTeam: string;
  gameTime?: string;
  env: GameEnvironment;
}) {
  const rating = envRating(env.env_score);
  const scoreOut100 = Math.round(env.env_score * 100);

  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        {/* Teams with logos and time */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src={teamLogoUrl(awayTeam)} alt={awayTeam} className="w-8 h-8" />
            <span className="text-xl font-bold text-foreground">{awayTeam}</span>
          </div>
          <span className="text-muted text-sm">@</span>
          <div className="flex items-center gap-2">
            <img src={teamLogoUrl(homeTeam)} alt={homeTeam} className="w-8 h-8" />
            <span className="text-xl font-bold text-foreground">{homeTeam}</span>
          </div>
          {gameTime && (
            <span className="text-sm text-muted ml-2 font-mono">{gameTime}</span>
          )}
        </div>

        {/* Weather chips */}
        <div className="flex flex-wrap gap-2 mt-2">
          <Chip value={env.temperature_f !== null ? `${env.temperature_f}°F` : "?"} />
          <Chip value={env.is_dome ? "Dome" : `${env.wind_speed_mph ?? "?"}mph ${windLabel(env.wind_score, env.is_dome)}`} />
          <Chip value={`Park: ${env.park_factor}`} />
          {env.pressure_hpa && <Chip value={`${env.pressure_hpa} hPa`} />}
          {env.humidity !== null && <Chip value={`${env.humidity}% Humid`} />}
        </div>
      </div>

      {/* Score circle */}
      <div className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center flex-shrink-0 ${rating.border}`}>
        <span className={`text-xl font-bold font-mono ${rating.color}`}>{scoreOut100}</span>
        <span className="text-[8px] text-muted -mt-0.5">ENV</span>
      </div>
    </div>
  );
}

function Chip({ value }: { value: string }) {
  return (
    <span className="px-2 py-0.5 text-[10px] bg-background/50 border border-card-border rounded-full text-muted">
      {value}
    </span>
  );
}
