"use client";

import type { BullpenEntry } from "./types";
import { teamLogoUrl, teamName } from "./game-header";

const STATUS_DOT: Record<string, string> = {
  fresh:        "bg-accent-green",
  available:    "bg-accent-green/50",
  questionable: "bg-accent-yellow",
  tired:        "bg-accent-red",
};

function eraColor(v: number | null) {
  if (v == null) return "text-muted/50";
  if (v < 3.0)  return "text-accent-green font-semibold";
  if (v < 4.5)  return "text-foreground";
  return "text-accent-red";
}
function hr9Color(v: number | null) {
  if (v == null) return "text-muted/50";
  if (v < 1.0)  return "text-accent-green font-semibold";
  if (v < 1.5)  return "text-foreground";
  return "text-accent-red";
}
function kPctColor(v: number | null) {
  if (v == null) return "text-muted/50";
  if (v >= 28)  return "text-accent-green font-semibold";
  if (v >= 18)  return "text-foreground";
  return "text-accent-red";
}
function restLabel(days: number) {
  if (days <= 0) return "yest";
  if (days === 1) return "1d";
  return `${days}d`;
}
function fmt(v: number | null, digits = 2) {
  return v == null ? "—" : v.toFixed(digits);
}

function TeamBullpen({ teamAbbr, entries }: { teamAbbr: string; entries: BullpenEntry[] }) {
  if (!entries.length) return (
    <div className="rounded-xl p-4 text-xs text-muted text-center" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      No recent bullpen data
    </div>
  );

  const tired = entries.filter((e) => e.status === "tired" || e.status === "questionable").length;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <img src={teamLogoUrl(teamAbbr)} alt={teamAbbr} className="w-5 h-5 object-contain" />
        <span className="text-xs font-bold text-foreground">{teamName(teamAbbr)} Bullpen</span>
        {tired > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-accent-yellow">{tired} unavail.</span>
        )}
      </div>

      {/* Column headers */}
      <div className="grid px-3 py-1.5" style={{ gridTemplateColumns: "1.5rem 1fr 2rem 3rem 3rem 3rem 3rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <span />
        <span className="text-[9px] uppercase tracking-widest text-muted/40">Pitcher</span>
        <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">Rest</span>
        <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">ERA</span>
        <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">HR/9</span>
        <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">K%</span>
        <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">WHIP</span>
      </div>

      {/* Rows */}
      {entries.map((p) => (
        <div
          key={p.id}
          className="grid items-center px-3 py-2"
          style={{ gridTemplateColumns: "1.5rem 1fr 2rem 3rem 3rem 3rem 3rem", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
        >
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[p.status] ?? "bg-muted/40"}`} />
          <span className="text-xs text-foreground font-medium truncate pr-2">{p.name}</span>
          <span className="text-[11px] font-mono text-muted text-center">{restLabel(p.days_rest)}</span>
          <span className={`text-[11px] font-mono text-center ${eraColor(p.era)}`}>{fmt(p.era)}</span>
          <span className={`text-[11px] font-mono text-center ${hr9Color(p.hr9)}`}>{fmt(p.hr9)}</span>
          <span className={`text-[11px] font-mono text-center ${kPctColor(p.k_pct)}`}>{fmt(p.k_pct, 1)}{p.k_pct != null ? "%" : ""}</span>
          <span className="text-[11px] font-mono text-muted/70 text-center">{fmt(p.whip)}</span>
        </div>
      ))}
    </div>
  );
}

export function BullpenSection({
  awayTeam,
  homeTeam,
  bullpen,
}: {
  awayTeam: string;
  homeTeam: string;
  bullpen: { away: BullpenEntry[]; home: BullpenEntry[] };
}) {
  return (
    <div className="mt-8 space-y-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted/40">Bullpen Freshness</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TeamBullpen teamAbbr={awayTeam} entries={bullpen.away} />
        <TeamBullpen teamAbbr={homeTeam} entries={bullpen.home} />
      </div>
    </div>
  );
}
