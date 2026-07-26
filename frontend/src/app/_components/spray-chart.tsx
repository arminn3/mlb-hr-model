"use client";

import type { RecentAB } from "./types";
import { CARD } from "../_design";

// SVG field geometry
const W = 320;
const H = 280;
const HOME_X = 160;
const HOME_Y = 250;
const R_MAX_PX = 220; // maps ~450 ft
const R_MAX_FT = 450;
const FOUL_R = 195; // foul-line length (px)

const deg2rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Field bearing (deg from dead-center): -45 = LF line, 0 = center, +45 = RF. */
function bearing(ab: RecentAB, hand: string, i: number): number {
  if (ab.spray_deg != null) return clamp(ab.spray_deg, -48, 48);
  // Fallback for legacy slates without spray_deg: approximate from the
  // pull/center/oppo bucket + handedness (RHB pulls to LF = negative).
  const pullsLeft = hand !== "L"; // RHB (and switch default) pull to left field
  const spread = 30 + ((i * 7) % 12) - 6; // jitter so dots don't stack
  if (ab.direction === "center" || ab.direction == null) return ((i * 5) % 18) - 9;
  if (ab.direction === "pull") return pullsLeft ? -spread : spread;
  return pullsLeft ? spread : -spread; // oppo
}

function pos(bearingDeg: number, distFt: number) {
  const r = (clamp(distFt, 0, R_MAX_FT) / R_MAX_FT) * R_MAX_PX;
  const th = deg2rad(bearingDeg);
  return { x: HOME_X + r * Math.sin(th), y: HOME_Y - r * Math.cos(th) };
}

function dotColor(result: string): string {
  if (result === "home_run") return "#4ade80"; // green
  if (result === "single" || result === "double" || result === "triple") return "#60a5fa"; // blue hit
  return "#71717a"; // out / other
}

const leftPole = pos(-45, (FOUL_R / R_MAX_PX) * R_MAX_FT);
const rightPole = pos(45, (FOUL_R / R_MAX_PX) * R_MAX_FT);

export function SprayChart({ abs, batterHand }: { abs: RecentAB[]; batterHand: string }) {
  const plotted = abs.filter((a) => a.distance != null && Number(a.distance) > 0);
  const anyExact = abs.some((a) => a.spray_deg != null);

  return (
    <div className="rounded-xl p-4" style={CARD.elevated}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-foreground/55">
          Spray Chart
        </span>
        <span className="text-[10px] text-muted/60">
          {plotted.length} batted balls{!anyExact && plotted.length > 0 ? " · approx" : ""}
        </span>
      </div>

      {plotted.length === 0 ? (
        <p className="text-xs text-muted px-4 py-8 text-center">No batted-ball locations for this filter.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[360px] mx-auto block" role="img" aria-label="Batted ball spray chart">
            {/* fair territory */}
            <path
              d={`M${HOME_X},${HOME_Y} L${leftPole.x.toFixed(1)},${leftPole.y.toFixed(1)} Q${HOME_X},20 ${rightPole.x.toFixed(1)},${rightPole.y.toFixed(1)} Z`}
              fill="rgba(74,222,128,0.05)"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth={1}
            />
            {/* outfield fence arc */}
            <path
              d={`M${leftPole.x.toFixed(1)},${leftPole.y.toFixed(1)} Q${HOME_X},20 ${rightPole.x.toFixed(1)},${rightPole.y.toFixed(1)}`}
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1.5}
            />
            {/* foul lines */}
            <line x1={HOME_X} y1={HOME_Y} x2={leftPole.x} y2={leftPole.y} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            <line x1={HOME_X} y1={HOME_Y} x2={rightPole.x} y2={rightPole.y} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            {/* infield diamond */}
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
            {/* batted balls */}
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
                  <title>{`${ab.date} · ${ab.result.replace(/_/g, " ")} · ${ab.ev} EV · ${ab.distance} ft`}</title>
                </circle>
              );
            })}
            {/* home plate */}
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
