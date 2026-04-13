"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TABLE_BG,
  cellClass,
  cellStyle,
  headerCellClass,
  headerCellStyle,
  tableClass,
  tableWrapperClass,
  tableWrapperStyle,
} from "./table-styles";

interface PitcherProjection {
  pitcher_name: string;
  pitcher_hand: string;
  team: string;
  opposing_team: string;
  k_pct: number;
  swstr_pct: number;
  k_per_9: number;
  ip_per_start: number;
  total_ip: number;
  starts: number;
  strikeouts_total: number;
  pa_faced: number;
  projected_k: number;
  expected_ip: number;
  team_adjustment: number;
  data_source: string;
}

interface KProjections {
  date: string;
  generated_at: string;
  pitchers: PitcherProjection[];
  league_avg_k_pct: number;
  league_avg_swstr_pct: number;
}

export function KRankings() {
  const [data, setData] = useState<KProjections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<
    "projected_k" | "k_per_9" | "swstr_pct" | "name"
  >("projected_k");

  useEffect(() => {
    fetch("/data/k_projections.json")
      .then((res) => {
        if (!res.ok) throw new Error("K projections not available yet");
        return res.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
  }, []);

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.pitchers];
    arr.sort((a, b) => {
      if (sortBy === "name") return a.pitcher_name.localeCompare(b.pitcher_name);
      if (sortBy === "projected_k") return b.projected_k - a.projected_k;
      if (sortBy === "k_per_9") return b.k_per_9 - a.k_per_9;
      if (sortBy === "swstr_pct") return b.swstr_pct - a.swstr_pct;
      return 0;
    });
    return arr;
  }, [data, sortBy]);

  if (error) {
    return (
      <div className="bg-card/50 border border-card-border rounded-xl p-8 max-w-2xl text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          K Projections Not Ready
        </h2>
        <p className="text-sm text-muted">{error}</p>
        <code className="text-xs bg-background px-3 py-2 rounded text-accent font-mono block mt-4">
          python k_model.py
        </code>
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted text-sm">Loading K projections…</p>;
  }

  const Headers = [
    { key: "rank", label: "#" },
    { key: "name", label: "Pitcher" },
    { key: "team", label: "Team" },
    { key: "matchup", label: "vs" },
    { key: "projected_k", label: "Proj K" },
    { key: "k_per_9", label: "K/9" },
    { key: "k_pct", label: "K%" },
    { key: "swstr_pct", label: "SwStr%" },
    { key: "expected_ip", label: "Exp IP" },
    { key: "starts", label: "Starts" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-xs text-foreground">
        <span className="font-semibold text-accent">Pitcher K Projections.</span>{" "}
        Projected strikeouts for tonight&apos;s starters based on their season
        K/9, SwStr%, and expected innings.{" "}
        <span className="text-muted">
          MVP — lineup-specific adjustments and umpire factors coming in v1.
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">Sort:</span>
        {(["projected_k", "k_per_9", "swstr_pct", "name"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`px-3 py-1.5 rounded-full cursor-pointer transition-colors ${
              sortBy === s
                ? "bg-accent text-background font-bold"
                : "bg-card/50 text-muted border border-card-border hover:text-foreground"
            }`}
          >
            {s === "projected_k"
              ? "Proj K"
              : s === "k_per_9"
                ? "K/9"
                : s === "swstr_pct"
                  ? "SwStr%"
                  : "Name"}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {sorted.length} pitchers · generated{" "}
        {new Date(data.generated_at).toLocaleString()}
      </p>

      <div
        className={`hidden md:block ${tableWrapperClass}`}
        style={tableWrapperStyle}
      >
        <table className={tableClass}>
          <thead>
            <tr>
              {Headers.map((h) => (
                <th
                  key={h.key}
                  className={headerCellClass}
                  style={headerCellStyle}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr
                key={p.pitcher_name}
                style={{ backgroundColor: TABLE_BG }}
              >
                <td className={cellClass} style={cellStyle}>
                  {i + 1}
                </td>
                <td className={cellClass} style={cellStyle}>
                  {p.pitcher_name}{" "}
                  <span className="text-muted text-[11px]">({p.pitcher_hand})</span>
                </td>
                <td className={cellClass} style={cellStyle}>
                  {p.team}
                </td>
                <td className={cellClass} style={cellStyle}>
                  {p.opposing_team}
                </td>
                <td
                  className={cellClass}
                  style={{ ...cellStyle, color: "#22c55e", fontWeight: 700 }}
                >
                  {p.projected_k.toFixed(1)}
                </td>
                <td className={cellClass} style={cellStyle}>
                  {p.k_per_9.toFixed(1)}
                </td>
                <td className={cellClass} style={cellStyle}>
                  {(p.k_pct * 100).toFixed(1)}%
                </td>
                <td className={cellClass} style={cellStyle}>
                  {(p.swstr_pct * 100).toFixed(1)}%
                </td>
                <td className={cellClass} style={cellStyle}>
                  {p.expected_ip.toFixed(1)}
                </td>
                <td className={cellClass} style={cellStyle}>
                  {p.starts}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {sorted.map((p, i) => (
          <div
            key={p.pitcher_name}
            className="bg-card/50 border border-card-border rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-accent font-mono">
                  #{i + 1}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {p.pitcher_name}
                </span>
                <span className="text-[11px] text-muted">
                  ({p.pitcher_hand})
                </span>
              </div>
              <span
                className="font-mono text-sm font-bold"
                style={{ color: "#22c55e" }}
              >
                {p.projected_k.toFixed(1)} K
              </span>
            </div>
            <div className="text-[11px] text-muted mb-1.5">
              {p.team} vs {p.opposing_team}
            </div>
            <div className="grid grid-cols-4 gap-2 text-[11px] text-center">
              <div>
                <div className="text-muted uppercase text-[9px]">K/9</div>
                <div className="font-mono text-foreground">
                  {p.k_per_9.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-muted uppercase text-[9px]">K%</div>
                <div className="font-mono text-foreground">
                  {(p.k_pct * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-muted uppercase text-[9px]">SwStr%</div>
                <div className="font-mono text-foreground">
                  {(p.swstr_pct * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-muted uppercase text-[9px]">Exp IP</div>
                <div className="font-mono text-foreground">
                  {p.expected_ip.toFixed(1)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
