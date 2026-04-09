// Shared table styling — Figma node 1:88 design tokens.
// Used by every data table EXCEPT the HR Rankings table (top-picks.tsx),
// which intentionally keeps its existing look.

export const TABLE_BG = "#0d1116";
export const TABLE_HEADER_BG = "#1a1c24";
export const TABLE_BORDER = "#32333b";
export const TABLE_HEADER_TEXT = "#a0a1a4";

export const tableWrapperClass =
  "overflow-x-auto rounded-[12px] border";
export const tableWrapperStyle = {
  borderColor: TABLE_BORDER,
  backgroundColor: TABLE_BG,
  fontFamily: "Inter, system-ui, sans-serif",
} as const;

export const tableClass = "border-collapse w-max min-w-full";

// Cell base — applied to every body td. Numbers should keep `text-right`
// or `text-center` overrides where needed; default is left-aligned.
export const cellClass =
  "p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] text-white whitespace-nowrap border-b border-r";

export const cellStyle = { borderColor: TABLE_BORDER } as const;

// Header th base — same font, but in muted header color.
export const headerCellClass =
  "p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] text-left whitespace-nowrap border-b border-r select-none";

export const headerCellStyle = {
  backgroundColor: TABLE_HEADER_BG,
  borderColor: TABLE_BORDER,
  color: TABLE_HEADER_TEXT,
} as const;
