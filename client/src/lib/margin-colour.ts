export function getMarginColour(marginPercent: number): string {
  if (marginPercent > 20) {
    return "bg-green-50 dark:bg-green-950/20";
  }

  if (marginPercent >= 10) {
    return "bg-amber-50 dark:bg-amber-950/20";
  }

  return "bg-red-50 dark:bg-red-950/20";
}
