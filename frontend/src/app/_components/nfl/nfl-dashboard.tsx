"use client";

import { useEffect, useState } from "react";
import { color } from "../../_design";
import { UserMenu } from "../user-menu";
import type { NflSlate, NflPlayer } from "./types";
import { Rankings } from "./rankings";
import { GameResearch } from "./game-research";

type Tab = "rankings" | "research";
const FAV_KEY = "beeb:nfl-favorites";

export function NflDashboard() {
  const [slate, setSlate] = useState<NflSlate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("research");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(FAV_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    fetch("/data/nfl/latest.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setSlate)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(FAV_KEY, JSON.stringify([...favorites])); } catch {}
  }, [favorites]);

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Clicking a ranking row jumps to that player's GAME in the game-driven
  // Research view (then you scroll to the role-holder).
  const openResearch = (p: NflPlayer) => {
    const g = slate?.games.find((gm) => gm.players.some((pl) => pl.gsis_id === p.gsis_id && pl.team === p.team));
    if (g) setSelectedGameId(g.game_id);
    setTab("research");
  };

  return (
    <div className="min-h-screen" style={{ background: color.background }}>
      <header className="border-b" style={{ borderColor: "#3a3a3a", background: color.background }}>
        <div className="max-w-[1760px] mx-auto px-6 flex items-center justify-between">
          {/* title — sits above the game rail */}
          <div className="flex items-center py-6 w-[186px] shrink-0">
            <span className="text-[20px] font-bold text-white whitespace-nowrap">Beeb Sheets</span>
          </div>
          {/* main nav tabs */}
          <nav className="flex-1 min-w-0 flex items-center gap-6 px-[18px]">
            {([["rankings", "Rankings"], ["research", "Research"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="px-2 py-1 rounded-lg text-[16px] font-medium cursor-pointer whitespace-nowrap transition-colors"
                style={tab === key
                  ? { background: "#1e2444", border: "1px solid #3a54d5", color: "#fff" }
                  : { background: "transparent", border: "1px solid transparent", color: "#909090" }}
              >
                {label}
              </button>
            ))}
          </nav>
          {/* account — Clerk avatar (signed-in) / Sign in link (signed-out) */}
          <div className="shrink-0 flex items-center justify-end min-w-[44px]">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-[1760px] mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="rounded-xl p-8 text-center text-[13px]" style={{ color: color.muted, border: "1px solid #2c2c2e" }}>
            Couldn&apos;t load the NFL slate ({error}).<br />
            Run <code className="font-mono" style={{ color: color.foreground }}>python3 -m nfl.main --season 2025 --week 10</code> to generate it.
          </div>
        )}
        {!slate && !error && (
          <div className="text-[13px]" style={{ color: color.muted }}>Loading slate…</div>
        )}
        {slate && tab === "rankings" && (
          <Rankings slate={slate} favorites={favorites} onToggleFavorite={toggleFavorite} onSelect={openResearch} />
        )}
        {slate && tab === "research" && (
          <GameResearch slate={slate} selectedGameId={selectedGameId} onSelectGame={setSelectedGameId} />
        )}
      </main>
    </div>
  );
}
