"use client";

import { useState } from "react";

export function Methodology() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-card-border rounded-xl bg-card/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-5 py-3 flex items-center justify-between cursor-pointer"
      >
        <span className="text-sm font-semibold text-foreground">
          How the Model Works
        </span>
        <svg
          className={`w-4 h-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-card-border">
          <div className="grid md:grid-cols-3 gap-6 mt-4 text-xs text-muted leading-relaxed">
            <div>
              <h4 className="text-foreground font-semibold text-sm mb-2">
                Pitch-Type Matching
              </h4>
              <p>
                For each pitcher, we analyze their pitch mix against the
                specific batter handedness. Pitches thrown less than 12% of the
                time are filtered out. Pitches at 45%+ usage get elevated weight
                (1.5x) in the composite. Equal-usage arsenals are weighted
                evenly.
              </p>
            </div>
            <div>
              <h4 className="text-foreground font-semibold text-sm mb-2">
                Batter Metrics (55% of score)
              </h4>
              <p className="mb-2">
                For each relevant pitch type, we pull the batter&apos;s last 5 plate
                appearances against that pitch from same-hand pitchers. Metrics
                computed per pitch type, then weighted by pitch mix:
              </p>
              <ul className="space-y-1 ml-3">
                <li><span className="text-accent-green font-medium">Fly Ball%</span> — 35% weight. HRs require loft.</li>
                <li><span className="text-accent-green font-medium">Barrel%</span> — 30% weight. Optimal exit velo + launch angle.</li>
                <li><span className="text-foreground font-medium">Hard Hit%</span> — 20% weight. Exit velo &ge; 95 mph.</li>
                <li><span className="text-foreground font-medium">Avg Exit Velo</span> — 15% weight. Raw power indicator.</li>
              </ul>
            </div>
            <div>
              <h4 className="text-foreground font-semibold text-sm mb-2">
                Pitcher Vulnerability (45% of score)
              </h4>
              <p className="mb-2">
                Pitcher stats are split by batter handedness (LHB vs RHB) from
                the last 120 days of Statcast data:
              </p>
              <ul className="space-y-1 ml-3">
                <li><span className="text-accent-green font-medium">HR/FB%</span> — 40% weight. What % of fly balls leave the park.</li>
                <li><span className="text-foreground font-medium">FB% Allowed</span> — 25% weight. Fly ball tendency.</li>
                <li><span className="text-foreground font-medium">HR/9</span> — 20% weight. Home run rate per 9 innings.</li>
                <li><span className="text-foreground font-medium">Total HRs</span> — 15% weight. Volume indicator.</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-card-border text-xs text-muted">
            <span className="font-semibold text-foreground">Data sources:</span>{" "}
            Baseball Savant (Statcast via pybaseball) for all batting and
            pitching metrics. MLB Stats API for schedules and rosters. The Odds
            API for prop lines and market odds.
          </div>
        </div>
      )}
    </div>
  );
}
