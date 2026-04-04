export function RatingBadge({ composite }: { composite: number }) {
  let label: string;
  let classes: string;
  let tooltip: string;

  if (composite >= 0.50) {
    label = "Ideal";
    classes = "bg-accent-green/15 text-accent-green";
    tooltip = "Strong HR candidate — elite matchup with high recent performance and favorable conditions.";
  } else if (composite >= 0.35) {
    label = "Favorable";
    classes = "bg-accent/15 text-accent";
    tooltip = "Good HR potential — solid matchup with above-average metrics in most categories.";
  } else if (composite >= 0.20) {
    label = "Average";
    classes = "bg-accent-yellow/15 text-accent-yellow";
    tooltip = "Moderate HR chance — some positive signals but no standout matchup advantage.";
  } else {
    label = "Difficult";
    classes = "bg-accent-red/15 text-accent-red";
    tooltip = "Low HR probability — unfavorable matchup, weak recent metrics, or tough conditions.";
  }

  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded cursor-help ${classes}`} title={tooltip}>
      {label}
    </span>
  );
}
