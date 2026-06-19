"use client";

import type { PlayerData } from "./types";
import { scoreFor } from "./score-utils";

interface Signal {
  key: string;
  label: string;
  stat: string;
  triggered: boolean;
}

function buildSignals(player: PlayerData): Signal[] {
  const s = player.hr_signals;
  if (!s) return [];

  const sp = player.season_profile;
  const signals: Signal[] = [];

  signals.push({
    key: "barrel",
    label: "Barrel heat",
    stat: s.barrel_heat ? "barreled in last 5 games" : "no barrel in last 5 games",
    triggered: s.barrel_heat,
  });

  const pullAir = sp?.pull_air ?? 0;
  const pullBrl = sp?.pull_barrel ?? 0;
  signals.push({
    key: "pull",
    label: "Pull-power profile",
    stat: `pull air ${pullAir.toFixed(0)}%  ·  pull barrel ${pullBrl.toFixed(0)}%`,
    triggered: s.pull_power,
  });

  if (s.drought) {
    const { bips_since_hr, expected_gap, z_score } = s.drought;
    signals.push({
      key: "drought",
      label: "HR drought",
      stat: `${bips_since_hr} BIPs since HR  ·  avg gap ${expected_gap}  ·  Z ${z_score >= 0 ? "+" : ""}${z_score.toFixed(2)}`,
      triggered: s.drought.triggered,
    });
  }

  signals.push({
    key: "pitcher",
    label: "Pitcher vulnerable",
    stat: `${player.opp_pitcher} HR/9: ${player.pitcher_stats?.hr_per_9?.toFixed(2) ?? "—"}  (avg ~1.3)`,
    triggered: s.pitcher_vulnerable,
  });

  signals.push({
    key: "park",
    label: "HR-friendly park",
    stat: "park factor > 105",
    triggered: s.park_friendly,
  });

  // Barrel surge — last 5 GAMES (group recent_abs by date, take 5 most recent dates)
  const allAbs = scoreFor(player, "L10")?.recent_abs ?? scoreFor(player, "L5")?.recent_abs ?? [];
  const seasonBarrel = sp?.barrel ?? null;
  if (seasonBarrel !== null && allAbs.length > 0) {
    const dates = [...new Set(allAbs.map((ab) => ab.date))].sort().slice(-5);
    const g5Abs = allAbs.filter((ab) => dates.includes(ab.date));
    const bips = g5Abs.filter((ab) => ab.ev > 0);
    // Statcast barrel approximation: zone expands as EV rises above 98
    const barrels = bips.filter((ab) => {
      if (ab.ev < 98) return false;
      const expand = Math.max(0, ab.ev - 98) * 2;
      return ab.angle >= Math.max(8, 26 - expand) && ab.angle <= Math.min(50, 30 + expand);
    }).length;
    const g5BarrelPct = bips.length > 0 ? Math.round((barrels / bips.length) * 1000) / 10 : null;
    if (g5BarrelPct !== null) {
      const ratio = seasonBarrel > 0 ? g5BarrelPct / seasonBarrel : null;
      const triggered = g5BarrelPct >= 8 && ratio !== null && ratio >= 1.5;
      const ratioStr = ratio !== null ? `${ratio.toFixed(1)}×` : "—";
      signals.push({
        key: "barrel_surge",
        label: "Barrel surge (G5)",
        stat: `G5: ${g5BarrelPct}%  ·  season: ${seasonBarrel}%  ·  ${ratioStr} rate  ·  ${bips.length} BIP`,
        triggered,
      });
    }
  }

  return signals;
}

const TIER: Record<number, { label: string; accent: string; glow: string }> = {
  5: { label: "Locked In", accent: "text-amber-400", glow: "rgba(251,191,36,0.18)" },
  4: { label: "Primed",    accent: "text-accent-green", glow: "rgba(var(--color-accent-green-rgb, 74,222,128),0.10)" },
  3: { label: "Warming",   accent: "text-accent-green/70", glow: "transparent" },
  2: { label: "Neutral",   accent: "text-foreground/70",    glow: "transparent" },
  1: { label: "Cold",      accent: "text-foreground/60",    glow: "transparent" },
  0: { label: "Cold",      accent: "text-foreground/60",    glow: "transparent" },
};

export function HRSignalCard({ player }: { player: PlayerData }) {
  if (!player.hr_signals) return null;

  const signals = buildSignals(player);
  const hit = signals.filter((s) => s.triggered).length;
  const total = signals.length;
  const tier = TIER[Math.min(hit, 5)] ?? TIER[0];
  const isGold = hit === total && total > 0;

  return (
    <div
      className="rounded-[var(--radius-md)] overflow-hidden"
      style={{
        border: isGold
          ? "1px solid rgba(251,191,36,0.30)"
          : "1px solid rgba(255,255,255,0.10)",
        boxShadow: isGold
          ? `inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.3), 0 4px 10px -2px rgba(0,0,0,0.5), 0 0 24px 0 rgba(251,191,36,0.10)`
          : "inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.3), 0 4px 10px -2px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header strip */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          background: isGold
            ? "linear-gradient(90deg, rgba(251,191,36,0.12) 0%, rgba(251,191,36,0.04) 100%)"
            : "rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/65">
          Power Signals
        </span>

        <div className="flex items-center gap-3">
          {/* Segmented dot indicators */}
          <div className="flex items-center gap-1">
            {signals.map((sig, i) => (
              <span
                key={i}
                className="block rounded-full transition-all duration-300"
                style={{
                  width: 7,
                  height: 7,
                  background: sig.triggered
                    ? isGold
                      ? "rgba(251,191,36,0.9)"
                      : "rgba(74,222,128,0.85)"
                    : "rgba(255,255,255,0.12)",
                  boxShadow: sig.triggered && isGold
                    ? "0 0 6px 1px rgba(251,191,36,0.5)"
                    : sig.triggered
                    ? "0 0 5px 0px rgba(74,222,128,0.4)"
                    : "none",
                }}
              />
            ))}
          </div>

          {/* Score + label */}
          <div className="flex items-baseline gap-1.5">
            <span
              className={`font-mono text-sm font-bold ${isGold ? "text-amber-400" : "text-foreground"}`}
            >
              {hit}/{total}
            </span>
            <span className={`text-[11px] font-semibold ${tier.accent}`}>
              {tier.label}
            </span>
            {isGold && (
              <span className="text-amber-400 text-[11px] leading-none">★</span>
            )}
          </div>
        </div>
      </div>

      {/* Signal rows */}
      <div style={{ background: "rgba(255,255,255,0.015)" }}>
        {signals.map((sig, i) => (
          <div
            key={sig.key}
            className="flex items-start gap-3 px-4 py-2.5 relative"
            style={{
              borderBottom:
                i < signals.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}
          >
            {/* Left accent bar */}
            <div
              className="flex-shrink-0 rounded-full mt-0.5"
              style={{
                width: 3,
                height: 32,
                background: sig.triggered
                  ? isGold
                    ? "rgba(251,191,36,0.8)"
                    : "rgba(74,222,128,0.7)"
                  : "rgba(255,255,255,0.08)",
              }}
            />

            {/* Text */}
            <div className="flex-1 min-w-0">
              <div
                className={`text-[12px] font-semibold leading-tight ${
                  sig.triggered ? "text-foreground" : "text-foreground/55"
                }`}
              >
                {sig.label}
              </div>
              <div
                className={`text-[11px] font-mono mt-0.5 leading-tight truncate ${
                  sig.triggered ? "text-foreground/80" : "text-foreground/45"
                }`}
              >
                {sig.stat}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
