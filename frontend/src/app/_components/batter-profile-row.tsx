import type { RecentAB } from "./types";

const DASH = "—";

// FanGraphs 2024 wOBA event weights — close enough for directional batter context.
const WOBA_WEIGHTS: Record<string, number> = {
  single: 0.882,
  double: 1.244,
  triple: 1.569,
  home_run: 2.005,
  // walks / HBP would weight ~0.696 / 0.728 but recent_abs is BIP-only,
  // so they don't appear here.
};

const HIT_RESULTS = new Set(["single", "double", "triple", "home_run"]);
const TB_BY_RESULT: Record<string, number> = {
  single: 1, double: 2, triple: 3, home_run: 4,
};

interface ProfileRow {
  pa: number;       // BIP only in our dataset; PA-level requires backend extension
  hr: number;
  ba: number | null;
  slg: number | null;
  iso: number | null;
  woba: number | null;
  ev: number | null;
  hard_hit_pct: number | null;
  barrel_pct: number | null;
  fb_pct: number | null;
  ld_pct: number | null;
  gb_pct: number | null;
  hr_fb_pct: number | null;
  pull_air_pct: number | null;  // requires hit_location — null for now
}

function computeRow(abs: RecentAB[]): ProfileRow {
  const empty: ProfileRow = {
    pa: 0, hr: 0, ba: null, slg: null, iso: null, woba: null,
    ev: null, hard_hit_pct: null, barrel_pct: null,
    fb_pct: null, ld_pct: null, gb_pct: null, hr_fb_pct: null,
    pull_air_pct: null,
  };
  if (!abs.length) return empty;

  const n = abs.length;
  let hr = 0, hits = 0, totalBases = 0, woba = 0;
  let ev_sum = 0, ev_n = 0;
  let hard = 0, barrel = 0;
  let fb = 0, ld = 0, gb = 0;

  for (const ab of abs) {
    if (HIT_RESULTS.has(ab.result)) {
      hits += 1;
      totalBases += TB_BY_RESULT[ab.result] ?? 0;
      woba += WOBA_WEIGHTS[ab.result] ?? 0;
    }
    if (ab.result === "home_run") hr += 1;
    if (typeof ab.ev === "number" && !Number.isNaN(ab.ev)) {
      ev_sum += ab.ev;
      ev_n += 1;
      if (ab.ev >= 95) hard += 1;
      // Barrel approx (Statcast formula): EV >= 98 AND LA between ~26 and 30
      if (ab.ev >= 98 && ab.angle >= 26 && ab.angle <= 30) barrel += 1;
    }
    if (typeof ab.angle === "number" && !Number.isNaN(ab.angle)) {
      if (ab.angle >= 25 && ab.angle <= 50) fb += 1;
      else if (ab.angle >= 10 && ab.angle < 25) ld += 1;
      else if (ab.angle < 10) gb += 1;
    }
  }

  return {
    pa: n,
    hr,
    ba: hits / n,
    slg: totalBases / n,
    iso: (totalBases / n) - (hits / n),
    woba: woba / n,
    ev: ev_n > 0 ? ev_sum / ev_n : null,
    hard_hit_pct: ev_n > 0 ? (hard / n) * 100 : null,
    barrel_pct: ev_n > 0 ? (barrel / n) * 100 : null,
    fb_pct: (fb / n) * 100,
    ld_pct: (ld / n) * 100,
    gb_pct: (gb / n) * 100,
    hr_fb_pct: fb > 0 ? (hr / fb) * 100 : null,
    pull_air_pct: null, // requires hit_location data — backend extension
  };
}

// ─── Color thresholds (BATTER perspective: green = good for batter) ──────────
type Threshold = { good: number; bad: number; direction: 1 | -1 };

const THRESHOLDS: Record<keyof ProfileRow, Threshold | null> = {
  pa: null,
  hr: null,
  ba: { good: 0.270, bad: 0.215, direction: 1 },
  slg: { good: 0.430, bad: 0.350, direction: 1 },
  iso: { good: 0.180, bad: 0.130, direction: 1 },
  woba: { good: 0.340, bad: 0.290, direction: 1 },
  ev: { good: 92, bad: 86, direction: 1 },
  hard_hit_pct: { good: 42, bad: 32, direction: 1 },
  barrel_pct: { good: 12, bad: 6, direction: 1 },
  fb_pct: { good: 36, bad: 26, direction: 1 },
  ld_pct: { good: 24, bad: 18, direction: 1 },
  gb_pct: { good: 38, bad: 50, direction: -1 }, // more grounders = bad for HR
  hr_fb_pct: { good: 16, bad: 9, direction: 1 },
  pull_air_pct: { good: 22, bad: 14, direction: 1 },
};

function colorFor(key: keyof ProfileRow, value: number | null | undefined): string {
  const t = THRESHOLDS[key];
  if (!t || value == null) return "";
  const v = t.direction === 1 ? value : -value;
  const good = t.direction === 1 ? t.good : -t.good;
  const bad = t.direction === 1 ? t.bad : -t.bad;
  if (v >= good) return "bg-accent-green/20 text-accent-green";
  if (v <= bad) return "bg-accent-red/20 text-accent-red";
  const mid = (good + bad) / 2;
  if (v >= mid) return "bg-accent-green/10 text-accent-green/80";
  return "bg-accent-red/10 text-accent-red/80";
}

function fmtBA(v: number | null): string {
  if (v == null) return DASH;
  return v.toFixed(3).replace(/^0/, "");
}
function fmtPct(v: number | null, digits = 1): string {
  if (v == null) return DASH;
  return `${v.toFixed(digits)}%`;
}
function fmt(v: number | null, digits = 1): string {
  if (v == null) return DASH;
  return v.toFixed(digits);
}

interface ColumnDef {
  key: keyof ProfileRow;
  header: string;
  group: "basic" | "stats" | "strikes" | "statcast";
  render: (v: number | null | undefined) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: "pa", header: "BIP", group: "basic", render: (v) => v == null ? DASH : String(v) },
  { key: "hr", header: "HR", group: "basic", render: (v) => v == null ? DASH : String(v) },
  { key: "ba", header: "BA", group: "stats", render: (v) => fmtBA(v ?? null) },
  { key: "slg", header: "SLG", group: "stats", render: (v) => fmtBA(v ?? null) },
  { key: "iso", header: "ISO", group: "stats", render: (v) => fmtBA(v ?? null) },
  { key: "woba", header: "wOBA", group: "stats", render: (v) => fmtBA(v ?? null) },
  { key: "hr_fb_pct", header: "HR/FB%", group: "stats", render: (v) => fmtPct(v ?? null) },
  { key: "ev", header: "EV", group: "statcast", render: (v) => fmt(v ?? null) },
  { key: "barrel_pct", header: "Barrel%", group: "statcast", render: (v) => fmtPct(v ?? null) },
  { key: "hard_hit_pct", header: "HH%", group: "statcast", render: (v) => fmtPct(v ?? null) },
  { key: "fb_pct", header: "FB%", group: "statcast", render: (v) => fmtPct(v ?? null) },
  { key: "ld_pct", header: "LD%", group: "statcast", render: (v) => fmtPct(v ?? null) },
  { key: "gb_pct", header: "GB%", group: "statcast", render: (v) => fmtPct(v ?? null) },
  { key: "pull_air_pct", header: "PullAir%", group: "statcast", render: (v) => fmtPct(v ?? null) },
];

const GROUP_LABELS: Record<ColumnDef["group"], string> = {
  basic: "",
  stats: "Stats",
  strikes: "Strikes",
  statcast: "Statcast",
};

export function BatterProfileRow({
  recentAbs,
  pitcherName,
  pitcherHand,
  batterHand,
  pitchTypes,
  lookback,
}: {
  recentAbs: RecentAB[];
  pitcherName: string;
  pitcherHand: string;
  batterHand: string;
  pitchTypes: string[];
  lookback: string;
}) {
  const row = computeRow(recentAbs);

  const groupSpans: { group: ColumnDef["group"]; span: number }[] = [];
  for (const col of COLUMNS) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.group === col.group) last.span += 1;
    else groupSpans.push({ group: col.group, span: 1 });
  }

  return (
    <div>
      {/* Filter context header — explains what these numbers mean */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="text-muted">vs</span>
        <span className="text-foreground font-semibold">{pitcherName}</span>
        <span className="px-1.5 py-0.5 font-mono font-semibold rounded bg-card-border/60 text-muted">{pitcherHand}HP</span>
        <span className="text-muted">·</span>
        <span className="text-foreground">{batterHand}HB</span>
        <span className="text-muted">·</span>
        <span className="text-foreground font-mono">{lookback}</span>
        <span className="text-muted">·</span>
        <span className="text-muted">Pitches:</span>
        {pitchTypes.length > 0 ? pitchTypes.map((pt) => (
          <span key={pt} className="px-1.5 py-0.5 font-mono rounded bg-accent/10 text-accent border border-accent/20">
            {pt}
          </span>
        )) : (
          <span className="text-muted">all</span>
        )}
      </div>

      {/* Color legend */}
      <div className="mb-2 flex items-center gap-3 text-[9px] text-muted">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm bg-accent-green/70" />
          Favors batter
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm bg-accent-red/70" />
          Favors pitcher
        </div>
      </div>

      {row.pa === 0 ? (
        <div className="text-xs text-muted py-3">No batted-ball data in this window.</div>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted/70">
                {groupSpans.map((g, i) => (
                  <th key={i} colSpan={g.span} className="font-medium pb-1 px-1 text-center">
                    {GROUP_LABELS[g.group]}
                  </th>
                ))}
              </tr>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="font-medium pb-1.5 px-1.5 text-center whitespace-nowrap">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-card-border/40">
                {COLUMNS.map((c) => {
                  const value = row[c.key] as number | null;
                  const text = c.render(value);
                  const cls = colorFor(c.key, value);
                  return (
                    <td
                      key={c.key}
                      className={`text-center px-1.5 py-2 whitespace-nowrap ${cls}`}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
