"use client";

export type Tab = "rankings" | "environment";

export function Nav({
  active,
  onChange,
  right,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  right?: React.ReactNode;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "rankings", label: "Rankings" },
    { key: "environment", label: "Environment" },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-card-border pb-3 mb-6">
      <div className="flex items-center gap-8">
        <span className="text-lg font-bold text-foreground tracking-tight">
          MLB HR Prop Model
        </span>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`px-4 py-2 text-sm cursor-pointer transition-colors border-b-2 -mb-[13px] ${
                active === t.key
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {right && <div className="flex items-center gap-4">{right}</div>}
    </nav>
  );
}
