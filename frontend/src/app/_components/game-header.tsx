import type { GameEnvironment } from "./types";

// MLB team ID mapping for logo URLs + full names
const TEAMS: Record<string, { id: number; name: string }> = {
  ARI: { id: 109, name: "Diamondbacks" }, AZ: { id: 109, name: "Diamondbacks" },
  ATL: { id: 144, name: "Braves" }, BAL: { id: 110, name: "Orioles" },
  BOS: { id: 111, name: "Red Sox" }, CHC: { id: 112, name: "Cubs" },
  CIN: { id: 113, name: "Reds" }, CLE: { id: 114, name: "Guardians" },
  COL: { id: 115, name: "Rockies" }, CWS: { id: 145, name: "White Sox" },
  DET: { id: 116, name: "Tigers" }, HOU: { id: 117, name: "Astros" },
  KC: { id: 118, name: "Royals" }, LAA: { id: 108, name: "Angels" },
  LAD: { id: 119, name: "Dodgers" }, MIA: { id: 146, name: "Marlins" },
  MIL: { id: 158, name: "Brewers" }, MIN: { id: 142, name: "Twins" },
  NYM: { id: 121, name: "Mets" }, NYY: { id: 147, name: "Yankees" },
  OAK: { id: 133, name: "Athletics" }, ATH: { id: 133, name: "Athletics" },
  PHI: { id: 143, name: "Phillies" }, PIT: { id: 134, name: "Pirates" },
  SD: { id: 135, name: "Padres" }, SDP: { id: 135, name: "Padres" },
  SEA: { id: 136, name: "Mariners" }, SF: { id: 137, name: "Giants" },
  STL: { id: 138, name: "Cardinals" }, TB: { id: 139, name: "Rays" },
  TEX: { id: 140, name: "Rangers" }, TOR: { id: 141, name: "Blue Jays" },
  WSH: { id: 120, name: "Nationals" },
};

// ESPN uses "ari" for Diamondbacks (not "az"), "oak" for Athletics (not "ath"),
// "sd" for Padres (not "sdp"). Our data feed sometimes uses the non-ESPN
// alias — normalize before building the logo URL.
const ESPN_ABBR: Record<string, string> = {
  AZ: "ari",
  ATH: "oak",
  SDP: "sd",
};

export function teamLogoUrl(abbr: string): string {
  const code = ESPN_ABBR[abbr] ?? abbr.toLowerCase();
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/mlb/500/${code}.png&h=40&w=40`;
}

function teamName(abbr: string): string {
  return TEAMS[abbr]?.name || abbr;
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
            <img src={teamLogoUrl(awayTeam)} alt={awayTeam} className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-foreground">{teamName(awayTeam)}</span>
          </div>
          <span className="text-muted text-sm">@</span>
          <div className="flex items-center gap-2">
            <img src={teamLogoUrl(homeTeam)} alt={homeTeam} className="w-7 h-7 object-contain" />
            <span className="text-lg font-bold text-foreground">{teamName(homeTeam)}</span>
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
