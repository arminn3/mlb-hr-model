"use client";

import { PanelLeft } from "lucide-react";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./ui/icon-button";

export type Page =
  | "rankings"
  | "ml"
  | "slate"
  | "environment"
  | "projections"
  | "slips"
  | "bvp"
  | "team_pitch_mix"
  | "breakouts"
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
  { key: "team_pitch_mix", label: "Team vs Pitch Mix", icon: "matchup" },
  { key: "breakouts", label: "Breakouts & Regression", icon: "gem" },
  { key: "live", label: "Live Feed", icon: "live" },
  { key: "results", label: "Results Log", icon: "check" },
  { key: "matchup", label: "Matchup Analysis", icon: "matchup" },
  { key: "methodology", label: "How It Works", icon: "info" },
];

function NavButton({
  item,
  active,
  collapsed,
  onChange,
}: {
  item: NavItem;
  active: Page;
  collapsed: boolean;
  onChange: (page: Page) => void;
}) {
  const isActive = active === item.key;
  return (
    <div className="relative group">
      <button
        onClick={() => onChange(item.key)}
        aria-label={item.label}
        className={
          (collapsed
            ? "w-full flex items-center justify-center h-9 "
            : "w-full flex items-center gap-3 px-3 py-2 ") +
          "text-[13px] font-medium rounded-[var(--radius-md)] border " +
          "transition-colors duration-[var(--duration-fast)] cursor-pointer " +
          (isActive
            ? "bg-accent/10 border-accent/30 text-accent"
            : "bg-transparent border-transparent text-muted hover:text-foreground hover:bg-[var(--surface-2)]")
        }
      >
        <Icon name={item.icon} size={16} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </button>
      {collapsed && (
        // Custom tooltip — shows instantly on hover (no native title delay).
        // Absolute positioned to the right of the collapsed icon.
        <span
          className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-75
            absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 whitespace-nowrap
            px-2 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium
            bg-[var(--surface-3,#2a2a2e)] text-foreground border border-[#3a3a3e] shadow-md"
          role="tooltip"
        >
          {item.label}
        </span>
      )}
    </div>
  );
}

function SectionLabel({
  children,
  collapsed,
}: {
  children: React.ReactNode;
  collapsed: boolean;
}) {
  if (collapsed) {
    return <div className="h-px mx-2 mb-2 bg-[var(--border-subtle,#2c2c2e)]" />;
  }
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/70 px-3 mb-2 block">
      {children}
    </span>
  );
}

export function Sidebar({
  active,
  collapsed = false,
  onChange,
  onToggleCollapse,
}: {
  active: Page;
  collapsed?: boolean;
  onChange: (page: Page) => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <aside
      className={
        (collapsed ? "w-14" : "w-56") +
        " flex-shrink-0 h-screen sticky top-0 flex flex-col " +
        "transition-[width] duration-[var(--duration-base)]"
      }
      style={{ background: "#1c1c1e", borderRight: "1px solid #2c2c2e" }}
    >
      {/* Logo + collapse toggle — height matches the page header */}
      <div
        className={
          (collapsed ? "px-2 justify-center " : "px-3 md:px-4 justify-between gap-2 ") +
          "flex items-center"
        }
        style={{ height: 60 }}
      >
        {!collapsed && (
          <div className="min-w-0">
            <div
              className="font-semibold text-foreground truncate"
              style={{ fontSize: 14, lineHeight: "20px", letterSpacing: "-0.005em" }}
            >
              Beeb Sheets
            </div>
            <div
              className="font-medium text-muted truncate"
              style={{ fontSize: 11, lineHeight: "14px", letterSpacing: "0.02em" }}
            >
              MLB HR Prop Analysis
            </div>
          </div>
        )}
        {onToggleCollapse && (
          <IconButton
            icon={PanelLeft}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="flex-shrink-0"
          />
        )}
      </div>

      {/* Nav groups */}
      <div className={(collapsed ? "px-2" : "px-3") + " py-4 flex-1 overflow-y-auto overflow-x-visible"}>
        <SectionLabel collapsed={collapsed}>Analysis</SectionLabel>
        <div className="space-y-1 mb-5">
          {(
            [
              "rankings",
              "ml",
              "slate",
              "matchup",
              "breakouts",
              "projections",
              "environment",
              "live",
            ] as const
          ).map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key)!;
            return (
              <NavButton
                key={key}
                item={item}
                active={active}
                collapsed={collapsed}
                onChange={onChange}
              />
            );
          })}
        </div>

        <SectionLabel collapsed={collapsed}>Research</SectionLabel>
        <div className="space-y-1 mb-5">
          {(["bvp", "team_pitch_mix"] as const).map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key)!;
            return (
              <NavButton
                key={key}
                item={item}
                active={active}
                collapsed={collapsed}
                onChange={onChange}
              />
            );
          })}
        </div>

        <SectionLabel collapsed={collapsed}>Tools</SectionLabel>
        <div className="space-y-1 mb-5">
          {(["slips", "results"] as const).map((key) => {
            const item = NAV_ITEMS.find((n) => n.key === key)!;
            return (
              <NavButton
                key={key}
                item={item}
                active={active}
                collapsed={collapsed}
                onChange={onChange}
              />
            );
          })}
        </div>
      </div>

      {/* How It Works — pinned to bottom */}
      <div className={collapsed ? "px-2 pb-3" : "px-3 pb-3"}>
        <NavButton
          item={NAV_ITEMS.find((n) => n.key === "methodology")!}
          active={active}
          collapsed={collapsed}
          onChange={onChange}
        />
      </div>

      {/* Footer */}
      {!collapsed && (
        <div
          className="px-5 py-3 text-[10px] font-medium tracking-[0.02em] text-muted/80"
          style={{ borderTop: "1px solid #2c2c2e" }}
        >
          Data: Baseball Savant, Open-Meteo
        </div>
      )}
    </aside>
  );
}
