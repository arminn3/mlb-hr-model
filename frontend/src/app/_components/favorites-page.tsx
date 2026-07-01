"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameData, PlayerData, ScoreSet } from "./types";
import { scoreFor, type UILookback } from "./score-utils";
import { mlComposite, FALLBACK_WEIGHTS, type MlWeights } from "./ml-rankings";
import { RatingBadge } from "./rating-badge";
import { Icon } from "./icon";
import type { SelectedBatter } from "./game-section";
import { FilterBar, passesCriteria, hasActiveCriteria, type FilterCriteria } from "./batter-filter-bar";

/** One favorited batter resolved against today's slate. */
interface FavRow {
  player: PlayerData;
  name: string;
  game: string;
  gamePk: number;
  gameTimeSort: number;
  teamAbbr: string;
  oppPitcher: string;
  pitcherHand: string;
  batterHand: string;
  composite: number;
  scores: ScoreSet;
  barrelPct: number;
  exitVelo: number;
  parkFactor: number;
}

function buildFavRows(
  games: GameData[],
  favorites: Set<string>,
  window: UILookback,
  weights: MlWeights,
): { rows: FavRow[]; missing: string[] } {
  const rows: FavRow[] = [];
  const found = new Set<string>();
  for (const game of games) {
    const parkFactor = game.environment?.park_factor ?? 100;
    for (const player of game.players) {
      if (!favorites.has(player.name) || found.has(player.name)) continue;
      found.add(player.name);

      // Resolve at the filter window; fall back like the slip generator so a
      // low-sample player still shows rather than dropping off the list.
      let effLb: UILookback = window;
      let scores = scoreFor(player, window);
      if (!scores) { scores = scoreFor(player, "L10"); effLb = "L10"; }
      if (!scores) { scores = scoreFor(player, "L5");  effLb = "L5"; }
      if (!scores) continue;

      rows.push({
        player,
        name: player.name,
        game: `${game.away_team}@${game.home_team}`,
        gamePk: game.game_pk,
        gameTimeSort: game.game_time_sort ?? 0,
        teamAbbr: player.batter_side === "home" ? game.home_team : game.away_team,
        oppPitcher: player.opp_pitcher,
        pitcherHand: player.pitcher_hand,
        batterHand: player.batter_hand,
        composite: mlComposite(player, effLb, weights),
        scores,
        barrelPct: scores.barrel_pct,
        exitVelo: scores.exit_velo,
        parkFactor,
      });
    }
  }
  rows.sort((a, b) => b.composite - a.composite);
  // Favorites the user starred on a past slate who aren't playing today.
  const missing = [...favorites].filter((n) => !found.has(n)).sort();
  return { rows, missing };
}

export function FavoritesPage({
  games,
  favorites,
  onToggleFavorite,
  onSelectBatter,
  criteria,
  onCriteriaChange,
}: {
  games: GameData[];
  favorites: Set<string>;
  onToggleFavorite: (name: string) => void;
  onSelectBatter: (s: SelectedBatter) => void;
  criteria: FilterCriteria;
  onCriteriaChange: (c: FilterCriteria) => void;
}) {
  const [mlWeights, setMlWeights] = useState<MlWeights>(FALLBACK_WEIGHTS);
  useEffect(() => {
    fetch("/data/results/ml_analysis.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.category_weights) {
          setMlWeights({
            batter: d.category_weights.batter ?? FALLBACK_WEIGHTS.batter,
            matchup: d.category_weights.matchup ?? FALLBACK_WEIGHTS.matchup,
            pitcher: d.category_weights.pitcher ?? FALLBACK_WEIGHTS.pitcher,
            environment: d.category_weights.environment ?? FALLBACK_WEIGHTS.environment,
          });
        }
      })
      .catch(() => {});
  }, []);

  const { rows, missing } = useMemo(
    () => buildFavRows(games, favorites, criteria.window, mlWeights),
    [games, favorites, criteria.window, mlWeights],
  );

  // Same HR criteria as the Batter Filter tab, applied to starred players.
  const filteredRows = useMemo(
    () => (hasActiveCriteria(criteria) ? rows.filter((r) => passesCriteria(r.scores, criteria)) : rows),
    [rows, criteria],
  );

  if (favorites.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <Icon name="star" size={24} />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1.5">No favorites yet</h3>
        <p className="text-sm text-muted max-w-sm">
          Tap the star on any batter in the <span className="text-foreground font-medium">Game Slate</span> to
          add them here. Favorites also pre-load in the Slip Generator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FilterBar criteria={criteria} onChange={onCriteriaChange} />
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted">
          {hasActiveCriteria(criteria)
            ? `${filteredRows.length} of ${rows.length} match`
            : `${filteredRows.length} on today's slate`}
          {missing.length > 0 && <span className="text-muted/50"> · {missing.length} not playing</span>}
        </span>
      </div>

      {/* Active favorites — on today's slate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {filteredRows.map((r) => (
          <button
            key={r.name}
            onClick={() =>
              onSelectBatter({
                player: r.player,
                battingOrder: null,
                teamAbbr: r.teamAbbr,
                parkFactor: r.parkFactor,
              })
            }
            className="text-left rounded-xl px-3.5 py-3 flex items-center gap-3 hover:border-accent/40 transition-colors"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            {/* Star / unfavorite */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(r.name); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggleFavorite(r.name); } }}
              className="flex-shrink-0 text-accent-yellow hover:scale-110 transition-transform cursor-pointer"
              aria-label={`Remove ${r.name} from favorites`}
              title="Remove from favorites"
            >
              <Icon name="star" size={18} fill="currentColor" />
            </span>

            {/* Name + matchup */}
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-foreground truncate">{r.name}</div>
              <div className="text-[11px] text-muted truncate">
                {r.game} · vs {r.oppPitcher} ({r.pitcherHand}HP)
              </div>
            </div>

            {/* Key HR stats — window-specific, mirrors the filter metrics. */}
            <div className="hidden sm:flex items-center gap-3.5 flex-shrink-0 text-center">
              <Stat label="EV" value={`${r.exitVelo.toFixed(0)}`} />
              <Stat label="Barrel%" value={`${r.barrelPct.toFixed(0)}%`} />
              <Stat label="Blast%" value={r.scores.blast_pct == null ? "—" : `${r.scores.blast_pct.toFixed(0)}%`} />
              <Stat label="Pull Brl%" value={r.scores.pull_brl == null ? "—" : `${r.scores.pull_brl.toFixed(0)}%`} />
              <Stat label="GB%" value={`${r.scores.gb_pct.toFixed(0)}%`} />
            </div>

            {/* Rating */}
            <div className="flex-shrink-0">
              <RatingBadge composite={r.composite} />
            </div>
          </button>
        ))}
      </div>

      {/* Favorited but not on today's slate */}
      {missing.length > 0 && (
        <div className="pt-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted/60 mb-2">Not on today&apos;s slate</div>
          <div className="flex flex-wrap gap-2">
            {missing.map((name) => (
              <span key={name}
                className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-muted"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {name}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggleFavorite(name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleFavorite(name); } }}
                  className="text-muted/50 hover:text-accent-red cursor-pointer"
                  aria-label={`Remove ${name} from favorites`}
                  title="Remove from favorites"
                >
                  <Icon name="close" size={13} />
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-w-[40px]">
      <span className="text-[8px] uppercase tracking-wider text-muted/50 leading-none mb-1">{label}</span>
      <span className="text-[13px] font-mono font-semibold text-foreground leading-none">{value}</span>
    </div>
  );
}
