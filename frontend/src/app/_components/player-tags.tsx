"use client";

import { useState, useRef, useEffect } from "react";
import type { PlayerData } from "./types";
import { scoreFor } from "./score-utils";

export type PlayerTag = {
  key: string;
  emoji: string;
  label: string;
  sentiment: "positive" | "negative" | "elite";
  tooltip: string;
};

export function buildTags(player: PlayerData, parkFactor?: number): PlayerTag[] {
  const tags: PlayerTag[] = [];
  const sp = player.season_profile;
  const signals = player.hr_signals;

  // Elite Barrels — season barrel% ≥ 15%, min 50 BIP (R²=.642 yr/yr stability)
  if (sp && sp.barrel >= 15 && sp.bip_count >= 50) {
    tags.push({
      key: "elite_barrels",
      emoji: "🎯",
      label: "Elite Barrels",
      sentiment: "elite",
      tooltip: `${sp.barrel}% season barrel rate — top-tier contact quality`,
    });
  }

  // Platoon Advantage — LHB vs RHP only (research: +28-35 wOBA pts; RHB effect is ~6 pts, not meaningful)
  if (player.batter_hand === "L" && player.pitcher_hand === "R") {
    tags.push({
      key: "platoon_adv",
      emoji: "⚡",
      label: "Platoon Adv",
      sentiment: "positive",
      tooltip: "LHB vs RHP — +28-35 wOBA point historical platoon edge",
    });
  }

  // GB Pitcher — negative signal (≥55% GB rate = true ground ball pitcher, suppresses HR chances)
  if (player.pitcher_stats?.gb_rate != null && player.pitcher_stats.gb_rate >= 55) {
    tags.push({
      key: "gb_pitcher",
      emoji: "⬇️",
      label: "GB Pitcher",
      sentiment: "negative",
      tooltip: `${player.pitcher_stats.gb_rate.toFixed(0)}% ground ball rate — pitcher keeps the ball on the ground, fewer balls in the air to leave the yard`,
    });
  }

  // Barrel Surge (G5) — G5 barrel% ≥ 8% AND ≥ 1.5× season rate (quality signal, not outcome streak)
  const allAbs = scoreFor(player, "L10")?.recent_abs ?? scoreFor(player, "L5")?.recent_abs ?? [];
  if (sp && allAbs.length > 0 && sp.barrel > 0) {
    const dates = [...new Set(allAbs.map((ab) => ab.date))].sort().slice(-5);
    const g5Abs = allAbs.filter((ab) => dates.includes(ab.date));
    const bips = g5Abs.filter((ab) => ab.ev > 0);
    const barrels = bips.filter((ab) => {
      if (ab.ev < 98) return false;
      const expand = Math.max(0, ab.ev - 98) * 2;
      return ab.angle >= Math.max(8, 26 - expand) && ab.angle <= Math.min(50, 30 + expand);
    }).length;
    const g5BarrelPct = bips.length > 0 ? Math.round((barrels / bips.length) * 1000) / 10 : null;
    if (g5BarrelPct !== null) {
      const ratio = g5BarrelPct / sp.barrel;
      if (g5BarrelPct >= 8 && ratio >= 1.5) {
        tags.push({
          key: "barrel_surge",
          emoji: "🔥",
          label: "Barrel Surge",
          sentiment: "elite",
          tooltip: `G5 barrel: ${g5BarrelPct}% — ${ratio.toFixed(1)}× season rate (${sp.barrel}%)`,
        });
      }
    }
  }

  // Pitcher's Park — park factor < 95 (documented HR suppression)
  if (parkFactor != null && parkFactor < 95) {
    tags.push({
      key: "pitchers_park",
      emoji: "🏟️",
      label: "Pitcher's Park",
      sentiment: "negative",
      tooltip: `Park factor ${parkFactor} — ${Math.round((1 - parkFactor / 100) * 100)}% below neutral for HRs`,
    });
  }

  // Pull Power Profile — use existing signal or raw thresholds
  if (
    signals?.pull_power ||
    (sp?.pull_air != null && sp.pull_air >= 35 && sp?.pull_barrel != null && sp.pull_barrel >= 35)
  ) {
    tags.push({
      key: "pull_power",
      emoji: "💪",
      label: "Pull Power",
      sentiment: "positive",
      tooltip: `Pull air ${sp?.pull_air?.toFixed(0) ?? "—"}% · Pull barrel ${sp?.pull_barrel?.toFixed(0) ?? "—"}% — elevated pull-side power profile`,
    });
  }

  return tags;
}

const SENTIMENT_STYLE: Record<PlayerTag["sentiment"], { base: React.CSSProperties; glow: string }> = {
  elite: {
    base: {
      background: "linear-gradient(180deg, rgba(74,222,128,0.18) 0%, rgba(74,222,128,0.08) 100%)",
      border: "1px solid rgba(74,222,128,0.35)",
      color: "rgba(74,222,128,0.95)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.12), inset 0 -1px 0 0 rgba(0,0,0,0.2), 0 2px 6px -1px rgba(0,0,0,0.5)",
    },
    glow: "rgba(74,222,128,0.15)",
  },
  positive: {
    base: {
      background: "linear-gradient(180deg, rgba(250,204,21,0.16) 0%, rgba(250,204,21,0.07) 100%)",
      border: "1px solid rgba(250,204,21,0.35)",
      color: "rgba(250,204,21,0.92)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.2), 0 2px 6px -1px rgba(0,0,0,0.5)",
    },
    glow: "rgba(250,204,21,0.12)",
  },
  negative: {
    base: {
      background: "linear-gradient(180deg, rgba(248,113,113,0.16) 0%, rgba(248,113,113,0.07) 100%)",
      border: "1px solid rgba(248,113,113,0.35)",
      color: "rgba(248,113,113,0.92)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 -1px 0 0 rgba(0,0,0,0.2), 0 2px 6px -1px rgba(0,0,0,0.5)",
    },
    glow: "rgba(248,113,113,0.12)",
  },
};

function TagPill({ tag }: { tag: PlayerTag }) {
  const [showTip, setShowTip] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const style = SENTIMENT_STYLE[tag.sentiment];

  useEffect(() => {
    if (!showTip) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowTip(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [showTip]);

  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold leading-none select-none cursor-pointer transition-all duration-150"
        style={style.base}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onClick={() => setShowTip((v) => !v)}
        aria-label={tag.label}
      >
        <span className="text-[13px] leading-none">{tag.emoji}</span>
        {tag.label}
      </button>
      {showTip && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
          style={{ minWidth: 180, maxWidth: 260 }}
        >
          <span
            className="block px-3 py-2 text-[11px] font-medium text-foreground rounded-xl leading-snug"
            style={{
              background: "rgba(15,15,20,0.97)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: `0 8px 24px -4px rgba(0,0,0,0.7), 0 0 0 1px ${style.glow}`,
            }}
          >
            <span className="font-bold text-[12px] block mb-0.5">{tag.emoji} {tag.label}</span>
            {tag.tooltip}
          </span>
          {/* Arrow */}
          <span
            className="block w-2 h-2 mx-auto -mt-1 rotate-45"
            style={{ background: "rgba(15,15,20,0.97)", border: "1px solid rgba(255,255,255,0.12)", borderTop: "none", borderLeft: "none" }}
          />
        </span>
      )}
    </span>
  );
}

export function PlayerTagPills({
  tags,
  maxVisible = 6,
}: {
  tags: PlayerTag[];
  maxVisible?: number;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.slice(0, maxVisible).map((tag) => (
        <TagPill key={tag.key} tag={tag} />
      ))}
    </div>
  );
}
