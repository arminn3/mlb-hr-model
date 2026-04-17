/**
 * Design token exports for TS consumers. Mirrors the CSS variables in
 * globals.css — use these for:
 *   - Inline styles where a Tailwind utility can't reach (dynamic values)
 *   - Computed colors for the non-table-styles tables (e.g. Figma bg
 *     colors must be inlined because Tailwind opacity is not applied)
 *
 * DO NOT duplicate values — always reference these consts instead of
 * hardcoding a hex or a px number.
 */

export const surfaces = {
  base: "var(--surface-1)",
  raised: "var(--surface-2)",
  floating: "var(--surface-3)",
  sunken: "var(--surface-sunken)",
} as const;

export const borders = {
  subtle: "var(--border-subtle)",
  strong: "var(--border-strong)",
} as const;

export const radii = {
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  xl: "var(--radius-xl)",
} as const;

export const shadows = {
  sm: "var(--shadow-sm)",
  md: "var(--shadow-md)",
  lg: "var(--shadow-lg)",
} as const;

export const motion = {
  easeOut: "var(--ease-out)",
  fast: "var(--duration-fast)",
  base: "var(--duration-base)",
} as const;

/** Semantic color tokens (existing globals). */
export const colors = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  muted: "var(--muted)",
  accent: "var(--accent)",
  accentGreen: "var(--accent-green)",
  accentYellow: "var(--accent-yellow)",
  accentRed: "var(--accent-red)",
} as const;
