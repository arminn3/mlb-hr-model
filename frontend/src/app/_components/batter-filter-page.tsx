"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameData, PlayerData, ScoreSet } from "./types";
import { scoreFor, type UILookback } from "./score-utils";
import { mlComposite, FALLBACK_WEIGHTS, type MlWeights } from "./ml-rankings";
import { RatingBadge } from "./rating-badge";
import { Icon } from "./icon";
import type { SelectedBatter } from "./game-section";
import { FilterBar, passesCriteria, hasActiveCriteria, type FilterCriteria } from "./batter-filter-bar";

interface Row {
  player: PlayerData;
  name: string;
  batterHand: string;
  game: string;
  gameTime: string;
  gameTimeSort: number;
  teamAbbr: string;
  parkFactor: number;
  oppPitcher: string;
  pitcherHand: string;
  hrPer9: number;
  hrFbRate: number;
  scores: ScoreSet;
  composite: number;
  lowSample: boolean;
}

type PitcherTier = { label: string; cls: string };
function pitcherTier(hrPer9: number, hrFb: number): PitcherTier {
  // From the batter's POV: a homer-prone pitcher is a GOOD target (red = hot).
  if (hrPer9 >= 1.5 || hrFb >= 12) return { label: "Vulnerable", cls: "text-accent-red bg-accent-red/10 border-accent-red/25" };
  if (hrPer9 > 0 && hrPer9 <= 0.9 && hrFb <= 9) return { label: "Tough", cls: "text-accent-green bg-accent-green/10 border-accent-green/25" };
  return { label: "Average", cls: "text-muted bg-white/5 border-card-border" };
}

// Heat pill — bright at/above hi, dim at/above lo, plain below. `invert` for
// "lower is better" stats (GB%): green when at/below lo, red when at/above hi.
function pill(value: number | null | undefined, lo: number, hi: number, label: string, invert = false) {
  let cls = "text-foreground/70";
  if (value != null) {
    const hot = invert ? value <= lo : value >= hi;
    const warm = invert ? value <= hi : value >= lo;
    if (hot) cls = "text-accent-green font-bold";
    else if (warm) cls = "text-foreground font-semibold";
    else cls = invert ? "text-accent-red/90" : "text-foreground/60";
  }
  return <span className={`font-mono text-[13px] ${cls}`}>{label}</span>;
}

type SortKey = "name" | "game" | "pitcher" | "ev" | "barrel" | "blast" | "pullbrl" | "fb" | "hardhit" | "gb" | "rating";

export function BatterFilterPage({
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

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rating", dir: "desc" });

  const allRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const game of games) {
      const parkFactor = game.environment?.park_factor ?? 100;
      for (const player of game.players) {
        if (seen.has(player.name)) continue;
        seen.add(player.name);
        let scores = scoreFor(player, criteria.window);
        if (!scores) scores = scoreFor(player, "L10");
        if (!scores) scores = scoreFor(player, "L5");
        if (!scores) continue;
        const hrPer9 = player.pitcher_stats?.hr_per_9 ?? 0;
        const hrFbRate = player.pitcher_stats?.hr_fb_rate ?? 0;
        rows.push({
          player,
          name: player.name,
          batterHand: player.batter_hand,
          game: `${game.away_team}@${game.home_team}`,
          gameTime: game.game_time ?? "",
          gameTimeSort: game.game_time_sort ?? 0,
          teamAbbr: player.batter_side === "home" ? game.home_team : game.away_team,
          parkFactor,
          oppPitcher: player.opp_pitcher,
          pitcherHand: player.pitcher_hand,
          hrPer9,
          hrFbRate,
          scores,
          composite: mlComposite(player, criteria.window, mlWeights),
          lowSample: scores.data_quality === "LOW_SAMPLE" || (scores.bip ?? 0) < 10,
        });
      }
    }
    return rows;
  }, [games, criteria.window, mlWeights]);

  const filtered = useMemo(() => {
    const base = hasActiveCriteria(criteria)
      ? allRows.filter((r) => passesCriteria(r.scores, criteria))
      : allRows;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: Row): number | string => {
      switch (sort.key) {
        case "name": return r.name;
        case "game": return r.gameTimeSort;
        case "pitcher": return r.hrPer9;
        case "ev": return r.scores.exit_velo;
        case "barrel": return r.scores.barrel_pct;
        case "blast": return r.scores.blast_pct ?? 0;
        case "pullbrl": return r.scores.pull_brl ?? 0;
        case "fb": return r.scores.fb_pct;
        case "hardhit": return r.scores.hard_hit_pct;
        case "gb": return r.scores.gb_pct;
        case "rating": return r.composite;
      }
    };
    return [...base].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [allRows, criteria, sort]);

  const th = (key: SortKey, label: string, align = "text-center") => (
    <th
      className={`py-2 px-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:text-foreground ${align}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
    >
      {label}{sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <FilterBar criteria={criteria} onChange={onCriteriaChange} />

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted">
          {filtered.length} of {allRows.length} batters{hasActiveCriteria(criteria) ? " match" : ""} · window {criteria.window}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}>
        <table className="w-full min-w-[860px] text-[13px]">
          <thead style={{ background: "rgba(20,20,22,0.9)" }}>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="py-2 pl-3 pr-1 w-8"></th>
              {th("name", "Batter", "text-left")}
              {th("game", "Game", "text-left")}
              {th("pitcher", "Pitcher", "text-left")}
              {th("ev", "EV")}
              {th("barrel", "Barrel%")}
              {th("blast", "Blast%")}
              {th("pullbrl", "Pull Brl%")}
              {th("fb", "FB%")}
              {th("hardhit", "HH%")}
              {th("gb", "GB%")}
              {th("rating", "Rating")}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const tier = pitcherTier(r.hrPer9, r.hrFbRate);
              const fav = favorites.has(r.name);
              return (
                <tr
                  key={r.name}
                  onClick={() => onSelectBatter({ player: r.player, battingOrder: null, teamAbbr: r.teamAbbr, parkFactor: r.parkFactor })}
                  className="border-b border-card-border/30 last:border-0 hover:bg-white/[0.03] cursor-pointer"
                >
                  <td className="py-2 pl-3 pr-1" onClick={(e) => { e.stopPropagation(); onToggleFavorite(r.name); }}>
                    <span
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggleFavorite(r.name); } }}
                      className={`inline-flex cursor-pointer transition-transform hover:scale-110 ${fav ? "text-accent-yellow" : "text-muted/40 hover:text-muted"}`}
                      aria-label={fav ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`}
                      title={fav ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Icon name="star" size={16} fill={fav ? "currentColor" : "none"} />
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <div className={`text-[14px] font-semibold leading-tight ${r.lowSample ? "text-red-400" : "text-foreground"}`}>
                      {r.name}
                      <span className="text-[11px] text-muted/60 font-normal ml-1.5">{r.batterHand}</span>
                      {r.lowSample && <span className="ml-1.5 px-1 py-0 text-[8px] font-bold rounded bg-accent-red/10 text-red-400 border border-accent-red/20 align-middle">SMALL</span>}
                    </div>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <span className="text-[12px] text-foreground/85">{r.game}</span>
                    {r.gameTime && <span className="text-[10px] text-muted/50 ml-1.5">{r.gameTime}</span>}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <span className="text-[12px] text-foreground/80">{r.oppPitcher}</span>
                    <span className="text-[10px] text-muted/50 ml-1">({r.pitcherHand})</span>
                    <span className={`ml-1.5 px-1.5 py-0.5 text-[9px] font-semibold rounded border align-middle ${tier.cls}`}>{tier.label}</span>
                  </td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.exit_velo, 88, 93, `${r.scores.exit_velo}`)}</td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.barrel_pct, 8, 15, `${r.scores.barrel_pct}%`)}</td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.blast_pct ?? null, 10, 18, r.scores.blast_pct == null ? "—" : `${r.scores.blast_pct}%`)}</td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.pull_brl ?? null, 3, 8, r.scores.pull_brl == null ? "—" : `${r.scores.pull_brl}%`)}</td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.fb_pct, 30, 45, `${r.scores.fb_pct}%`)}</td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.hard_hit_pct, 35, 50, `${r.scores.hard_hit_pct}%`)}</td>
                  <td className="py-2 px-2 text-center">{pill(r.scores.gb_pct, 30, 40, `${r.scores.gb_pct}%`, true)}</td>
                  <td className="py-2 px-2 text-center"><RatingBadge composite={r.composite} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="text-center text-muted py-10 text-sm">No batters match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
