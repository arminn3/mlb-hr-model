"use client";

import type { PlayerData } from "./types";

export function BvPTab({ player }: { player: PlayerData }) {
  const bvp = player.bvp_stats;

  if (!bvp || !bvp.career) {
    return (
      <div className="text-xs text-muted py-4 text-center">
        No batter vs pitcher history available.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-semibold text-foreground">{player.name}</span>
        <span className="text-xs text-muted">vs</span>
        <span className="text-sm font-semibold text-foreground">{player.opp_pitcher}</span>
      </div>

      {/* Summary stats */}
      {bvp.career && bvp.career.abs > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">Career Head-to-Head</h4>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
            <StatBox label="AB" value={`${bvp.career.abs}`} />
            <StatBox label="H" value={`${bvp.career.hits}`} />
            <StatBox label="HR" value={`${bvp.career.hrs}`} highlight={bvp.career.hrs > 0} />
            <StatBox label="BA" value={bvp.career.ba.toFixed(3)} highlight={bvp.career.ba >= 0.280} />
            <StatBox label="SLG" value={bvp.career.slg.toFixed(3)} highlight={bvp.career.slg >= 0.450} />
            <StatBox label="ISO" value={bvp.career.iso.toFixed(3)} highlight={bvp.career.iso >= 0.200} />
            <StatBox label="K%" value={`${bvp.career.k_pct.toFixed(0)}%`} />
          </div>
        </div>
      )}

      {/* Recent at-bats against this pitcher */}
      {bvp.recent_abs && bvp.recent_abs.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Recent At-Bats vs {player.opp_pitcher} ({bvp.recent_abs.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                  <th className="text-left py-1.5">Date</th>
                  <th className="text-left py-1.5">Pitch</th>
                  <th className="text-center py-1.5">EV</th>
                  <th className="text-center py-1.5">Angle</th>
                  <th className="text-left py-1.5">Result</th>
                </tr>
              </thead>
              <tbody>
                {bvp.recent_abs.map((ab, i) => (
                  <tr key={i} className="border-b border-card-border/30">
                    <td className="py-1.5 text-muted font-mono">{ab.date.slice(5)}</td>
                    <td className="py-1.5 text-foreground">{ab.pitch_type}</td>
                    <td className="text-center py-1.5">
                      <span className={`font-mono ${ab.ev >= 95 ? "text-accent-green" : "text-foreground"}`}>
                        {ab.ev > 0 ? ab.ev.toFixed(1) : "-"}
                      </span>
                    </td>
                    <td className="text-center py-1.5">
                      <span className={`font-mono ${ab.angle >= 25 && ab.angle <= 35 ? "text-accent-green" : "text-foreground"}`}>
                        {ab.angle !== 0 ? `${ab.angle.toFixed(0)}°` : "-"}
                      </span>
                    </td>
                    <td className="py-1.5 text-muted capitalize">{(ab.result || "").replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bvp.career && bvp.career.abs === 0 && (
        <p className="text-xs text-muted py-2">First career meeting — no history.</p>
      )}
    </div>
  );
}

function StatBox({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-background/30 rounded-lg p-2 text-center">
      <div className={`text-sm font-bold font-mono ${highlight ? "text-accent-green" : "text-foreground"}`}>{value}</div>
      <div className="text-[9px] text-muted uppercase">{label}</div>
    </div>
  );
}
