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
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
            selected
              ? "bg-accent border-accent text-background font-bold"
              : "border-card-border"
          }`}
        >
          {selected ? "\u2713" : ""}
        </span>
        <div>
          <span className="text-sm font-medium text-foreground">{player.name}</span>
          <span className="text-[10px] text-muted ml-2">{player.game}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-muted">
          {player.exit_velo.toFixed(0)} EV
        </span>
        <span className="text-[10px] text-muted">
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
  const [mode, setMode] = useState<"auto" | "custom">("auto");
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
    : allPlayers.slice(0, 50);

  if (games.length === 0) {
    return <p className="text-center text-muted py-12">No games available.</p>;
  }

  const slips = mode === "auto" ? autoSlips : customSlips;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground">Slip Generator</h2>
          <p className="text-xs text-muted mt-0.5">
            {mode === "auto"
              ? "Best HR parlay combinations based on model rankings."
              : `Select players to build custom parlays. ${selectedNames.size} selected.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1">
            <button
              onClick={() => setMode("auto")}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                mode === "auto"
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => setMode("custom")}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                mode === "custom"
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Build
            </button>
          </div>
          {/* Leg count toggle */}
          <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1">
            <button
              onClick={() => setLegCount(2)}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                legCount === 2
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Duos
            </button>
            <button
              onClick={() => setLegCount(3)}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                legCount === 3
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Trios
            </button>
          </div>
        </div>
      </div>

      {/* Custom mode: player picker */}
      {mode === "custom" && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 text-sm bg-background/50 border border-card-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:border-accent/50"
            />
            {selectedNames.size > 0 && (
              <button
                onClick={() => { setSelectedNames(new Set()); try { localStorage.removeItem("slip-selected-players"); } catch {} }}
                className="px-3 py-2 text-xs text-muted border border-card-border rounded-lg cursor-pointer hover:text-foreground"
              >
                Clear ({selectedNames.size})
              </button>
            )}
          </div>

          {/* Selected players chips */}
          {selectedNames.size > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
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
          {slips.map((slip, i) => (
            <div
              key={i}
              className="border border-card-border rounded-xl bg-card/40 p-4 hover:bg-card/60 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="text-[10px] text-muted uppercase">
                    {slip.gameCount} game{slip.gameCount > 1 ? "s" : ""}
                    {slip.gameCount === 1 && " (SGP)"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted">Avg </span>
                  <span className="font-mono font-bold text-foreground">
                    {slip.avgComposite.toFixed(3)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {slip.players.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between bg-background/30 rounded-lg px-3 py-2"
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
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : mode === "custom" && selectedNames.size >= legCount ? (
        <p className="text-center text-muted py-8">
          No valid combinations. Try selecting players from different games.
        </p>
      ) : mode === "custom" ? (
        <p className="text-center text-muted py-8">
          Select {legCount}+ players above to generate {legCount === 2 ? "duo" : "trio"} parlays.
        </p>
      ) : null}

      <div className="mt-6 text-[10px] text-muted">
        {mode === "auto"
          ? "Slips prioritize game diversity. Players rated 0.15+ composite are eligible. Top 20 shown."
          : "Custom parlays built from your selections. SGP = Same Game Parlay (1 game). Multi-game parlays shown first."}
      </div>
    </div>
  );
}
