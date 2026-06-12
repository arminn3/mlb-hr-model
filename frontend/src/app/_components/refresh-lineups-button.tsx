"use client";

import { useState, useEffect } from "react";
import { fetchLiveLineups, loadOverride, saveOverride, clearOverride, type LineupOverride } from "./lineup-refresh";

type State = "idle" | "loading" | "done" | "error";

export function RefreshLineupsButton({
  date,
  onOverrideChange,
}: {
  date: string;
  onOverrideChange: (o: LineupOverride | null) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string>("");
  const [override, setOverrideLocal] = useState<LineupOverride | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = loadOverride(date);
    if (saved) {
      setOverrideLocal(saved);
      onOverrideChange(saved);
    }
  }, [date, onOverrideChange]);

  const refresh = async () => {
    if (state === "loading") return;
    setState("loading");
    setError("");
    try {
      const o = await fetchLiveLineups(date);
      saveOverride(o);
      setOverrideLocal(o);
      onOverrideChange(o);
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  const clear = () => {
    clearOverride(date);
    setOverrideLocal(null);
    onOverrideChange(null);
  };

  const ago = override
    ? (() => {
        const mins = Math.floor((Date.now() - override.fetchedAt) / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        return `${hrs}h ago`;
      })()
    : null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={state === "loading"}
        className={
          "px-3 py-1.5 text-[12px] font-semibold rounded-[var(--radius-md)] cursor-pointer transition-colors border " +
          (state === "loading"
            ? "bg-transparent text-muted border-[#2c2c2e] cursor-wait"
            : state === "done"
            ? "bg-accent-green/15 text-accent-green border-accent-green/40"
            : state === "error"
            ? "bg-accent-red/15 text-accent-red border-accent-red/40"
            : override
            ? "bg-accent/15 text-accent border-accent/40 hover:border-accent/60"
            : "bg-transparent text-muted border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e]")
        }
        title={override ? `${override.starters.length} starters across ${override.gamesWithLineups} games` : "Pull latest posted lineups from MLB"}
      >
        {state === "loading" ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Loading
          </span>
        ) : state === "done" ? (
          <span className="inline-flex items-center gap-1.5">
            ✓ Updated · {override?.starters.length} starters
          </span>
        ) : state === "error" ? (
          <span>Error: {error.slice(0, 30)}</span>
        ) : override ? (
          <span>Lineups · {override.gamesWithLineups} games · {ago}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Lineups
          </span>
        )}
      </button>
      {override && state !== "loading" && (
        <button
          onClick={clear}
          className="text-[11px] text-muted hover:text-foreground cursor-pointer"
          title="Revert to slate-based confirmed starters"
        >
          clear
        </button>
      )}
    </div>
  );
}
