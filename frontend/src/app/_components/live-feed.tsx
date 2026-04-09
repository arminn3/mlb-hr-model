"use client";

import { useEffect, useState, useCallback } from "react";
import {
  TABLE_BG,
  cellClass,
  cellStyle,
  headerCellClass,
  headerCellStyle,
  tableClass,
  tableWrapperClass,
  tableWrapperStyle,
} from "./table-styles";

interface LivePlay {
  batter: string;
  pitcher: string;
  game: string;
  ev: number;
  angle: number;
  distance: number;
  result: string;
  description?: string;
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

function getLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function LiveFeed({ selectedDate: dashboardDate }: { selectedDate?: string }) {
  const [plays, setPlays] = useState<LivePlay[]>([]);
  const [slateHRs, setSlateHRs] = useState(0);
  const [games, setGames] = useState<GameStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [internalDate, setInternalDate] = useState<string>(getLocalDate);

  // Use dashboard date if provided, otherwise internal state
  const selectedDate = dashboardDate || internalDate;
  const setSelectedDate = setInternalDate;
  const isToday = selectedDate === getLocalDate();

  // Load saved data for past dates from server JSON
  const loadSavedData = useCallback(async (dateStr: string) => {
    setLoading(true);
    setPlays([]);
    setGames([]);
    setSlateHRs(0);
    try {
      const res = await fetch(`/data/results/livefeed-${dateStr}.json`);
      if (!res.ok) throw new Error("No saved data");
      const data = await res.json();

      setPlays(data.plays || []);
      setSlateHRs(data.totalHRs || 0);
      setGames(
        (data.games || []).map((g: Record<string, unknown>) => ({
          ...g,
          inning: 0,
        }))
      );
      setLastUpdate("Saved");
    } catch {
      // No saved file — try fetching live from MLB API as fallback
      await fetchFromMLB(dateStr);
    }
    setLoading(false);
  }, []);

  // Fetch live from MLB API (for today, or fallback for past dates without saved files)
  const fetchFromMLB = useCallback(async (dateStr: string) => {
    try {
      const schedRes = await fetch(
        `https://statsapi.mlb.com/api/v1/schedule?date=${dateStr}&sportId=1&hydrate=team,linescore,scoringplays`
      );
      const schedData = await schedRes.json();

      const activeGames: GameStatus[] = [];
      const allPlays: LivePlay[] = [];
      let totalHRsFromScoring = 0;
      const gamesToFetch: Array<{ gamePk: number; away: string; home: string }> = [];

      for (const dateEntry of schedData.dates || []) {
        for (const game of dateEntry.games || []) {
          const status = game.status?.detailedState || "";
          const away = game.teams?.away?.team?.abbreviation || "";
          const home = game.teams?.home?.team?.abbreviation || "";
          const linescore = game.linescore || {};

          for (const sp of game.scoringPlays || []) {
            if (sp?.result?.event === "Home Run") totalHRsFromScoring++;
          }

          activeGames.push({
            gamePk: game.gamePk,
            away,
            home,
            status,
            inning: linescore.currentInning || 0,
            awayScore: linescore.teams?.away?.runs || 0,
            homeScore: linescore.teams?.home?.runs || 0,
          });

          if (status !== "Scheduled" && status !== "Pre-Game" && status !== "Warmup" && status !== "Postponed") {
            gamesToFetch.push({ gamePk: game.gamePk, away, home });
          }
        }
      }

      // Fetch all game feeds in parallel
      const feedResults = await Promise.allSettled(
        gamesToFetch.map(async (g) => {
          const res = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`);
          const data = await res.json();
          return { ...g, plays: data.liveData?.plays?.allPlays || [] };
        })
      );

      for (const result of feedResults) {
        if (result.status !== "fulfilled") continue;
        const { away, home, plays: gamePlays } = result.value;

        for (const play of gamePlays) {
          const matchup = play.matchup || {};
          const resultData = play.result || {};
          const about = play.about || {};

          const playEvents = play.playEvents || [];
          const battedBall = playEvents.find(
            (e: Record<string, unknown>) => e.hitData && (e.hitData as Record<string, unknown>).launchSpeed
          );
          if (!battedBall) continue;

          const hitData = battedBall.hitData as Record<string, number>;
          const ev = hitData.launchSpeed || 0;
          const angle = hitData.launchAngle || 0;
          const dist = hitData.totalDistance || 0;

          if (ev < 90 || angle < 20) continue;

          const isHR = resultData.event === "Home Run";
          const isNearHR = !isHR && ev >= 95 && angle >= 25 && angle <= 35;

          allPlays.push({
            batter: matchup.batter?.fullName || "Unknown",
            pitcher: matchup.pitcher?.fullName || "Unknown",
            game: `${away}@${home}`,
            ev,
            angle,
            distance: dist,
            result: resultData.event || "",
            description: resultData.description || "",
            inning: about.inning || 0,
            timestamp: about.startTime || "",
            isHR,
            isNearHR,
          });
        }
      }

      // Deduplicate
      const uniquePlays = new Map<string, LivePlay>();
      for (const p of allPlays) {
        const key = `${p.batter}-${p.game}-${p.inning}-${p.ev.toFixed(1)}-${p.angle.toFixed(0)}-${p.distance.toFixed(0)}`;
        uniquePlays.set(key, p);
      }

      const merged = Array.from(uniquePlays.values());
      merged.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

      setPlays(merged);
      setSlateHRs(totalHRsFromScoring);
      setGames(activeGames);
      setLastUpdate(new Date().toLocaleTimeString());
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  // Main effect: load data based on selected date
  useEffect(() => {
    if (isToday) {
      // Today: fetch live from MLB API
      setLoading(true);
      fetchFromMLB(selectedDate);
      if (!autoRefresh) return;
      const interval = setInterval(() => fetchFromMLB(selectedDate), 10000);
      return () => clearInterval(interval);
    } else {
      // Past date: load from saved JSON file
      loadSavedData(selectedDate);
    }
  }, [selectedDate, isToday, autoRefresh, fetchFromMLB, loadSavedData]);

  const activeCount = games.filter(g => g.status === "In Progress").length;
  const totalHRs = slateHRs;
  const nearHRCount = plays.filter(p => p.isNearHR).length;
  const hardHitCount = plays.filter(p => p.ev >= 95 && p.angle >= 25).length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {isToday ? "Live Feed" : `Game Action — ${selectedDate}`}
            {autoRefresh && isToday && (
              <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            )}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => {
                if (isToday) {
                  const d = new Date(selectedDate + "T12:00:00");
                  d.setDate(d.getDate() - 1);
                  setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
                } else {
                  setSelectedDate(getLocalDate());
                }
              }}
              className={`px-3 py-1 text-xs rounded-lg cursor-pointer transition-colors ${
                isToday
                  ? "bg-card/50 text-muted border border-card-border hover:text-foreground"
                  : "bg-accent-green/10 text-accent-green border border-accent-green/20 hover:bg-accent-green/20"
              }`}
            >
              {isToday ? "Yesterday" : "Back to Live"}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isToday && (
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
          )}
          <button
            onClick={() => isToday ? fetchFromMLB(selectedDate) : loadSavedData(selectedDate)}
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
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-foreground">{isToday ? activeCount : games.length}</div>
          <div className="text-[10px] text-muted uppercase">{isToday ? "Games Live" : "Games"}</div>
        </div>
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-accent-green">{totalHRs}</div>
          <div className="text-[10px] text-muted uppercase">Home Runs</div>
        </div>
        <div className="bg-card/50 border border-accent-yellow/30 rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-accent-yellow">{nearHRCount}</div>
          <div className="text-[10px] text-muted uppercase">Near HRs</div>
        </div>
        <div className="bg-card/50 border border-card-border rounded-lg p-3 text-center">
          <div className="text-lg font-bold font-mono text-foreground">{hardHitCount}</div>
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
                : g.status === "Final" || g.status === "Game Over" || g.status === "Completed Early"
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
            {(g.status === "Final" || g.status === "Game Over" || g.status === "Completed Early") && (
              <span className="text-muted">F</span>
            )}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-muted py-12 animate-pulse">Loading {isToday ? "live" : "game action"} data...</div>
      ) : plays.length === 0 ? (
        <div className="text-center text-muted py-12">
          {isToday
            ? `No hard-hit air balls yet. ${activeCount === 0 ? "No games in progress." : "Waiting for batted balls..."}`
            : "No saved game action data for this date."}
        </div>
      ) : (
        <>
        {/* Mobile card view */}
        <div className="md:hidden space-y-2">
          {plays.map((p, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2.5 ${
                p.isHR ? "bg-accent-green/10 border border-accent-green/20" : p.isNearHR ? "bg-accent-yellow/5 border border-accent-yellow/20" : "bg-background/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {p.isHR ? (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-accent-green/20 text-accent-green shrink-0">HR</span>
                  ) : p.isNearHR ? (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-accent-yellow/20 text-accent-yellow shrink-0">NEAR</span>
                  ) : (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-card-border text-muted shrink-0">AIR</span>
                  )}
                  <span className="text-sm font-medium text-foreground">{p.batter}</span>
                </div>
                <span className={`font-mono text-sm font-bold shrink-0 ml-2 ${p.ev >= 100 ? "text-accent-green" : "text-foreground"}`}>
                  {typeof p.ev === 'number' ? p.ev.toFixed(1) : p.ev}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted">
                <span>{p.game} &middot; Inn {p.inning}</span>
                <span className={`font-mono ${p.angle >= 25 && p.angle <= 35 ? "text-accent-green" : ""}`}>
                  {typeof p.angle === 'number' ? `${p.angle.toFixed(0)}°` : `${p.angle}°`}
                </span>
                <span className={`font-mono ${p.distance >= 380 ? "text-accent-green" : ""}`}>
                  {p.distance > 0 ? `${typeof p.distance === 'number' ? p.distance.toFixed(0) : p.distance}ft` : "-"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div className={`hidden md:block ${tableWrapperClass}`} style={tableWrapperStyle}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={headerCellClass} style={headerCellStyle}>Type</th>
                <th className={headerCellClass} style={headerCellStyle}>Batter</th>
                <th className={headerCellClass} style={headerCellStyle}>Game</th>
                <th className={headerCellClass} style={headerCellStyle}>Inn</th>
                <th className={headerCellClass} style={headerCellStyle}>EV</th>
                <th className={headerCellClass} style={headerCellStyle}>Angle</th>
                <th className={headerCellClass} style={headerCellStyle}>Dist</th>
                <th className={headerCellClass} style={headerCellStyle}>Result</th>
              </tr>
            </thead>
            <tbody>
              {plays.map((p, i) => (
                <tr key={i} style={{ backgroundColor: TABLE_BG }}>
                  <td className={cellClass} style={cellStyle}>{p.isHR ? "HR" : p.isNearHR ? "NEAR" : "AIR"}</td>
                  <td className={cellClass} style={cellStyle}>{p.batter} vs {p.pitcher}</td>
                  <td className={cellClass} style={cellStyle}>{p.game}</td>
                  <td className={cellClass} style={cellStyle}>{p.inning}</td>
                  <td className={cellClass} style={cellStyle}>{typeof p.ev === 'number' ? p.ev.toFixed(1) : p.ev}</td>
                  <td className={cellClass} style={cellStyle}>{typeof p.angle === 'number' ? `${p.angle.toFixed(0)}°` : `${p.angle}°`}</td>
                  <td className={cellClass} style={cellStyle}>{p.distance > 0 ? `${typeof p.distance === 'number' ? p.distance.toFixed(0) : p.distance}ft` : "-"}</td>
                  <td className={cellClass} style={cellStyle}>{p.result.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
