export function RatingBadge({ composite }: { composite: number }) {
  let label: string;
  let classes: string;

  if (composite >= 0.50) {
    label = "Ideal";
    classes = "bg-accent-green/15 text-accent-green";
  } else if (composite >= 0.35) {
    label = "Favorable";
    classes = "bg-accent/15 text-accent";
  } else if (composite >= 0.20) {
    label = "Average";
    classes = "bg-accent-yellow/15 text-accent-yellow";
  } else {
    label = "Difficult";
    classes = "bg-accent-red/15 text-accent-red";
  }

  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${classes}`}>
      {label}
    </span>
  );
}
