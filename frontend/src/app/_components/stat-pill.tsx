export function StatPill({
  label,
  value,
  unit = "",
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 bg-card rounded-lg border border-card-border">
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className="text-sm font-mono font-semibold text-foreground">
        {value}
        {unit && <span className="text-muted text-xs ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}
