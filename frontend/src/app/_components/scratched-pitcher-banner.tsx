"use client";

import { useState, useEffect, useRef } from "react";
import type { PitcherScratch } from "./pitcher-scratch";

// Cached list of active MLB pitchers — fetched once per page load, shared
// across every Mark Scratched button so the autocomplete is instant.
type PitcherOption = { id: number; name: string; hand: "L" | "R"; teamAbbr: string };
let _pitcherCache: PitcherOption[] | null = null;
let _pitcherCachePromise: Promise<PitcherOption[]> | null = null;

async function loadActivePitchers(): Promise<PitcherOption[]> {
  if (_pitcherCache) return _pitcherCache;
  if (_pitcherCachePromise) return _pitcherCachePromise;
  _pitcherCachePromise = (async () => {
    try {
      const year = new Date().getFullYear();
      const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${year}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`MLB API ${resp.status}`);
      const data = await resp.json();
      type RawPerson = {
        id: number;
        fullName?: string;
        primaryPosition?: { code?: string };
        pitchHand?: { code?: string };
        currentTeam?: { abbreviation?: string };
      };
      const list: PitcherOption[] = ((data?.people ?? []) as RawPerson[])
        .filter((p) => p?.primaryPosition?.code === "1") // pitchers
        .map((p) => ({
          id: p.id,
          name: p.fullName || "",
          hand: (p?.pitchHand?.code === "L" ? "L" : "R") as "L" | "R",
          teamAbbr: p?.currentTeam?.abbreviation || "",
        }))
        .filter((p) => p.name);
      _pitcherCache = list;
      return list;
    } catch {
      _pitcherCache = [];
      return [];
    }
  })();
  return _pitcherCachePromise;
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
  onSave: (replacementName: string, replacementHand: "L" | "R") => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PitcherOption | null>(null);
  const [pitchers, setPitchers] = useState<PitcherOption[]>([]);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load pitcher list the first time the user opens the form.
  useEffect(() => {
    if (!open || pitchers.length > 0) return;
    let cancelled = false;
    loadActivePitchers().then((list) => { if (!cancelled) setPitchers(list); });
    return () => { cancelled = true; };
  }, [open, pitchers.length]);

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

  // Only this team's pitchers — replacements come from the team's own roster.
  // ATH/OAK alias maps to the same Athletics team for the Vegas-era roster.
  // Unassigned pitchers (no team in MLB API — usually just-traded / call-ups
  // whose roster hasn't propagated yet) are included as a fallback so the user
  // can still find them. Empty-string teamAbbr means "no team data."
  const teamPitchers = pitchers.filter((p) =>
    p.teamAbbr === teamAbbr
    || (teamAbbr === "ATH" && p.teamAbbr === "OAK")
    || (teamAbbr === "OAK" && p.teamAbbr === "ATH")
    || p.teamAbbr === ""
  );

  // When the input is empty, show the whole roster so the user can browse.
  // Surface real team members first, unassigned ("just traded") below them.
  const suggestions = (query.trim().length === 0
    ? teamPitchers
    : teamPitchers.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
  )
    .sort((a, b) => (a.teamAbbr === "" ? 1 : 0) - (b.teamAbbr === "" ? 1 : 0))
    .slice(0, 12);

  const commit = (pitcher: PitcherOption) => {
    onSave(pitcher.name, pitcher.hand);
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
                {p.teamAbbr ? (
                  <span className="text-[10px] text-foreground/55 font-mono">{p.teamAbbr}</span>
                ) : (
                  <span className="text-[9px] uppercase tracking-wider font-bold text-amber-400/85" title="No team data in MLB API — recently traded/promoted">
                    Recent move
                  </span>
                )}
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
          No {teamAbbr} pitchers match &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
