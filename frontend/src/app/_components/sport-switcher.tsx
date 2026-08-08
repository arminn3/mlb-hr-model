"use client";

import { color } from "../_design";

// Shared MLB <-> NFL toggle. Pure navigation glue (links between the two routes)
// so the sports feel like one platform. Deliberately shared by both dashboards;
// it carries no sport-specific logic, so it doesn't couple the two pipelines.
export function SportSwitcher({
  active,
  collapsed = false,
}: {
  active: "mlb" | "nfl";
  collapsed?: boolean;
}) {
  const items = [
    { key: "mlb", label: "MLB", href: "/dashboard" },
    { key: "nfl", label: "NFL", href: "/nfl" },
  ] as const;

  if (collapsed) {
    // Icon-strip sidebar: just link to the other sport.
    const other = active === "mlb" ? items[1] : items[0];
    return (
      <a
        href={other.href}
        title={`Switch to ${other.label}`}
        className="flex items-center justify-center w-8 h-7 rounded-md text-[11px] font-bold cursor-pointer transition-colors"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid #2c2c2e", color: color.muted }}
      >
        {other.label}
      </a>
    );
  }

  return (
    <div
      className="inline-flex rounded-lg p-0.5 gap-0.5"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid #2c2c2e" }}
    >
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
          className="px-3 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors"
          style={
            active === it.key
              ? { background: color.accent, color: "#fff" }
              : { color: color.muted }
          }
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}
