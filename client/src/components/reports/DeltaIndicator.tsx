interface DeltaIndicatorProps {
  value: number;
  higherIsBetter?: boolean;
  showPercent?: boolean;
}

export default function DeltaIndicator({ value, higherIsBetter = true, showPercent = false }: DeltaIndicatorProps) {
  if (value === 0) return <span className="text-slate-400">—</span>;

  const isPositive = value > 0;
  const isGood = higherIsBetter ? isPositive : !isPositive;
  const color = isGood ? "text-emerald-600" : "text-red-600";
  const arrow = isPositive ? "▲" : "▼";
  const formatted = showPercent
    ? `${Math.abs(value).toFixed(1)}%`
    : Math.abs(value).toLocaleString("en-ZA", { maximumFractionDigits: 2 });

  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {formatted}
    </span>
  );
}
