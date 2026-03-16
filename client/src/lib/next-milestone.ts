export interface NextMilestoneSummary {
  name: string;
  date: string | null;
  allPaid: boolean;
}

type NextMilestoneDisplayOptions = {
  fallbackLabel?: string;
  truncateAt?: number;
};

export function isNextMilestoneSummary(value: unknown): value is NextMilestoneSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NextMilestoneSummary>;
  const hasValidName = typeof candidate.name === "string";
  const hasValidDate = typeof candidate.date === "string" || candidate.date === null;
  const hasValidAllPaid = typeof candidate.allPaid === "boolean";
  return hasValidName && hasValidDate && hasValidAllPaid;
}

export function formatNextMilestoneSummary(
  value: unknown,
  options: NextMilestoneDisplayOptions = {},
): { label: string; dateLabel: string | null; allPaid: boolean } {
  const { fallbackLabel = "—", truncateAt } = options;

  if (value == null) {
    return { label: fallbackLabel, dateLabel: null, allPaid: false };
  }

  if (!isNextMilestoneSummary(value)) {
    return { label: "Milestone unavailable", dateLabel: null, allPaid: false };
  }

  const name = value.name.trim() || "Revenue Milestone";
  const baseLabel = value.allPaid ? "All Paid ✓" : name;
  const label = truncateAt && baseLabel.length > truncateAt ? `${baseLabel.slice(0, truncateAt)}…` : baseLabel;

  let dateLabel: string | null = null;
  if (!value.allPaid && value.date) {
    const parsedDate = new Date(value.date);
    if (!Number.isNaN(parsedDate.getTime())) {
      dateLabel = parsedDate.toLocaleDateString("en-ZA", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }

  return {
    label,
    dateLabel,
    allPaid: value.allPaid,
  };
}

