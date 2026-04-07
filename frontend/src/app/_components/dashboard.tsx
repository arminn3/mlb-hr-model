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
import { ResultsView } from "./results-view";
import { MethodologyPage } from "./methodology-page";
import { SlipGenerator } from "./slip-generator";
import { BvPPage } from "./bvp-page";
import { GemFinder } from "./gem-finder";
import { LiveFeed } from "./live-feed";
import { ProjectionsView } from "./projections-view";

export function Dashboard() {
  const [data, setData] = useState<ModelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    const file = dateStr ? `/data/${dateStr}.json` : "/data/latest.json";
    fetch(file)
      .then((res) => {
        if (!res.ok) throw new Error("No data for this date.");
        return res.json();
      })
      .then((d) => {
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
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse text-muted text-sm">Loading model data...</div>
      </div>
    );
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

  const pageTitle = activePage === "rankings" ? "HR Rankings" : activePage === "slate" ? "Game Slate" : activePage === "projections" ? "Projections" : activePage === "slips" ? "Slip Generator" : activePage === "bvp" ? "Batter vs Pitcher" : activePage === "environment" ? "Environment" : activePage === "gems" ? "Gem Finder" : activePage === "live" ? "Live Feed" : activePage === "results" ? "Results Log" : "How It Works";

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
            {(activePage === "rankings" || activePage === "slate" || activePage === "slips" || activePage === "bvp" || activePage === "gems") && (
              <LookbackToggle value={lookback} onChange={setLookback} />
            )}
            <DatePicker currentDate={selectedDate} onChange={loadDate} />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-8">
          {activePage === "rankings" && (
            <TopPicks games={data.games} lookback={lookback} />
          )}

          {activePage === "slate" && (
            <>
              {data.games.map((game) => (
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
