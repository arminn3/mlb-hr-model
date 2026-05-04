"use client";

import type { BullpenEntry } from "./types";
import { teamLogoUrl, teamName } from "./game-header";

const STATUS_CONFIG = {
  fresh:        { dot: "bg-accent-green",  label: "Fresh",  text: "text-accent-green" },
  available:    { dot: "bg-accent-green/60", label: "Avail", text: "text-accent-green/70" },
  questionable: { dot: "bg-accent-yellow", label: "Quest.", text: "text-accent-yellow" },
  tired:        { dot: "bg-accent-red",    label: "Tired",  text: "text-accent-red" },
};

function restLabel(days: number): string {
  if (days <= 0) return "Pitched yesterday";
  if (days === 1) return "1 day rest";
  return `${days} days rest`;
}

function PitcherRow({ p }: { p: BullpenEntry }) {
  const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.fresh;
  return (
    <div
      className="flex items-center gap-3 py-2 px-3"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className="text-sm text-foreground font-medium flex-1 min-w-0 truncate">{p.name}</span>
      <span className="text-xs text-muted font-mono flex-shrink-0">{restLabel(p.days_rest)}</span>
      {p.pitches > 0 && (
        <span className="text-xs text-muted/60 font-mono flex-shrink-0 w-14 text-right">
          {p.pitches} pit · {p.ip} IP
        </span>
      )}
      <span className={`text-[10px] font-bold uppercase tracking-wide flex-shrink-0 w-12 text-right ${cfg.text}`}>
        {cfg.label}
      </span>
    </div>
  );
}

function TeamBullpen({ teamAbbr, entries }: { teamAbbr: string; entries: BullpenEntry[] }) {
  if (entries.length === 0) return null;
  const tired = entries.filter((e) => e.status === "tired" || e.status === "questionable").length;
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
      >
        <img src={teamLogoUrl(teamAbbr)} alt={teamAbbr} className="w-5 h-5 object-contain" />
        <span className="text-xs font-bold text-foreground">{teamName(teamAbbr)} Bullpen</span>
        {tired > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-accent-yellow">{tired} arm{tired > 1 ? "s" : ""} unavail.</span>
        )}
      </div>
      <div>
        {entries.map((p) => <PitcherRow key={p.id} p={p} />)}
      </div>
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
  if (!bullpen.away.length && !bullpen.home.length) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted/50">Bullpen Freshness</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TeamBullpen teamAbbr={awayTeam} entries={bullpen.away} />
        <TeamBullpen teamAbbr={homeTeam} entries={bullpen.home} />
      </div>
    </div>
  );
}
