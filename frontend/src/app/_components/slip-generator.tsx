"use client";

import { useMemo, useState } from "react";
import type { GameData, LookbackKey } from "./types";
import { RatingBadge } from "./rating-badge";

interface SlipPlayer {
  name: string;
  composite: number;
  game: string;
  gamePk: number;
  opp_pitcher: string;
  batter_hand: string;
  pitcher_hand: string;
  barrel_pct: number;
  fb_pct: number;
  exit_velo: number;
}

interface Slip {
  players: SlipPlayer[];
  avgComposite: number;
  gameCount: number;
}

function getAllPlayers(games: GameData[], lookback: LookbackKey): SlipPlayer[] {
  const allPlayers: SlipPlayer[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    for (const player of game.players) {
      if (seen.has(player.name)) continue;
      seen.add(player.name);
      const scores = player.scores[lookback];
      const composite = scores?.composite ?? 0;
      if (composite < 0.15) continue;
      allPlayers.push({
        name: player.name,
        composite,
        game: `${game.away_team}@${game.home_team}`,
        gamePk: game.game_pk,
        opp_pitcher: player.opp_pitcher,
        batter_hand: player.batter_hand,
        pitcher_hand: player.pitcher_hand,
        barrel_pct: scores?.barrel_pct ?? 0,
        fb_pct: scores?.fb_pct ?? 0,
        exit_velo: scores?.exit_velo ?? 0,
      });
    }
  }
  allPlayers.sort((a, b) => b.composite - a.composite);
  return allPlayers;
}

function buildSlips(
  players: SlipPlayer[],
  legCount: 2 | 3
): Slip[] {
  const candidates = players.slice(0, 30);
  const slips: Slip[] = [];

  if (legCount === 2) {
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const p1 = candidates[i];
        const p2 = candidates[j];
        const diffGames = p1.gamePk !== p2.gamePk;
        const avg = (p1.composite + p2.composite) / 2;
        slips.push({
          players: [p1, p2],
          avgComposite: avg,
          gameCount: diffGames ? 2 : 1,
        });
      }
    }
  } else {
    for (let i = 0; i < Math.min(candidates.length, 20); i++) {
      for (let j = i + 1; j < Math.min(candidates.length, 25); j++) {
        for (let k = j + 1; k < Math.min(candidates.length, 30); k++) {
          const p1 = candidates[i];
          const p2 = candidates[j];
          const p3 = candidates[k];
          const uniqueGames = new Set([p1.gamePk, p2.gamePk, p3.gamePk]).size;
          if (uniqueGames < 2) continue;
          const avg = (p1.composite + p2.composite + p3.composite) / 3;
          slips.push({
            players: [p1, p2, p3],
            avgComposite: avg,
            gameCount: uniqueGames,
          });
        }
      }
    }
  }

  slips.sort((a, b) => {
    if (b.gameCount !== a.gameCount) return b.gameCount - a.gameCount;
    return b.avgComposite - a.avgComposite;
  });

  return slips.slice(0, 20);
}

function buildCustomSlips(
  selected: SlipPlayer[],
  legCount: 2 | 3
): Slip[] {
  if (selected.length < legCount) return [];
  const slips: Slip[] = [];

  if (legCount === 2) {
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const p1 = selected[i];
        const p2 = selected[j];
        const uniqueGames = new Set([p1.gamePk, p2.gamePk]).size;
        slips.push({
          players: [p1, p2],
          avgComposite: (p1.composite + p2.composite) / 2,
          gameCount: uniqueGames,
        });
      }
    }
  } else {
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        for (let k = j + 1; k < selected.length; k++) {
          const p1 = selected[i];
          const p2 = selected[j];
          const p3 = selected[k];
          const uniqueGames = new Set([p1.gamePk, p2.gamePk, p3.gamePk]).size;
          slips.push({
            players: [p1, p2, p3],
            avgComposite: (p1.composite + p2.composite + p3.composite) / 3,
            gameCount: uniqueGames,
          });
        }
      }
    }
  }

  slips.sort((a, b) => {
    if (b.gameCount !== a.gameCount) return b.gameCount - a.gameCount;
    return b.avgComposite - a.avgComposite;
  });

  return slips;
}

type SortMode = "best" | "chalk" | "longshot" | "diverse";

function buildOptimalSlips(
  selected: SlipPlayer[],
  legCount: 2 | 3,
  sortMode: SortMode
): Slip[] {
  if (selected.length < legCount) return [];

  // Group players by game
  const byGame: Record<number, SlipPlayer[]> = {};
  for (const p of selected) {
    if (!byGame[p.gamePk]) byGame[p.gamePk] = [];
    byGame[p.gamePk].push(p);
  }
  for (const gk of Object.keys(byGame)) {
    byGame[Number(gk)].sort((a, b) => b.composite - a.composite);
  }
  const gameKeys = Object.keys(byGame).map(Number);

  // Sort players based on sort mode
  const sorted = [...selected];
  if (sortMode === "chalk") {
    sorted.sort((a, b) => b.composite - a.composite);
  } else if (sortMode === "longshot") {
    sorted.sort((a, b) => a.composite - b.composite);
  } else {
    sorted.sort((a, b) => b.composite - a.composite);
  }

  // Greedy: assign players to slips, each player used exactly once
  // ALWAYS prefer different games — only put same-game players together as last resort
  const slips: Slip[] = [];
  const used = new Set<string>();

  // Pass 1: Build slips with players from DIFFERENT games
  const diffGameSlips: Slip[] = [];
  const pass1Used = new Set<string>();

  if (sortMode === "diverse") {
    // Round-robin from each game to maximize spread
    const queues = gameKeys.map((gk) => [...byGame[gk]]);
    const interleaved: SlipPlayer[] = [];
    let idx = 0;
    while (interleaved.length < selected.length) {
      const q = queues[idx % queues.length];
      if (q.length > 0) interleaved.push(q.shift()!);
      idx++;
      if (queues.every((q) => q.length === 0)) break;
    }

    for (let i = 0; i < interleaved.length; i++) {
      if (pass1Used.has(interleaved[i].name)) continue;
      const group: SlipPlayer[] = [interleaved[i]];
      pass1Used.add(interleaved[i].name);
      const groupGames = new Set([interleaved[i].gamePk]);

      for (let j = 0; j < interleaved.length && group.length < legCount; j++) {
        if (pass1Used.has(interleaved[j].name)) continue;
        if (!groupGames.has(interleaved[j].gamePk)) {
          group.push(interleaved[j]);
          pass1Used.add(interleaved[j].name);
          groupGames.add(interleaved[j].gamePk);
        }
      }
      if (group.length === legCount) {
        diffGameSlips.push({
          players: group,
          avgComposite: group.reduce((s, p) => s + p.composite, 0) / legCount,
          gameCount: new Set(group.map((p) => p.gamePk)).size,
        });
      }
    }
  } else {
    for (let i = 0; i < sorted.length; i++) {
      if (pass1Used.has(sorted[i].name)) continue;
      const group: SlipPlayer[] = [sorted[i]];
      pass1Used.add(sorted[i].name);
      const groupGames = new Set([sorted[i].gamePk]);

      // First try: different games only
      for (let j = i + 1; j < sorted.length && group.length < legCount; j++) {
        if (pass1Used.has(sorted[j].name)) continue;
        if (!groupGames.has(sorted[j].gamePk)) {
          group.push(sorted[j]);
          pass1Used.add(sorted[j].name);
          groupGames.add(sorted[j].gamePk);
        }
      }
      if (group.length === legCount) {
        diffGameSlips.push({
          players: group,
          avgComposite: group.reduce((s, p) => s + p.composite, 0) / legCount,
          gameCount: new Set(group.map((p) => p.gamePk)).size,
        });
      } else {
        // Undo — these players go to pass 2
        for (const p of group) pass1Used.delete(p.name);
      }
    }
  }

  // Track who got used in diff-game slips
  for (const slip of diffGameSlips) {
    for (const p of slip.players) used.add(p.name);
    slips.push(slip);
  }

  // Pass 2: Remaining players get grouped together (may be same game)
  const remaining = sorted.filter((p) => !used.has(p.name));
  for (let i = 0; i < remaining.length; i += legCount) {
    const group = remaining.slice(i, i + legCount);
    if (group.length === legCount) {
      slips.push({
        players: group,
        avgComposite: group.reduce((s, p) => s + p.composite, 0) / legCount,
        gameCount: new Set(group.map((p) => p.gamePk)).size,
      });
    }
  }

  return slips;
}

function PlayerPickRow({
  player,
  selected,
  onToggle,
}: {
  player: SlipPlayer;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors text-left ${
        selected
          ? "bg-accent/15 border border-accent/30"
          : "bg-background/30 border border-transparent hover:bg-background/50"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
            selected
              ? "bg-accent border-accent text-background font-bold"
              : "border-card-border"
          }`}
        >
          {selected ? "\u2713" : ""}
        </span>
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{player.name}</span>
          <span className="text-[10px] text-muted block md:hidden">{player.game}</span>
          <span className="text-[10px] text-muted hidden md:inline ml-0">{player.game}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-3 shrink-0 ml-2">
        <span className="text-[10px] text-muted hidden md:inline">
          {player.exit_velo.toFixed(0)} EV
        </span>
        <span className="text-[10px] text-muted hidden md:inline">
          {player.barrel_pct.toFixed(0)}% bar
        </span>
        <RatingBadge composite={player.composite} />
        <span className="font-mono text-xs text-foreground w-12 text-right">
          {player.composite.toFixed(3)}
        </span>
      </div>
    </button>
  );
}

export function SlipGenerator({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [legCount, setLegCount] = useState<2 | 3>(2);
  const [mode, setMode] = useState<"auto" | "custom" | "optimal">("auto");
  const [sortMode, setSortMode] = useState<SortMode>("best");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem("slip-selected-players");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [search, setSearch] = useState("");

  const allPlayers = useMemo(
    () => getAllPlayers(games, lookback),
    [games, lookback]
  );

  const autoSlips = useMemo(
    () => buildSlips(allPlayers, legCount),
    [allPlayers, legCount]
  );

  const selectedPlayers = useMemo(
    () => allPlayers.filter((p) => selectedNames.has(p.name)),
    [allPlayers, selectedNames]
  );

  const customSlips = useMemo(
    () => buildCustomSlips(selectedPlayers, legCount),
    [selectedPlayers, legCount]
  );

  const optimalSlips = useMemo(
    () => buildOptimalSlips(selectedPlayers, legCount, sortMode),
    [selectedPlayers, legCount, sortMode]
  );

  const togglePlayer = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try { localStorage.setItem("slip-selected-players", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const filteredPlayers = search
    ? allPlayers.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.game.toLowerCase().includes(search.toLowerCase())
      )
    : allPlayers;

  if (games.length === 0) {
    return <p className="text-center text-muted py-12">No games available.</p>;
  }

  const slips = mode === "auto" ? autoSlips : mode === "optimal" ? optimalSlips : customSlips;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground">Slip Generator</h2>
          <p className="text-xs text-muted mt-0.5">
            {mode === "auto"
              ? "Best HR parlay combinations based on model rankings."
              : mode === "optimal"
              ? `Each player used once. ${selectedNames.size} selected = ${Math.floor(selectedNames.size / legCount)} ${legCount === 2 ? "duos" : "trios"}.`
              : `All combos from your picks. ${selectedNames.size} selected.`}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {/* Mode toggle — top row, larger tabs */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted">Mode:</span>
            {([
              { key: "auto" as const, label: "Auto", desc: "Model picks" },
              { key: "custom" as const, label: "All Combos", desc: "Every combo" },
              { key: "optimal" as const, label: "Optimal", desc: "No repeats" },
            ]).map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`px-4 py-2 text-xs rounded-lg cursor-pointer transition-colors ${
                  mode === m.key
                    ? "bg-accent text-background font-bold"
                    : "bg-card/50 text-muted border border-card-border hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {/* Leg count — bottom row, pill style */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted">Legs:</span>
            <button
              onClick={() => setLegCount(2)}
              className={`px-4 py-1.5 text-xs rounded-full cursor-pointer transition-colors ${
                legCount === 2
                  ? "bg-accent-green/20 text-accent-green border border-accent-green/30 font-semibold"
                  : "bg-card/50 text-muted border border-card-border hover:text-foreground"
              }`}
            >
              2-Leg (Duos)
            </button>
            <button
              onClick={() => setLegCount(3)}
              className={`px-4 py-1.5 text-xs rounded-full cursor-pointer transition-colors ${
                legCount === 3
                  ? "bg-accent-green/20 text-accent-green border border-accent-green/30 font-semibold"
                  : "bg-card/50 text-muted border border-card-border hover:text-foreground"
              }`}
            >
              3-Leg (Trios)
            </button>
          </div>
        </div>
      </div>

      {/* Sort mode for optimal tab */}
      {mode === "optimal" && selectedNames.size >= legCount && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] text-muted uppercase">Sort by:</span>
          {(
            [
              { key: "best", label: "Best Overall" },
              { key: "chalk", label: "Chalk" },
              { key: "longshot", label: "Longshots" },
              { key: "diverse", label: "Game Spread" },
            ] as { key: SortMode; label: string }[]
          ).map((s) => (
            <button
              key={s.key}
              onClick={() => setSortMode(s.key)}
              className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${
                sortMode === s.key
                  ? "bg-accent/15 text-accent border border-accent/30 font-semibold"
                  : "bg-card/50 text-muted border border-card-border hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Player picker for custom and optimal modes */}
      {(mode === "custom" || mode === "optimal") && (
        <div className="mb-6">
          {/* Search bar with clear X */}
          <div className="relative mb-3">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-background/50 border border-card-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:border-accent/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-muted hover:text-foreground cursor-pointer text-sm"
              >
                x
              </button>
            )}
          </div>

          {/* Selected players chips + clear all */}
          {selectedNames.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {selectedPlayers.map((p) => (
                <button
                  key={p.name}
                  onClick={() => togglePlayer(p.name)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/15 text-accent border border-accent/30 rounded-full cursor-pointer hover:bg-accent/25"
                >
                  {p.name}
                  <span className="text-accent/60">x</span>
                </button>
              ))}
              <button
                onClick={() => { setSelectedNames(new Set()); try { localStorage.removeItem("slip-selected-players"); } catch {} }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-accent-red border border-accent-red/30 rounded-full cursor-pointer hover:bg-accent-red/10"
              >
                Clear All Selections
              </button>
            </div>
          )}

          {/* Player list */}
          <div className="max-h-64 overflow-y-auto space-y-1 border border-card-border rounded-lg p-2 bg-card/20">
            {filteredPlayers.map((p) => (
              <PlayerPickRow
                key={p.name}
                player={p}
                selected={selectedNames.has(p.name)}
                onToggle={() => togglePlayer(p.name)}
              />
            ))}
          </div>

          {selectedNames.size > 0 && selectedNames.size < legCount && (
            <p className="text-xs text-accent-yellow mt-2">
              Select at least {legCount} players to generate {legCount === 2 ? "duos" : "trios"}.
            </p>
          )}
        </div>
      )}

      {/* Slips */}
      {slips.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {slips.map((slip, i) => {
            const isSameGame = slip.gameCount === 1;
            // Check for partial SGP — players sharing a game in a multi-game slip
            const gameFreq: Record<number, string[]> = {};
            for (const p of slip.players) {
              if (!gameFreq[p.gamePk]) gameFreq[p.gamePk] = [];
              gameFreq[p.gamePk].push(p.name);
            }
            const sharedGames = Object.entries(gameFreq).filter(([, names]) => names.length > 1);
            const hasPartialSGP = !isSameGame && sharedGames.length > 0;
            const sharedGameLabel = hasPartialSGP
              ? sharedGames.map(([, names]) => names.join(" + ")).join(", ")
              : "";

            const cardWarning = isSameGame || hasPartialSGP;

            return (
            <div
              key={i}
              className={`rounded-xl p-4 transition-colors ${
                isSameGame
                  ? "border-2 border-accent-yellow/50 bg-accent-yellow/5 hover:bg-accent-yellow/10"
                  : hasPartialSGP
                  ? "border-2 border-accent-yellow/30 bg-accent-yellow/[0.03] hover:bg-accent-yellow/[0.06]"
                  : "border border-card-border bg-card/40 hover:bg-card/60"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    cardWarning ? "bg-accent-yellow/20 text-accent-yellow" : "bg-accent/10 text-accent"
                  }`}>
                    {i + 1}
                  </span>
                  {isSameGame ? (
                    <span className="text-[10px] font-semibold text-accent-yellow uppercase">
                      Same Game Parlay
                    </span>
                  ) : hasPartialSGP ? (
                    <div>
                      <span className="text-[10px] text-muted uppercase">
                        {slip.gameCount} games
                      </span>
                      <span className="text-[10px] text-accent-yellow ml-2">
                        {sharedGames[0][1].length} legs same game
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted uppercase">
                      {slip.gameCount} games
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted">Avg </span>
                  <span className="font-mono font-bold text-foreground">
                    {slip.avgComposite.toFixed(3)}
                  </span>
                </div>
              </div>

              {hasPartialSGP && (
                <div className="text-[10px] text-accent-yellow bg-accent-yellow/10 rounded px-2 py-1 mb-2">
                  {sharedGameLabel} are in the same game
                </div>
              )}

              <div className="space-y-2">
                {slip.players.map((p) => {
                  const isShared = hasPartialSGP && sharedGames.some(([, names]) => names.includes(p.name));
                  return (
                  <div
                    key={p.name}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      isShared ? "bg-accent-yellow/[0.07]" : "bg-background/30"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {p.name}
                        </span>
                        <RatingBadge composite={p.composite} />
                      </div>
                      <div className="text-[10px] text-muted mt-0.5">
                        {p.game} vs {p.opp_pitcher} ({p.pitcher_hand}HP)
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-xs text-foreground">
                        {p.composite.toFixed(3)}
                      </span>
                      <div className="text-[10px] text-muted">
                        {p.barrel_pct.toFixed(0)}% bar / {p.fb_pct.toFixed(0)}% fb
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          );
          })}
        </div>
      ) : (mode === "custom" || mode === "optimal") && selectedNames.size >= legCount ? (
        <p className="text-center text-muted py-8">
          No valid combinations. Try selecting players from different games.
        </p>
      ) : mode !== "auto" ? (
        <p className="text-center text-muted py-8">
          Select {legCount}+ players above to generate {legCount === 2 ? "duo" : "trio"} parlays.
        </p>
      ) : null}

      <div className="mt-6 text-[10px] text-muted">
        {mode === "auto"
          ? "Slips prioritize game diversity. Players rated 0.15+ composite are eligible. Top 20 shown."
          : mode === "optimal"
          ? "Each player used exactly once. Sort by chalk (safest), longshots (highest payout), or game spread (most diverse)."
          : "All possible combos from your selections. SGP = Same Game Parlay (1 game). Multi-game parlays shown first."}
      </div>
    </div>
  );
}
