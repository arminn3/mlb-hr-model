"use client";

import type { GameData, PlayerData } from "./types";
import type { UILookback } from "./score-utils";
import { scoreFor } from "./score-utils";
import type { SelectedBatter } from "./game-section";
import { teamLogoUrl } from "./game-header";

function signalCount(player: PlayerData): number {
  const s = player.hr_signals;
  if (!s) return 0;
  return [
    s.barrel_heat,
    s.pull_power,
    s.drought?.triggered ?? false,
    s.pitcher_vulnerable,
    s.park_friendly,
  ].filter(Boolean).length;
}

const TIER_CONFIG = {
  5: { label: "Locked In",  dot: "rgba(251,191,36,0.9)",  glow: "0 0 5px 1px rgba(251,191,36,0.45)", border: "rgba(251,191,36,0.25)", bg: "rgba(251,191,36,0.06)", labelColor: "text-amber-400", star: true },
  4: { label: "Primed",     dot: "rgba(74,222,128,0.85)", glow: "0 0 4px 0px rgba(74,222,128,0.40)", border: "rgba(74,222,128,0.18)", bg: "rgba(74,222,128,0.04)", labelColor: "text-accent-green", star: false },
  3: { label: "Warming",    dot: "rgba(74,222,128,0.50)", glow: "none",                               border: "rgba(255,255,255,0.08)", bg: "rgba(255,255,255,0.02)", labelColor: "text-accent-green/60", star: false },
};

interface DueEntry {
  player: PlayerData;
  mlbId?: number;
  teamAbbr: string;
  battingOrder: number | null;
  count: number;
}

function buildDueList(games: GameData[]): DueEntry[] {
  const entries: DueEntry[] = [];

  for (const game of games) {
    // Build mlbId + order lookup from team_pitch_mix
    const mlbIdMap = new Map<string, { id: number; order: number | null }>();
    for (const side of [game.team_pitch_mix?.away, game.team_pitch_mix?.home]) {
      for (const b of side?.batters ?? []) {
        mlbIdMap.set(b.name, { id: b.id, order: b.order });
      }
    }

    for (const player of game.players) {
      const count = signalCount(player);
      if (count < 3) continue;
      const info = mlbIdMap.get(player.name);
      const teamAbbr = player.batter_side === "home" ? game.home_team : game.away_team;
      entries.push({
        player,
        mlbId: info?.id,
        teamAbbr,
        battingOrder: info?.order ?? null,
        count,
      });
    }
  }

  // Sort: highest signal count first, then composite desc within tier
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const sa = scoreFor(a.player, "L5")?.composite ?? 0;
    const sb = scoreFor(b.player, "L5")?.composite ?? 0;
    return sb - sa;
  });

  return entries;
}

function DueCard({
  entry,
  lookback,
  onSelect,
}: {
  entry: DueEntry;
  lookback: UILookback;
  onSelect: () => void;
}) {
  const { player, mlbId, teamAbbr, battingOrder, count } = entry;
  const tier = TIER_CONFIG[count as 3 | 4 | 5];
  const scores = scoreFor(player, lookback) ?? scoreFor(player, "L5")!;
  const sig = player.hr_signals!;
  const flags = [
    sig.barrel_heat,
    sig.pull_power,
    sig.drought?.triggered ?? false,
    sig.pitcher_vulnerable,
    sig.park_friendly,
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.04] active:bg-white/[0.05]"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      {/* Headshot */}
      <div className="relative flex-shrink-0">
        {mlbId ? (
          <img
            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
            alt={player.name}
            className="w-9 h-9 rounded-full object-cover"
            style={{ background: "rgba(255,255,255,0.06)" }}
            loading="lazy"
          />
        ) : (
          <div className="w-9 h-9 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
        )}
        {battingOrder !== null && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full text-[8px] font-bold text-black" style={{ background: "var(--accent)", fontSize: 8 }}>
            {battingOrder}
          </span>
        )}
      </div>

      {/* Name + matchup */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-semibold leading-tight truncate ${
            (() => {
              const s = scoreFor(player, lookback) ?? scoreFor(player, "L5");
              return s && (s.data_quality === "LOW_SAMPLE" || (s.recent_abs?.length ?? 10) <= 2) ? "text-red-400" : "text-foreground";
            })()
          }`}>{player.name}</span>
          <img src={teamLogoUrl(teamAbbr)} alt={teamAbbr} className="w-4 h-4 object-contain flex-shrink-0 opacity-70" />
        </div>
        <div className="text-[10px] text-muted/50 truncate mt-0.5">vs {player.opp_pitcher} · {player.pitcher_hand}HP</div>
      </div>

      {/* Signal dots */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {flags.map((on, i) => (
          <span
            key={i}
            className="block rounded-full"
            style={{
              width: 6, height: 6,
              background: on ? tier.dot : "rgba(255,255,255,0.10)",
              boxShadow: on ? tier.glow : "none",
            }}
          />
        ))}
        {tier.star && <span className="text-amber-400 text-[10px] leading-none ml-0.5">★</span>}
      </div>

      {/* Score */}
      <div className="flex-shrink-0 text-right ml-1">
        <div className={`text-sm font-mono font-bold ${count === 5 ? "text-amber-400" : count === 4 ? "text-accent-green" : "text-foreground"}`}>
          {scores.composite.toFixed(2)}
        </div>
        <div className={`text-[9px] font-semibold ${tier.labelColor}`}>{tier.label}</div>
      </div>

      {/* Chevron */}
      <svg className="w-3 h-3 text-muted/20 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}

export function HRDueList({
  games,
  lookback,
  onSelectBatter,
}: {
  games: GameData[];
  lookback: UILookback;
  onSelectBatter: (s: SelectedBatter) => void;
}) {
  const entries = buildDueList(games);
  const byTier = {
    5: entries.filter((e) => e.count === 5),
    4: entries.filter((e) => e.count === 4),
    3: entries.filter((e) => e.count === 3),
  };

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 text-muted text-sm">
        No players with 3+ HR signals today.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {([5, 4, 3] as const).map((tier) => {
        const group = byTier[tier];
        if (!group.length) return null;
        const cfg = TIER_CONFIG[tier];
        return (
          <div
            key={tier}
            className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${cfg.border}`, background: cfg.bg }}
          >
            {/* Tier header */}
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span
                      key={i}
                      className="block rounded-full"
                      style={{
                        width: 6, height: 6,
                        background: i < tier ? cfg.dot : "rgba(255,255,255,0.10)",
                        boxShadow: i < tier ? cfg.glow : "none",
                      }}
                    />
                  ))}
                  {cfg.star && <span className="text-amber-400 text-[10px] leading-none ml-0.5">★</span>}
                </div>
                <span className={`text-[11px] font-bold uppercase tracking-wider ${cfg.labelColor}`}>
                  {cfg.label}
                </span>
                <span className="text-[10px] text-muted/40 font-mono">{tier}/5 signals</span>
              </div>
              <span className="text-[10px] text-muted/40">{group.length} player{group.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Player rows */}
            {group.map((entry) => (
              <DueCard
                key={entry.player.name}
                entry={entry}
                lookback={lookback}
                onSelect={() =>
                  onSelectBatter({
                    player: entry.player,
                    mlbId: entry.mlbId,
                    battingOrder: entry.battingOrder,
                    teamAbbr: entry.teamAbbr,
                  })
                }
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
