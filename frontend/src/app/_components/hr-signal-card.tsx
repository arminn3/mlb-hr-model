import type { PlayerData } from "./types";

interface Signal {
  label: string;
  detail: string;
  triggered: boolean;
}

function buildSignals(player: PlayerData): Signal[] {
  const s = player.hr_signals;
  if (!s) return [];

  const signals: Signal[] = [];

  signals.push({
    label: "Barrel in last 3 games",
    detail: "Research: 1.34× HR rate when player barreled recently",
    triggered: s.barrel_heat,
  });

  const pullAir = player.season_profile?.pull_air ?? 0;
  const pullBrl = player.season_profile?.pull_barrel ?? 0;
  signals.push({
    label: "Pull-power tendency",
    detail: `Pull air ${pullAir.toFixed(0)}% · Pull barrel ${pullBrl.toFixed(0)}% — pulled barrels HR 66.5% of the time`,
    triggered: s.pull_power,
  });

  if (s.drought) {
    const { bips_since_hr, expected_gap, z_score } = s.drought;
    signals.push({
      label: "HR drought — overdue",
      detail: `${bips_since_hr} BIPs since last HR · personal avg gap ${expected_gap} · Z ${z_score > 0 ? "+" : ""}${z_score.toFixed(2)}`,
      triggered: s.drought.triggered,
    });
  }

  signals.push({
    label: "Facing HR-prone pitcher",
    detail: `Pitcher HR/9: ${player.pitcher_stats?.hr_per_9?.toFixed(2) ?? "—"} (MLB avg ~1.3)`,
    triggered: s.pitcher_vulnerable,
  });

  const env = player as any;
  signals.push({
    label: "HR-friendly park",
    detail: `Park factor >105 boosts fly-ball carry`,
    triggered: s.park_friendly,
  });

  return signals;
}

function label(hit: number, total: number): { text: string; color: string } {
  if (total === 0) return { text: "No Data", color: "text-muted" };
  const pct = hit / total;
  if (pct === 1) return { text: "Locked In", color: "text-amber-400" };
  if (pct >= 0.8) return { text: "Primed", color: "text-accent-green" };
  if (pct >= 0.6) return { text: "Warming Up", color: "text-accent-green/70" };
  if (pct >= 0.4) return { text: "Neutral", color: "text-muted" };
  return { text: "Cold", color: "text-muted/60" };
}

export function HRSignalCard({ player }: { player: PlayerData }) {
  if (!player.hr_signals) return null;

  const signals = buildSignals(player);
  const hit = signals.filter((s) => s.triggered).length;
  const total = signals.length;
  const { text: lbl, color } = label(hit, total);
  const isGold = hit === total && total > 0;

  return (
    <div
      className="rounded-[var(--radius-md)] p-4"
      style={{
        background: isGold
          ? "linear-gradient(180deg, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0.03) 100%)"
          : "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%)",
        border: isGold ? "1px solid rgba(251,191,36,0.25)" : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted/50">
          HR Signal
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-sm font-bold font-mono ${isGold ? "text-amber-400" : "text-foreground"}`}>
            {hit}/{total}
          </span>
          <span className={`text-[11px] font-semibold ${color}`}>{lbl}</span>
          {isGold && <span className="text-amber-400 text-xs">★</span>}
        </div>
      </div>

      {/* Signal rows */}
      <div className="space-y-1.5">
        {signals.map((sig, i) => (
          <div
            key={i}
            className={`flex gap-2.5 rounded px-2.5 py-1.5 ${
              sig.triggered
                ? "bg-accent-green/8 border border-accent-green/15"
                : "bg-white/[0.02] border border-white/[0.04]"
            }`}
          >
            <span
              className={`mt-0.5 text-[11px] font-bold flex-shrink-0 ${
                sig.triggered ? "text-accent-green" : "text-muted/40"
              }`}
            >
              {sig.triggered ? "✓" : "✗"}
            </span>
            <div className="min-w-0">
              <div
                className={`text-[11px] font-semibold leading-tight ${
                  sig.triggered ? "text-foreground" : "text-muted/60"
                }`}
              >
                {sig.label}
              </div>
              <div className="text-[10px] text-muted/50 mt-0.5 leading-tight">{sig.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
