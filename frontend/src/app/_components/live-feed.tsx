"use client";

import { useEffect, useState, useCallback } from "react";

interface LivePlay {
  batter: string;
  pitcher: string;
  game: string;
  ev: number;
  angle: number;
  distance: number;
  result: string;
  description: string;
  inning: number;
  timestamp: string;
  isHR: boolean;
  isNearHR: boolean;
}

interface GameStatus {
  gamePk: number;
  away: string;
  home: string;
  status: string;
  inning: number;
  awayScore: number;
  homeScore: number;
}

export function LiveFeed() {
  const [plays, setPlays] = useState<LivePlay[]>([]);
  const [games, setGames] = useState<GameStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLiveData = useCallback(async () => {
    try {
      // Get today's schedule
      const today = new Date().toISOString().split("T")[0];
      const schedRes = await fetch(
        `https://statsapi.mlb.com/api/v1/schedule?date=${today}&sportId=1&hydrate=linescore`
      );
      const schedData = await schedRes.json();

      const activeGames: GameStatus[] = [];
      const allPlays: LivePlay[] = [];

      for (const dateEntry of schedData.dates || []) {
        for (const game of dateEntry.games || []) {
          const status = game.status?.detailedState || "";
          const away = game.teams?.away?.team?.abbreviation || "";
          const home = game.teams?.home?.team?.abbreviation || "";
          const linescore = game.linescore || {};

          activeGames.push({
            gamePk: game.gamePk,
            away,
            home,
            status,
            inning: linescore.currentInning || 0,
            awayScore: linescore.teams?.away?.runs || 0,
            homeScore: linescore.teams?.home?.runs || 0,
          });

          // Only fetch play-by-play for in-progress or final games
          if (status !== "In Progress" && status !== "Final" && status !== "Game Over") continue;

          try {
            const feedRes = await fetch(
              `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`
            );
            const feedData = await feedRes.json();

            const allPlayData = feedData.liveData?.plays?.allPlays || [];

            for (const play of allPlayData) {
              const matchup = play.matchup || {};
              const result = play.result || {};
              const about = play.about || {};

              // Check each pitch/event in the play for batted ball data
              for (const event of play.playEvents || []) {
                const hitData = event.hitData;
                if (!hitData || !hitData.launchSpeed) continue;

                const ev = hitData.launchSpeed || 0;
                const angle = hitData.launchAngle || 0;
                const dist = hitData.totalDistance || 0;

                // Only show hard-hit air balls (90+ EV, 20+ degrees)
                if (ev < 90 || angle < 20) continue;

                const isHR = result.event === "Home Run";
                const isNearHR = !isHR && ev >= 95 && angle >= 25 && angle <= 35;

                allPlays.push({
                  batter: matchup.batter?.fullName || "Unknown",
                  pitcher: matchup.pitcher?.fullName || "Unknown",
                  game: `${away}@${home}`,
                  ev,
                  angle,
                  distance: dist,
                  result: result.event || event.details?.description || "",
                  description: result.description || "",
                  inning: about.inning || 0,
                  timestamp: about.startTime || "",
                  isHR,
                  isNearHR,
                });
              }
            }
          } catch {
            // Skip games with feed errors
          }
        }
      }

      // Sort by most recent first
      allPlays.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

      setGames(activeGames);
      setPlays(allPlays);
      setLastUpdate(new Date().toLocaleTimeString());
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLiveData, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [fetchLiveData, autoRefresh]);

  const activeCount = games.filter(g => g.status === "In Progress").length;
  const totalHRs = plays.filter(p => p.isHR).length;
  const hardHitCount = plays.filter(p => p.ev >= 95 && p.angle >= 25).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            Live Feed
            {autoRefresh && (
              <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            )}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Hard-hit air balls across all active games. Updates every 30 seconds.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${
              autoRefresh
                ? "bg-accent-green/15 text-accent-green border border-accent-green/20"
                : "bg-card/50 text-muted border border-card-border"
            }`}
          >
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button
            onClick={fetchLiveData}
            className="px-3 py-1.5 text-xs rounded-lg cursor-pointer bg-card/50 text-muted border border-card-border hover:text-foreground"
          >
            Refresh
          </button>
          {lastUpdate && (
            <span className="text-[10px] text-muted">Last: {lastUpdate}</span>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-foreground">{activeCount}</div>
          <div className="text-[10px] text-muted uppercase">Games Live</div>
        </div>
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-accent-green">{totalHRs}</div>
          <div className="text-[10px] text-muted uppercase">Home Runs</div>
        </div>
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-accent-yellow">{hardHitCount}</div>
          <div className="text-[10px] text-muted uppercase">Hard Hit Air</div>
        </div>
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-foreground">{plays.length}</div>
          <div className="text-[10px] text-muted uppercase">Total Air Balls</div>
        </div>
      </div>

      {/* Game scoreboard */}
      <div className="flex flex-wrap gap-2 mb-6">
        {games.map((g) => (
          <div
            key={g.gamePk}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
              g.status === "In Progress"
                ? "border-accent-green/30 bg-accent-green/5"
                : g.status === "Final" || g.status === "Game Over"
                  ? "border-card-border bg-card/30"
                  : "border-card-border bg-card/10"
            }`}
          >
            {g.status === "In Progress" && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
            )}
            <span className="font-medium text-foreground">{g.away} {g.awayScore}</span>
            <span className="text-muted">-</span>
            <span className="font-medium text-foreground">{g.homeScore} {g.home}</span>
            {g.status === "In Progress" && (
              <span className="text-muted font-mono">{g.inning}</span>
            )}
            {(g.status === "Final" || g.status === "Game Over") && (
              <span className="text-muted">F</span>
            )}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-muted py-12 animate-pulse">Loading live data...</div>
      ) : plays.length === 0 ? (
        <div className="text-center text-muted py-12">
          No hard-hit air balls yet. {activeCount === 0 ? "No games in progress." : "Waiting for batted balls..."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                <th className="text-left py-2">Type</th>
                <th className="text-left py-2">Batter</th>
                <th className="text-left py-2">Game</th>
                <th className="text-center py-2">Inn</th>
                <th className="text-center py-2">EV</th>
                <th className="text-center py-2">Angle</th>
                <th className="text-center py-2">Dist</th>
                <th className="text-left py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {plays.map((p, i) => (
                <tr
                  key={i}
                  className={`border-b border-card-border/30 ${
                    p.isHR ? "bg-accent-green/10" : p.isNearHR ? "bg-accent-yellow/5" : ""
                  }`}
                >
                  <td className="py-2">
                    {p.isHR ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-accent-green/20 text-accent-green">HR</span>
                    ) : p.isNearHR ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-accent-yellow/20 text-accent-yellow">NEAR</span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-card-border text-muted">AIR</span>
                    )}
                  </td>
                  <td className="py-2">
                    <span className="font-medium text-foreground">{p.batter}</span>
                    <span className="text-muted text-[10px] ml-1">vs {p.pitcher}</span>
                  </td>
                  <td className="py-2 text-muted">{p.game}</td>
                  <td className="text-center py-2 font-mono text-muted">{p.inning}</td>
                  <td className="text-center py-2">
                    <span className={`font-mono ${p.ev >= 100 ? "text-accent-green font-bold" : p.ev >= 95 ? "text-accent-green" : "text-foreground"}`}>
                      {p.ev.toFixed(1)}
                    </span>
                  </td>
                  <td className="text-center py-2">
                    <span className={`font-mono ${p.angle >= 25 && p.angle <= 35 ? "text-accent-green" : "text-foreground"}`}>
                      {p.angle.toFixed(0)}°
                    </span>
                  </td>
                  <td className="text-center py-2">
                    <span className={`font-mono ${p.distance >= 380 ? "text-accent-green font-bold" : p.distance >= 350 ? "text-accent-green" : "text-foreground"}`}>
                      {p.distance > 0 ? `${p.distance.toFixed(0)}ft` : "-"}
                    </span>
                  </td>
                  <td className="py-2 text-muted capitalize">{p.result.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
