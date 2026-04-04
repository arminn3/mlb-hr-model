"use client";

export type Page = "rankings" | "slate" | "environment" | "projections" | "results";

const NAV_ITEMS: { key: Page; label: string; icon: string }[] = [
  { key: "rankings", label: "HR Rankings", icon: "chart" },
  { key: "slate", label: "Game Slate", icon: "games" },
  { key: "projections", label: "Projections", icon: "target" },
  { key: "environment", label: "Environment", icon: "cloud" },
  { key: "results", label: "Results Log", icon: "check" },
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

      {/* Nav items */}
      <div className="px-3 py-4 flex-1">
        <span className="text-[10px] uppercase tracking-wider text-muted px-2 mb-2 block">
          Tools
        </span>
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg cursor-pointer transition-colors ${
                active === item.key
                  ? "bg-accent/10 text-accent font-medium border border-accent/20"
                  : "text-muted hover:text-foreground hover:bg-card/50"
              }`}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-card-border text-[10px] text-muted">
        Data: Baseball Savant, Open-Meteo
      </div>
    </aside>
  );
}
