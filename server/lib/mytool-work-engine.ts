export const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

export function isTaskOpen(status: string | null | undefined): boolean {
  return !status || !TERMINAL_STATUSES.has(status);
}

export function isOverdue(dueAt: string | Date | null | undefined, status: string | null | undefined, now = new Date()): boolean {
  if (!dueAt || !isTaskOpen(status)) return false;
  const dueDate = dueAt instanceof Date ? dueAt : new Date(dueAt);
  return dueDate.getTime() < now.getTime();
}

export function computeMilestoneProgress(linkedTaskStatuses: Array<string | null | undefined>): number {
  if (linkedTaskStatuses.length === 0) return 0;
  const completed = linkedTaskStatuses.filter((s) => !isTaskOpen(s)).length;
  return Math.round((completed / linkedTaskStatuses.length) * 100);
}

export function computeNextRecurrenceDate(
  currentDate: string,
  frequency: string,
  interval: number,
  daysOfWeek: string | null,
): string {
  const d = new Date(`${currentDate}T00:00:00Z`);

  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + interval);
      break;
    case "weekly": {
      const days = (daysOfWeek || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        .sort((a, b) => a - b);
      if (days.length > 0) {
        const currentDay = d.getUTCDay();
        const nextDay = days.find((day) => day > currentDay);
        if (nextDay !== undefined) {
          d.setUTCDate(d.getUTCDate() + (nextDay - currentDay));
        } else {
          d.setUTCDate(d.getUTCDate() + (7 * interval - currentDay + days[0]));
        }
      } else {
        d.setUTCDate(d.getUTCDate() + (7 * interval));
      }
      break;
    }
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
    default:
      d.setUTCDate(d.getUTCDate() + interval);
  }

  return d.toISOString().slice(0, 10);
}

export function shouldBlockTask(predecessorStatuses: Array<string | null | undefined>): boolean {
  return predecessorStatuses.some((status) => isTaskOpen(status));
}

export function validateDependencyPair(predecessorTaskId: number, successorTaskId: number): string | null {
  if (predecessorTaskId === successorTaskId) return "A task cannot depend on itself";
  return null;
}
