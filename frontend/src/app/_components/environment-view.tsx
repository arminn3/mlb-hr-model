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
function calcCombinedPct(g: GameEnv): { weatherPct: number; parkPct: number; combinedPct: number } {
  const weatherPct = calcWeatherPct(g);
  // Park: 100 = neutral. Every point above/below = ~1% HR boost/reduction
  const parkPct = Math.round((g.park_factor - 100) * 1.0 * 10) / 10;
  // Combined: additive
  const combinedPct = Math.round((weatherPct + parkPct) * 10) / 10;
  return { weatherPct, parkPct, combinedPct };
}

type SortKey = "game" | "weatherPct" | "parkPct" | "combinedPct" | "temp" | "wind" | "parkFactor";
type SortDir = "asc" | "desc" | "none";

function useSortableTable<T>(data: T[], defaultSort: { key: SortKey; dir: SortDir } = { key: "combinedPct", dir: "desc" }) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort.key);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort.dir);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      // Cycle: desc → asc → none → desc
      setSortDir(prev => prev === "desc" ? "asc" : prev === "asc" ? "none" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const arrow = (key: SortKey) => {
    if (sortKey !== key || sortDir === "none") return "";
    return sortDir === "desc" ? " ↓" : " ↑";
  };

  return { sortKey, sortDir, toggleSort, arrow };
}

function CombinedView({ games }: { games: GameEnv[] }) {
  const withPcts = games.map(g => ({ ...g, ...calcCombinedPct(g) }));
  const { sortKey, sortDir, toggleSort, arrow } = useSortableTable(withPcts);

  const sorted = [...withPcts].sort((a, b) => {
    if (sortDir === "none") return b.combinedPct - a.combinedPct; // default
    const dir = sortDir === "desc" ? -1 : 1;
    switch (sortKey) {
      case "game": return dir * `${a.away_team}${a.home_team}`.localeCompare(`${b.away_team}${b.home_team}`);
      case "weatherPct": return dir * (a.weatherPct - b.weatherPct);
      case "parkPct": return dir * (a.parkPct - b.parkPct);
      case "combinedPct": return dir * (a.combinedPct - b.combinedPct);
      case "temp": return dir * ((a.temperature_f ?? 0) - (b.temperature_f ?? 0));
      case "wind": return dir * ((a.wind_speed_mph ?? 0) - (b.wind_speed_mph ?? 0));
      case "parkFactor": return dir * (a.park_factor - b.park_factor);
      default: return 0;
    }
  });

  const favorable = sorted.filter(g => g.combinedPct > 5);
  const unfavorable = sorted.filter(g => g.combinedPct < -5);
  const neutral = sorted.filter(g => g.combinedPct >= -5 && g.combinedPct <= 5);

  return (
    <div>
      <h3 className="text-lg font-bold text-foreground mb-2">Combined HR Impact (Weather + Park)</h3>
      <p className="text-xs text-muted mb-6">Weather boost/reduction combined with park HR factor vs league average.</p>

      {/* Favorable */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-accent-green" />
          <span className="text-sm font-semibold text-foreground">HR Favorable</span>
          <span className="text-xs text-muted">(Combined conditions increase HR probability)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {favorable.length > 0 ? favorable.map(g => (
            <CombinedPill key={g.game_pk} away={g.away_team} home={g.home_team}
              weatherPct={g.weatherPct} parkPct={g.parkPct} combinedPct={g.combinedPct} type="favorable" />
          )) : <span className="text-xs text-muted">None</span>}
        </div>
      </div>

      {/* Unfavorable */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-accent-red" />
          <span className="text-sm font-semibold text-foreground">HR Unfavorable</span>
          <span className="text-xs text-muted">(Combined conditions decrease HR probability)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {unfavorable.length > 0 ? unfavorable.map(g => (
            <CombinedPill key={g.game_pk} away={g.away_team} home={g.home_team}
              weatherPct={g.weatherPct} parkPct={g.parkPct} combinedPct={g.combinedPct} type="unfavorable" />
          )) : <span className="text-xs text-muted">None</span>}
        </div>
      </div>

      {/* Neutral */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-muted" />
          <span className="text-sm font-semibold text-foreground">Neutral</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {neutral.map(g => (
            <CombinedPill key={g.game_pk} away={g.away_team} home={g.home_team}
              weatherPct={g.weatherPct} parkPct={g.parkPct} combinedPct={g.combinedPct} type="neutral" />
          ))}
        </div>
      </div>

      {/* Detailed table */}
      <div className="mt-8">
        <h4 className="text-sm font-semibold text-foreground mb-3">Detailed Breakdown</h4>

        {/* Mobile card view */}
        <div className="md:hidden space-y-2">
          {sorted.map(g => (
            <div key={g.game_pk} className="bg-background/30 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{g.away_team} @ {g.home_team}</span>
                <span className={`font-mono text-sm font-bold ${g.combinedPct > 5 ? "text-accent-green" : g.combinedPct < -5 ? "text-accent-red" : "text-foreground"}`}>
                  {g.combinedPct > 0 ? "+" : ""}{g.combinedPct}%
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                <span className={`font-mono ${g.weatherPct > 0 ? "text-accent-green" : g.weatherPct < 0 ? "text-accent-red" : "text-muted"}`}>
                  WX {g.weatherPct > 0 ? "+" : ""}{g.weatherPct}%
                </span>
                <span className={`font-mono ${g.parkPct > 0 ? "text-accent-green" : g.parkPct < 0 ? "text-accent-red" : "text-muted"}`}>
                  PK {g.parkPct > 0 ? "+" : ""}{g.parkPct}%
                </span>
                <span className="text-muted font-mono">{g.temperature_f ?? "?"}°F</span>
                <span className="text-muted font-mono">{g.wind_speed_mph ?? "?"}mph</span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                {([
                  { key: "game" as SortKey, label: "Game", align: "text-left" },
                  { key: "weatherPct" as SortKey, label: "Weather %", align: "text-center" },
                  { key: "parkPct" as SortKey, label: "Park %", align: "text-center" },
                  { key: "combinedPct" as SortKey, label: "Combined %", align: "text-center" },
                  { key: "temp" as SortKey, label: "Temp", align: "text-center" },
                  { key: "wind" as SortKey, label: "Wind", align: "text-center" },
                  { key: "parkFactor" as SortKey, label: "Park Factor", align: "text-center" },
                ]).map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`${col.align} py-2 cursor-pointer hover:text-foreground transition-colors select-none`}
                  >
                    {col.label}{arrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(g => (
                <tr key={g.game_pk} className="border-b border-card-border/30">
                  <td className="py-2 font-medium text-foreground">{g.away_team} @ {g.home_team}</td>
                  <td className="text-center py-2">
                    <span className={`font-mono ${g.weatherPct > 0 ? "text-accent-green" : g.weatherPct < 0 ? "text-accent-red" : "text-muted"}`}>
                      {g.weatherPct > 0 ? "+" : ""}{g.weatherPct}%
                    </span>
                  </td>
                  <td className="text-center py-2">
                    <span className={`font-mono ${g.parkPct > 0 ? "text-accent-green" : g.parkPct < 0 ? "text-accent-red" : "text-muted"}`}>
                      {g.parkPct > 0 ? "+" : ""}{g.parkPct}%
                    </span>
                  </td>
                  <td className="text-center py-2">
                    <span className={`font-mono font-bold ${g.combinedPct > 5 ? "text-accent-green" : g.combinedPct < -5 ? "text-accent-red" : "text-foreground"}`}>
                      {g.combinedPct > 0 ? "+" : ""}{g.combinedPct}%
                    </span>
                  </td>
                  <td className="text-center py-2 text-muted font-mono">{g.temperature_f ?? "?"}°F</td>
                  <td className="text-center py-2 text-muted font-mono">{g.wind_speed_mph ?? "?"}mph</td>
                  <td className="text-center py-2 text-muted font-mono">{g.park_factor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

function CombinedPill({ away, home, weatherPct, parkPct, combinedPct, type }: {
  away: string; home: string; weatherPct: number; parkPct: number; combinedPct: number;
  type: "favorable" | "unfavorable" | "neutral";
}) {
  const borderColor = type === "favorable" ? "border-accent-green/30 bg-accent-green/5" :
    type === "unfavorable" ? "border-accent-red/30 bg-accent-red/5" : "border-card-border bg-card/30";
  const dotColor = type === "favorable" ? "bg-accent-green" : type === "unfavorable" ? "bg-accent-red" : "bg-muted";
  const pctColor = type === "favorable" ? "text-accent-green" : type === "unfavorable" ? "text-accent-red" : "text-muted";

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${borderColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="font-medium text-foreground">{away} @ {home}</span>
      <span className={`font-bold font-mono ${pctColor}`}>{combinedPct > 0 ? "+" : ""}{combinedPct}%</span>
      <span className="text-muted text-[10px]">WX:{weatherPct > 0 ? "+" : ""}{weatherPct}% PK:{parkPct > 0 ? "+" : ""}{parkPct}%</span>
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
