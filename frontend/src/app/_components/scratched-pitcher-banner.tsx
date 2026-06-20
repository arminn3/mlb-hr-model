"use client";

import { useState, useEffect, useRef } from "react";
import type { PitcherScratch } from "./pitcher-scratch";

// Team roster fetches — /sports/1/players returns garbage team data (665 of
// the 700+ pitchers come back with no team at all), so we hit each team's
// 40-man roster endpoint directly. One cache per team, populated lazily on
// the first time the user opens that team's Mark Scratched form.
type PitcherOption = { id: number; name: string; hand: "L" | "R" };

// Static team abbr → MLB team ID. These are stable, no need to refetch.
const TEAM_ID: Record<string, number> = {
  ARI: 109, AZ: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CWS: 145,
  CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117, KC: 118, LAA: 108,
  LAD: 119, MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, ATH: 133,
  OAK: 133, PHI: 143, PIT: 134, SD: 135, SDP: 135, SF: 137, SEA: 136,
  STL: 138, TB: 139, TBR: 139, TEX: 140, TOR: 141, WSH: 120,
};

const _teamRosterCache: Map<string, Promise<PitcherOption[]>> = new Map();

async function loadTeamPitchers(teamAbbr: string): Promise<PitcherOption[]> {
  if (_teamRosterCache.has(teamAbbr)) return _teamRosterCache.get(teamAbbr)!;
  const teamId = TEAM_ID[teamAbbr];
  if (!teamId) {
    const empty: PitcherOption[] = [];
    _teamRosterCache.set(teamAbbr, Promise.resolve(empty));
    return empty;
  }
  const promise = (async () => {
    try {
      // 40-man roster has all the active+IL pitchers for the team — that's the
      // pool real-life replacements come from. Include `person` hand via hydrate.
      const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster/40Man?hydrate=person`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`MLB API ${resp.status}`);
      const data = await resp.json();
      type Entry = {
        position?: { code?: string };
        person?: { id: number; fullName?: string; pitchHand?: { code?: string } };
      };
      const list: PitcherOption[] = ((data?.roster ?? []) as Entry[])
        .filter((r) => r?.position?.code === "1")
        .map((r) => ({
          id: r.person!.id,
          name: r.person!.fullName || "",
          hand: (r?.person?.pitchHand?.code === "L" ? "L" : "R") as "L" | "R",
        }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      return list;
    } catch {
      return [];
    }
  })();
  _teamRosterCache.set(teamAbbr, promise);
  return promise;
}

export function ScratchedPitcherBanner({
  scratch,
  originalHand,
  onClear,
}: {
  scratch: PitcherScratch;
  originalHand: "L" | "R";
  onClear: () => void;
}) {
  // Platoon flip = if the replacement throws with the opposite hand, every batter's
  // platoon advantage just flipped. Critical signal for HR betting.
  const platoonFlip = scratch.replacementHand !== originalHand;

  return (
    <div
      className="rounded-lg px-3 py-2 mb-3 flex items-center gap-3"
      style={{
        background: "rgba(239,68,68,0.10)",
        border: "1px solid rgba(239,68,68,0.32)",
      }}
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 whitespace-nowrap">
        Scratched
      </span>
      <div className="flex-1 text-[12px] text-foreground leading-tight">
        <span className="line-through text-foreground/55">{scratch.originalName}</span>
        {" → "}
        <span className="font-semibold">{scratch.replacementName}</span>
        <span className="ml-1.5 px-1 py-0.5 text-[9px] font-mono font-bold rounded bg-white/10 text-foreground/80">
          {scratch.replacementHand}HP
        </span>
        {platoonFlip && (
          <span className="ml-2 text-[11px] font-semibold text-amber-400">
            Platoon flip — ratings stale
          </span>
        )}
      </div>
      <button
        onClick={onClear}
        className="text-[10px] text-muted hover:text-foreground cursor-pointer"
        title="Clear scratch override"
      >
        clear
      </button>
    </div>
  );
}

export function MarkScratchedButton({
  originalName,
  originalHand,
  teamAbbr,
  onSave,
}: {
  originalName: string;
  originalHand: "L" | "R";
  /** Filter the autocomplete to this team's active pitchers only */
  teamAbbr: string;
  onSave: (replacementName: string, replacementHand: "L" | "R", replacementId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PitcherOption | null>(null);
  const [pitchers, setPitchers] = useState<PitcherOption[]>([]);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load this TEAM's 40-man pitcher list the first time the form opens.
  useEffect(() => {
    if (!open || pitchers.length > 0) return;
    let cancelled = false;
    loadTeamPitchers(teamAbbr).then((list) => { if (!cancelled) setPitchers(list); });
    return () => { cancelled = true; };
  }, [open, pitchers.length, teamAbbr]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
        setSelected(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // `pitchers` is already filtered to this team's 40-man roster by the loader.
  const suggestions = (query.trim().length === 0
    ? pitchers
    : pitchers.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
  ).slice(0, 12);

  const commit = (pitcher: PitcherOption) => {
    onSave(pitcher.name, pitcher.hand, pitcher.id);
    setOpen(false);
    setQuery("");
    setSelected(null);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md cursor-pointer transition-colors flex items-center gap-1.5"
        style={{
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.40)",
          color: "rgb(252,165,165)",
        }}
        title={`Mark ${originalName} as scratched`}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Mark Scratched
      </button>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className="rounded-md px-2 py-1.5 flex items-center gap-2"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)" }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); setSelected(null); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && suggestions[highlight]) { e.preventDefault(); commit(suggestions[highlight]); }
            else if (e.key === "Escape") { setOpen(false); setQuery(""); }
          }}
          placeholder="Type replacement name…"
          className="bg-transparent text-[12px] text-foreground placeholder:text-foreground/45 outline-none w-44 font-medium"
        />
        {selected && (
          <span
            className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded"
            style={{ background: "rgba(34,197,94,0.18)", color: "rgb(134,239,172)" }}
            title={`${selected.name} throws ${selected.hand === "L" ? "left" : "right"}-handed`}
          >
            {selected.hand}HP
          </span>
        )}
        <button
          onClick={() => { setOpen(false); setQuery(""); setSelected(null); }}
          className="text-[11px] text-foreground/55 hover:text-foreground cursor-pointer"
          title="Cancel"
        >
          ✕
        </button>
      </div>
      {suggestions.length > 0 && (
        <div
          className="absolute z-50 mt-1 rounded-md overflow-hidden w-full"
          style={{ background: "#0d0d12", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}
        >
          {suggestions.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); commit(p); }}
              onMouseEnter={() => setHighlight(i)}
              className="w-full text-left px-3 py-2 cursor-pointer flex items-center justify-between gap-2 transition-colors"
              style={{ background: i === highlight ? "rgba(255,255,255,0.07)" : "transparent" }}
            >
              <span className="text-[13px] text-foreground font-medium truncate">{p.name}</span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span
                  className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded"
                  style={p.hand === "L"
                    ? { background: "rgba(96,165,250,0.18)", color: "rgb(147,197,253)" }
                    : { background: "rgba(251,191,36,0.18)", color: "rgb(253,224,71)" }}
                >
                  {p.hand}HP
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {query.trim().length > 0 && pitchers.length === 0 && (
        <div className="absolute z-50 mt-1 rounded-md px-3 py-2 text-[11px] text-foreground/65"
          style={{ background: "#0d0d12", border: "1px solid rgba(255,255,255,0.16)" }}>
          Loading pitchers…
        </div>
      )}
      {query.trim().length > 0 && pitchers.length > 0 && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 rounded-md px-3 py-2 text-[11px] text-foreground/65"
          style={{ background: "#0d0d12", border: "1px solid rgba(255,255,255,0.16)" }}>
          No {teamAbbr} pitchers match &quot;{query}&quot;.
          <br />
          <span className="text-[10px] text-foreground/55">If a player was just traded their MLB roster may not be updated yet — pick from the original team or wait.</span>
        </div>
      )}
    </div>
  );
}
