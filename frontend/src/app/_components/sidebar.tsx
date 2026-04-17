"use client";

import { Icon, type IconName } from "./icon";

export type Page =
  | "rankings"
  | "ml"
  | "slate"
  | "environment"
  | "projections"
  | "slips"
  | "bvp"
  | "gems"
  | "live"
  | "results"
  | "methodology"
  | "matchup";

interface NavItem {
  key: Page;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { key: "rankings", label: "HR Rankings", icon: "chart" },
  { key: "ml", label: "ML Rankings", icon: "brain" },
  { key: "slate", label: "Game Slate", icon: "games" },
  { key: "projections", label: "Projections", icon: "target" },
  { key: "environment", label: "Environment", icon: "cloud" },
  { key: "slips", label: "Slip Generator", icon: "slip" },
  { key: "bvp", label: "Batter vs Pitcher", icon: "bvp" },
  { key: "gems", label: "Gem Finder", icon: "gem" },
  { key: "live", label: "Live Feed", icon: "live" },
  { key: "results", label: "Results Log", icon: "check" },
  { key: "matchup", label: "Matchup Analysis", icon: "matchup" },
  { key: "methodology", label: "How It Works", icon: "info" },
];

function NavButton({
  item,
  active,
  onChange,
}: {
  item: NavItem;
  active: Page;
  onChange: (page: Page) => void;
}) {
  const isActive = active === item.key;
  return (
    <button
      onClick={() => onChange(item.key)}
      className={
        "relative w-full flex items-center gap-3 pl-4 pr-3 py-2 " +
        "text-[13px] font-medium rounded-[var(--radius-md)] " +
        "transition-colors duration-[var(--duration-fast)] cursor-pointer " +
        (isActive
          ? "bg-[var(--surface-2)] text-accent"
          : "text-muted hover:text-foreground hover:bg-[var(--surface-2)]")
      }
    >
      {/* 2px accent rail, only on active */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent"
        />
      )}
      <Icon name={item.icon} size={16} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/70 px-3 mb-2 block">
      {children}
    </span>
  );
}

export function Sidebar({
  active,
  onChange,
}: {
  active: Page;
  onChange: (page: Page) => void;
}) {
  return (
    <aside
      className="w-56 flex-shrink-0 h-screen sticky top-0 flex flex-col bg-background"
      style={{ borderRight: "1px solid #2c2c2e" }}
    >
      {/* Logo */}
      <div className="px-5 py-5">
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-foreground block">
          Beeb Sheets
        </span>
        <span className="text-[11px] font-medium tracking-[0.02em] text-muted block mt-0.5">
          MLB HR Prop Analysis
        </span>
      </div>

      {/* Thin divider under logo */}
      <div className="mx-5" style={{ borderBottom: "1px solid #2c2c2e" }} />

      {/* Nav groups */}
      <div className="px-3 py-4 flex-1 overflow-y-auto">
        <SectionLabel>Analysis</SectionLabel>
        <div className="space-y-1 mb-5">
          {(
            [
              "rankings",
              "ml",
              "slate",
              "matchup",
              "gems",
              "projections",
              "environment",
              "live",
            ] as const
          ).map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key)!;
            return <NavButton key={key} item={item} active={active} onChange={onChange} />;
          })}
        </div>

        <SectionLabel>Research</SectionLabel>
        <div className="space-y-1 mb-5">
          {(["bvp"] as const).map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key)!;
            return <NavButton key={key} item={item} active={active} onChange={onChange} />;
          })}
        </div>

        <SectionLabel>Tools</SectionLabel>
        <div className="space-y-1 mb-5">
          {(["slips", "results"] as const).map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key)!;
            return <NavButton key={key} item={item} active={active} onChange={onChange} />;
          })}
        </div>
      </div>

      {/* How It Works — pinned to bottom */}
      <div className="px-3 pb-3">
        <NavButton
          item={NAV_ITEMS.find((n) => n.key === "methodology")!}
          active={active}
          onChange={onChange}
        />
      </div>

      {/* Footer */}
      <div
        className="px-5 py-3 text-[10px] font-medium tracking-[0.02em] text-muted/80"
        style={{ borderTop: "1px solid #2c2c2e" }}
      >
        Data: Baseball Savant, Open-Meteo
      </div>
    </aside>
  );
}
