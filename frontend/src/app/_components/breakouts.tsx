"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameData } from "./types";
import {
  tableWrapperClass,
  tableWrapperStyle,
  tableClass,
  cellClass,
  cellStyle,
  headerCellClass,
  headerCellStyle,
} from "./table-styles";

interface BatterRow {
  name: string;
  batter_id: number;
  pa: number;
  hr: number;
  xhr_count: number;
  luck_residual: number;
  hr_rate: number;
  predicted_hr_rate: number;
  barrel_pct: number | null;
  exit_velo: number | null;
  hard_hit_pct: number | null;
  fb_pct: number | null;
  bat_speed: number | null;
  fast_swing_pct: number | null;
  pull_fb_pct: number | null;
}

interface ResearchReport {
  dataset: {
    seasons: number[];
    n_batter_seasons: number;
    league_hr_rate_by_season: Record<string, number>;
  };
  univariate: Record<string, { r: number | null; n: number }>;
  multivariate: { holdout_pearson_r: number | null; n_train: number; n_test: number };
  lucky_unlucky_2026: {
    league_hr_rate_2026: number;
    min_pa: number;
    n_batters_evaluated: number;
    lucky_top_20: BatterRow[];
    unlucky_top_20: BatterRow[];
    // Full sorted list so we can slice to today's slate. Older research
    // dumps only ship the top-20 lists, so this field is optional.
    all_batters_sorted?: BatterRow[];
  };
}

type TabKey = "unlucky" | "lucky";


// Heat-map coloring (green above threshold, red below, muted neutral)
function heat(value: number | null, lo: number, hi: number): string | null {
  if (value === null || !isFinite(value)) return null;
  if (value >= hi) return "#22c55e";
  if (value <= lo) return "#ef4444";
  return null;
}
function heatStyle(color: string | null): React.CSSProperties {
  if (!color) return { color: "#ffffff" };
  return { color, backgroundColor: color + "22", fontWeight: 600 };
}

const fmt3 = (v: number | null) => (v === null ? "—" : v.toFixed(3).replace(/^0/, ""));
const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtNum = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));

type SortKey =
  | "name" | "pa" | "hr" | "xhr_count" | "luck_residual"
  | "barrel_pct" | "exit_velo" | "hard_hit_pct" | "fb_pct"
  | "bat_speed" | "fast_swing_pct" | "pull_fb_pct";

const COLS: ReadonlyArray<{
  key: SortKey | "rank" | "team";
  label: string;
  align: string;
  sortable: boolean;
}> = [
  { key: "rank", label: "#", align: "text-center", sortable: false },
  { key: "name", label: "Player", align: "text-left", sortable: true },
  { key: "team", label: "Team", align: "text-left", sortable: false },
  { key: "pa", label: "PA", align: "text-right", sortable: true },
  { key: "hr", label: "HR", align: "text-right", sortable: true },
  { key: "xhr_count", label: "xHR", align: "text-right", sortable: true },
  { key: "luck_residual", label: "Luck", align: "text-right", sortable: true },
  { key: "barrel_pct", label: "Barrel%", align: "text-right", sortable: true },
  { key: "exit_velo", label: "EV", align: "text-right", sortable: true },
  { key: "hard_hit_pct", label: "HH%", align: "text-right", sortable: true },
  { key: "fb_pct", label: "FB%", align: "text-right", sortable: true },
  { key: "bat_speed", label: "Bat Spd", align: "text-right", sortable: true },
  { key: "fast_swing_pct", label: "Fast Sw%", align: "text-right", sortable: true },
  { key: "pull_fb_pct", label: "Pull+FB%", align: "text-right", sortable: true },
];

function PlayerRow({ row, idx, mode, team }: { row: BatterRow; idx: number; mode: TabKey; team?: string }) {
  const luckColor = mode === "lucky" ? "#22c55e" : "#ef4444";
  return (
    <tr>
      <td className={cellClass + " text-center"} style={{ ...cellStyle, color: "#a0a1a4" }}>{idx + 1}</td>
      <td className={cellClass} style={cellStyle}>
        <span className="font-semibold text-white">{row.name}</span>
      </td>
      <td className={cellClass + " font-mono"} style={{ ...cellStyle, color: "#a0a1a4" }}>{team ?? "—"}</td>
      <td className={cellClass + " text-right font-mono"} style={cellStyle}>{row.pa}</td>
      <td className={cellClass + " text-right font-mono"} style={cellStyle}>{row.hr}</td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, color: "#a0a1a4" }}>{fmtNum(row.xhr_count, 1)}</td>
      <td
        className={cellClass + " text-right font-mono"}
        style={{ ...cellStyle, color: luckColor, backgroundColor: luckColor + "22", fontWeight: 700 }}
      >
        {row.luck_residual > 0 ? "+" : ""}{fmtNum(row.luck_residual, 1)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.barrel_pct, 0.06, 0.12)) }}>
        {fmtPct(row.barrel_pct)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.exit_velo, 87, 92)) }}>
        {fmtNum(row.exit_velo, 1)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.hard_hit_pct, 0.30, 0.45)) }}>
        {fmtPct(row.hard_hit_pct)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.fb_pct, 0.25, 0.38)) }}>
        {fmtPct(row.fb_pct)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.bat_speed, 68, 73)) }}>
        {fmtNum(row.bat_speed, 1)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.fast_swing_pct, 0.30, 0.50)) }}>
        {fmtPct(row.fast_swing_pct)}
      </td>
      <td className={cellClass + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.pull_fb_pct, 0.10, 0.25)) }}>
        {fmtPct(row.pull_fb_pct)}
      </td>
    </tr>
  );
}

export function Breakouts({ games }: { games: GameData[] }) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("unlucky");
  // Default sort depends on the tab: unlucky = ascending luck (most-negative
  // first); lucky = descending luck (most-positive first).
  const [sortKey, setSortKey] = useState<SortKey>("luck_residual");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    fetch("/data/bat_tracking_research.json")
      .then((r) => {
        if (!r.ok) throw new Error("no research data");
        return r.json();
      })
      .then(setReport)
      .catch((e) => setErr(e.message));
  }, []);

  // When tab flips, reset to the sensible default sort for that mode.
  useEffect(() => {
    setSortKey("luck_residual");
    setSortDir(tab === "lucky" ? "desc" : "asc");
  }, [tab]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      // For "lower is worse" metrics (K%, luck on unlucky), start desc;
      // for most metrics desc = highest-first feels natural.
      setSortDir("desc");
    }
  };

  // Map batter_id → team abbreviation from today's slate. Filtering by
  // batter_id (not name) fixes the "two Max Muncys" problem — same name,
  // different players, both landing on opposite tabs.
  const teamById = useMemo(() => {
    const m = new Map<number, string>();
    for (const g of games) {
      const tpm = g.team_pitch_mix;
      if (!tpm) continue;
      for (const b of tpm.away.batters) m.set(b.id, g.away_team);
      for (const b of tpm.home.batters) m.set(b.id, g.home_team);
    }
    return m;
  }, [games]);

  const rows: BatterRow[] = useMemo(() => {
    if (!report) return [];
    const lu = report.lucky_unlucky_2026;
    // Prefer the full sorted list so slate filtering still yields 20+ names;
    // fall back to the static top_20 for older research dumps.
    const full = lu.all_batters_sorted;
    let base: BatterRow[];
    if (full && full.length > 0) {
      const filtered = teamById.size > 0
        ? full.filter((r) => teamById.has(r.batter_id))
        : full;
      base = tab === "lucky"
        ? [...filtered].sort((a, b) => b.luck_residual - a.luck_residual).slice(0, 20)
        : [...filtered].sort((a, b) => a.luck_residual - b.luck_residual).slice(0, 20);
    } else {
      // Legacy research dump — fall back to name matching (only option).
      const top = tab === "lucky" ? lu.lucky_top_20 : lu.unlucky_top_20;
      const slateNames = new Set<string>();
      for (const g of games) for (const p of g.players) slateNames.add(p.name);
      base = slateNames.size > 0 ? top.filter((r) => slateNames.has(r.name)) : top;
    }
    const dirMul = sortDir === "desc" ? -1 : 1;
    const cmp = (a: BatterRow, b: BatterRow) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dirMul;
      const av = a[sortKey] as number | null;
      const bv = b[sortKey] as number | null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dirMul;
    };
    return [...base].sort(cmp);
  }, [report, tab, sortKey, sortDir, teamById, games]);

  if (err) {
    return (
      <div className="text-center text-muted text-sm py-12">
        Bat-tracking research data unavailable ({err}). Run <code className="text-foreground">python3 bat_tracking_research.py</code> locally to regenerate.
      </div>
    );
  }
  if (!report) {
    return <div className="text-center text-muted text-sm py-12">Loading research…</div>;
  }

  const lu = report.lucky_unlucky_2026;

  return (
    <div>
      {/* Tab toggle + explainer */}
      <div className="mb-4">
        <div className="flex items-center gap-1 mb-3">
          {(["unlucky", "lucky"] as const).map((t) => (
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
              {t === "unlucky" ? "Breakout Candidates" : "Regression Candidates"}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted leading-relaxed">
          {tab === "unlucky" ? (
            <>Hitters whose <span className="text-foreground font-semibold">actual HRs are well below their expected HRs (xHR)</span> given their Barrel %, Exit Velo, Bat Speed, and other contact-quality stats. The xHR model was trained on 2024 data and validated on 2025 (holdout Pearson r = {report.multivariate.holdout_pearson_r?.toFixed(2)}). Large negative luck = elite contact underperforming the slate — likely to hit more HRs going forward.</>
          ) : (
            <>Hitters whose <span className="text-foreground font-semibold">actual HRs are well above their expected HRs (xHR)</span>. Their underlying contact metrics don&apos;t justify the current HR pace — likely to regress. Large positive luck = watch for cooling stretches.</>
          )}
        </p>
      </div>

      {/* Meta bar */}
      <div
        className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-3 py-2 rounded-[var(--radius-md)] border mb-3 text-[11px]"
        style={{ background: "#0d1116", borderColor: "#32333b" }}
      >
        <span><span className="text-muted">Evaluated </span><span className="font-mono font-semibold text-foreground">{lu.n_batters_evaluated}</span><span className="text-muted"> batters @ ≥{lu.min_pa} PA</span></span>
        <span><span className="text-muted">2026 league HR/PA </span><span className="font-mono font-semibold text-foreground">{(lu.league_hr_rate_2026 * 100).toFixed(2)}%</span></span>
        <span><span className="text-muted">Model trained on </span><span className="font-mono font-semibold text-foreground">{report.dataset.n_batter_seasons.toLocaleString()}</span><span className="text-muted"> batter-seasons (2024-2025)</span></span>
      </div>

      {/* Table */}
      <div className={tableWrapperClass} style={tableWrapperStyle}>
        <table className={tableClass}>
          <thead>
            <tr>
              {COLS.map((c) => {
                const isSorted = c.sortable && c.key === sortKey;
                const indicator = isSorted ? (sortDir === "desc" ? " ↓" : " ↑") : "";
                return (
                  <th
                    key={c.key}
                    className={
                      headerCellClass + " " + c.align +
                      " " + (c.sortable ? "cursor-pointer" : "") +
                      " " + (isSorted ? "text-accent" : "")
                    }
                    style={headerCellStyle}
                    onClick={() => c.sortable && onSort(c.key as SortKey)}
                  >
                    {c.label}{indicator}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <PlayerRow key={row.batter_id} row={row} idx={i} mode={tab} team={teamById.get(row.batter_id)} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] text-muted">
        Luck = actual HR − xHR. xHR model features: Barrel %, Exit Velo, Hard-Hit %, FB %, Bat Speed, Fast Swing %, Pull+FB %.
        All stats are 2026 season-to-date. See <code className="text-foreground">bat_tracking_research.json</code> for full methodology.
      </p>
    </div>
  );
}
