"use client";

import { useEffect, useState } from "react";
import { ListOrdered, Table2 } from "lucide-react";
import { color } from "../../_design";
import type { NflSlate } from "./types";
import { Rankings } from "./rankings";
import { ResearchTable } from "./research-table";

type Tab = "rankings" | "research";
const FAV_KEY = "beeb:nfl-favorites";

export function NflDashboard() {
  const [slate, setSlate] = useState<NflSlate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rankings");
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

  return (
    <div className="min-h-screen" style={{ background: color.background }}>
      <header className="border-b" style={{ borderColor: "#2c2c2e", background: color.card }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-foreground leading-tight">Beeb Sheets — NFL</div>
            <div className="text-[11px] font-medium truncate" style={{ color: color.muted }}>
              Anytime TD{slate ? ` · ${slate.season} Week ${slate.week}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {([["rankings", "Rankings", ListOrdered], ["research", "Research", Table2]] as const).map(
              ([key, label, Ico]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                  style={
                    tab === key
                      ? { background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)", color: color.accent }
                      : { background: "transparent", border: "1px solid #2c2c2e", color: color.muted }
                  }
                >
                  <Ico size={14} /> {label}
                </button>
              ),
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="rounded-xl p-8 text-center text-[13px]" style={{ color: color.muted, border: "1px solid #2c2c2e" }}>
            Couldn&apos;t load the NFL slate ({error}).<br />
            Run <code className="font-mono" style={{ color: color.foreground }}>python3 -m nfl.main --season 2025 --week 10</code> to generate it.
          </div>
        )}
        {!slate && !error && (
          <div className="text-[13px]" style={{ color: color.muted }}>Loading slate…</div>
        )}
        {slate && (
          tab === "rankings"
            ? <Rankings slate={slate} favorites={favorites} onToggleFavorite={toggleFavorite} />
            : <ResearchTable slate={slate} favorites={favorites} onToggleFavorite={toggleFavorite} />
        )}
      </main>
    </div>
  );
}
