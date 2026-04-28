"use client";

import { useState } from "react";

type TopPick = {
  name: string;
  team: string;
  opp: string;
  composite: number;
  barrel_pct: number | null;
  fb_pct: number | null;
  exit_velo: number | null;
};

const BRAND = "Beeb Sheets";

const FAQS: { q: string; a: string }[] = [
  {
    q: `What does ${BRAND} do?`,
    a: "We rank every MLB batter on tonight's slate by their probability of hitting a home run — built on Statcast data (barrels, exit velocity, fly-ball rate, bat speed), opposing-pitcher arsenals, and park + weather environments. Every number you see on the site is the number the model actually scores.",
  },
  {
    q: "What data powers the rankings?",
    a: "Pitch-level Statcast data on every batter-pitcher interaction (barrels, exit velocity, launch angle, bat speed), regressed against actual HR outcomes. Lineups pull from the MLB Stats API. Park environments include wind, humidity, pressure, and dimensions. Results are backtested against real HR outcomes every day.",
  },
  {
    q: "How often is it updated?",
    a: "Every time a lineup locks, a weather forecast shifts, or a starting pitcher changes. Live game action (HRs + near-HRs) streams in real time from the MLB API.",
  },
  {
    q: "What's the model's edge?",
    a: "We separate the last-5 hot streak window from the last-10 stabilized window and show them side-by-side. We weight per-pitch-type contact by the opposing pitcher's arsenal (so a fly-ball bat vs a sinker-heavy pitcher gets the right discount). We use xHR — expected home runs from bat-tracking stats — to surface breakouts (lucky under-performers) and regression (fluky over-performers).",
  },
  {
    q: "Is this a sportsbook?",
    a: "No. We don't take bets and we're not affiliated with any sportsbook. We're a research tool — the picks are yours to make.",
  },
  {
    q: `How do I access ${BRAND}?`,
    a: "Click Launch App at the top of this page. You'll land on today's slate and can explore every feature.",
  },
];

function GlassBox({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] backdrop-blur-md ${className}`}
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow:
          "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 8px 32px -12px rgba(0,0,0,0.5)",
      }}
    >
      {children}
    </div>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md border-b" style={{ background: "rgba(20,20,20,0.6)", borderColor: "rgba(255,255,255,0.06)" }}>
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="text-base font-bold tracking-tight text-foreground">
          {BRAND}
        </div>
        <div className="flex items-center gap-6">
          <a href="#features" className="hidden sm:block text-sm text-muted hover:text-foreground transition-colors">Features</a>
          <a href="#how" className="hidden sm:block text-sm text-muted hover:text-foreground transition-colors">How it works</a>
          <a href="#faq" className="hidden sm:block text-sm text-muted hover:text-foreground transition-colors">FAQ</a>
          <a
            href="/dashboard"
            className="px-4 py-1.5 text-xs font-semibold rounded-lg text-background transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)" }}
          >
            Launch App
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full text-[11px] font-mono uppercase tracking-wider border" style={{ borderColor: "rgba(96,165,250,0.3)", color: "#60a5fa", background: "rgba(96,165,250,0.08)" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
        MLB HR props, updated live
      </div>
      <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4 text-foreground leading-[1.05]">
        Bet on <span style={{ background: "linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>the data</span>,
        <br />
        not the name on the jersey.
      </h1>
      <p className="text-base sm:text-lg text-muted max-w-2xl mx-auto mb-8 leading-relaxed">
        {BRAND} turns every Statcast metric — barrel rate, exit velocity, bat speed, and opposing pitcher arsenal — into a ranked HR-probability board. Every day, every game.
      </p>
      <div className="flex items-center justify-center gap-3">
        <a
          href="/dashboard"
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg text-background transition-all hover:opacity-90 shadow-lg"
          style={{ background: "linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)" }}
        >
          Launch App →
        </a>
        <a
          href="#features"
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg text-foreground border transition-colors hover:bg-white/5"
          style={{ borderColor: "rgba(255,255,255,0.12)" }}
        >
          See features
        </a>
      </div>
    </section>
  );
}

const SAMPLE_PICKS: TopPick[] = [
  { name: "Aaron Judge", team: "NYY", opp: "Tarik Skubal", composite: 0.91, barrel_pct: 21.4, fb_pct: 44.2, exit_velo: 95.1 },
  { name: "Shohei Ohtani", team: "LAD", opp: "Logan Webb", composite: 0.87, barrel_pct: 18.6, fb_pct: 41.0, exit_velo: 93.7 },
  { name: "Kyle Schwarber", team: "PHI", opp: "Sonny Gray", composite: 0.84, barrel_pct: 17.3, fb_pct: 49.5, exit_velo: 92.4 },
];

function LivePreview() {
  const picks = SAMPLE_PICKS;

  return (
    <section className="max-w-4xl mx-auto px-6 pb-20">
      <GlassBox className="p-6">
        <div className="space-y-2">
          {picks.map((p, i) => (
              <div
                key={p.name}
                className="flex items-center gap-4 p-3 rounded-[var(--radius-md)]"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
              >
                <div className="text-xl font-bold font-mono w-7 text-center" style={{ color: "#60a5fa" }}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground truncate">{p.name}</div>
                  <div className="text-[11px] text-muted font-mono truncate">
                    {p.team} vs {p.opp}
                  </div>
                </div>
                <div className="flex gap-4 text-xs font-mono text-muted">
                  <span><span className="text-foreground">{p.barrel_pct ?? "—"}%</span> brl</span>
                  <span><span className="text-foreground">{p.fb_pct ?? "—"}%</span> fb</span>
                  <span><span className="text-foreground">{p.exit_velo ?? "—"}</span> ev</span>
                </div>
                <div
                  className="px-2.5 py-1 rounded-md text-xs font-bold font-mono"
                  style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.25)" }}
                >
                  {(p.composite * 100).toFixed(0)}
                </div>
              </div>
            ))}
        </div>
        <div className="mt-5 text-center">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm font-semibold transition-colors"
            style={{ color: "#60a5fa" }}
          >
            See the full slate →
          </a>
        </div>
      </GlassBox>
    </section>
  );
}

function Features() {
  const items = [
    {
      icon: "📊",
      title: "HR Rankings",
      body: "Every starting batter ranked by composite HR probability, updated live. L5 and L10 windows side-by-side.",
    },
    {
      icon: "⚾",
      title: "Game Slate",
      body: "Every game, every matchup, every probable. Pitcher arsenals, team pitch mixes, and park environments in one view.",
    },
    {
      icon: "📈",
      title: "Breakouts & Regression",
      body: "xHR model surfaces batters whose actual HR pace doesn't match their underlying bat-tracking data. Catch the upswings early.",
    },
    {
      icon: "🎯",
      title: "Team vs Pitch Mix",
      body: "Drill into how each team handles the opposing starter's exact arsenal — split by RHB / LHB, pitch type, and date range.",
    },
    {
      icon: "🤖",
      title: "ML Rankings",
      body: "Learned category weights from 125k historical slates. The model trains on what actually correlates with HR outcomes, not what feels right.",
    },
    {
      icon: "🔴",
      title: "Live Feed",
      body: "Real-time HRs and near-HRs as they happen, streamed from the MLB API. See which picks paid off the moment the ball lands.",
    },
  ];
  return (
    <section id="features" className="max-w-6xl mx-auto px-6 pb-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-foreground tracking-tight">Everything you need to find an edge</h2>
        <p className="text-muted max-w-xl mx-auto">Six focused tools. Every one of them is driven by the same Statcast-backed model.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it) => (
          <GlassBox key={it.title} className="p-5">
            <div className="text-2xl mb-3">{it.icon}</div>
            <div className="text-base font-semibold text-foreground mb-2">{it.title}</div>
            <div className="text-sm text-muted leading-relaxed">{it.body}</div>
          </GlassBox>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Pull the data",
      body: "Every pitch-level Statcast event for every batter vs every pitcher, across 2024, 2025, and 2026. Plus daily lineups, weather, and park dimensions.",
    },
    {
      n: "02",
      title: "Score the matchup",
      body: "Weight each batter's barrel rate, exit velocity, and fly-ball rate against the opposing pitcher's arsenal — separately for last-5 hot streak and last-10 stabilized windows.",
    },
    {
      n: "03",
      title: "Rank and serve",
      body: "Composite scores flow into HR Rankings, Game Slate, and ML Rankings. Breakouts and Regression surface which hot/cold streaks are real vs noise.",
    },
  ];
  return (
    <section id="how" className="max-w-5xl mx-auto px-6 pb-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-foreground tracking-tight">How it works</h2>
        <p className="text-muted max-w-xl mx-auto">Transparent end-to-end. Every number on the site is the number the model scores.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {steps.map((s) => (
          <GlassBox key={s.n} className="p-6">
            <div className="text-xs font-mono tracking-wider mb-3" style={{ color: "#60a5fa" }}>{s.n}</div>
            <div className="text-lg font-semibold text-foreground mb-2">{s.title}</div>
            <div className="text-sm text-muted leading-relaxed">{s.body}</div>
          </GlassBox>
        ))}
      </div>
    </section>
  );
}

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="max-w-3xl mx-auto px-6 pb-20">
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-foreground tracking-tight">Frequently asked questions</h2>
      </div>
      <div className="space-y-3">
        {FAQS.map((f, i) => (
          <GlassBox key={i} className="overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between p-4 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
            >
              <span className="text-sm sm:text-base font-semibold text-foreground">{f.q}</span>
              <span className="text-muted text-lg font-mono" style={{ transform: open === i ? "rotate(45deg)" : "", transition: "transform var(--duration-fast)" }}>
                +
              </span>
            </button>
            {open === i && (
              <div className="px-4 pb-4 text-sm text-muted leading-relaxed">
                {f.a}
              </div>
            )}
          </GlassBox>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
      <GlassBox className="p-10">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-foreground tracking-tight">
          Ready to find an edge?
        </h2>
        <p className="text-muted mb-6">Today&apos;s slate is already scored. Walk in at first pitch.</p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg text-background transition-all hover:opacity-90 shadow-lg"
          style={{ background: "linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)" }}
        >
          Launch App →
        </a>
      </GlassBox>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm font-semibold text-foreground">{BRAND}</div>
        <div className="text-[11px] text-muted font-mono">
          Data from Statcast + MLB Stats API · Not affiliated with MLB · For research only
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <Nav />
      <Hero />
      <LivePreview />
      <Features />
      <HowItWorks />
      <FAQ />
      <CTA />
      <Footer />
    </div>
  );
}
