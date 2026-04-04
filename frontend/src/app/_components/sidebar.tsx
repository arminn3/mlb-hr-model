"use client";

export type Page = "rankings" | "slate" | "environment" | "projections" | "slips" | "bvp" | "gems" | "results" | "methodology";

const NAV_ITEMS: { key: Page; label: string; icon: string }[] = [
  { key: "rankings", label: "HR Rankings", icon: "chart" },
  { key: "slate", label: "Game Slate", icon: "games" },
  { key: "projections", label: "Projections", icon: "target" },
  { key: "environment", label: "Environment", icon: "cloud" },
  { key: "slips", label: "Slip Generator", icon: "slip" },
  { key: "bvp", label: "Batter vs Pitcher", icon: "bvp" },
  { key: "gems", label: "Gem Finder", icon: "gem" },
  { key: "results", label: "Results Log", icon: "check" },
  { key: "methodology", label: "How It Works", icon: "info" },
];

function Icon({ name }: { name: string }) {
  if (name === "chart")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h2v8H3zM9 9h2v12H9zM15 5h2v16h-2zM21 1h2v20h-2z" />
      </svg>
    );
  if (name === "games")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  if (name === "target")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
      </svg>
    );
  if (name === "gem")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l3.5 7L12 7l3.5 3L19 3M5 3l7 18 7-18" />
      </svg>
    );
  if (name === "bvp")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    );
  if (name === "slip")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    );
  if (name === "info")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  if (name === "check")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  if (name === "cloud")
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
    );
  return null;
}

function NavButton({ item, active, onChange }: {
  item: { key: Page; label: string; icon: string };
  active: Page;
  onChange: (page: Page) => void;
}) {
  return (
    <button
      onClick={() => onChange(item.key)}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
        active === item.key
          ? "bg-accent/10 text-accent font-medium border border-accent/20"
          : "text-muted hover:text-foreground hover:bg-card/50"
      }`}
    >
      <Icon name={item.icon} />
      {item.label}
    </button>
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
    <aside className="w-56 flex-shrink-0 border-r border-card-border h-screen sticky top-0 flex flex-col bg-card/30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-card-border">
        <span className="text-lg font-bold text-foreground tracking-tight">
          HR Model
        </span>
        <span className="text-xs text-muted block mt-0.5">MLB Prop Analysis</span>
      </div>

      {/* Nav groups */}
      <div className="px-3 py-4 flex-1 overflow-y-auto">
        {/* Analysis */}
        <span className="text-[10px] uppercase tracking-wider text-muted px-2 mb-2 block">
          Analysis
        </span>
        <div className="space-y-1 mb-5">
          {(["rankings", "slate", "gems", "projections", "environment"] as const).map((key) => {
            const item = NAV_ITEMS.find(n => n.key === key)!;
            return <NavButton key={key} item={item} active={active} onChange={onChange} />;
          })}
        </div>

        {/* Research */}
        <span className="text-[10px] uppercase tracking-wider text-muted px-2 mb-2 block">
          Research
        </span>
        <div className="space-y-1 mb-5">
          {(["bvp"] as const).map((key) => {
            const item = NAV_ITEMS.find(n => n.key === key)!;
            return <NavButton key={key} item={item} active={active} onChange={onChange} />;
          })}
        </div>

        {/* Tools */}
        <span className="text-[10px] uppercase tracking-wider text-muted px-2 mb-2 block">
          Tools
        </span>
        <div className="space-y-1 mb-5">
          {(["slips", "results"] as const).map((key) => {
            const item = NAV_ITEMS.find(n => n.key === key)!;
            return <NavButton key={key} item={item} active={active} onChange={onChange} />;
          })}
        </div>
      </div>

      {/* How It Works — pinned to bottom */}
      <div className="px-3 pb-3">
        <NavButton
          item={NAV_ITEMS.find(n => n.key === "methodology")!}
          active={active}
          onChange={onChange}
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-card-border text-[10px] text-muted">
        Data: Baseball Savant, Open-Meteo
      </div>
    </aside>
  );
}
