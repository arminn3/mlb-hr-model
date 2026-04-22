import type { PitcherInfo, PitcherStats } from "./types";

export function PitcherCard({
  pitcher,
  stats,
  pitchTypes,
}: {
  pitcher: PitcherInfo;
  stats: PitcherStats;
  pitchTypes?: string[];
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] p-4 mb-3 backdrop-blur-sm"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.03)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{pitcher.name}</span>
          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-card-border text-muted">
            {pitcher.hand}HP
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 mb-3">
        <Stat label="HR/9" value={stats.hr_per_9.toFixed(2)} />
        <Stat label="HR/FB%" value={`${stats.hr_fb_rate}%`} />
        <Stat label="FB%" value={`${stats.fb_rate}%`} />
        <Stat label="IP" value={stats.ip.toFixed(1)} />
        <Stat label="HR" value={`${stats.total_hrs}`} />
      </div>

      {/* Pitch arsenal */}
      {pitchTypes && pitchTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pitchTypes.map((pt) => (
            <span
              key={pt}
              className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-accent/10 text-accent border border-accent/20"
            >
              {pt}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-mono font-semibold text-foreground">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
