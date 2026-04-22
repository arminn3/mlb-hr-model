"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TABLE_BG,
  tableWrapperClass,
  tableWrapperStyle,
  tableClass,
  headerCellStyle,
  cellStyle,
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
  };
}

type TabKey = "unlucky" | "lucky";

const compactCell = "py-1.5 px-2 text-[12px] font-medium whitespace-nowrap border-b border-r";
const compactHeader = "py-1.5 px-2 text-[11px] font-medium whitespace-nowrap border-b border-r select-none";

function headshotUrl(id: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;
}

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

const COLS = [
  { key: "rank", label: "#", align: "text-center", w: "w-8" },
  { key: "name", label: "Player", align: "text-left", w: "min-w-[180px]" },
  { key: "pa", label: "PA", align: "text-right", w: "w-10" },
  { key: "hr", label: "HR", align: "text-right", w: "w-10" },
  { key: "xhr", label: "xHR", align: "text-right", w: "w-12" },
  { key: "luck", label: "Luck", align: "text-right", w: "w-14" },
  { key: "barrel", label: "Barrel%", align: "text-right", w: "w-16" },
  { key: "ev", label: "EV", align: "text-right", w: "w-14" },
  { key: "hh", label: "HH%", align: "text-right", w: "w-14" },
  { key: "fb", label: "FB%", align: "text-right", w: "w-14" },
  { key: "bs", label: "Bat Spd", align: "text-right", w: "w-16" },
  { key: "fs", label: "Fast Sw%", align: "text-right", w: "w-16" },
  { key: "pfb", label: "Pull+FB%", align: "text-right", w: "w-16" },
];

function PlayerRow({ row, idx, mode }: { row: BatterRow; idx: number; mode: TabKey }) {
  const luckColor = mode === "lucky" ? "#22c55e" : "#ef4444";
  return (
    <tr>
      <td className={compactCell + " text-center text-muted"} style={cellStyle}>{idx + 1}</td>
      <td className={compactCell} style={cellStyle}>
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headshotUrl(row.batter_id)}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            className="w-7 h-7 rounded-full shrink-0 bg-[var(--surface-2)] object-cover"
          />
          <span className="font-semibold text-white truncate">{row.name}</span>
        </div>
      </td>
      <td className={compactCell + " text-right font-mono text-white"} style={cellStyle}>{row.pa}</td>
      <td className={compactCell + " text-right font-mono text-white"} style={cellStyle}>{row.hr}</td>
      <td className={compactCell + " text-right font-mono text-muted"} style={cellStyle}>{fmtNum(row.xhr_count, 1)}</td>
      <td
        className={compactCell + " text-right font-mono"}
        style={{ ...cellStyle, color: luckColor, backgroundColor: luckColor + "22", fontWeight: 700 }}
      >
        {row.luck_residual > 0 ? "+" : ""}{fmtNum(row.luck_residual, 1)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.barrel_pct, 0.06, 0.12)) }}>
        {fmtPct(row.barrel_pct)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.exit_velo, 87, 92)) }}>
        {fmtNum(row.exit_velo, 1)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.hard_hit_pct, 0.30, 0.45)) }}>
        {fmtPct(row.hard_hit_pct)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.fb_pct, 0.25, 0.38)) }}>
        {fmtPct(row.fb_pct)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.bat_speed, 68, 73)) }}>
        {fmtNum(row.bat_speed, 1)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.fast_swing_pct, 0.30, 0.50)) }}>
        {fmtPct(row.fast_swing_pct)}
      </td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(row.pull_fb_pct, 0.10, 0.25)) }}>
        {fmtPct(row.pull_fb_pct)}
      </td>
    </tr>
  );
}

export function Breakouts() {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("unlucky");

  useEffect(() => {
    fetch("/data/bat_tracking_research.json")
      .then((r) => {
        if (!r.ok) throw new Error("no research data");
        return r.json();
      })
      .then(setReport)
      .catch((e) => setErr(e.message));
  }, []);

  const rows: BatterRow[] = useMemo(() => {
    if (!report) return [];
    return tab === "lucky"
      ? report.lucky_unlucky_2026.lucky_top_20
      : report.lucky_unlucky_2026.unlucky_top_20;
  }, [report, tab]);

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
              {t === "unlucky" ? "Breakout Candidates (Under-performers)" : "Regression Candidates (Over-performers)"}
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
        style={{ background: TABLE_BG, borderColor: "#32333b" }}
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
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={compactHeader + " " + c.align + " " + c.w + " text-muted"}
                  style={headerCellStyle}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <PlayerRow key={row.batter_id} row={row} idx={i} mode={tab} />
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
