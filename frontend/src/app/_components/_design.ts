// ─────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — single source of truth for the dashboard's visual system.
// Rules:
//   1. Every new component imports from here. No more ad-hoc rgba() values.
//   2. Never use text-muted/<25 — it fails WCAG and is unreadable on dark bg.
//   3. Never invent font sizes below TEXT.SIZE.MICRO (10px) for any user-facing
//      text. Use only the scale below.
//   4. Modals/drawers use OVERLAY.* presets — no custom gradients.
//   5. Pills/badges use PILL.* presets — no custom px-1.5 py-0.5 inlining.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Text opacity tiers on dark background. Lower than TERTIARY is unreadable.
 * Use foreground/<n> in Tailwind so these are uniform across the app.
 */
export const TEXT = {
  /** Headline + key numbers — full white */
  PRIMARY: "text-foreground",
  /** Body copy + secondary labels — readable everywhere */
  SECONDARY: "text-foreground/80",
  /** Captions, axis labels, helper text — minimum readable */
  TERTIARY: "text-foreground/65",
  /** Inactive/disabled state — borderline, use sparingly */
  MUTED: "text-foreground/45",

  SIZE: {
    MICRO:   "text-[10px]",  // smallest allowed — captions
    CAPTION: "text-[11px]",  // table cells, secondary labels
    BODY:    "text-[12px]",  // default body
    SUBHEAD: "text-[13px]",
    HEAD:    "text-[15px]",
    DISPLAY: "text-[18px]",
  },

  WEIGHT: {
    REGULAR: "font-normal",
    MEDIUM:  "font-medium",
    BOLD:    "font-bold",
  },
} as const;

/** Background surfaces — layered cards/panels */
export const SURFACE = {
  /** Page background — handled by global bg */
  PAGE: "transparent",
  /** Card / panel — sits on PAGE */
  CARD: "rgba(255,255,255,0.04)",
  /** Card raised — interactive hover state */
  CARD_HOVER: "rgba(255,255,255,0.06)",
  /** Drawer / modal panel body */
  PANEL: "#0a0a0f",
  /** Subtle row background inside tables */
  ROW_ALT: "rgba(255,255,255,0.02)",
} as const;

export const BORDER = {
  /** Default subtle border on cards/inputs */
  DEFAULT: "1px solid rgba(255,255,255,0.10)",
  /** Even subtler — interior dividers */
  DIVIDER: "1px solid rgba(255,255,255,0.06)",
  /** Accent border — selected/active state */
  ACCENT: "1px solid rgba(34,197,94,0.40)",
} as const;

/** Pill / badge presets. Use these by spreading style={PILL.GREEN_BRIGHT}. */
export const PILL = {
  /** className shared by every pill — keeps geometry uniform */
  BASE: "inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider whitespace-nowrap",
  /** className for compact in-table pills */
  COMPACT: "inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded",
  GREEN_BRIGHT: { background: "#16a34a", color: "#fff" } as const,
  GREEN_DIM:    { background: "rgba(34,197,94,0.13)",  border: "1px solid rgba(34,197,94,0.32)",  color: "#86efac" } as const,
  YELLOW:       { background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.32)", color: "#fcd34d" } as const,
  RED:          { background: "rgba(239,68,68,0.13)",  border: "1px solid rgba(239,68,68,0.32)",  color: "#fca5a5" } as const,
  NEUTRAL:      { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" } as const,
  MUTED:        { color: "rgba(255,255,255,0.55)" } as const,
} as const;

export const OVERLAY = {
  /** Modal/drawer backdrop. No backdrop-blur (perf killer). */
  BACKDROP: "fixed inset-0 z-40 bg-black/75",
  /** Side panel (drawer) wrapper */
  PANEL_BG: SURFACE.PANEL,
  PANEL_BORDER_LEFT: "1px solid rgba(255,255,255,0.10)",
  PANEL_SHADOW: "-8px 0 24px rgba(0,0,0,0.55)",
} as const;

/** Status/intent colors — for heat scales, score gradients, etc. */
export const INTENT = {
  GREEN:  "rgb(34,197,94)",
  GREEN_BRIGHT: "rgb(74,222,128)",
  YELLOW: "rgb(251,191,36)",
  RED:    "rgb(239,68,68)",
  BLUE:   "rgb(96,165,250)",
} as const;
