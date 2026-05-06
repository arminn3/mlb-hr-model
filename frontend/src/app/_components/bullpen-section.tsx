"use client";

import type { BullpenEntry, TeamBullpen, BullpenQuality } from "./types";
import { teamLogoUrl, teamName } from "./game-header";

// ── Tier config ───────────────────────────────────────────────────────────────

const TIER_CONFIG = {
  1: { label: "Elite",       bg: "rgba(74,222,128,0.10)",  border: "rgba(74,222,128,0.25)",  text: "text-accent-green",  dot: "bg-accent-green" },
  2: { label: "Average",     bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)", text: "text-muted",          dot: "bg-muted/50" },
  3: { label: "Vulnerable",  bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.25)", text: "text-accent-red",     dot: "bg-accent-red" },
};

const STATUS_DOT: Record<string, string> = {
  fresh:        "bg-accent-green",
  available:    "bg-accent-green/50",
  questionable: "bg-accent-yellow",
  tired:        "bg-accent-red",
};

// ── Color helpers ─────────────────────────────────────────────────────────────

function eraColor(v: number | null) {
  if (v == null) return "text-muted/40";
  if (v < 3.0)  return "text-accent-green font-semibold";
  if (v < 4.25) return "text-foreground";
  return "text-accent-red font-semibold";
}
function hr9Color(v: number | null) {
  if (v == null) return "text-muted/40";
  if (v < 1.0)  return "text-accent-green font-semibold";
  if (v < 1.5)  return "text-foreground";
  return "text-accent-red font-semibold";
}
function kPctColor(v: number | null) {
  if (v == null) return "text-muted/40";
  if (v >= 28)  return "text-accent-green font-semibold";
  if (v >= 18)  return "text-foreground";
  return "text-accent-red font-semibold";
}
function restLabel(days: number) {
  if (days <= 0) return "yest";
  if (days === 1) return "1d";
  return `${days}d`;
}
function fmt(v: number | null, digits = 2) {
  return v == null ? "—" : v.toFixed(digits);
}

// ── Quality banner ────────────────────────────────────────────────────────────

function QualityBanner({ q }: { q: BullpenQuality }) {
  const cfg = TIER_CONFIG[q.tier];
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg flex-wrap"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      <span className={`text-xs font-bold uppercase tracking-wide ${cfg.text}`}>
        {q.label} Bullpen
      </span>
      {q.tired_count >= 2 && (
        <span className="text-[10px] font-semibold text-accent-yellow">{q.tired_count} arms unavail.</span>
      )}
      <div className="flex items-center gap-3 ml-auto">
        {q.avg_era != null && (
          <span className="text-[11px] font-mono">
            <span className="text-muted/50 mr-1">ERA</span>
            <span className={eraColor(q.avg_era)}>{fmt(q.avg_era)}</span>
          </span>
        )}
        {q.avg_hr9 != null && (
          <span className="text-[11px] font-mono">
            <span className="text-muted/50 mr-1">HR/9</span>
            <span className={hr9Color(q.avg_hr9)}>{fmt(q.avg_hr9)}</span>
          </span>
        )}
        {q.avg_k_pct != null && (
          <span className="text-[11px] font-mono">
            <span className="text-muted/50 mr-1">K%</span>
            <span className={kPctColor(q.avg_k_pct)}>{fmt(q.avg_k_pct, 1)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Individual arm row ────────────────────────────────────────────────────────

function ArmRow({ p }: { p: BullpenEntry }) {
  return (
    <div
      className="grid items-center px-3 py-2"
      style={{ gridTemplateColumns: "1rem 1fr 2rem 3rem 3rem 3rem 3rem", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
    >
      <span className={`w-2 h-2 rounded-full ${STATUS_DOT[p.status] ?? "bg-muted/40"}`} />
      <span className="text-xs text-foreground font-medium truncate pr-2">{p.name}</span>
      <span className="text-[11px] font-mono text-muted text-center">{restLabel(p.days_rest)}</span>
      <span className={`text-[11px] font-mono text-center ${eraColor(p.era)}`}>{fmt(p.era)}</span>
      <span className={`text-[11px] font-mono text-center ${hr9Color(p.hr9)}`}>{fmt(p.hr9)}</span>
      <span className={`text-[11px] font-mono text-center ${kPctColor(p.k_pct)}`}>{p.k_pct != null ? `${fmt(p.k_pct, 1)}%` : "—"}</span>
      <span className="text-[11px] font-mono text-muted/60 text-center">{fmt(p.whip)}</span>
    </div>
  );
}

// ── Team bullpen card ─────────────────────────────────────────────────────────

function TeamBullpenCard({ teamAbbr, data }: { teamAbbr: string; data: TeamBullpen }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {/* Team header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <img src={teamLogoUrl(teamAbbr)} alt={teamAbbr} className="w-5 h-5 object-contain" />
        <span className="text-xs font-bold text-foreground">{teamName(teamAbbr)}</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Quality banner */}
        <QualityBanner q={data.quality} />

        {/* Arms table */}
        {data.arms.length > 0 && (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            {/* Column headers */}
            <div className="grid px-3 py-1.5 bg-white/[0.02]" style={{ gridTemplateColumns: "1rem 1fr 2rem 3rem 3rem 3rem 3rem" }}>
              <span />
              <span className="text-[9px] uppercase tracking-widest text-muted/40">Pitcher</span>
              <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">Rest</span>
              <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">ERA</span>
              <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">HR/9</span>
              <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">K%</span>
              <span className="text-[9px] uppercase tracking-widest text-muted/40 text-center">WHIP</span>
            </div>
            {data.arms.map((p) => <ArmRow key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function BullpenSection({
  awayTeam,
  homeTeam,
  bullpen,
}: {
  awayTeam: string;
  homeTeam: string;
  bullpen: { away: TeamBullpen; home: TeamBullpen };
}) {
  return (
    <div className="mt-8 space-y-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted/40">Bullpen Freshness</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TeamBullpenCard teamAbbr={awayTeam} data={bullpen.away} />
        <TeamBullpenCard teamAbbr={homeTeam} data={bullpen.home} />
      </div>
    </div>
  );
}
