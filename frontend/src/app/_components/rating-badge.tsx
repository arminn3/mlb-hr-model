import { Tooltip } from "./tooltip";

export function RatingBadge({ composite }: { composite: number }) {
  let label: string;
  let classes: string;
  let tip: string;

  if (composite >= 0.50) {
    label = "Ideal";
    classes = "bg-accent-green/15 text-accent-green";
    tip = "Strong HR candidate — elite matchup and metrics";
  } else if (composite >= 0.35) {
    label = "Favorable";
    classes = "bg-accent/15 text-accent";
    tip = "Good HR potential — above-average matchup";
  } else if (composite >= 0.20) {
    label = "Average";
    classes = "bg-accent-yellow/15 text-accent-yellow";
    tip = "Moderate HR chance — no standout advantage";
  } else {
    label = "Difficult";
    classes = "bg-accent-red/15 text-accent-red";
    tip = "Low HR probability — unfavorable matchup";
  }

  return (
    <Tooltip text={tip}>
      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${classes}`}>
        {label}
      </span>
    </Tooltip>
  );
}
