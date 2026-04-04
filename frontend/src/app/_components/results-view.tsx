"use client";

import { useEffect, useState } from "react";

interface DayReport {
  date: string;
  total_players_ranked: number;
  total_hrs_hit: number;
  total_near_hrs?: number;
  model_hits: number;
  model_near_hits?: number;
  tier_accuracy: Record<string, { total: number; hits: number; rate: number }>;
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
  const [data, setData] = useState<DayReport[]>([]);
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

  return (
    <div>
      {/* Cumulative summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatBox label="Days Tracked" value={`${totalDays}`} />
        <StatBox label="Total HRs" value={`${totalHRs}`} sub={`${totalCaught} caught + ${data.reduce((s, d) => s + (d.model_near_hits || 0), 0)} near HRs`} />
        <StatBox
          label="Top 10 Hit Rate"
          value={cumTop10Total > 0 ? `${(cumTop10Hits / cumTop10Total * 100).toFixed(1)}%` : "-"}
          sub={`${cumTop10Hits}/${cumTop10Total}`}
        />
        <StatBox
          label="Top 20 Hit Rate"
          value={cumTop20Total > 0 ? `${(cumTop20Hits / cumTop20Total * 100).toFixed(1)}%` : "-"}
          sub={`${cumTop20Hits}/${cumTop20Total}`}
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

      {/* Daily reports */}
      {filtered.map((day) => (
        <div key={day.date} className="border border-card-border rounded-xl bg-card/50 p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">{day.date}</h3>
            <div className="flex items-center gap-4 text-xs text-muted">
              <span>{day.total_players_ranked} ranked</span>
              <span>{day.total_hrs_hit} HRs hit</span>
              <span className="text-accent-green">{day.model_hits} caught</span>
            </div>
          </div>

          {/* Tier accuracy */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {Object.entries(day.tier_accuracy).map(([tier, acc]) => (
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

          {/* HR hitters */}
          {day.hr_hitters.length > 0 && (
            <div className="mb-3">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">HR Hitters in Rankings</h4>
              <div className="overflow-x-auto">
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
                    {day.hr_hitters.map((h) => (
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
          )}

          {/* Near HRs — batted ball events */}
          {day.near_hr_events && day.near_hr_events.length > 0 && (
            <div className="mb-3">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Near HRs — Warning Track ({day.near_hr_events.length} batted balls)
              </h4>
              <div className="overflow-x-auto">
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
          <div className="mt-3 pt-3 border-t border-card-border flex items-center gap-4 text-xs">
            <span className="text-muted">Composite separation:</span>
            <span className={`font-mono font-semibold ${day.composite_separation > 0 ? "text-accent-green" : "text-accent-red"}`}>
              {day.composite_separation > 0 ? "+" : ""}{day.composite_separation.toFixed(3)}
            </span>
            <span className="text-muted">
              (HR hitters avg {day.avg_composite_hr_hitters.toFixed(3)} vs non-hitters {day.avg_composite_non_hitters.toFixed(3)})
            </span>
          </div>
        </div>
      ))}
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
