// Shared NFL display helpers — all colors come from the design tokens so the
// NFL side matches the MLB feel and never invents its own palette.
import { color } from "../../_design";

export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
export const fmtPct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
export const fmtOdds = (o: number) => (o > 0 ? `+${o}` : `${o}`);

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

/** DvP rank (1 = softest matchup) -> intent color. 32 teams. */
export function dvpColor(rank: number): string {
  if (!rank) return color.muted;
  if (rank <= 8) return color.green; // soft matchup
  if (rank <= 20) return color.yellow;
  return color.muted; // tough
}
