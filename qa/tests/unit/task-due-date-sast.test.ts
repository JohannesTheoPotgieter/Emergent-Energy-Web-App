import { describe, it, expect } from "vitest";
import { isOverdue, isDueThisWeek } from "@/lib/task-formatters";

/**
 * Batch 7 — overdue/due-soon compares DATE-ONLY in SAST, so a task due today is
 * never flagged overdue regardless of the current SAST time-of-day. (Before the
 * fix, `new Date("YYYY-MM-DD") < new Date()` treated a same-day due date as
 * overdue any time after 02:00 SAST — the UTC-midnight off-by-one.)
 */
const SAST_TZ = "Africa/Johannesburg";
const todaySAST = new Date().toLocaleDateString("en-CA", { timeZone: SAST_TZ });
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

describe("isOverdue — SAST date-only", () => {
  it("a task due TODAY is not overdue", () => {
    expect(isOverdue(todaySAST, "in_progress")).toBe(false);
  });
  it("a task due tomorrow is not overdue", () => {
    expect(isOverdue(addDays(todaySAST, 1), "in_progress")).toBe(false);
  });
  it("a task due in the past is overdue", () => {
    expect(isOverdue(addDays(todaySAST, -1), "in_progress")).toBe(true);
    expect(isOverdue("2020-01-01", "in_progress")).toBe(true);
  });
  it("a completed task is never overdue", () => {
    expect(isOverdue("2020-01-01", "complete")).toBe(false);
  });
});

describe("isDueThisWeek — SAST date-only", () => {
  it("includes today and the next 7 days", () => {
    expect(isDueThisWeek(todaySAST, "in_progress")).toBe(true);
    expect(isDueThisWeek(addDays(todaySAST, 6), "in_progress")).toBe(true);
  });
  it("excludes a date more than 7 days out and past dates", () => {
    expect(isDueThisWeek(addDays(todaySAST, 30), "in_progress")).toBe(false);
    expect(isDueThisWeek(addDays(todaySAST, -1), "in_progress")).toBe(false);
  });
});
