"use client";

import { useState, useMemo } from "react";
import type { RecentAB } from "./types";
import { CARD } from "../_design";
import { parkDimsFor } from "./park-dimensions";

// Fence sample bearings (deg from center), left→right: LF line, LF alley, CF,
// RF alley, RF line.
const FENCE_BEARINGS = [-45, -27, 0, 27, 45];

// SVG field geometry
const W = 320;
const H = 280;
const HOME_X = 160;
const HOME_Y = 250;
const R_MAX_PX = 220; // maps ~450 ft
const R_MAX_FT = 450;

const deg2rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Field bearing (deg from dead-center): -45 = LF line, 0 = center, +45 = RF. */
function bearing(ab: RecentAB, hand: string, i: number): number {
  if (ab.spray_deg != null) return clamp(ab.spray_deg, -48, 48);
  // Fallback for legacy slates without spray_deg: approximate from the
  // pull/center/oppo bucket + handedness (RHB pulls to LF = negative).
  const pullsLeft = hand !== "L";
  const spread = 30 + ((i * 7) % 12) - 6;
  if (ab.direction === "center" || ab.direction == null) return ((i * 5) % 18) - 9;
  if (ab.direction === "pull") return pullsLeft ? -spread : spread;
  return pullsLeft ? spread : -spread;
}

function pos(bearingDeg: number, distFt: number) {
  const r = (clamp(distFt, 0, R_MAX_FT) / R_MAX_FT) * R_MAX_PX;
  const th = deg2rad(bearingDeg);
  return { x: HOME_X + r * Math.sin(th), y: HOME_Y - r * Math.cos(th) };
}

function dotColor(result: string): string {
  if (result === "home_run") return "#4ade80";
  if (result === "single" || result === "double" || result === "triple") return "#60a5fa";
  return "#71717a";
}

// Small segmented control (matches the app's toggle look).
function Seg<T extends string | number>({
  options, value, onChange,
}: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={
            "px-2.5 py-1 text-[11px] font-mono rounded cursor-pointer transition-colors " +
            (value === o.v ? "bg-accent/15 text-accent font-semibold" : "text-muted hover:text-foreground")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const COUNT_OPTIONS = [10, 25, 50] as const;
const HAND_OPTIONS = [
  { v: "Both", label: "Both" },
  { v: "R", label: "vs RHP" },
  { v: "L", label: "vs LHP" },
] as const;

export function SprayChart({ abs, batterHand, parkTeam }: { abs: RecentAB[]; batterHand: string; parkTeam?: string }) {
  const [hand, setHand] = useState<"Both" | "L" | "R">("Both");
  const [count, setCount] = useState<number>(25);
  const [pitches, setPitches] = useState<Set<string>>(new Set()); // empty = all

  // Today's park wall — sampled at the 5 fence bearings from real dimensions.
  const dims = parkDimsFor(parkTeam);
  const fencePts = [dims.lf, dims.lcf, dims.cf, dims.rcf, dims.rf].map((ft, i) => pos(FENCE_BEARINGS[i], ft));
  const fencePath = fencePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fairPath = `${HOME_X},${HOME_Y} ${fencePath}`;

  // Plottable batted balls (need a landing distance).
  const pool = useMemo(
    () => abs.filter((a) => a.distance != null && Number(a.distance) > 0),
    [abs],
  );
  const pitchTypes = useMemo(
    () => [...new Set(pool.map((a) => a.pitch_type).filter(Boolean))].sort(),
    [pool],
  );

  const plotted = useMemo(
    () =>
      pool
        .filter((a) => hand === "Both" || a.pitch_arm === hand)
        .filter((a) => pitches.size === 0 || pitches.has(a.pitch_type))
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        .slice(0, count),
    [pool, hand, pitches, count],
  );

  const anyExact = plotted.some((a) => a.spray_deg != null);
  const togglePitch = (pt: string) =>
    setPitches((prev) => {
      const next = new Set(prev);
      if (next.has(pt)) next.delete(pt);
      else next.add(pt);
      return next;
    });

  return (
    <div className="rounded-xl p-4" style={CARD.elevated}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-foreground/55">
          Spray Chart{parkTeam ? ` · ${parkTeam} park` : ""}
        </span>
        <span className="text-[10px] text-muted/60">
          {plotted.length} batted balls{!anyExact && plotted.length > 0 ? " · approx" : ""}
        </span>
      </div>

      {/* Filters — pitcher hand · count · pitch types */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Seg options={HAND_OPTIONS as unknown as { v: "Both" | "L" | "R"; label: string }[]} value={hand} onChange={setHand} />
        <Seg options={COUNT_OPTIONS.map((c) => ({ v: c, label: String(c) }))} value={count} onChange={setCount} />
        {pitches.size > 0 && (
          <button onClick={() => setPitches(new Set())} className="text-[11px] text-accent-red/80 hover:text-accent-red cursor-pointer">
            clear pitches
          </button>
        )}
      </div>
      {pitchTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {pitchTypes.map((pt) => {
            const on = pitches.has(pt);
            return (
              <button
                key={pt}
                onClick={() => togglePitch(pt)}
                className={
                  "px-2 py-1 text-[10px] rounded-md border cursor-pointer transition-colors " +
                  (on
                    ? "bg-accent/15 text-accent border-accent/40"
                    : "bg-transparent text-muted border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e]")
                }
              >
                {pt}
              </button>
            );
          })}
        </div>
      )}

      {plotted.length === 0 ? (
        <p className="text-xs text-muted px-4 py-8 text-center">No batted balls match these filters.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[360px] mx-auto block" role="img" aria-label="Batted ball spray chart">
            {/* fair territory (home + the park's fence points) */}
            <polygon points={fairPath} fill="rgba(74,222,128,0.05)" stroke="none" />
            {/* outfield wall — the actual park contour */}
            <polyline points={fencePath} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} strokeLinejoin="round" />
            {/* foul lines from home to the poles */}
            <line x1={HOME_X} y1={HOME_Y} x2={fencePts[0].x} y2={fencePts[0].y} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            <line x1={HOME_X} y1={HOME_Y} x2={fencePts[4].x} y2={fencePts[4].y} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            {(() => {
              const b1 = pos(45, 90), b2 = pos(0, 127), b3 = pos(-45, 90);
              return (
                <polygon
                  points={`${HOME_X},${HOME_Y} ${b1.x.toFixed(1)},${b1.y.toFixed(1)} ${b2.x.toFixed(1)},${b2.y.toFixed(1)} ${b3.x.toFixed(1)},${b3.y.toFixed(1)}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth={1}
                />
              );
            })()}
            {plotted.map((ab, i) => {
              const { x, y } = pos(bearing(ab, batterHand, i), Number(ab.distance));
              const isHR = ab.result === "home_run";
              return (
                <circle
                  key={i}
                  cx={x.toFixed(1)}
                  cy={y.toFixed(1)}
                  r={isHR ? 4 : 3}
                  fill={dotColor(ab.result)}
                  fillOpacity={isHR ? 0.95 : 0.7}
                  stroke={isHR ? "#4ade80" : "none"}
                  strokeWidth={isHR ? 1 : 0}
                >
                  <title>{`${ab.date} · ${ab.result.replace(/_/g, " ")} · ${ab.pitch_type} · ${ab.ev} EV · ${ab.distance} ft`}</title>
                </circle>
              );
            })}
            <circle cx={HOME_X} cy={HOME_Y} r={2.5} fill="rgba(255,255,255,0.5)" />
          </svg>

          <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#4ade80" }} /> HR</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#60a5fa" }} /> Hit</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#71717a" }} /> Out</span>
          </div>
        </>
      )}
    </div>
  );
}
