"use client";

import { useState } from "react";
import type { PitcherInfo, PitcherStatRow } from "./types";

const DASH = "—";

// Direction: +1 means HIGH = good for batter (green), LOW = good for pitcher (red).
//            -1 means HIGH = good for pitcher (red), LOW = good for batter (green).
type Direction = 1 | -1;

interface Threshold {
  // Values for color scaling. green when value >= goodForBatter, red when value <= goodForPitcher.
  // direction handles the inversion for pitcher-favoring stats.
  goodForBatter: number;
  goodForPitcher: number;
  direction: Direction;
}

// League-rough thresholds. Tunable. Used to classify cells green/red.
const THRESHOLDS: Record<keyof PitcherStatRow, Threshold | null> = {
  ip: null,
  bf: null,
  hr: null,
  baa: { goodForBatter: 0.260, goodForPitcher: 0.225, direction: 1 },
  woba: { goodForBatter: 0.330, goodForPitcher: 0.295, direction: 1 },
  slg: { goodForBatter: 0.420, goodForPitcher: 0.360, direction: 1 },
  iso: { goodForBatter: 0.180, goodForPitcher: 0.135, direction: 1 },
  whip: { goodForBatter: 1.30, goodForPitcher: 1.05, direction: 1 },
  hr_per_9: { goodForBatter: 1.40, goodForPitcher: 1.00, direction: 1 },
  bb_pct: { goodForBatter: 9.5, goodForPitcher: 6.5, direction: 1 },
  whiff_pct: { goodForBatter: 22, goodForPitcher: 28, direction: -1 },
  k_pct: { goodForBatter: 18, goodForPitcher: 26, direction: -1 },
  meatball_pct: { goodForBatter: 7.5, goodForPitcher: 5.5, direction: 1 },
  barrel_pct: { goodForBatter: 9, goodForPitcher: 5, direction: 1 },
  hard_hit_pct: { goodForBatter: 40, goodForPitcher: 32, direction: 1 },
  fb_pct: { goodForBatter: 36, goodForPitcher: 30, direction: 1 },
  hr_fb_pct: { goodForBatter: 14, goodForPitcher: 9, direction: 1 },
  pullair_pct: { goodForBatter: 22, goodForPitcher: 17, direction: 1 },
};

function cellColor(key: keyof PitcherStatRow, value: number | null | undefined): string {
  const t = THRESHOLDS[key];
  if (t == null || value == null) return "";
  const { goodForBatter, goodForPitcher, direction } = t;
  // Normalize so "above goodForBatter" always means green (favors batter)
  const v = direction === 1 ? value : -value;
  const gB = direction === 1 ? goodForBatter : -goodForBatter;
  const gP = direction === 1 ? goodForPitcher : -goodForPitcher;
  if (v >= gB) return "bg-accent-green/20 text-accent-green";
  if (v <= gP) return "bg-accent-red/20 text-accent-red";
  // Mid-zone — light shade based on which side it leans
  const mid = (gB + gP) / 2;
  if (v >= mid) return "bg-accent-green/10 text-accent-green/80";
  return "bg-accent-red/10 text-accent-red/80";
}

function fmt(value: number | null | undefined, opts: { digits?: number; pct?: boolean; baStyle?: boolean } = {}): string {
  const { digits = 1, pct = false, baStyle = false } = opts;
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  if (baStyle) {
    // Drop leading 0: 0.182 → .182
    return value.toFixed(3).replace(/^0/, "");
  }
  return pct ? `${value.toFixed(digits)}%` : value.toFixed(digits);
}

interface ColumnDef {
  key: keyof PitcherStatRow;
  header: string;
  group: "basic" | "stats" | "strikes" | "statcast";
  // Renderer override for this column
  render?: (value: number | null | undefined) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: "ip", header: "IP", group: "basic", render: (v) => fmt(v, { digits: 1 }) },
  { key: "bf", header: "BF", group: "basic", render: (v) => v == null ? DASH : String(v) },
  { key: "baa", header: "BAA", group: "stats", render: (v) => fmt(v, { baStyle: true }) },
  { key: "woba", header: "wOBA", group: "stats", render: (v) => fmt(v, { baStyle: true }) },
  { key: "slg", header: "SLG", group: "stats", render: (v) => fmt(v, { baStyle: true }) },
  { key: "iso", header: "ISO", group: "stats", render: (v) => fmt(v, { baStyle: true }) },
  { key: "whip", header: "WHIP", group: "stats", render: (v) => fmt(v, { digits: 2 }) },
  { key: "hr", header: "HR", group: "stats", render: (v) => v == null ? DASH : String(v) },
  { key: "hr_per_9", header: "HR/9", group: "stats", render: (v) => fmt(v, { digits: 2 }) },
  { key: "bb_pct", header: "BB%", group: "stats", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "whiff_pct", header: "Whiff%", group: "strikes", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "k_pct", header: "K%", group: "strikes", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "meatball_pct", header: "Meatball%", group: "strikes", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "barrel_pct", header: "Barrel%", group: "statcast", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "hard_hit_pct", header: "HH%", group: "statcast", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "fb_pct", header: "FB%", group: "statcast", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "hr_fb_pct", header: "HR/FB%", group: "statcast", render: (v) => fmt(v, { pct: true, digits: 1 }) },
  { key: "pullair_pct", header: "PullAir%", group: "statcast", render: (v) => fmt(v, { pct: true, digits: 1 }) },
];

const ROWS: { key: "season" | "vs_L" | "vs_R"; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "vs_L", label: "vsLHB" },
  { key: "vs_R", label: "vsRHB" },
];

const GROUP_LABELS: Record<ColumnDef["group"], string> = {
  basic: "",
  stats: "Stats",
  strikes: "Strikes",
  statcast: "Statcast",
};

type WindowKey = "season" | "last_3" | "last_5" | "last_7" | "last_10";
const WINDOW_OPTIONS: { key: WindowKey; label: string }[] = [
  { key: "season",  label: "Season" },
  { key: "last_3",  label: "Last 3" },
  { key: "last_5",  label: "Last 5" },
  { key: "last_7",  label: "Last 7" },
  { key: "last_10", label: "Last 10" },
];

export function PitcherProfileCard({ pitcher, side, teamAbbr, onNameClick }: { pitcher: PitcherInfo; side?: "away" | "home"; teamAbbr?: string; onNameClick?: () => void }) {
  const profile = pitcher.profile ?? null;
  const seasonRows = profile?.rows ?? null;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const games_started = profile?.games_started ?? 0;
  const is2025Fallback = (profile?.data_year ?? 2026) === 2025;

  const [windowKey, setWindowKey] = useState<WindowKey>("season");
  // Window data lives under profile.windows[key] with the same shape as
  // profile.rows ({ season, vs_L, vs_R }). Fall back to season rows when
  // a window is missing (older slates pre-windows).
  const windowsData = profile?.windows ?? null;
  const activeWindow = windowKey === "season" ? null : (windowsData?.[windowKey] ?? null);
  const rows = activeWindow ?? seasonRows;

  // Build column-group spans for the header row
  const groupSpans: { group: ColumnDef["group"]; span: number }[] = [];
  for (const col of COLUMNS) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.group === col.group) last.span += 1;
    else groupSpans.push({ group: col.group, span: 1 });
  }

  return (
    <div
      className="rounded-[var(--radius-md)] p-5 mb-4 backdrop-blur-sm"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Side label */}
      {side && (
        <div className="mb-3">
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted/50">
            {teamAbbr ? `${teamAbbr} Starter` : side === "away" ? "Away Starter" : "Home Starter"}
          </span>
        </div>
      )}

      {/* Header — headshot + name + hand */}
      <div className="flex items-center gap-3 mb-4">
        {pitcher.id ? (
          <img
            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${pitcher.id}/headshot/67/current`}
            alt={pitcher.name}
            className="w-12 h-12 rounded-full object-cover bg-card-border/40 flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-card-border/40 flex-shrink-0" />
        )}
        <div className="flex flex-col min-w-0">
          {onNameClick ? (
            <button
              onClick={onNameClick}
              className="text-base font-semibold text-foreground leading-tight text-left cursor-pointer hover:text-accent transition-colors"
            >
              {pitcher.name}
            </button>
          ) : (
            <span className="text-base font-semibold text-foreground leading-tight">{pitcher.name}</span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-card-border/60 text-muted">
              {pitcher.hand}HP
            </span>
            {(wins > 0 || losses > 0) && (
              <span className="text-[11px] text-muted font-mono">{wins}-{losses}</span>
            )}
            {games_started > 0 && (
              <span className="text-[11px] text-muted">{games_started} GS</span>
            )}
          </div>
        </div>
      </div>

      {is2025Fallback && (
        <div className="mb-3 px-2 py-1.5 rounded text-[10px] text-amber-400/80 bg-amber-400/8 border border-amber-400/15">
          2025 data — no 2026 appearances yet
        </div>
      )}

      {/* Window selector — Season / Last 3 / Last 5 / Last 7 / Last 10.
          Same pool the Pitcher Summary page uses, just exposed here so users
          can see recent-form splits without leaving the Game Slate. */}
      {windowsData && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {WINDOW_OPTIONS.map((opt) => {
            const hasData = opt.key === "season" || windowsData[opt.key] != null;
            const on = windowKey === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => hasData && setWindowKey(opt.key)}
                disabled={!hasData}
                className={
                  "px-2 py-1 text-[10px] font-mono rounded cursor-pointer transition-colors border " +
                  (on
                    ? "bg-accent/15 text-accent border-accent/40"
                    : hasData
                      ? "bg-transparent text-muted border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e]"
                      : "bg-transparent text-muted/30 border-[#1c1c1e] cursor-not-allowed")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {!rows ? (
        <div className="text-xs text-muted py-6 text-center">No Statcast data available.</div>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted/70">
                <th className="text-left font-medium pb-1 pr-2"></th>
                {groupSpans.map((g, i) => (
                  <th key={i} colSpan={g.span} className="font-medium pb-1 px-1 text-center">
                    {GROUP_LABELS[g.group]}
                  </th>
                ))}
              </tr>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left font-medium pb-1.5 pr-3">Split</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="font-medium pb-1.5 px-1.5 text-center whitespace-nowrap">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ key, label }) => {
                const row = rows[key];
                return (
                  <tr key={key} className="border-t border-card-border/40">
                    <td className="pl-1 pr-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-foreground whitespace-nowrap">
                      {label}
                    </td>
                    {COLUMNS.map((c) => {
                      const value = (row ? row[c.key] : null) as number | null;
                      const text = c.render ? c.render(value) : (value == null ? DASH : String(value));
                      const colorCls = cellColor(c.key, value);
                      return (
                        <td
                          key={c.key}
                          className={`text-center px-1.5 py-1.5 whitespace-nowrap ${colorCls}`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
