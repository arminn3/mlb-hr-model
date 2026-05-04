"use client";

import type { GameEnvironment } from "./types";

// MLB team ID mapping for logo URLs + full names
const TEAMS: Record<string, { id: number; name: string; city: string }> = {
  ARI: { id: 109, name: "Diamondbacks", city: "Arizona" },
  AZ:  { id: 109, name: "Diamondbacks", city: "Arizona" },
  ATL: { id: 144, name: "Braves",        city: "Atlanta" },
  BAL: { id: 110, name: "Orioles",       city: "Baltimore" },
  BOS: { id: 111, name: "Red Sox",       city: "Boston" },
  CHC: { id: 112, name: "Cubs",          city: "Chicago" },
  CIN: { id: 113, name: "Reds",          city: "Cincinnati" },
  CLE: { id: 114, name: "Guardians",     city: "Cleveland" },
  COL: { id: 115, name: "Rockies",       city: "Colorado" },
  CWS: { id: 145, name: "White Sox",     city: "Chicago" },
  DET: { id: 116, name: "Tigers",        city: "Detroit" },
  HOU: { id: 117, name: "Astros",        city: "Houston" },
  KC:  { id: 118, name: "Royals",        city: "Kansas City" },
  LAA: { id: 108, name: "Angels",        city: "Los Angeles" },
  LAD: { id: 119, name: "Dodgers",       city: "Los Angeles" },
  MIA: { id: 146, name: "Marlins",       city: "Miami" },
  MIL: { id: 158, name: "Brewers",       city: "Milwaukee" },
  MIN: { id: 142, name: "Twins",         city: "Minnesota" },
  NYM: { id: 121, name: "Mets",          city: "New York" },
  NYY: { id: 147, name: "Yankees",       city: "New York" },
  OAK: { id: 133, name: "Athletics",     city: "Oakland" },
  ATH: { id: 133, name: "Athletics",     city: "Oakland" },
  PHI: { id: 143, name: "Phillies",      city: "Philadelphia" },
  PIT: { id: 134, name: "Pirates",       city: "Pittsburgh" },
  SD:  { id: 135, name: "Padres",        city: "San Diego" },
  SDP: { id: 135, name: "Padres",        city: "San Diego" },
  SEA: { id: 136, name: "Mariners",      city: "Seattle" },
  SF:  { id: 137, name: "Giants",        city: "San Francisco" },
  STL: { id: 138, name: "Cardinals",     city: "St. Louis" },
  TB:  { id: 139, name: "Rays",          city: "Tampa Bay" },
  TEX: { id: 140, name: "Rangers",       city: "Texas" },
  TOR: { id: 141, name: "Blue Jays",     city: "Toronto" },
  WSH: { id: 120, name: "Nationals",     city: "Washington" },
};

const ESPN_ABBR: Record<string, string> = { AZ: "ari", ATH: "oak", SDP: "sd" };

export function teamLogoUrl(abbr: string): string {
  const code = ESPN_ABBR[abbr] ?? abbr.toLowerCase();
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/mlb/500/${code}.png&h=80&w=80`;
}

export function teamName(abbr: string): string {
  return TEAMS[abbr]?.name || abbr;
}

export function teamCity(abbr: string): string {
  return TEAMS[abbr]?.city || abbr;
}

function parkLabel(pf: number): { text: string; color: string } {
  const pct = Math.round(pf - 100);
  if (pct > 0) return { text: `+${pct}% HRs`, color: "text-accent-green" };
  if (pct < 0) return { text: `${pct}% HRs`, color: "text-accent-red" };
  return { text: "Neutral Park", color: "text-muted" };
}

function windLabel(score: number, isDome: boolean, speed: number | null): { text: string; color: string } {
  if (isDome) return { text: "Dome", color: "text-muted" };
  const spd = speed ?? 0;
  if (score > 5)  return { text: `${spd}mph Out`, color: "text-accent-green" };
  if (score > 2)  return { text: `${spd}mph Out`, color: "text-accent-yellow" };
  if (score < -5) return { text: `${spd}mph In`,  color: "text-accent-red" };
  if (score < -2) return { text: `${spd}mph In`,  color: "text-accent-yellow" };
  return { text: spd > 0 ? `${spd}mph Neutral` : "Calm", color: "text-muted" };
}

function envRating(score: number): { label: string; color: string; ring: string } {
  if (score >= 0.65) return { label: "Excellent", color: "text-accent-green", ring: "rgba(74,222,128,0.5)" };
  if (score >= 0.50) return { label: "Good",      color: "text-accent-green", ring: "rgba(74,222,128,0.3)" };
  if (score >= 0.35) return { label: "Average",   color: "text-accent-yellow", ring: "rgba(251,191,36,0.4)" };
  return { label: "Poor", color: "text-accent-red", ring: "rgba(248,113,113,0.4)" };
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
  const rating   = envRating(env.env_score);
  const scoreOut = Math.round(env.env_score * 100);
  const park     = parkLabel(env.park_factor);
  const wind     = windLabel(env.wind_score, env.is_dome, env.wind_speed_mph ?? null);

  return (
    <div
      className="rounded-xl p-6 mb-0"
      style={{
        background: "linear-gradient(160deg, rgba(30,30,40,0.95) 0%, rgba(18,18,26,1) 100%)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 8px 32px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Teams row */}
      <div className="flex items-center justify-between">
        {/* Away team */}
        <div className="flex flex-col items-center gap-2 flex-1">
          <img src={teamLogoUrl(awayTeam)} alt={awayTeam} className="w-16 h-16 object-contain drop-shadow-lg" />
          <div className="text-center">
            <div className="text-[11px] text-muted uppercase tracking-widest font-semibold">{teamCity(awayTeam)}</div>
            <div className="text-xl font-bold text-foreground leading-tight">{teamName(awayTeam)}</div>
          </div>
        </div>

        {/* Center: time + env */}
        <div className="flex flex-col items-center gap-3 px-4">
          {gameTime && (
            <span className="text-sm font-mono text-muted">{gameTime.replace(" ET","")}</span>
          )}
          <span className="text-muted/40 text-lg font-light">@</span>
          {/* Env score */}
          <div
            className="w-14 h-14 rounded-full flex flex-col items-center justify-center"
            style={{ border: `2px solid ${rating.ring}`, background: "rgba(0,0,0,0.3)" }}
          >
            <span className={`text-lg font-bold font-mono leading-none ${rating.color}`}>{scoreOut}</span>
            <span className="text-[8px] text-muted/60 uppercase tracking-widest mt-0.5">ENV</span>
          </div>
        </div>

        {/* Home team */}
        <div className="flex flex-col items-center gap-2 flex-1">
          <img src={teamLogoUrl(homeTeam)} alt={homeTeam} className="w-16 h-16 object-contain drop-shadow-lg" />
          <div className="text-center">
            <div className="text-[11px] text-muted uppercase tracking-widest font-semibold">{teamCity(homeTeam)}</div>
            <div className="text-xl font-bold text-foreground leading-tight">{teamName(homeTeam)}</div>
          </div>
        </div>
      </div>

      {/* Context chips row */}
      <div className="flex items-center justify-center flex-wrap gap-2 mt-5 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {env.temperature_f !== null && (
          <ContextChip label="TEMP" value={`${env.temperature_f}°F`} valueColor="text-foreground" />
        )}
        <ContextChip label="WIND" value={wind.text} valueColor={wind.color} />
        <ContextChip label="PARK" value={park.text} valueColor={park.color} />
        {env.humidity !== null && (
          <ContextChip label="HUMID" value={`${env.humidity}%`} valueColor="text-muted" />
        )}
        {env.is_dome && (
          <span className="px-2.5 py-1 text-[10px] font-semibold rounded-full bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider">Dome</span>
        )}
      </div>
    </div>
  );
}

function ContextChip({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <span className="text-[9px] uppercase tracking-widest text-muted/60 font-semibold">{label}</span>
      <span className={`text-[11px] font-semibold font-mono ${valueColor}`}>{value}</span>
    </div>
  );
}
