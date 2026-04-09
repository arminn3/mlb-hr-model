"use client";

import type { PlayerData } from "./types";
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
          {/* Mobile card view */}
          <div className="md:hidden space-y-1.5">
            {bvp.recent_abs.map((ab, i) => (
              <div key={i} className="bg-background/30 rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="text-xs text-foreground capitalize">{(ab.result || "").replace(/_/g, " ")}</div>
                  <div className="text-[10px] text-muted mt-0.5">{ab.date.slice(5)} &middot; {ab.pitch_type}</div>
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className={`font-mono ${ab.ev >= 95 ? "text-accent-green" : "text-foreground"}`}>
                    {ab.ev > 0 ? ab.ev.toFixed(1) : "-"} EV
                  </span>
                  <span className={`font-mono ${ab.angle >= 25 && ab.angle <= 35 ? "text-accent-green" : "text-foreground"}`}>
                    {ab.angle !== 0 ? `${ab.angle.toFixed(0)}°` : "-"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className={`hidden md:block ${tableWrapperClass}`} style={tableWrapperStyle}>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={headerCellClass} style={headerCellStyle}>Date</th>
                  <th className={headerCellClass} style={headerCellStyle}>Pitch</th>
                  <th className={headerCellClass} style={headerCellStyle}>EV</th>
                  <th className={headerCellClass} style={headerCellStyle}>Angle</th>
                  <th className={headerCellClass} style={headerCellStyle}>Result</th>
                </tr>
              </thead>
              <tbody>
                {bvp.recent_abs.map((ab, i) => (
                  <tr key={i} style={{ backgroundColor: TABLE_BG }}>
                    <td className={cellClass} style={cellStyle}>{ab.date.slice(5)}</td>
                    <td className={cellClass} style={cellStyle}>{ab.pitch_type}</td>
                    <td className={cellClass} style={cellStyle}>{ab.ev > 0 ? ab.ev.toFixed(1) : "-"}</td>
                    <td className={cellClass} style={cellStyle}>{ab.angle !== 0 ? `${ab.angle.toFixed(0)}°` : "-"}</td>
                    <td className={cellClass} style={cellStyle}>{(ab.result || "").replace(/_/g, " ")}</td>
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
