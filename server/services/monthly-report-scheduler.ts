/**
 * Monthly Report Auto-Generation Scheduler
 *
 * Uses setInterval (matching existing codebase pattern) to auto-generate
 * draft reports on the 1st of each month for the previous month.
 */

import { db } from "../db";
import { monthlyReportSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generatePmReportData } from "./pm-monthly-report-service";
import { generateEngineeringReportData } from "./engineering-monthly-report-service";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckedDate = "";
let isRunning = false;

function getPreviousMonth(): string {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-indexed (Jan=0), so value IS previous month in 1-indexed
  if (month === 0) {
    month = 12;
    year--;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isFirstOfMonth(): boolean {
  return new Date().getDate() === 1;
}

async function generateMonthlyReport(reportType: "pm" | "engineering", month: string): Promise<boolean> {
  // Check if a report already exists for this month+type
  const [existing] = await db.select().from(monthlyReportSnapshots)
    .where(and(eq(monthlyReportSnapshots.reportType, reportType), eq(monthlyReportSnapshots.reportMonth, month)))
    .limit(1);

  if (existing) {
    console.log(`[Monthly Report Scheduler] ${reportType} report for ${month} already exists (status: ${existing.status}), skipping`);
    return false;
  }

  const data = reportType === "pm"
    ? await generatePmReportData(month)
    : await generateEngineeringReportData(month);

  try {
    await db.insert(monthlyReportSnapshots).values({
      reportType,
      reportMonth: month,
      status: "draft",
      data,
      generatedAt: new Date(),
    });
  } catch (err: any) {
    // Handle unique constraint violation (race condition — another instance already created it)
    if (err.message?.includes("unique") || err.message?.includes("duplicate") || err.code === "23505") {
      console.log(`[Monthly Report Scheduler] ${reportType} report for ${month} was created by another instance, skipping`);
      return false;
    }
    throw err;
  }

  console.log(`[Monthly Report Scheduler] Auto-generated ${reportType} draft report for ${month}`);
  return true;
}

export function startMonthlyReportScheduler(): void {
  if (schedulerInterval) return;

  console.log("[Monthly Report Scheduler] Starting scheduler (checks every hour)");

  // Check every hour if it's the 1st of the month
  schedulerInterval = setInterval(async () => {
    if (isRunning) return;

    const today = new Date().toISOString().slice(0, 10);

    // Only run once per day
    if (today === lastCheckedDate) return;

    if (!isFirstOfMonth()) return;

    lastCheckedDate = today;
    isRunning = true;
    const previousMonth = getPreviousMonth();

    console.log(`[Monthly Report Scheduler] 1st of month detected. Generating reports for ${previousMonth}...`);

    try {
      await generateMonthlyReport("pm", previousMonth);
    } catch (err: any) {
      console.error(`[Monthly Report Scheduler] Failed to generate PM report for ${previousMonth}:`, err.message);
    }

    try {
      await generateMonthlyReport("engineering", previousMonth);
    } catch (err: any) {
      console.error(`[Monthly Report Scheduler] Failed to generate Engineering report for ${previousMonth}:`, err.message);
    }

    isRunning = false;
  }, 60 * 60 * 1000); // Check every hour
}

export function stopMonthlyReportScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Monthly Report Scheduler] Stopped");
  }
}
