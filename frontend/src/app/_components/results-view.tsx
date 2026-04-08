"use client";

import { useEffect, useState } from "react";

interface DayReportData {
  date: string;
  total_players_ranked: number;
  total_hrs_hit: number;
  total_near_hrs?: number;
  model_hits: number;
  model_near_hits?: number;
  tier_accuracy: Record<string, { total: number; hits: number; rate: number }>;
  tier_accuracy_by_lookback?: Record<string, Record<string, { total: number; hits: number; rate: number }>>;
  best_lookback?: string;
  tier_accuracy_with_near?: Record<string, { total: number; hits: number; rate: number }>;
  avg_composite_hr_hitters: number;
  avg_composite_non_hitters: number;
  composite_separation: number;
  hr_hitters: Array<{
    name: string;
    rank: number;
    composite: number;
    opp_pitcher: string;
    matchup: string;
  }>;
  hr_hitters_l10?: Array<{
    name: string;
    rank: number;
    composite: number;
    opp_pitcher: string;
    matchup: string;
  }>;
  near_hr_hitters?: Array<{
    name: string;
    rank: number;
    composite: number;
    opp_pitcher: string;
    matchup: string;
  }>;
  near_hr_events?: Array<{
    batter: string;
    ev: number;
    angle: number;
    distance: number | null;
    hr_in_parks?: number;
    result: string;
    pitcher: string;
  }>;
  surprise_hrs: Array<{
    name: string;
    pitcher: string;
    description: string;
  }>;
}

export function ResultsView({ selectedDate }: { selectedDate: string }) {
  const [data, setData] = useState<DayReportData[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/results/cumulative.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setData(d.reverse()))
      .catch(() => setError("No results data yet. Run: python results_tracker.py --date 2026-04-02"));
  }, []);

  // Filter to selected date if set, otherwise show all
  const filtered = selectedDate
    ? data.filter((d) => d.date === selectedDate)
    : data;

  if (error) {
    return (
      <div className="bg-card/50 border border-card-border rounded-xl p-8 text-center">
        <p className="text-sm text-muted">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-card/50 border border-card-border rounded-xl p-8 text-center">
        <p className="text-sm text-muted">No results tracked yet. Results are logged after games complete.</p>
      </div>
    );
  }

  // Cumulative stats
  const totalDays = data.length;
  const totalHRs = data.reduce((s, d) => s + d.total_hrs_hit, 0);
  const totalCaught = data.reduce((s, d) => s + d.model_hits, 0);
  const cumTop10Hits = data.reduce((s, d) => s + (d.tier_accuracy.top_10?.hits || 0), 0);
  const cumTop10Total = data.reduce((s, d) => s + (d.tier_accuracy.top_10?.total || 0), 0);
  const cumTop20Hits = data.reduce((s, d) => s + (d.tier_accuracy.top_20?.hits || 0), 0);
  const cumTop20Total = data.reduce((s, d) => s + (d.tier_accuracy.top_20?.total || 0), 0);
  const avgSeparation = data.reduce((s, d) => s + d.composite_separation, 0) / totalDays;

  // Combined HR + near HR cumulative
  const cumTop10WithNear = data.reduce((s, d) => s + (d.tier_accuracy_with_near?.top_10?.hits || d.tier_accuracy.top_10?.hits || 0), 0);
  const cumTop20WithNear = data.reduce((s, d) => s + (d.tier_accuracy_with_near?.top_20?.hits || d.tier_accuracy.top_20?.hits || 0), 0);

  return (
    <div>
      {/* Cumulative summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatBox label="Days Tracked" value={`${totalDays}`} />
        <StatBox label="Total HRs" value={`${totalHRs}`} sub={`${totalCaught} caught + ${data.reduce((s, d) => s + (d.model_near_hits || 0), 0)} near HRs`} />
        <StatBox
          label="Top 10 Hit Rate"
          value={cumTop10Total > 0 ? `${(cumTop10Hits / cumTop10Total * 100).toFixed(1)}%` : "-"}
          sub={`${cumTop10Hits}/${cumTop10Total} HRs${cumTop10WithNear > cumTop10Hits ? ` (${cumTop10WithNear} w/ near)` : ""}`}
        />
        <StatBox
          label="Top 20 Hit Rate"
          value={cumTop20Total > 0 ? `${(cumTop20Hits / cumTop20Total * 100).toFixed(1)}%` : "-"}
          sub={`${cumTop20Hits}/${cumTop20Total} HRs${cumTop20WithNear > cumTop20Hits ? ` (${cumTop20WithNear} w/ near)` : ""}`}
        />
        <StatBox
          label="Catch Rate"
          value={totalHRs > 0 ? `${(totalCaught / totalHRs * 100).toFixed(1)}%` : "-"}
          sub="HRs by ranked players"
        />
        <StatBox
          label="Avg Separation"
          value={avgSeparation > 0 ? `+${avgSeparation.toFixed(3)}` : avgSeparation.toFixed(3)}
          sub="HR hitters vs non-hitters"
          good={avgSeparation > 0}
        />
      </div>

      {/* Placeholder if no results for selected date */}
      {selectedDate && filtered.length === 0 && (
        <div className="border border-card-border rounded-xl bg-card/30 p-8 mb-4 text-center">
          <p className="text-sm text-muted">
            No results available for {selectedDate}.
          </p>
          <p className="text-xs text-muted mt-2">
            Results are generated automatically after games complete each night.
          </p>
        </div>
      )}

      {/* Daily reports */}
      {filtered.map((day) => (
        <DayReport key={day.date} day={day} />
      ))}
    </div>
  );
}

function DayReport({ day }: { day: DayReportData }) {
  const [lb, setLb] = useState<"L5" | "L10">("L5");
  const tierAccuracy = lb === "L5"
    ? day.tier_accuracy
    : day.tier_accuracy_by_lookback?.[lb] || day.tier_accuracy;

  return (
        <div className="border border-card-border rounded-xl bg-card/50 p-5 mb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-bold text-foreground">{day.date}</h3>
              <div className="flex items-center gap-4 text-xs text-muted">
                <span>{day.total_players_ranked} ranked</span>
                <span>{day.total_hrs_hit} HRs hit</span>
                <span className="text-accent-green font-semibold">{day.model_hits} caught</span>
              </div>
            </div>
            {/* L5/L10 toggle — prominent */}
            <div className="flex items-center gap-1 bg-card border border-card-border rounded-xl p-1">
              <button
                onClick={() => setLb("L5")}
                className={`px-5 py-2 text-sm font-bold rounded-lg cursor-pointer transition-colors ${
                  lb === "L5" ? "bg-accent text-background" : "text-muted hover:text-foreground"
                }`}
              >
                L5
              </button>
              <button
                onClick={() => setLb("L10")}
                className={`px-5 py-2 text-sm font-bold rounded-lg cursor-pointer transition-colors ${
                  lb === "L10" ? "bg-accent text-background" : "text-muted hover:text-foreground"
                }`}
              >
                L10
              </button>
            </div>
          </div>

          {/* Tier accuracy — HRs only */}
          <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">HR Hit Rate ({lb})</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {Object.entries(tierAccuracy).map(([tier, acc]) => (
              <div key={tier} className="bg-background/30 rounded-lg p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  {tier.replace("_", " ")}
                </div>
                <div className={`text-lg font-bold font-mono ${acc.rate >= 25 ? "text-accent-green" : acc.rate >= 15 ? "text-accent-yellow" : "text-accent-red"}`}>
                  {acc.rate}%
                </div>
                <div className="text-[10px] text-muted">{acc.hits}/{acc.total}</div>
              </div>
            ))}
          </div>

          {/* HR + Near HR — toned down, no border emphasis */}
          {day.tier_accuracy_with_near && Object.values(day.tier_accuracy_with_near).some((a: { rate: number }) => a.rate > 0) && (
            <div className="mb-4">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Including Near HRs
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(day.tier_accuracy_with_near).map(([tier, acc]: [string, { total: number; hits: number; rate: number }]) => (
                  <div key={tier} className="bg-background/20 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">
                      {tier.replace("_", " ")}
                    </div>
                    <div className="text-sm font-mono text-muted">
                      {acc.rate}%
                    </div>
                    <div className="text-[9px] text-muted">{acc.hits}/{acc.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lookback comparison */}
          {day.tier_accuracy_by_lookback && (
            <div className="mb-4">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Performance by Lookback Window
                {day.best_lookback && (
                  <span className="ml-2 text-accent font-semibold">Best: {day.best_lookback}</span>
                )}
              </h4>

              {/* Mobile card view */}
              <div className="md:hidden space-y-1.5">
                {Object.entries(day.tier_accuracy_by_lookback).map(([lbKey, acc]) => {
                  const a = acc as Record<string, { rate: number; hits: number; total: number }>;
                  return (
                    <div key={lbKey} className={`rounded-lg px-3 py-2 flex items-center justify-between ${lbKey === day.best_lookback ? "bg-accent/5" : "bg-background/30"}`}>
                      <span className={`font-mono font-semibold text-sm ${lbKey === day.best_lookback ? "text-accent" : "text-foreground"}`}>
                        {lbKey} {lbKey === day.best_lookback && "★"}
                      </span>
                      <div className="flex items-center gap-3 text-[10px] font-mono">
                        <span>T10 {a.top_10?.rate ?? 0}%</span>
                        <span>T20 {a.top_20?.rate ?? 0}%</span>
                        <span>T30 {a.top_30?.rate ?? 0}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                      <th className="text-left py-1.5">Window</th>
                      <th className="text-center py-1.5">Top 10</th>
                      <th className="text-center py-1.5">Top 20</th>
                      <th className="text-center py-1.5">Top 30</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(day.tier_accuracy_by_lookback).map(([lbKey, acc]) => (
                      <tr key={lbKey} className={`border-b border-card-border/30 ${lbKey === day.best_lookback ? "bg-accent/5" : ""}`}>
                        <td className={`py-1.5 font-mono font-semibold ${lbKey === day.best_lookback ? "text-accent" : "text-foreground"}`}>
                          {lbKey} {lbKey === day.best_lookback && "★"}
                        </td>
                        <td className="text-center py-1.5 font-mono">
                          {(acc as Record<string, { rate: number; hits: number; total: number }>).top_10?.rate ?? 0}%
                        </td>
                        <td className="text-center py-1.5 font-mono">
                          {(acc as Record<string, { rate: number; hits: number; total: number }>).top_20?.rate ?? 0}%
                        </td>
                        <td className="text-center py-1.5 font-mono">
                          {(acc as Record<string, { rate: number; hits: number; total: number }>).top_30?.rate ?? 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* HR hitters */}
          {day.hr_hitters.length > 0 && (
            <HRHittersTable l5={day.hr_hitters} l10={day.hr_hitters_l10 || []} activeLb={lb} />
          )}

          {/* Near HRs — batted ball events */}
          {day.near_hr_events && day.near_hr_events.length > 0 && (
            <div className="mb-3">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Near HRs — Warning Track ({day.near_hr_events.length} batted balls)
              </h4>

              {/* Mobile card view */}
              <div className="md:hidden space-y-1.5">
                {day.near_hr_events.map((n: { batter: string; pitcher: string; ev: number; angle: number; distance: number | null; hr_in_parks?: number; result: string }, i: number) => (
                  <div key={i} className="bg-background/30 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{n.batter}</span>
                      <span className={`font-mono text-sm font-bold ${n.ev >= 105 ? "text-accent-green" : "text-foreground"}`}>{n.ev} mph</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px]">
                      <span className="text-muted">vs {n.pitcher}</span>
                      <span className={`font-mono ${n.angle >= 25 && n.angle <= 32 ? "text-accent-green" : ""}`}>{n.angle}°</span>
                      <span className="font-mono">{n.distance ? `${n.distance}ft` : "-"}</span>
                      <span className={`font-mono font-semibold ${(n.hr_in_parks ?? 0) >= 15 ? "text-accent-green" : "text-muted"}`}>{n.hr_in_parks ?? 0}/30 parks</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                      <th className="text-left py-1.5">Batter</th>
                      <th className="text-left py-1.5">vs Pitcher</th>
                      <th className="text-center py-1.5">EV</th>
                      <th className="text-center py-1.5">Angle</th>
                      <th className="text-center py-1.5">Distance</th>
                      <th className="text-center py-1.5">HR Parks</th>
                      <th className="text-left py-1.5">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.near_hr_events.map((n: { batter: string; pitcher: string; ev: number; angle: number; distance: number | null; hr_in_parks?: number; result: string }, i: number) => (
                      <tr key={i} className="border-b border-card-border/30">
                        <td className="py-1.5 font-medium text-foreground">{n.batter}</td>
                        <td className="py-1.5 text-muted">{n.pitcher}</td>
                        <td className="text-center py-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-mono ${n.ev >= 105 ? "bg-accent-green/70 text-background" : n.ev >= 100 ? "bg-accent-green/30 text-foreground" : "text-foreground"}`}>
                            {n.ev}
                          </span>
                        </td>
                        <td className="text-center py-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-mono ${n.angle >= 25 && n.angle <= 32 ? "bg-accent-green/70 text-background" : "text-foreground"}`}>
                            {n.angle}°
                          </span>
                        </td>
                        <td className="text-center py-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-mono ${n.distance && n.distance >= 390 ? "bg-accent-green/70 text-background" : n.distance && n.distance >= 370 ? "bg-accent-green/30 text-foreground" : "text-foreground"}`}>
                            {n.distance ? `${n.distance} ft` : "-"}
                          </span>
                        </td>
                        <td className="text-center py-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-mono font-semibold ${
                            (n.hr_in_parks ?? 0) >= 25 ? "bg-accent-green/70 text-background" :
                            (n.hr_in_parks ?? 0) >= 15 ? "bg-accent-green/30 text-foreground" :
                            (n.hr_in_parks ?? 0) >= 1 ? "bg-accent-yellow/30 text-foreground" :
                            "text-muted"
                          }`}>
                            {n.hr_in_parks ?? 0}/30
                          </span>
                        </td>
                        <td className="py-1.5 text-muted capitalize">{(n.result || "").replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 px-3 py-2.5 rounded-lg bg-accent-yellow/10 border border-accent-yellow/20 text-sm text-accent-yellow">
                This feature is a work in progress and may not be fully accurate. Some near-HR park calculations are still being refined.
              </div>
            </div>
          )}

          {/* Surprise HRs */}
          {day.surprise_hrs.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">Surprise HRs (Not Ranked)</h4>
              {day.surprise_hrs.map((hr, i) => (
                <div key={i} className="text-xs text-muted py-1">
                  <span className="text-accent-red font-medium">{hr.name}</span> vs {hr.pitcher}
                </div>
              ))}
            </div>
          )}

          {/* Separation */}
          <div className="mt-3 pt-3 border-t border-card-border flex flex-wrap items-center gap-2 md:gap-4 text-xs">
            <span className="text-muted">Composite separation:</span>
            <span className={`font-mono font-semibold ${day.composite_separation > 0 ? "text-accent-green" : "text-accent-red"}`}>
              {day.composite_separation > 0 ? "+" : ""}{day.composite_separation.toFixed(3)}
            </span>
            <span className="text-muted">
              (HR hitters avg {day.avg_composite_hr_hitters.toFixed(3)} vs non-hitters {day.avg_composite_non_hitters.toFixed(3)})
            </span>
          </div>
        </div>
  );
}

function HRHittersTable({ l5, l10, activeLb }: {
  l5: Array<{ name: string; rank: number; composite: number; opp_pitcher: string; matchup: string }>;
  l10: Array<{ name: string; rank: number; composite: number; opp_pitcher: string; matchup: string }>;
  activeLb: "L5" | "L10";
}) {
  const hitters = activeLb === "L10" && l10.length > 0 ? l10 : l5;

  return (
    <div className="mb-3">
      <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">HR Hitters in Rankings ({activeLb})</h4>

      {/* Mobile card view */}
      <div className="md:hidden space-y-1.5">
        {hitters.map((h) => (
          <div key={h.name} className="bg-background/30 rounded-lg px-3 py-2 flex items-center gap-3">
            <span className="font-mono font-bold text-accent text-sm shrink-0">#{h.rank}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-foreground">{h.name}</span>
              <div className="text-[10px] text-muted mt-0.5">vs {h.opp_pitcher} &middot; {h.matchup}</div>
            </div>
            <span className="font-mono text-sm text-foreground shrink-0">{h.composite.toFixed(3)}</span>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-center py-1.5 w-12">Rank</th>
              <th className="text-left py-1.5">Player</th>
              <th className="text-left py-1.5">vs Pitcher</th>
              <th className="text-left py-1.5">Game</th>
              <th className="text-center py-1.5">Score</th>
            </tr>
          </thead>
          <tbody>
            {hitters.map((h) => (
              <tr key={h.name} className="border-b border-card-border/30">
                <td className="text-center py-1.5 font-mono font-bold text-accent">#{h.rank}</td>
                <td className="py-1.5 font-medium text-foreground">{h.name}</td>
                <td className="py-1.5 text-muted">{h.opp_pitcher}</td>
                <td className="py-1.5 text-muted">{h.matchup}</td>
                <td className="text-center py-1.5 font-mono">{h.composite.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="bg-card/50 border border-card-border rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${good === true ? "text-accent-green" : good === false ? "text-accent-red" : "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
