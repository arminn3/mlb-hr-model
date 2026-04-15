"use client";

import { useEffect, useState } from "react";
import type { ModelData, LookbackKey, GameEnvironment } from "./types";
import { Sidebar, type Page } from "./sidebar";
import { LookbackToggle } from "./lookback-toggle";
import { DatePicker } from "./date-picker";
import { GameSection } from "./game-section";
import { EnvironmentView } from "./environment-view";
import { Methodology } from "./methodology";
import { TopPicks } from "./top-picks";
import { MLRankings } from "./ml-rankings";
import { ResultsView } from "./results-view";
import { MethodologyPage } from "./methodology-page";
import { SlipGenerator } from "./slip-generator";
import { BvPPage } from "./bvp-page";
import { GemFinder } from "./gem-finder";
import { LiveFeed } from "./live-feed";
import { ProjectionsView } from "./projections-view";
import { MatchupAnalysis } from "./matchup-analysis";

// When MAINTENANCE_MODE_PROD is true, show the error page ONLY on
// the production Vercel deployment. Local dev (`npm run dev`) and
// preview deploys are unaffected. Vercel auto-sets
// NEXT_PUBLIC_VERCEL_ENV to "production" / "preview" / undefined.
const MAINTENANCE_MODE_PROD = false;
const IS_PROD =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
const MAINTENANCE_MODE = MAINTENANCE_MODE_PROD && IS_PROD;

// Dates hidden from prod only (dev sees them normally).
// Add YYYY-MM-DD strings here to fall back to the prior day on prod.
const PROD_BLOCKED_DATES: Set<string> = new Set(IS_PROD ? ["2026-04-15"] : []);

function MaintenancePage() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="bg-card/50 border border-card-border rounded-xl p-8 max-w-md text-center">
        <div className="mb-4">
          <svg className="w-12 h-12 mx-auto text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        </div>
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-1">
          Error 503
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Service Temporarily Unavailable
        </h2>
        <p className="text-sm text-muted">
          We&apos;re experiencing technical difficulties. Please check back shortly.
        </p>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<ModelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (MAINTENANCE_MODE) {
    return <MaintenancePage />;
  }

  // Read initial state from URL hash: #page=rankings&date=2026-04-03&lookback=L5
  function getHashParam(key: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    return params.get(key) || fallback;
  }

  const [activePage, setActivePageRaw] = useState<Page>(() => getHashParam("page", "rankings") as Page);
  const [lookback, setLookbackRaw] = useState<LookbackKey>(() => getHashParam("lookback", "L5") as LookbackKey);
  const [selectedDate, setSelectedDate] = useState<string>(() => getHashParam("date", ""));
  const [selectedGames, setSelectedGames] = useState<Set<number>>(new Set()); // empty = all games

  // Update URL hash when state changes
  function updateHash(page: string, date: string, lb: string) {
    if (typeof window === "undefined") return;
    window.location.hash = `page=${page}&date=${date}&lookback=${lb}`;
  }

  const setActivePage = (p: Page) => {
    setActivePageRaw(p);
    updateHash(p, selectedDate, lookback);
  };
  const setLookback = (lb: LookbackKey) => {
    setLookbackRaw(lb);
    updateHash(activePage, selectedDate, lb);
  };

  const loadDate = (dateStr: string) => {
    const url = dateStr ? `/data/${dateStr}.json` : "/data/latest.json";
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("No data for this date.");
        return res.json();
      })
      .then((d: ModelData) => {
        // If the fetched date is blocked on prod, swap in the prior day.
        if (PROD_BLOCKED_DATES.has(d.date)) {
          const [y, m, day] = d.date.split("-").map(Number);
          const prev = new Date(Date.UTC(y, m - 1, day - 1));
          const prevStr = prev.toISOString().slice(0, 10);
          return fetch(`/data/${prevStr}.json`).then((r) => r.json());
        }
        return d;
      })
      .then((d: ModelData) => {
        setData(d);
        setSelectedDate(d.date);
        updateHash(activePage, d.date, lookback);
        setError(null);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    // Always load latest data on first visit
    loadDate("");
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="bg-card/50 border border-card-border rounded-xl p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">No Model Data Yet</h2>
          <p className="text-sm text-muted mb-4">{error}</p>
          <code className="text-xs bg-background px-3 py-2 rounded text-accent font-mono block">
            python main.py
          </code>
        </div>
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  const totalPlayers = data.games.reduce((sum, g) => sum + g.players.length, 0);

  const envGames: Array<{
    game_pk: number;
    away_team: string;
    home_team: string;
    away_pitcher: string;
    home_pitcher: string;
  } & GameEnvironment> = data.games.map((g) => ({
    game_pk: g.game_pk,
    away_team: g.away_team,
    home_team: g.home_team,
    away_pitcher: g.away_pitcher.name,
    home_pitcher: g.home_pitcher.name,
    ...g.environment,
  }));

  const handlePageChange = (page: Page) => {
    setActivePage(page);
    setSidebarOpen(false); // close on mobile after selecting
  };

  const pageTitle = activePage === "rankings" ? "HR Rankings" : activePage === "ml" ? "ML Rankings" : activePage === "slate" ? "Game Slate" : activePage === "projections" ? "Projections" : activePage === "slips" ? "Slip Generator" : activePage === "bvp" ? "Batter vs Pitcher" : activePage === "environment" ? "Environment" : activePage === "gems" ? "Gem Finder" : activePage === "matchup" ? "Matchup Analysis" : activePage === "live" ? "Live Feed" : activePage === "results" ? "Results Log" : "How It Works";

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile, slide in when open */}
      <div className={`fixed lg:static z-40 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <Sidebar active={activePage} onChange={handlePageChange} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-card-border px-4 md:px-8 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-muted hover:text-foreground cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-sm font-semibold text-foreground">{pageTitle}</h1>
            <span className="text-xs text-muted hidden sm:inline">
              {totalPlayers} players &middot; {data.games.length} games
            </span>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {(activePage === "rankings" || activePage === "ml" || activePage === "slate" || activePage === "slips" || activePage === "bvp" || activePage === "gems") && (
              <LookbackToggle value={lookback} onChange={setLookback} />
            )}
            <DatePicker currentDate={selectedDate} onChange={loadDate} />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-8">
          {activePage === "ml" && (
            <MLRankings games={data.games} lookback={lookback} currentDate={data.date} />
          )}

          {activePage === "rankings" && (
            <TopPicks games={data.games} lookback={lookback} />
          )}

          {activePage === "slate" && (
            <>
              {/* Game filter — multi-select chips */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button
                  onClick={() => setSelectedGames(new Set())}
                  className={`px-3 py-1.5 text-xs rounded-full cursor-pointer transition-colors ${
                    selectedGames.size === 0
                      ? "bg-accent text-background font-bold"
                      : "bg-card/50 text-muted border border-card-border hover:text-foreground"
                  }`}
                >
                  All ({data.games.length})
                </button>
                {data.games.map((game) => {
                  const sel = selectedGames.has(game.game_pk);
                  return (
                    <button
                      key={game.game_pk}
                      onClick={() => {
                        setSelectedGames((prev) => {
                          const next = new Set(prev);
                          if (next.has(game.game_pk)) next.delete(game.game_pk);
                          else next.add(game.game_pk);
                          return next;
                        });
                      }}
                      className={`px-2.5 py-1.5 text-[11px] rounded-full cursor-pointer transition-colors ${
                        sel
                          ? "bg-accent/15 text-accent border border-accent/30 font-semibold"
                          : selectedGames.size === 0
                          ? "bg-card/50 text-foreground border border-card-border"
                          : "bg-card/50 text-muted border border-card-border hover:text-foreground"
                      }`}
                    >
                      {game.away_team}@{game.home_team}
                    </button>
                  );
                })}
              </div>
              {(selectedGames.size === 0 ? data.games : data.games.filter((g) => selectedGames.has(g.game_pk))).map((game) => (
                <GameSection key={game.game_pk} game={game} lookback={lookback} />
              ))}
              {data.games.length === 0 && (
                <p className="text-center text-muted py-12">No games with scored players today.</p>
              )}
            </>
          )}

          {activePage === "projections" && (
            <ProjectionsView games={data.games} lookback={lookback} />
          )}

          {activePage === "environment" && (
            <EnvironmentView games={envGames} />
          )}

          {activePage === "live" && (
            <LiveFeed selectedDate={selectedDate} />
          )}

          {activePage === "bvp" && (
            <BvPPage games={data.games} lookback={lookback} />
          )}

          {activePage === "gems" && (
            <GemFinder games={data.games} lookback={lookback} />
          )}

          {activePage === "matchup" && (
            <MatchupAnalysis games={data.games} />
          )}

          {activePage === "slips" && (
            <SlipGenerator games={data.games} lookback={lookback} />
          )}

          {activePage === "results" && (
            <ResultsView selectedDate={selectedDate} />
          )}

          {activePage === "methodology" && (
            <MethodologyPage />
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- Loading skeleton ---------- */

function SkelBlock({ className = "" }: { className?: string }) {
  return <div className={`bg-white/5 rounded animate-pulse ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar skeleton */}
      <aside className="hidden lg:flex w-56 flex-col gap-2 border-r border-card-border bg-card/20 p-4">
        <SkelBlock className="h-8 w-32 mb-4" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SkelBlock key={i} className="h-8 w-full" />
        ))}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar skeleton */}
        <header className="sticky top-0 bg-background/80 backdrop-blur-sm border-b border-card-border px-4 md:px-8 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <SkelBlock className="h-5 w-32" />
            <SkelBlock className="h-3 w-40 hidden sm:block" />
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <SkelBlock className="h-8 w-24 rounded-lg" />
            <SkelBlock className="h-8 w-32 rounded-lg" />
          </div>
        </header>

        {/* Content skeleton — 3 game-card-shaped blocks with table rows inside */}
        <main className="flex-1 p-4 md:p-8 space-y-6">
          {/* Filter chip row */}
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkelBlock key={i} className="h-7 w-20 rounded-full" />
            ))}
          </div>

          {/* Game card skeletons */}
          {Array.from({ length: 3 }).map((_, gi) => (
            <div
              key={gi}
              className="border border-card-border rounded-xl bg-card/20 p-4 md:p-6 space-y-3"
            >
              <div className="flex items-center justify-between gap-4">
                <SkelBlock className="h-5 w-48" />
                <SkelBlock className="h-4 w-24" />
              </div>
              <div className="space-y-2 pt-2">
                {Array.from({ length: 6 }).map((__, ri) => (
                  <div key={ri} className="flex items-center gap-3">
                    <SkelBlock className="h-4 w-32" />
                    <SkelBlock className="h-4 flex-1" />
                    <SkelBlock className="h-4 w-12" />
                    <SkelBlock className="h-4 w-12" />
                    <SkelBlock className="h-4 w-12" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
