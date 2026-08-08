"use client";

import { useMemo } from "react";
import { Star } from "lucide-react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflPlayer } from "./types";
import { fmtPct, fmtPct1, scoreColor, posColor, matchupColor, matchupLabel } from "./format";

const TOP_N = 30;

function Pill({ label, value, c }: { label: string; value: string; c?: string }) {
  return (
    <div className="flex flex-col items-center min-w-[52px]">
      <span className="text-[9px] uppercase tracking-wider" style={{ color: color.muted }}>{label}</span>
      <span className="text-[13px] font-semibold font-mono" style={{ color: c ?? color.foreground }}>{value}</span>
    </div>
  );
}

function Row({
  p, rank, fav, onToggleFavorite,
}: {
  p: NflPlayer; rank: number; fav: boolean; onToggleFavorite: (id: string) => void;
}) {
  const mColor = matchupColor(p.opp_rank_vs_role, p.opp_rank_total);
  const mLabel = matchupLabel(p.opp_rank_vs_role, p.opp_rank_total);
  const usage = p.pos === "RB" ? `${p.carries_pg} car/g` : `${p.targets_pg} tgt/g`;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={CARD.simple}>
      <span className="w-6 text-[13px] font-bold text-right shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{rank}</span>
      <button onClick={() => onToggleFavorite(p.gsis_id)} className="cursor-pointer shrink-0" aria-label="favorite">
        <Star size={14} fill={fav ? color.yellow : "none"} stroke={fav ? color.yellow : "rgba(255,255,255,0.25)"} />
      </button>

      {/* name + role + the matchup headline */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-foreground truncate">{p.name}</span>
          <span className="text-[10px] font-bold shrink-0 px-1 rounded" style={{ color: posColor(p.pos), background: "rgba(255,255,255,0.06)" }}>{p.role}</span>
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: color.muted }}>
          {p.team} <span style={{ color: "rgba(255,255,255,0.3)" }}>vs</span> {p.opponent}
          <span className="mx-1"> </span>
          <span style={{ color: mColor, fontWeight: 600 }}>#{p.opp_rank_vs_role}/{p.opp_rank_total} vs {p.role}</span>
          <span className="mx-1.5">·</span>imp {p.implied_team_total}
          <span className="mx-1.5">·</span>{usage}
        </div>
      </div>

      {/* stat pills */}
      <div className="hidden md:flex items-center gap-3 shrink-0">
        <Pill label="Hit% Szn" value={fmtPct(p.hit_rate_season)} />
        <Pill label="Hit% L5" value={fmtPct(p.hit_rate_l5)} />
        <Pill label="RZ Opp%" value={fmtPct(p.rz_opp_share)} />
        <Pill label="Snap%" value={fmtPct(p.snap_pct)} />
      </div>

      {/* matchup label + score */}
      <div className="flex items-center gap-3 shrink-0 pl-1">
        <span className="text-[10px] font-bold uppercase tracking-wider w-12 text-center" style={{ color: mColor }}>{mLabel}</span>
        <div className="text-right w-16">
          <div className="text-[18px] font-bold font-mono leading-none" style={{ color: scoreColor(p.score) }}>{fmtPct1(p.score)}</div>
          <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: color.muted }}>TD prob</div>
        </div>
      </div>
    </div>
  );
}

export function Rankings({
  slate, favorites, onToggleFavorite,
}: {
  slate: NflSlate; favorites: Set<string>; onToggleFavorite: (id: string) => void;
}) {
  const top = useMemo(() => {
    const all = slate.games.flatMap((g) => g.players);
    return [...all].sort((a, b) => b.score - a.score).slice(0, TOP_N);
  }, [slate]);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[18px] font-semibold text-foreground tracking-[-0.005em]">Top {TOP_N} Anytime-TD Plays</h2>
        <span className="text-[11px]" style={{ color: color.muted }}>ranked by model TD probability</span>
      </div>
      <div className="space-y-1.5">
        {top.map((p, i) => (
          <Row key={p.gsis_id + p.team} p={p} rank={i + 1} fav={favorites.has(p.gsis_id)} onToggleFavorite={onToggleFavorite} />
        ))}
      </div>
    </div>
  );
}
