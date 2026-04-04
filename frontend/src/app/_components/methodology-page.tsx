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

      {/* Overview */}
      <Section title="Overview">
        <p>
          This model predicts which MLB batters have the highest probability of hitting a home run on any given day.
          It analyzes every batter in the starting lineup against the specific pitcher they&apos;re facing, scoring them
          based on recent performance, pitch-type matchup quality, pitcher vulnerability, and environmental conditions.
        </p>
        <p className="mt-2">
          The model uses <strong>machine learning</strong> to continuously learn what actually predicts home runs.
          Every morning it retrains on all historical data, adjusting its weights based on what&apos;s working.
        </p>
      </Section>

      {/* Composite Score */}
      <Section title="Composite Score Breakdown">
        <p className="mb-4">
          Each batter receives a composite score from 0 to 1. The score is a weighted blend of four factors,
          with weights learned automatically by the ML model:
        </p>
        {weights && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <WeightCard label="Recent BIP Metrics" pct={weights.batter * 100} description="Barrel%, fly ball%, hard hit%, exit velocity from the last 5-15 balls in play against this pitch type from same-hand pitchers" />
            <WeightCard label="Pitcher Vulnerability" pct={weights.pitcher * 100} description="HR/9, HR/FB%, fly ball rate allowed — how many home runs this pitcher gives up" />
            <WeightCard label="Environment" pct={weights.environment * 100} description="Park HR factor (by batter hand), temperature, wind direction/speed, humidity, pressure" />
            <WeightCard label="Matchup Quality" pct={weights.matchup * 100} description="2025 season ISO, SLG, HR rate against the specific pitch types this pitcher throws" />
          </div>
        )}
      </Section>

      {/* Pitch-Type Matching */}
      <Section title="Pitch-Type Matching — The Core Edge">
        <p>
          Most models use general stats like &quot;this batter hits .280 vs RHP.&quot; Our model goes deeper — it looks at
          how the batter performs against <strong>each specific pitch type</strong> the pitcher throws, weighted by how
          often they throw it.
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule>If a pitcher throws a pitch 45%+ of the time, it gets <strong>2x weight</strong> (dominant pitch)</Rule>
          <Rule>25-44% usage gets <strong>1.3x weight</strong> (significant pitch)</Rule>
          <Rule>12-24% usage gets <strong>1x weight</strong> (baseline)</Rule>
          <Rule>Below 12% usage is <strong>dropped entirely</strong> — too rare to matter</Rule>
        </div>
        <p className="mt-3">
          For each pitch type, we pull the batter&apos;s last 5/10/15 <strong>balls in play</strong> against that pitch
          from same-hand pitchers and calculate barrel%, fly ball%, hard hit%, and exit velocity.
        </p>
      </Section>

      {/* Season Blending */}
      <Section title="Season Data Blending">
        <p>
          Early in the season, recent data is noisy — a batter might have only 5-10 balls in play total.
          The model blends recent performance with <strong>2025 full-season data</strong> to stabilize scores.
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule>0 recent BIP → 100% season baseline</Rule>
          <Rule>15 recent BIP → ~65% season / 35% recent</Rule>
          <Rule>30+ recent BIP → 30% season / 70% recent</Rule>
        </div>
        <p className="mt-2 text-muted text-sm">
          This prevents unknown players with 2 lucky balls in play from ranking above established power hitters.
        </p>
      </Section>

      {/* Confidence Scaling */}
      <Section title="Confidence Scaling">
        <p>
          Players with very few balls in play get their composite score discounted:
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <Rule>10+ BIP → full score (100%)</Rule>
          <Rule>5-9 BIP → 95% of score</Rule>
          <Rule>1-4 BIP → 85% of score</Rule>
          <Rule>0 BIP → 70% of score</Rule>
        </div>
      </Section>

      {/* ML Learning */}
      <Section title="Machine Learning">
        <p>
          The model retrains every morning on all historical data. It uses <strong>logistic regression</strong> to learn
          which features actually predict home runs, then automatically adjusts the composite weights.
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
            <h4 className="text-xs font-semibold text-muted uppercase mb-2">Feature Importance (ML-Learned)</h4>
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

      {/* Data Sources */}
      <Section title="Data Sources">
        <div className="space-y-2 text-sm">
          <Rule><strong>Baseball Savant (Statcast)</strong> — pitch-level data: exit velocity, launch angle, barrel rate, pitch type, spray direction</Rule>
          <Rule><strong>MLB Stats API</strong> — schedules, rosters, lineups, probable pitchers, game results</Rule>
          <Rule><strong>Open-Meteo</strong> — game-time weather: temperature, wind speed/direction, humidity, pressure</Rule>
          <Rule><strong>The Odds API</strong> — HR prop lines (when available from preferred sportsbooks)</Rule>
        </div>
      </Section>

      {/* Rating System */}
      <Section title="Rating System">
        <div className="grid grid-cols-4 gap-3 mt-3">
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
