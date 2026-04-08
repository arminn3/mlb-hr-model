"use client";

import { useEffect, useState } from "react";

interface MLWeights {
  batter: number;
  matchup: number;
  pitcher: number;
  environment: number;
}

interface MLAnalysis {
  trained_on: number;
  hr_count: number;
  hr_rate: number;
  features: Array<{ name: string; coefficient: number; weight_pct: number }>;
}

export function MethodologyPage() {
  const [weights, setWeights] = useState<MLWeights | null>(null);
  const [analysis, setAnalysis] = useState<MLAnalysis | null>(null);

  useEffect(() => {
    fetch("/data/results/ml_weights.json").then(r => r.ok ? r.json() : null).then(setWeights).catch(() => {});
    fetch("/data/results/ml_analysis.json").then(r => r.ok ? r.json() : null).then(setAnalysis).catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-foreground mb-6">How This Model Works</h2>

      <Section title="Overview">
        <p>
          This model predicts which MLB batters have the highest probability of hitting a home run on any given day.
          It scores every batter based on their <strong>recent balls in play against the specific pitch types</strong> the
          opposing pitcher throws, combined with pitcher vulnerability, matchup history, and environment.
        </p>
        <p className="mt-2">
          The key insight: a batter&apos;s performance against four-seam fastballs matters much more when facing a pitcher
          who throws 46% fastballs than a pitcher who only throws 15% fastballs.
        </p>
      </Section>

      <Section title="Composite Score">
        <p className="mb-4">
          Each batter receives a composite score from 0 to 1. Higher = better HR look.
        </p>
        {weights && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <WeightCard label="Batter Score" pct={weights.batter * 100} description="Recent BIP quality weighted by pitcher's pitch mix — barrel%, FB%, exit velo" />
            <WeightCard label="Pitcher Vulnerability" pct={weights.pitcher * 100} description="How many HRs this pitcher gives up — HR/FB%, HR/9, FB rate allowed" />
            <WeightCard label="Matchup Quality" pct={weights.matchup * 100} description="Career ISO, SLG, HR rate against the pitcher's specific pitch types" />
            <WeightCard label="Environment" pct={weights.environment * 100} description="Park HR factor, temperature, wind direction/speed. Domes use park factor only." />
          </div>
        )}
      </Section>

      <Section title="Batter Score — Last 5 Balls in Play">
        <p>
          The batter score looks at the <strong>last 5 actual balls in play</strong> (not foul balls) against the same
          pitcher handedness, filtered to the pitch types the opposing pitcher throws (above 12% usage).
        </p>
        <p className="mt-2">
          If a batter doesn&apos;t have 5 BIP in 2026 on those pitch types, the model backfills from their 2025 season data
          to reach 5. Once they accumulate enough 2026 data, the 2025 data falls off naturally.
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule><strong>Barrel Rate (45%)</strong> — percentage of BIP that are barrels (98+ EV at ideal launch angle)</Rule>
          <Rule><strong>Fly Ball Rate (35%)</strong> — percentage of BIP that are fly balls (not grounders, not popups)</Rule>
          <Rule><strong>Exit Velocity (20%)</strong> — average exit velo across the BIP pool</Rule>
        </div>
        <p className="mt-2 text-xs text-muted">
          Hard hit % is tracked and displayed but does not affect the score — barrel rate already captures hard contact + lift.
        </p>
      </Section>

      <Section title="Pitch-Type Weighting — Dominant Pitch Matters More">
        <p>
          The batter&apos;s score is weighted by how often the opposing pitcher throws each pitch. A pitcher&apos;s dominant
          pitch gets extra weight because that&apos;s what the batter will see most often.
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule>60%+ usage → <strong>2.5x weight</strong> (ultra dominant)</Rule>
          <Rule>45-59% usage → <strong>2.0x weight</strong> (dominant pitch)</Rule>
          <Rule>35-44% usage → <strong>1.8x weight</strong> (primary pitch)</Rule>
          <Rule>25-34% usage → <strong>1.3x weight</strong> (significant pitch)</Rule>
          <Rule>12-24% usage → <strong>1.0x weight</strong> (baseline)</Rule>
          <Rule>Below 12% → <strong>dropped entirely</strong></Rule>
        </div>
        <p className="mt-3 text-xs text-muted">
          Example: If a pitcher throws 46% four-seam fastball and 30% slider, the batter&apos;s fastball performance
          counts 2.0x while their slider performance counts 1.3x in the score.
        </p>
      </Section>

      <Section title="Pitcher Vulnerability">
        <p>
          Pitchers are scored on how hittable they are for home runs, calibrated to MLB averages:
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule><strong>HR/FB Rate</strong> — what percentage of fly balls become HRs (league avg ~12%)</Rule>
          <Rule><strong>HR/9</strong> — home runs allowed per 9 innings (league avg ~1.2)</Rule>
          <Rule><strong>FB Rate Allowed</strong> — how many fly balls the pitcher gives up</Rule>
          <Rule><strong>Total HRs</strong> — raw HR count normalized by innings</Rule>
        </div>
        <p className="mt-2">
          Pitchers with less than 10 IP in 2026 are blended with their 2025 season stats. If no 2025 data exists,
          they get a league-average score (0.5) so unknown pitchers don&apos;t unfairly drag down hot batters.
        </p>
      </Section>

      <Section title="Sweeper / Slider Matching">
        <p>
          Statcast classifies sweepers (ST) and sliders (SL) as different pitch types. When a pitcher throws a sweeper
          but not a slider (or vice versa), the model also searches the batter&apos;s BIP for the related pitch type —
          since batters face both similarly.
        </p>
      </Section>

      <Section title="Environment">
        <p>
          Each game gets an environment score based on park factors and weather conditions at game time:
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule><strong>Park Factor</strong> — stadium HR tendency (Coors = 115, Oracle Park = 75)</Rule>
          <Rule><strong>Temperature</strong> — warmer air = ball carries further</Rule>
          <Rule><strong>Wind</strong> — blowing out helps HRs, blowing in suppresses them</Rule>
          <Rule><strong>Dome / Retractable Roof</strong> — when roof is closed, only park factor matters (no weather effect)</Rule>
        </div>
        <p className="mt-2 text-xs text-muted">
          Weather data is fetched hourly from Open-Meteo, targeting each game&apos;s local start time.
          Wind direction is calculated against each stadium&apos;s outfield azimuth.
        </p>
      </Section>

      <Section title="BvP — Career Head-to-Head">
        <p>
          The Batter vs Pitcher page shows career-long head-to-head stats pulled from the MLB Stats API.
          This includes every plate appearance between a batter and pitcher across their entire careers, not just recent data.
        </p>
      </Section>

      <Section title="Confidence & Data Quality">
        <div className="space-y-2 text-sm">
          <Rule>15+ BIP → full confidence (100%)</Rule>
          <Rule>10-14 BIP → 90% confidence</Rule>
          <Rule>7-9 BIP → 80% confidence</Rule>
          <Rule>4-6 BIP → 65% confidence</Rule>
          <Rule>1-3 BIP → 50% confidence</Rule>
          <Rule>0 BIP → 35% confidence</Rule>
        </div>
        <p className="mt-2 text-xs text-muted">
          Players with &ldquo;LOW PITCHER IP&rdquo; tags have thin pitcher data. &ldquo;LOW SAMPLE&rdquo; means few BIP available.
        </p>
      </Section>

      {/* ML Section */}
      <Section title="Machine Learning (In Development)">
        <p>
          An ML pipeline trains on historical predictions vs actual HR outcomes to learn optimal feature weights.
          Currently disabled while clean training data accumulates — the model uses manually tuned weights that have
          been validated against daily results.
        </p>
        {analysis && (
          <div className="mt-4 bg-background/30 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">{analysis.trained_on}</div>
                <div className="text-[10px] text-muted uppercase">Training Samples</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">{analysis.hr_count}</div>
                <div className="text-[10px] text-muted uppercase">Home Runs</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">{analysis.hr_rate}%</div>
                <div className="text-[10px] text-muted uppercase">HR Rate</div>
              </div>
            </div>
            <h4 className="text-xs font-semibold text-muted uppercase mb-2">Feature Importance (Last ML Run)</h4>
            <div className="space-y-1.5">
              {analysis.features
                .filter(f => f.weight_pct > 1)
                .sort((a, b) => b.weight_pct - a.weight_pct)
                .map(f => (
                  <div key={f.name} className="flex items-center gap-3">
                    <span className="text-xs text-muted w-40">{f.name.replace(/_/g, " ")}</span>
                    <div className="flex-1 h-2 bg-card-border rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${f.weight_pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-foreground w-12">{f.weight_pct}%</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Data Sources">
        <div className="space-y-2 text-sm">
          <Rule><strong>Baseball Savant (Statcast)</strong> — pitch-level data: exit velocity, launch angle, barrel rate, pitch type, bb_type</Rule>
          <Rule><strong>MLB Stats API</strong> — schedules, rosters, lineups, probable pitchers, career BvP stats</Rule>
          <Rule><strong>Open-Meteo</strong> — hourly weather forecasts for game-time conditions at each stadium</Rule>
        </div>
      </Section>

      <Section title="Rating System">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <div className="bg-accent-green/10 border border-accent-green/20 rounded-lg p-3 text-center">
            <span className="text-sm font-bold text-accent-green">Ideal</span>
            <div className="text-[10px] text-muted mt-1">Score &ge; 0.50</div>
          </div>
          <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 text-center">
            <span className="text-sm font-bold text-accent">Favorable</span>
            <div className="text-[10px] text-muted mt-1">Score &ge; 0.35</div>
          </div>
          <div className="bg-accent-yellow/10 border border-accent-yellow/20 rounded-lg p-3 text-center">
            <span className="text-sm font-bold text-accent-yellow">Average</span>
            <div className="text-[10px] text-muted mt-1">Score &ge; 0.20</div>
          </div>
          <div className="bg-accent-red/10 border border-accent-red/20 rounded-lg p-3 text-center">
            <span className="text-sm font-bold text-accent-red">Difficult</span>
            <div className="text-[10px] text-muted mt-1">Score &lt; 0.20</div>
          </div>
        </div>
      </Section>

      <Section title="Automation">
        <div className="space-y-2 text-sm">
          <Rule>Rankings update <strong>hourly</strong> from 7 AM to midnight ET via GitHub Actions</Rule>
          <Rule>Results are tracked automatically after the last game each night</Rule>
          <Rule>Live feed data is saved permanently for historical review</Rule>
          <Rule>Weather forecasts update each hour for game-time accuracy</Rule>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-foreground mb-3 border-b border-card-border pb-2">{title}</h3>
      <div className="text-sm text-muted leading-relaxed">{children}</div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-accent">&#8226;</span>
      <span>{children}</span>
    </div>
  );
}

function WeightCard({ label, pct, description }: { label: string; pct: number; description: string }) {
  return (
    <div className="bg-background/30 rounded-lg p-3">
      <div className="text-xl font-bold font-mono text-accent mb-1">{pct.toFixed(0)}%</div>
      <div className="text-xs font-semibold text-foreground mb-1">{label}</div>
      <div className="text-[10px] text-muted leading-tight">{description}</div>
    </div>
  );
}
