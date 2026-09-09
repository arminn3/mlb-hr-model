"use client";

// Small pill-button toggle group — shared by Matchup Factors and Touchdowns
// (year / depth / per-game-totals selectors), so they all look identical.
export function Toggle<T extends string>({ options, value, onChange }: {
  options: readonly T[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className="px-2.5 py-1 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors"
          style={value === opt
            ? { background: "#1e2444", border: "1px solid #3a54d5", color: "#fff" }
            : { background: "transparent", border: "1px solid #343434", color: "#ccc" }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function sortedYears(keys: string[]): string[] {
  return [...keys].sort((a, b) => Number(b) - Number(a));
}
