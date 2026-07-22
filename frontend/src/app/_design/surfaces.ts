/**
 * Surface & heat style presets.
 *
 * The MLB components repeat the same `linear-gradient / border / box-shadow`
 * blocks inline in dozens of places (see `batter-detail-page.tsx`,
 * `batter-card.tsx`, `batter-filter-bar.tsx`). This captures those exact recipes
 * as named objects you spread into a `style={}` prop, so every surface across
 * sports is identical. Import from `_design`.
 */
import type { CSSProperties } from "react";
import { intentRGB, type Intent } from "./tokens";

/**
 * Card surface recipes. Spread into `style={}` alongside a rounded-* class:
 *   <div className="rounded-xl p-4" style={CARD.elevated}>
 */
export const CARD: Record<"elevated" | "simple" | "filterBar" | "panel", CSSProperties> = {
  // The main content card (gradient + top highlight + drop shadow).
  elevated: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow:
      "inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.3), 0 4px 10px -2px rgba(0,0,0,0.5)",
  },
  // Small flat stat card.
  simple: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.03)",
  },
  // Filter / control bar (stronger border than a content card).
  filterBar: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  // Collapsible / secondary panel (the <details> wrappers).
  panel: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
};

/**
 * Heat coloring for stat pills / dynamic backgrounds.
 *   level 0 = flat/neutral, 1 = warm, 2 = hot.
 * Returns a bg + border tuned per intent, matching the app's
 * `rgba(...,0.22)` fill / `+0.2` border convention.
 */
export function heat(intent: Intent, level: 0 | 1 | 2): CSSProperties {
  if (level === 0) {
    return {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
    };
  }
  const rgb = intentRGB[intent];
  const bgAlpha = level === 2 ? 0.22 : 0.1;
  const bdAlpha = level === 2 ? 0.45 : 0.25;
  return {
    background: `rgba(${rgb},${bgAlpha})`,
    border: `1px solid rgba(${rgb},${bdAlpha})`,
  };
}

/**
 * Map a numeric value to a heat level given [low, high] thresholds.
 * value >= high → 2 (hot), >= low → 1 (warm), else 0. `invert` flips it for
 * "lower is better" stats (e.g. a defense rank, or GB% in MLB).
 */
export function heatLevel(
  value: number | null | undefined,
  low: number,
  high: number,
  invert = false,
): 0 | 1 | 2 {
  if (value == null) return 0;
  const hot = invert ? value <= low : value >= high;
  const warm = invert ? value <= high : value >= low;
  return hot ? 2 : warm ? 1 : 0;
}
