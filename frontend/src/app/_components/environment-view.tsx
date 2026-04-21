"use client";

import { useMemo, useState } from "react";
import { WeatherResearch } from "./weather-research";

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
  weather_density_pct?: number;
  weather_wind_pct?: number;
  weather_hr_pct?: number;
  park_hr_pct?: number;
  combined_hr_pct?: number;
}

type SortKey = "impact" | "wind" | "temp" | "park" | "game";

// ── Park L/R splits (for expanded detail) ────────────────────────────────
const PARK_SPLITS: Record<string, { L: number; R: number }> = {
  LAD: { L: 140, R: 134 }, CIN: { L: 120, R: 112 }, NYY: { L: 130, R: 105 },
  BAL: { L: 115, R: 106 }, PHI: { L: 118, R: 112 }, HOU: { L: 110, R: 114 },
  LAA: { L: 108, R: 114 }, TOR: { L: 112, R: 106 }, SDP: { L: 106, R: 112 },
  COL: { L: 118, R: 112 }, NYM: { L: 103, R: 107 }, MIL: { L: 108, R: 100 },
  DET: { L: 100, R: 104 }, MIN: { L: 98, R: 102 },  CWS: { L: 94, R: 98 },
  CLE: { L: 98, R: 94 },   ATL: { L: 93, R: 97 },   CHC: { L: 100, R: 90 },
  SEA: { L: 90, R: 98 },   ARI: { L: 94, R: 90 },   AZ: { L: 94, R: 90 },
  MIA: { L: 88, R: 94 },   WSH: { L: 93, R: 89 },   TEX: { L: 89, R: 93 },
  BOS: { L: 80, R: 95 },   STL: { L: 76, R: 80 },   KC:  { L: 92, R: 88 },
  PIT: { L: 62, R: 70 },   SF:  { L: 70, R: 80 },   TB:  { L: 93, R: 97 },
  OAK: { L: 110, R: 106 }, ATH: { L: 110, R: 106 },
};

// ── Impact calcs ─────────────────────────────────────────────────────────
function weatherPct(g: GameEnv): number {
  if (g.weather_hr_pct !== undefined && g.weather_hr_pct !== null) {
    return Math.round(g.weather_hr_pct * 10) / 10;
  }
  if (g.is_dome) return 0;
  let pct = (g.wind_score ?? 0) * 1.2;
  if (g.temperature_f) {
    if (g.temperature_f > 72) pct += (g.temperature_f - 72) * 0.3;
    if (g.temperature_f < 55) pct -= (55 - g.temperature_f) * 0.4;
  }
  if (g.humidity && g.humidity > 60) pct += (g.humidity - 60) * 0.05;
  return Math.round(pct * 10) / 10;
}
function parkPct(g: GameEnv): number {
  if (g.park_hr_pct !== undefined && g.park_hr_pct !== null) {
    return Math.round(g.park_hr_pct * 10) / 10;
  }
  return Math.round((g.park_factor - 100) * 10) / 10;
}
function combinedPct(g: GameEnv): number {
  if (g.combined_hr_pct !== undefined && g.combined_hr_pct !== null) {
    return Math.round(g.combined_hr_pct * 10) / 10;
  }
  return Math.round((weatherPct(g) + parkPct(g)) * 10) / 10;
}

// ── Tiers ────────────────────────────────────────────────────────────────
function impactTier(pct: number): { label: string; color: string; bg: string } {
  if (pct >= 10) return { label: "Elite", color: "#22c55e", bg: "rgba(34,197,94,0.12)" };
  if (pct >= 5)  return { label: "Boost", color: "#4ade80", bg: "rgba(74,222,128,0.08)" };
  if (pct >= -5) return { label: "Neutral", color: "#a1a1aa", bg: "rgba(161,161,170,0.04)" };
  if (pct >= -10) return { label: "Drag", color: "#fbbf24", bg: "rgba(251,191,36,0.08)" };
  return { label: "Suppress", color: "#ef4444", bg: "rgba(239,68,68,0.10)" };
}

// ── Wind direction → compass + flow ──────────────────────────────────────
const COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function windInfo(deg: number | null, score: number, isDome: boolean) {
  if (isDome) return { compass: "—", flow: "Dome", color: "#a1a1aa" };
  if (deg === null || deg === undefined) return { compass: "?", flow: "?", color: "#a1a1aa" };
  const compass = COMPASS_8[Math.round(deg / 45) % 8];
  if (score > 5)  return { compass, flow: "Out",   color: "#22c55e" };
  if (score > 2)  return { compass, flow: "Out",   color: "#4ade80" };
  if (score < -5) return { compass, flow: "In",    color: "#ef4444" };
  if (score < -2) return { compass, flow: "In",    color: "#f87171" };
  return { compass, flow: "Cross", color: "#a1a1aa" };
}

// Meteorological convention: wind "from" X blows "to" X+180.
function blowingToward(fromDeg: number | null): string {
  if (fromDeg === null || fromDeg === undefined) return "?";
  const to = (fromDeg + 180) % 360;
  return COMPASS_8[Math.round(to / 45) % 8];
}

// ── Stadium orientation: HP→CF compass bearings (mirror of backend) ──────
// Used to describe wind relative to the field: Out to CF / In from RF /
// Left to Right / etc. If a park is missing, we fall back to raw compass.
const PARK_CF_BEARING: Record<string, number> = {
  ARI: 23, AZ: 23, ATL: 25, BAL: 32, BOS: 45, CHC: 30,
  CIN: 10, CLE: 0,  COL: 0,  CWS: 35, DET: 150,
  HOU: 345, KC: 45, LAA: 60, LAD: 20, MIA: 40, MIL: 45,
  MIN: 90, NYM: 25, NYY: 75, OAK: 60, ATH: 60,
  PHI: 0, PIT: 115, SDP: 0, SD: 0, SF: 90, SEA: 60,
  STL: 55, TB: 45, TEX: 20, TOR: 0, WSH: 25,
};

// Describe wind relative to the field using the batter's left/right frame.
// Returns strings like "Out to CF", "In from RF", "Left to Right".
function fieldWindLabel(
  fromDeg: number | null,
  homeTeam: string,
  isDome: boolean,
): string {
  if (isDome) return "Dome";
  if (fromDeg === null || fromDeg === undefined) return "?";
  const cfBearing = PARK_CF_BEARING[homeTeam];
  if (cfBearing === undefined) return COMPASS_8[Math.round((((fromDeg + 180) % 360) / 45)) % 8];

  // α = signed angle from CF bearing to wind-TO direction, in [-180, 180]
  const toDeg = (fromDeg + 180) % 360;
  let alpha = toDeg - cfBearing;
  while (alpha > 180) alpha -= 360;
  while (alpha < -180) alpha += 360;
  const a = alpha;
  // Bucket into 8 sectors of 45° each (edges at ±22.5, ±67.5, ±112.5, ±157.5).
  if (a >= -22.5 && a < 22.5)   return "Out to CF";
  if (a >= 22.5 && a < 67.5)    return "Out to RF";
  if (a >= 67.5 && a < 112.5)   return "Left to Right";
  if (a >= 112.5 && a < 157.5)  return "In from RF";
  if (a >= 157.5 || a < -157.5) return "In from CF";
  if (a >= -157.5 && a < -112.5) return "In from LF";
  if (a >= -112.5 && a < -67.5) return "Right to Left";
  return "Out to LF"; // -67.5 ≤ a < -22.5
}

// ── Compact wind arrow SVG (24px, direction only) ────────────────────────
function MiniCompass({ deg, color }: { deg: number | null; color: string }) {
  if (deg === null) {
    return <span className="inline-block w-4 text-center text-muted">—</span>;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block w-4 h-4 align-middle"
      style={{ transform: `rotate(${deg}deg)`, color }}
      aria-hidden
    >
      <path d="M12 3 L16 13 L12 11 L8 13 Z" fill="currentColor" />
    </svg>
  );
}

// ── Inline expandable detail (replaces the old modal/diamond) ───────────
function ExpandedDetail({ g }: { g: GameEnv }) {
  const wx = weatherPct(g);
  const park = parkPct(g);
  const combined = combinedPct(g);
  const tier = impactTier(combined);
  const splits = PARK_SPLITS[g.home_team];
  const splitPct = (side: "L" | "R") => {
    if (!splits) return combined;
    const sp = Math.round((splits[side] - 100) * 10) / 10;
    return Math.round((wx + sp) * 10) / 10;
  };
  const wd = windInfo(g.wind_direction, g.wind_score ?? 0, g.is_dome);

  const Stat = ({ label, value, mono = true, color }: { label: string; value: string; mono?: boolean; color?: string }) => (
    <div>
      <div className="text-[10px] uppercase tracking-[0.06em] text-muted mb-0.5">{label}</div>
      <div className={`text-[13px] ${mono ? "font-mono" : "font-semibold"} text-foreground`} style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-4 px-4 py-4 border-t"
      style={{ borderColor: "#2c2c2e", background: "rgba(0,0,0,0.18)" }}
    >
      <Stat label="Combined" value={`${combined > 0 ? "+" : ""}${combined}%`} color={tier.color} />
      <Stat label="Weather" value={`${wx > 0 ? "+" : ""}${wx}%`} color={wx > 0 ? "#22c55e" : wx < 0 ? "#ef4444" : undefined} />
      <Stat label="Park" value={`${park > 0 ? "+" : ""}${park}%`} color={park > 0 ? "#22c55e" : park < 0 ? "#ef4444" : undefined} />
      {splits && (
        <>
          <Stat label="LHB" value={`${splitPct("L") > 0 ? "+" : ""}${splitPct("L")}%`} color={splitPct("L") > 0 ? "#22c55e" : splitPct("L") < 0 ? "#ef4444" : undefined} />
          <Stat label="RHB" value={`${splitPct("R") > 0 ? "+" : ""}${splitPct("R")}%`} color={splitPct("R") > 0 ? "#22c55e" : splitPct("R") < 0 ? "#ef4444" : undefined} />
        </>
      )}
      {/* Wind: arrow + mph + simple field-relative label */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.06em] text-muted mb-0.5">Wind</div>
        {g.is_dome ? (
          <div className="text-[13px] font-semibold text-muted">—</div>
        ) : (
          <div className="flex items-center gap-1.5 text-[13px]" style={{ color: wd.color }}>
            <MiniCompass deg={g.wind_direction} color={wd.color} />
            <span className="font-mono">
              {g.wind_speed_mph !== null ? g.wind_speed_mph : "?"} mph
            </span>
            <span className="font-semibold">
              {fieldWindLabel(g.wind_direction, g.home_team, g.is_dome)}
            </span>
          </div>
        )}
      </div>
      <Stat label="Temp" value={g.temperature_f !== null ? `${Math.round(g.temperature_f)}°F` : "—"} />
      <Stat label="Humidity" value={g.humidity !== null ? `${Math.round(g.humidity)}%` : "—"} />
      <Stat label="Pressure" value={g.pressure_hpa !== null ? `${Math.round(g.pressure_hpa)} hPa` : "—"} />
      <Stat label="Venue" value={g.is_dome ? "Dome / Roof" : "Open air"} />
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────
function EnvRow({
  g, expanded, onToggle,
}: {
  g: GameEnv;
  expanded: boolean;
  onToggle: () => void;
}) {
  const combined = combinedPct(g);
  const wx = weatherPct(g);
  const park = parkPct(g);
  const tier = impactTier(combined);
  const wd = windInfo(g.wind_direction, g.wind_score ?? 0, g.is_dome);

  return (
    <div className="border-b" style={{ borderColor: "#2c2c2e" }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-2,#232326)] cursor-pointer transition-colors"
        style={{
          gridTemplateColumns:
            "minmax(150px,1.2fr) 90px 70px 60px minmax(150px,1.1fr) 60px 60px 80px",
        }}
      >
        {/* Matchup */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-1 h-7 rounded-full shrink-0"
            style={{ background: tier.color }}
          />
          <span className="font-semibold text-foreground truncate">
            {g.away_team} <span className="text-muted font-normal">@</span> {g.home_team}
          </span>
          {g.is_dome && (
            <span className="text-[9px] text-muted uppercase tracking-wider border border-[#3a3a3e] rounded px-1 py-0.5">
              Dome
            </span>
          )}
        </div>

        {/* Impact (big colored) */}
        <div
          className="text-right font-mono font-bold text-[14px] px-2 py-0.5 rounded"
          style={{ color: tier.color, background: tier.bg }}
        >
          {combined > 0 ? "+" : ""}{combined}%
        </div>

        {/* Weather % */}
        <div className="text-right font-mono text-[12px]" style={{ color: wx > 0 ? "#22c55e" : wx < 0 ? "#ef4444" : "#a1a1aa" }}>
          {wx > 0 ? "+" : ""}{wx}
        </div>

        {/* Park */}
        <div className="text-right font-mono text-[12px] text-foreground">
          {g.park_factor}
        </div>

        {/* Wind — arrow + mph + field-relative label */}
        <div className="flex items-center justify-end gap-1.5 text-[12px]">
          {g.is_dome ? (
            <span className="text-muted">—</span>
          ) : (
            <>
              <MiniCompass deg={g.wind_direction} color={wd.color} />
              <span className="font-mono text-foreground">
                {g.wind_speed_mph !== null ? Math.round(g.wind_speed_mph) : "?"} mph
              </span>
              <span className="text-[11px]" style={{ color: wd.color }}>
                {fieldWindLabel(g.wind_direction, g.home_team, g.is_dome)}
              </span>
            </>
          )}
        </div>

        {/* Temp */}
        <div className="text-right font-mono text-[12px] text-foreground">
          {g.is_dome ? "—" : g.temperature_f !== null ? `${Math.round(g.temperature_f)}°` : "?"}
        </div>

        {/* Humidity */}
        <div className="text-right font-mono text-[12px] text-muted">
          {g.is_dome ? "—" : g.humidity !== null ? `${Math.round(g.humidity)}%` : "?"}
        </div>

        {/* Tier label + caret */}
        <div className="flex items-center justify-end gap-1.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: tier.color }}>
            {tier.label}
          </span>
          <svg
            viewBox="0 0 20 20"
            className="w-3.5 h-3.5 text-muted transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "none" }}
          >
            <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>
      {expanded && <ExpandedDetail g={g} />}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────
export function EnvironmentView({ games }: { games: GameEnv[] }) {
  const [tab, setTab] = useState<"today" | "research">("today");
  const [sortBy, setSortBy] = useState<SortKey>("impact");
  const [expandedPk, setExpandedPk] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const arr = [...games];
    switch (sortBy) {
      case "impact": arr.sort((a, b) => combinedPct(b) - combinedPct(a)); break;
      case "wind":   arr.sort((a, b) => (b.wind_score ?? 0) - (a.wind_score ?? 0)); break;
      case "temp":   arr.sort((a, b) => (b.temperature_f ?? 0) - (a.temperature_f ?? 0)); break;
      case "park":   arr.sort((a, b) => b.park_factor - a.park_factor); break;
      case "game":   arr.sort((a, b) => `${a.away_team}${a.home_team}`.localeCompare(`${b.away_team}${b.home_team}`)); break;
    }
    return arr;
  }, [games, sortBy]);

  if (!games || games.length === 0) {
    return <div className="text-center text-muted text-sm py-12">No environment data available.</div>;
  }

  const HeaderCell = ({
    label, k, align = "right",
  }: {
    label: string;
    k?: SortKey;
    align?: "left" | "right";
  }) => {
    const active = k && sortBy === k;
    return (
      <div
        className={`text-[10px] uppercase tracking-[0.06em] select-none ${k ? "cursor-pointer" : ""} ${align === "right" ? "text-right" : "text-left"} ${active ? "text-accent" : "text-muted"}`}
        onClick={k ? () => setSortBy(k) : undefined}
      >
        {label}{active ? " ↓" : ""}
      </div>
    );
  };

  return (
    <div>
      {/* Tab toggle — Today's slate vs 10-season research findings */}
      <div className="flex items-center gap-1 mb-4">
        {(["today", "research"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-3 py-1.5 text-[12px] font-semibold rounded-[var(--radius-md)] cursor-pointer transition-colors " +
              (tab === t
                ? "bg-accent/15 text-accent border border-accent/40"
                : "bg-transparent text-muted border border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e]")
            }
          >
            {t === "today" ? "Today's Slate" : "Model & Research"}
          </button>
        ))}
      </div>

      {tab === "research" ? (
        <WeatherResearch />
      ) : (
      <>
      <div
        className="rounded-[var(--radius-md)] border overflow-hidden"
        style={{ background: "var(--surface-1,#1c1c1e)", borderColor: "#2c2c2e" }}
      >
        {/* Column headers */}
        <div
          className="grid items-center gap-2 px-4 py-2 border-b"
          style={{
            gridTemplateColumns:
              "minmax(150px,1.2fr) 90px 70px 60px minmax(150px,1.1fr) 60px 60px 80px",
            borderColor: "#2c2c2e",
            background: "#161618",
          }}
        >
          <HeaderCell label="Matchup" k="game" align="left" />
          <HeaderCell label="Impact" k="impact" />
          <HeaderCell label="Wx%" />
          <HeaderCell label="Park" k="park" />
          <HeaderCell label="Wind" k="wind" />
          <HeaderCell label="Temp" k="temp" />
          <HeaderCell label="Hum" />
          <HeaderCell label="Tier" />
        </div>
        {sorted.map((g) => (
          <EnvRow
            key={g.game_pk}
            g={g}
            expanded={expandedPk === g.game_pk}
            onToggle={() =>
              setExpandedPk((prev) => (prev === g.game_pk ? null : g.game_pk))
            }
          />
        ))}
      </div>

      <div className="mt-4 text-[11px] text-muted">
        Weather: Open-Meteo · Park factors: 3-yr HR rates · Combined = weather% + park%.
      </div>
      </>
      )}
    </div>
  );
}
