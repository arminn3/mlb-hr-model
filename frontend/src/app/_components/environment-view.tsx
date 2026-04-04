"use client";

import { useState } from "react";

interface GameEnv {
  game_pk: number;
  away_team: string;
  home_team: string;
  park_factor: number;
  temperature_f: number | null;
  wind_speed_mph: number | null;
  wind_direction: number | null;
  wind_score: number;
  humidity: number | null;
  pressure_hpa: number | null;
  is_dome: boolean;
  park_norm: number;
  temp_norm: number;
  wind_norm: number;
  humid_norm: number;
  pressure_norm?: number;
  env_score: number;
}

type EnvTab = "combined" | "weather" | "parks";

function ratingLabel(score: number): { label: string; cls: string } {
  if (score >= 0.65) return { label: "Excellent", cls: "bg-accent-green/15 text-accent-green" };
  if (score >= 0.50) return { label: "Good", cls: "bg-accent-green/15 text-accent-green" };
  if (score >= 0.35) return { label: "Average", cls: "bg-accent-yellow/15 text-accent-yellow" };
  return { label: "Poor", cls: "bg-accent-red/15 text-accent-red" };
}

function ratingColor(score: number): string {
  if (score >= 0.5) return "text-accent-green";
  if (score >= 0.35) return "text-accent-yellow";
  return "text-accent-red";
}

function borderColor(score: number): string {
  if (score >= 0.5) return "border-accent-green";
  if (score >= 0.35) return "border-accent-yellow";
  return "border-accent-red";
}

function windLabel(score: number, isDome: boolean): string {
  if (isDome) return "Dome";
  if (score > 5) return "OUT (strong)";
  if (score > 2) return "OUT (mild)";
  if (score < -5) return "IN (strong)";
  if (score < -2) return "IN (mild)";
  return "Neutral";
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-2 bg-card-border rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function EnvironmentView({ games }: { games: GameEnv[] }) {
  const [tab, setTab] = useState<EnvTab>("combined");

  if (!games || games.length === 0) {
    return <div className="text-center text-muted text-sm py-12">No environment data available.</div>;
  }

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1 w-fit mb-6">
        {([
          { key: "combined" as const, label: "Combined" },
          { key: "weather" as const, label: "Weather Boost" },
          { key: "parks" as const, label: "Park Factors" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 text-xs rounded cursor-pointer transition-colors ${
              tab === t.key ? "bg-accent/15 text-accent font-medium" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "combined" && <CombinedView games={games} />}
      {tab === "weather" && <WeatherView games={games} />}
      {tab === "parks" && <ParksView games={games} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Combined View
// ═══════════════════════════════════════════════════════════════════════════════
function CombinedView({ games }: { games: GameEnv[] }) {
  const sorted = [...games].sort((a, b) => b.env_score - a.env_score);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Combined weather + park factors ranked by HR-friendliness. Environment = 15% of composite score.
      </p>
      {sorted.map((g) => {
        const score100 = Math.round(g.env_score * 100);
        const rating = ratingLabel(g.env_score);
        return (
          <div key={g.game_pk} className="border border-card-border rounded-xl bg-card/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground text-lg">{g.away_team} @ {g.home_team}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${rating.cls}`}>{rating.label}</span>
                {g.is_dome && <span className="px-2 py-0.5 text-[10px] rounded bg-card-border text-muted">Dome</span>}
              </div>
              <ScoreCircle score={score100} env_score={g.env_score} label="ENV" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <FactorCard label="Park" value={`${g.park_factor}`} sub="HR factor" norm={g.park_norm} />
              <FactorCard label="Temp" value={g.temperature_f !== null ? `${g.temperature_f}°F` : "?"} sub={g.temperature_f && g.temperature_f >= 75 ? "Warm — more carry" : "Cool"} norm={g.temp_norm} />
              <FactorCard label="Wind" value={g.is_dome ? "Dome" : `${g.wind_speed_mph ?? "?"}mph`} sub={windLabel(g.wind_score, g.is_dome)} norm={g.wind_norm} />
              <FactorCard label="Humidity" value={g.humidity !== null ? `${g.humidity}%` : "?"} sub={g.humidity && g.humidity >= 60 ? "Humid" : "Dry"} norm={g.humid_norm} />
              <FactorCard label="Pressure" value={g.pressure_hpa !== null ? `${g.pressure_hpa}` : "?"} sub="hPa" norm={g.pressure_norm ?? 0.5} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Weather Boost View — HomeRunPredict style categorized pills
// ═══════════════════════════════════════════════════════════════════════════════

function calcWeatherPct(g: GameEnv): number {
  // Weather HR boost percentage
  // Wind is the primary driver, temp and humidity secondary
  let pct = 0;
  // Wind: each mph of outward wind ≈ +1.2% HR boost
  pct += g.wind_score * 1.2;
  // Temperature: above 72F adds, below 55F subtracts
  if (g.temperature_f) {
    if (g.temperature_f > 72) pct += (g.temperature_f - 72) * 0.3;
    if (g.temperature_f < 55) pct -= (55 - g.temperature_f) * 0.4;
  }
  // Humidity: slight positive effect
  if (g.humidity && g.humidity > 60) pct += (g.humidity - 60) * 0.05;
  // Dome = neutral
  if (g.is_dome) pct = 0;
  return Math.round(pct * 10) / 10;
}

function WeatherView({ games }: { games: GameEnv[] }) {
  const withPct = games.map((g) => ({ ...g, weatherPct: calcWeatherPct(g) }));

  const favorable = withPct.filter(g => g.weatherPct > 5).sort((a, b) => b.weatherPct - a.weatherPct);
  const unfavorable = withPct.filter(g => g.weatherPct < -5).sort((a, b) => a.weatherPct - b.weatherPct);
  const neutral = withPct.filter(g => g.weatherPct >= -5 && g.weatherPct <= 5);

  return (
    <div>
      <h3 className="text-lg font-bold text-foreground mb-4">Weather Impact on Home Runs</h3>

      {/* Favorable */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-accent-green" />
          <span className="text-sm font-semibold text-foreground">HR Favorable Games</span>
          <span className="text-xs text-muted">(Weather increases home run probability)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {favorable.length > 0 ? favorable.map(g => (
            <WeatherPill key={g.game_pk} away={g.away_team} home={g.home_team} pct={g.weatherPct}
              wind={g.wind_speed_mph} temp={g.temperature_f} type="favorable" />
          )) : <span className="text-xs text-muted">No favorable weather games today</span>}
        </div>
      </div>

      {/* Unfavorable */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-accent-red" />
          <span className="text-sm font-semibold text-foreground">HR Unfavorable Games</span>
          <span className="text-xs text-muted">(Weather decreases home run probability)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {unfavorable.length > 0 ? unfavorable.map(g => (
            <WeatherPill key={g.game_pk} away={g.away_team} home={g.home_team} pct={g.weatherPct}
              wind={g.wind_speed_mph} temp={g.temperature_f} type="unfavorable" />
          )) : <span className="text-xs text-muted">No unfavorable weather games today</span>}
        </div>
      </div>

      {/* Neutral */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-muted" />
          <span className="text-sm font-semibold text-foreground">Neutral Impact Games</span>
          <span className="text-xs text-muted">(Minimal weather effect)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {neutral.map(g => (
            <WeatherPill key={g.game_pk} away={g.away_team} home={g.home_team} pct={g.weatherPct}
              wind={g.wind_speed_mph} temp={g.temperature_f} type="neutral" />
          ))}
        </div>
      </div>
    </div>
  );
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Park Factors View — just parks, ranked by HR factor
// ═══════════════════════════════════════════════════════════════════════════════
function ParksView({ games }: { games: GameEnv[] }) {
  const sorted = [...games].sort((a, b) => b.park_factor - a.park_factor);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Static HR park factors — how much each stadium boosts or suppresses home runs regardless of weather.
        100 = neutral. Split by batter handedness where available.
      </p>
      {sorted.map((g) => {
        const pf = g.park_factor;
        const pct = Math.min(((pf - 60) / (140 - 60)) * 100, 100);
        const color = pf >= 110 ? "text-accent-green" : pf >= 95 ? "text-foreground" : pf >= 85 ? "text-accent-yellow" : "text-accent-red";
        const barColor = pf >= 110 ? "bg-accent-green" : pf >= 95 ? "bg-accent-yellow" : "bg-accent-red";
        const tag = pf >= 110 ? "HR Friendly" : pf >= 95 ? "Neutral" : pf >= 85 ? "Slight Suppressor" : "Pitcher Park";
        const tagCls = pf >= 110 ? "bg-accent-green/15 text-accent-green" : pf >= 95 ? "bg-accent-yellow/15 text-accent-yellow" : "bg-accent-red/15 text-accent-red";

        return (
          <div key={g.game_pk} className="border border-card-border rounded-xl bg-card/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-foreground text-lg">{g.away_team} @ {g.home_team}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${tagCls}`}>{tag}</span>
              </div>
              <span className={`text-3xl font-bold font-mono ${color}`}>{pf}</span>
            </div>
            <div className="mb-2">
              <Bar pct={pct} color={barColor} />
            </div>
            <div className="flex justify-between text-[9px] text-muted">
              <span>60 (worst)</span>
              <span>100 (neutral)</span>
              <span>140 (best)</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared sub-components
// ═══════════════════════════════════════════════════════════════════════════════
function ScoreCircle({ score, env_score, label }: { score: number; env_score: number; label: string }) {
  return (
    <div className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center flex-shrink-0 ${borderColor(env_score)}`}>
      <span className={`text-lg font-bold font-mono ${ratingColor(env_score)}`}>{score}</span>
      <span className="text-[7px] text-muted -mt-0.5">{label}</span>
    </div>
  );
}

function FactorCard({ label, value, sub, norm }: { label: string; value: string; sub: string; norm: number }) {
  const color = norm >= 0.5 ? "bg-accent-green" : norm >= 0.3 ? "bg-accent-yellow" : "bg-accent-red";
  return (
    <div className="bg-background/30 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className="text-lg font-bold font-mono text-foreground">{value}</div>
      <div className="text-[10px] text-muted mb-2">{sub}</div>
      <Bar pct={norm * 100} color={color} />
    </div>
  );
}

function WeatherPill({ away, home, pct, wind, temp, type }: {
  away: string; home: string; pct: number;
  wind: number | null; temp: number | null; type: "favorable" | "unfavorable" | "neutral";
}) {
  const borderColor = type === "favorable" ? "border-accent-green/30 bg-accent-green/5" :
    type === "unfavorable" ? "border-accent-red/30 bg-accent-red/5" : "border-card-border bg-card/30";
  const dotColor = type === "favorable" ? "bg-accent-green" : type === "unfavorable" ? "bg-accent-red" : "bg-muted";
  const pctColor = type === "favorable" ? "text-accent-green" : type === "unfavorable" ? "text-accent-red" : "text-muted";

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${borderColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="font-medium text-foreground">{away} @ {home}</span>
      {type !== "neutral" ? (
        <span className={`font-bold font-mono ${pctColor}`}>{pct > 0 ? "+" : ""}{pct}%</span>
      ) : (
        <span className="text-muted font-mono">neutral</span>
      )}
      {wind !== null && (
        <span className="text-muted">{wind}mph wind{pct > 0 ? "+" : pct < 0 ? "-" : ""}</span>
      )}
    </div>
  );
}
