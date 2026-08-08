// Shared NFL display helpers — all colors come from the design tokens so the
// NFL side matches the MLB feel and never invents its own palette.
import { color } from "../../_design";

// Team logos (ESPN CDN). nflverse abbrs mostly match ESPN's lowercase slug;
// a couple differ.
const ESPN_ABBR: Record<string, string> = { LA: "lar", WAS: "wsh" };
export const teamLogo = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500/${(ESPN_ABBR[abbr] ?? abbr).toLowerCase()}.png`;

/** Continuous heat fill: t in [0,1] -> smooth red(low) → neutral → green(high).
 *  Fuller/saturated like the reference, not a faint tint. */
export function heatFill(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  if (c >= 0.5) return `rgba(34,197,94,${(0.06 + 0.5 * (c - 0.5) * 2).toFixed(3)})`;   // green
  return `rgba(239,68,68,${(0.06 + 0.5 * (0.5 - c) * 2).toFixed(3)})`;                 // red
}

export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
export const fmtPct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Anytime-TD probability -> intent color. */
export function scoreColor(p: number): string {
  if (p >= 0.6) return color.green;
  if (p >= 0.4) return color.yellow;
  return color.muted;
}

/** Position accent (defensive, falls back to muted for anything unmapped). */
export const POS_COLOR: Record<string, string> = {
  RB: color.green,
  WR: color.accent,
  TE: color.yellow,
  QB: color.red,
  FB: color.muted,
};
export const posColor = (pos: string) => POS_COLOR[pos] ?? color.muted;

/** Matchup color from defense-vs-role rank. HIGHER rank = softer (allows most),
 *  so #32-of-32 vs a role is the best spot -> green. */
export function matchupColor(rank: number, total: number): string {
  if (!rank || !total) return color.muted;
  const pct = rank / total;
  if (pct >= 0.72) return color.green;   // soft — top of the barrel
  if (pct >= 0.4) return color.yellow;   // middling
  return color.red;                      // tough
}

/** Short matchup label from the defense-vs-role rank. */
export function matchupLabel(rank: number, total: number): string {
  if (!rank || !total) return "—";
  const pct = rank / total;
  if (pct >= 0.72) return "SOFT";
  if (pct >= 0.4) return "AVG";
  return "TOUGH";
}
