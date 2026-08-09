// Shared NFL display helpers — all colors come from the design tokens so the
// NFL side matches the MLB feel and never invents its own palette.
import { color } from "../../_design";

// Team logos (ESPN CDN). nflverse abbrs mostly match ESPN's lowercase slug;
// a couple differ.
const ESPN_ABBR: Record<string, string> = { LA: "lar", WAS: "wsh" };
export const teamLogo = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500/${(ESPN_ABBR[abbr] ?? abbr).toLowerCase()}.png`;

// Full team names (nflverse abbr -> name).
const TEAM_NAME: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LA: "Los Angeles Rams", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
export const teamName = (abbr: string) => TEAM_NAME[abbr] ?? abbr;

/** ISO date -> "Today" / "Tomorrow" / "Yesterday" / weekday ("Sun"). */
export function relativeDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export const playerHeadshot = (espnId?: string | null) =>
  espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : null;

/** Line-driven cell heat: over the line = green (good look), under = red.
 *  `invert` flips it for lower-is-better stats (INT). Intensity by distance. */
export function lineHeat(v: number, line: number | null | undefined, invert = false): string {
  if (line == null) return "transparent";
  const over = invert ? v < line : v > line;
  const t = Math.min(1, Math.abs(v - line) / (Math.abs(line) || 1));
  const a = (0.08 + 0.42 * t).toFixed(3);
  if (Math.abs(v - line) < 1e-9) return "transparent";
  return over ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
}

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
