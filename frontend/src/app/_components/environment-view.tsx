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
// Weather Boost View — only weather factors, no park
// ═══════════════════════════════════════════════════════════════════════════════
function WeatherView({ games }: { games: GameEnv[] }) {
  // Weather-only score: temp 30%, wind 40%, humidity 15%, pressure 15%
  const withWeatherScore = games.map((g) => {
    const ws = 0.30 * g.temp_norm + 0.40 * g.wind_norm + 0.15 * g.humid_norm + 0.15 * (g.pressure_norm ?? 0.5);
    return { ...g, weather_score: ws };
  });
  const sorted = [...withWeatherScore].sort((a, b) => b.weather_score - a.weather_score);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Weather-only boost — park factors excluded. Shows which games have the best game-day conditions for HRs.
      </p>
      {sorted.map((g) => {
        const score100 = Math.round(g.weather_score * 100);
        const rating = ratingLabel(g.weather_score);
        return (
          <div key={g.game_pk} className="border border-card-border rounded-xl bg-card/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground text-lg">{g.away_team} @ {g.home_team}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${rating.cls}`}>{rating.label}</span>
                {g.is_dome && <span className="px-2 py-0.5 text-[10px] rounded bg-card-border text-muted">Dome</span>}
              </div>
              <ScoreCircle score={score100} env_score={g.weather_score} label="WX" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <WeatherCard label="Temperature" value={g.temperature_f !== null ? `${g.temperature_f}°F` : "?"} norm={g.temp_norm}
                note={g.temperature_f && g.temperature_f >= 80 ? "Hot — ball carries well" : g.temperature_f && g.temperature_f >= 65 ? "Moderate" : "Cool — denser air"} weight="30%" />
              <WeatherCard label="Wind" value={g.is_dome ? "Dome" : `${g.wind_speed_mph ?? "?"}mph`} norm={g.wind_norm}
                note={windLabel(g.wind_score, g.is_dome)} weight="40%" />
              <WeatherCard label="Humidity" value={g.humidity !== null ? `${g.humidity}%` : "?"} norm={g.humid_norm}
                note={g.humidity && g.humidity >= 60 ? "Less air resistance" : "Drier air"} weight="15%" />
              <WeatherCard label="Pressure" value={g.pressure_hpa !== null ? `${g.pressure_hpa} hPa` : "?"} norm={g.pressure_norm ?? 0.5}
                note={g.pressure_hpa && g.pressure_hpa < 1000 ? "Low — thinner air" : "Standard"} weight="15%" />
            </div>
          </div>
        );
      })}
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

function WeatherCard({ label, value, norm, note, weight }: { label: string; value: string; norm: number; note: string; weight: string }) {
  const color = norm >= 0.5 ? "bg-accent-green" : norm >= 0.3 ? "bg-accent-yellow" : "bg-accent-red";
  return (
    <div className="bg-background/30 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
        <span className="text-[9px] text-accent font-mono">{weight}</span>
      </div>
      <div className="text-xl font-bold font-mono text-foreground mb-0.5">{value}</div>
      <div className="text-[10px] text-muted mb-2">{note}</div>
      <Bar pct={norm * 100} color={color} />
      <div className="text-right text-[9px] text-muted mt-1">{Math.round(norm * 100)}%</div>
    </div>
  );
}
