// Shared NFL display helpers — all colors come from the design tokens so the
// NFL side matches the MLB feel and never invents its own palette.
import { color } from "../../_design";

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
