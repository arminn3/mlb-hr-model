"use client";

import { useEffect, useState } from "react";

interface BucketStat {
  label: string;
  n: number;
  hr_rate: number;
  vs_league_pct: number;
}

interface ParkHRRate {
  park: string;
  n: number;
  hr_rate: number;
  vs_league_pct: number;
}

interface ParkWindSens {
  park: string;
  n: number;
  sens_raw: number;
  sens_ship: number;
  p_val: number | null;
  significant: boolean;
}

interface CVSeason {
  season: number;
  n_test: number;
  pearson_r: number;
  rmse: number;
  beta_density: number;
  beta_wind: number;
}

interface ResearchData {
  dataset: {
    n_games: number;
    total_hrs: number;
    total_pas: number;
    seasons: number[];
    baseline_hr_rate: number;
  };
  global_coefficients: { K_RHO: number; K_WIND: number };
  hr_rate_by_temperature: BucketStat[];
  hr_rate_by_wind: BucketStat[];
  park_hr_rate_ranking: ParkHRRate[];
  park_wind_sensitivity: ParkWindSens[];
  extreme_conditions: {
    hot_wind_out: { n: number; hr_rate: number | null; vs_league_pct: number | null };
    cold_wind_in: { n: number; hr_rate: number | null; vs_league_pct: number | null };
  };
  cross_validation: CVSeason[];
}

function Section({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border overflow-hidden"
      style={{ background: "var(--surface-1,#1c1c1e)", borderColor: "#2c2c2e" }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: "#2c2c2e" }}>
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {subtitle && <div className="text-[11px] text-muted mt-0.5">{subtitle}</div>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function colorFor(pct: number): string {
  if (pct >= 10) return "#22c55e";
  if (pct >= 3) return "#4ade80";
  if (pct <= -10) return "#ef4444";
  if (pct <= -3) return "#f87171";
  return "#a1a1aa";
}

function StatRow({ label, rate, vsPct, n, maxAbs }: {
  label: string;
  rate: number;
  vsPct: number;
  n: number;
  maxAbs: number;
}) {
  const color = colorFor(vsPct);
  // Bar width: |vsPct| relative to max, clamp to 95%
  const pctWidth = Math.min(Math.abs(vsPct) / Math.max(maxAbs, 1) * 80, 80);
  const dirClass = vsPct >= 0 ? "ml-[50%]" : "mr-[50%] ml-auto";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="text-[12px] text-foreground min-w-[180px] truncate">{label}</div>
      <div className="flex-1 relative h-4 rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div
          className="absolute inset-y-0 w-px"
          style={{ left: "50%", background: "#3a3a3e" }}
        />
        <div
          className={`absolute top-0 bottom-0 rounded-sm ${vsPct >= 0 ? "left-1/2" : "right-1/2"}`}
          style={{ width: `${pctWidth}%`, background: color + "66" }}
        />
      </div>
      <div className="text-[12px] font-mono" style={{ color, minWidth: 60, textAlign: "right" }}>
        {vsPct > 0 ? "+" : ""}{vsPct.toFixed(1)}%
      </div>
      <div className="text-[11px] text-muted font-mono min-w-[50px] text-right">n={n}</div>
    </div>
  );
}

export function WeatherResearch() {
  const [data, setData] = useState<ResearchData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/weather_research.json")
      .then((r) => {
        if (!r.ok) throw new Error("no weather research data");
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="text-center text-muted text-sm py-12">
        Weather research data unavailable ({err}).
      </div>
    );
  }
  if (!data) {
    return <div className="text-center text-muted text-sm py-12">Loading research…</div>;
  }

  const maxTempAbs = Math.max(...data.hr_rate_by_temperature.map((b) => Math.abs(b.vs_league_pct)));
  const maxWindAbs = Math.max(...data.hr_rate_by_wind.map((b) => Math.abs(b.vs_league_pct)));
  const maxParkAbs = Math.max(...data.park_hr_rate_ranking.map((p) => Math.abs(p.vs_league_pct)));

  return (
    <div className="space-y-4">
      {/* Dataset overview */}
      <div
        className="rounded-[var(--radius-md)] border px-4 py-3"
        style={{ background: "var(--surface-1,#1c1c1e)", borderColor: "#2c2c2e" }}
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px]">
          <div>
            <span className="text-muted">Sample </span>
            <span className="font-mono font-semibold text-foreground">{data.dataset.n_games.toLocaleString()}</span>
            <span className="text-muted"> games</span>
          </div>
          <div>
            <span className="text-muted">HRs </span>
            <span className="font-mono font-semibold text-foreground">{data.dataset.total_hrs.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted">PAs </span>
            <span className="font-mono font-semibold text-foreground">{data.dataset.total_pas.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted">League HR/PA </span>
            <span className="font-mono font-semibold text-foreground">{(data.dataset.baseline_hr_rate * 100).toFixed(2)}%</span>
          </div>
          <div>
            <span className="text-muted">Seasons </span>
            <span className="font-mono font-semibold text-foreground">
              {data.dataset.seasons[0]}–{data.dataset.seasons[data.dataset.seasons.length - 1]}
            </span>
          </div>
          <div>
            <span className="text-muted">K<sub>ρ</sub> </span>
            <span className="font-mono font-semibold text-foreground">{data.global_coefficients.K_RHO.toFixed(3)}</span>
          </div>
          <div>
            <span className="text-muted">K<sub>wind</sub> </span>
            <span className="font-mono font-semibold text-foreground">{data.global_coefficients.K_WIND.toFixed(3)}</span>
          </div>
        </div>
      </div>

      {/* Extreme conditions comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          className="rounded-[var(--radius-md)] border px-4 py-3"
          style={{ background: "var(--surface-1,#1c1c1e)", borderColor: "#2c2c2e" }}
        >
          <div className="text-[10px] uppercase tracking-[0.06em] text-muted mb-1">Hottest HR environment</div>
          <div className="text-[11px] text-muted mb-2">Temp ≥ 80°F + wind-out ≥ 5mph</div>
          {data.extreme_conditions.hot_wind_out.hr_rate !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono" style={{ color: "#22c55e" }}>
                  +{data.extreme_conditions.hot_wind_out.vs_league_pct}%
                </span>
                <span className="text-[12px] text-muted">vs league</span>
              </div>
              <div className="text-[11px] text-muted font-mono mt-1">
                {(data.extreme_conditions.hot_wind_out.hr_rate! * 100).toFixed(2)}% HR/PA · n={data.extreme_conditions.hot_wind_out.n.toLocaleString()} games
              </div>
            </>
          ) : (
            <div className="text-muted">—</div>
          )}
        </div>
        <div
          className="rounded-[var(--radius-md)] border px-4 py-3"
          style={{ background: "var(--surface-1,#1c1c1e)", borderColor: "#2c2c2e" }}
        >
          <div className="text-[10px] uppercase tracking-[0.06em] text-muted mb-1">Coldest HR environment</div>
          <div className="text-[11px] text-muted mb-2">Temp ≤ 55°F + wind-in ≤ -5mph</div>
          {data.extreme_conditions.cold_wind_in.hr_rate !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono" style={{ color: "#ef4444" }}>
                  {data.extreme_conditions.cold_wind_in.vs_league_pct}%
                </span>
                <span className="text-[12px] text-muted">vs league</span>
              </div>
              <div className="text-[11px] text-muted font-mono mt-1">
                {(data.extreme_conditions.cold_wind_in.hr_rate! * 100).toFixed(2)}% HR/PA · n={data.extreme_conditions.cold_wind_in.n.toLocaleString()} games
              </div>
            </>
          ) : (
            <div className="text-muted">—</div>
          )}
        </div>
      </div>

      {/* HR rate by temperature */}
      <Section
        title="HR rate by temperature"
        subtitle="Mean HR/PA within each temperature band, expressed as % above/below the 10-season league mean."
      >
        {data.hr_rate_by_temperature.map((b) => (
          <StatRow key={b.label} label={b.label} rate={b.hr_rate} vsPct={b.vs_league_pct} n={b.n} maxAbs={maxTempAbs} />
        ))}
      </Section>

      {/* HR rate by wind */}
      <Section
        title="HR rate by wind (projected onto HP→CF axis)"
        subtitle="Positive wind = tailwind toward CF, negative = into the hitter. Open-air games only."
      >
        {data.hr_rate_by_wind.map((b) => (
          <StatRow key={b.label} label={b.label} rate={b.hr_rate} vsPct={b.vs_league_pct} n={b.n} maxAbs={maxWindAbs} />
        ))}
      </Section>

      {/* Park rankings */}
      <Section
        title="HR rate by park (10-season average)"
        subtitle="Observed HR/PA at each home park, vs league mean. Comparable to a park factor but unadjusted for opponent quality."
      >
        <div className="max-h-[500px] overflow-y-auto">
          {data.park_hr_rate_ranking.map((p) => (
            <StatRow key={p.park} label={p.park} rate={p.hr_rate} vsPct={p.vs_league_pct} n={p.n} maxAbs={maxParkAbs} />
          ))}
        </div>
      </Section>

      {/* Per-park wind sensitivity */}
      <Section
        title="Per-park wind sensitivity"
        subtitle="Calibrated multiplier on the league-average wind coefficient. 1.0× = average, 5.88× = Wrigley. Parks below p<0.10 significance fell back to 1.0×."
      >
        <div className="max-h-[500px] overflow-y-auto">
          {data.park_wind_sensitivity.map((p) => {
            const barWidth = Math.min(p.sens_ship / 6.0 * 100, 100);
            const color =
              p.sens_ship >= 2.0 ? "#22c55e" :
              p.sens_ship >= 1.3 ? "#4ade80" :
              p.sens_ship >= 1.01 ? "#a1a1aa" :
              p.sens_ship === 0 ? "#555" :
              "#a1a1aa";
            return (
              <div key={p.park} className="flex items-center gap-3 py-1.5">
                <div className="text-[12px] text-foreground font-semibold min-w-[44px]">{p.park}</div>
                <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div
                    className="h-full rounded-sm"
                    style={{ width: `${barWidth}%`, background: color + "66" }}
                  />
                </div>
                <div className="text-[12px] font-mono min-w-[50px] text-right" style={{ color }}>
                  {p.sens_ship.toFixed(2)}×
                </div>
                <div className="text-[10px] font-mono min-w-[56px] text-right" style={{ color: p.significant ? "#22c55e" : "#a1a1aa" }}>
                  {p.p_val !== null ? `p=${p.p_val.toFixed(3)}` : "—"}
                </div>
                <div className="text-[10px] text-muted font-mono min-w-[44px] text-right">n={p.n}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Cross-validation */}
      <Section
        title="Cross-validation (leave-one-season-out)"
        subtitle="Fit on 9 seasons, predict residual HR rate on the 10th. Stable r across ball eras means park effects aren't absorbing juiced-ball noise."
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2">
          {data.cross_validation.map((cv) => (
            <div
              key={cv.season}
              className="rounded-md border px-2 py-2 text-center"
              style={{ borderColor: "#2c2c2e", background: "rgba(0,0,0,0.2)" }}
            >
              <div className="text-[11px] font-semibold text-foreground">{cv.season}</div>
              <div className="text-[13px] font-mono font-bold" style={{ color: "#4ade80" }}>
                r={cv.pearson_r.toFixed(3)}
              </div>
              <div className="text-[9px] text-muted font-mono">n={cv.n_test}</div>
            </div>
          ))}
        </div>
      </Section>

      <div className="text-[11px] text-muted pt-2">
        Pipeline: pybaseball Statcast (per-game HRs &amp; PAs) × Iowa State ASOS METAR archive (hourly weather) joined on game start time, residualized by league-season mean, OLS per park with James-Stein shrinkage toward the pooled coefficient.
      </div>
    </div>
  );
}
