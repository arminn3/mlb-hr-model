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
import { ProjectionsView } from "./projections-view";

export function Dashboard() {
  const [data, setData] = useState<ModelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<Page>("rankings");
  const [lookback, setLookback] = useState<LookbackKey>("L5");
  const [selectedDate, setSelectedDate] = useState<string>("");

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
        setError(null);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
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

  return (
    <div className="flex min-h-screen -m-10">
      {/* Sidebar */}
      <Sidebar active={activePage} onChange={setActivePage} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-card-border px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-foreground">
              {activePage === "rankings" ? "HR Rankings" : activePage === "slate" ? "Game Slate" : activePage === "projections" ? "Projections" : activePage === "environment" ? "Environment" : "Results Log"}
            </h1>
            <span className="text-xs text-muted">
              {totalPlayers} players &middot; {data.games.length} games
            </span>
          </div>
          <div className="flex items-center gap-4">
            {(activePage === "rankings" || activePage === "slate" || activePage === "projections") && (
              <LookbackToggle value={lookback} onChange={setLookback} />
            )}
            <DatePicker currentDate={selectedDate} onChange={loadDate} />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-8">
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

          {activePage === "results" && (
            <ResultsView selectedDate={selectedDate} />
          )}
        </main>
      </div>
    </div>
  );
}
