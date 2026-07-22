/**
 * Design tokens — the JS-side single source of truth for styling.
 *
 * These mirror the CSS custom properties in `src/app/globals.css`. Import from
 * here (or from `_design`) instead of hardcoding hex/rgba values inline. See
 * `frontend/DESIGN_SYSTEM.md` for the rules. NFL code MUST use these; nothing
 * should invent its own colors.
 */

/** Core intent colors (== --foreground / --accent* / --muted in globals.css). */
export const color = {
  background: "#141414",
  foreground: "#e4e4e7",
  card: "#1c1c1e",
  cardBorder: "#2c2c2e",
  accent: "#60a5fa", // primary blue
  green: "#4ade80", // positive / good
  yellow: "#fbbf24", // caution / medium
  red: "#f87171", // negative / bad
  muted: "#71717a", // secondary text
} as const;

/** Surface elevation scale (== --surface-* in globals.css). */
export const surface = {
  s1: "#1c1c1e", // base card (== color.card)
  s2: "#232326", // raised / hover
  s3: "#2a2a2e", // popover / dropdown
  sunken: "#161618", // filter-bar trough / pressed
} as const;

export const border = {
  subtle: "#2c2c2e", // == color.cardBorder
  strong: "#3a3a3e",
} as const;

export const radius = { sm: "4px", md: "8px", lg: "12px", xl: "16px" } as const;

export const shadow = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.4)",
  md: "0 4px 12px rgba(0, 0, 0, 0.35)",
  lg: "0 12px 32px rgba(0, 0, 0, 0.45)",
} as const;

export const motion = {
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  fast: "120ms",
  base: "200ms",
} as const;

/**
 * RGB triples for the intent colors — for helpers that need to compose an alpha
 * (heat pills, dynamic backgrounds) where a hex won't do.
 */
export const intentRGB = {
  green: "74,222,128",
  yellow: "251,191,36",
  red: "248,113,113",
  blue: "96,165,250",
  neutral: "255,255,255",
} as const;
export type Intent = keyof typeof intentRGB;

/**
 * Typography presets as Tailwind class strings — the locked 6-step scale from
 * globals.css. Use `type.title` etc. so headings/labels stay consistent instead
 * of re-picking `text-[Npx]` per component.
 */
export const type = {
  display: "text-[24px] leading-[32px] font-semibold tracking-[-0.01em]",
  title: "text-[18px] leading-[24px] font-semibold tracking-[-0.005em]",
  body: "text-[14px] leading-[20px]",
  label: "text-[12px] leading-[16px] font-medium tracking-[0.01em]",
  caption: "text-[11px] leading-[14px] font-medium tracking-[0.02em]",
  micro: "text-[10px] leading-[12px] font-semibold tracking-[0.04em] uppercase",
} as const;
