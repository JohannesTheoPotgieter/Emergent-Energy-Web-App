import ExcelJS from "exceljs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import * as schema from "../shared/schema";
import * as fs from "fs";
import * as path from "path";

const EXCEL_PATH = path.join(process.cwd(), "data", "clickup_engineering_export.xlsx");
const REPORT_JSON_PATH = path.join(process.cwd(), "data", "migration_report_engineering.json");
const REPORT_CSV_PATH = path.join(process.cwd(), "data", "migration_report_engineering.csv");

const EPM_USER_ID = 5;

const VALID_STATUSES = new Set(schema.TASK_STATUSES);

const STATUS_MAP: Record<string, string> = {
  "NEEDS APROVAL": "NEEDS APPROVAL",
  "OPERATIONAL SITES": "IN PROGRESS",
};

function mapStatus(raw: string): { mapped: string; warning?: string } {
  const trimmed = (raw || "").trim().toUpperCase();
  if (STATUS_MAP[trimmed]) {
    return { mapped: STATUS_MAP[trimmed] };
  }
  if (VALID_STATUSES.has(trimmed as any)) {
    return { mapped: trimmed };
  }
  return { mapped: "TO DO", warning: `Unknown status "${raw}" → defaulted to "TO DO"` };
}

function mapPriority(raw: string): string {
  const val = (raw || "").trim().toLowerCase();
  const map: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", med: "Medium", normal: "Medium", low: "Low", critical: "Critical" };
  return map[val] || "Medium";
}

function parseDate(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseTimestamp(raw: any): Date | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d;
}

function cellVal(row: ExcelJS.Row, col: number): string {
  const cell = row.getCell(col);
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "object" && "richText" in (cell.value as any)) {
    return ((cell.value as any).richText || []).map((r: any) => r.text || "").join("");
  }
  return String(cell.value).trim();
}

function normalizeProjectName(name: string): string {
  return name.replace(/[_\-\s]+/g, " ").trim().toLowerCase();
}

function deriveProjectFromTaskName(taskName: string): string {
  const parts = taskName.split(" - ");
  return parts[0].trim();
}

async function main() {
  console.log("[Migration] Starting ClickUp Engineering migration...");

  if (!process.env.DATABASE_URL) {
    console.error("[Migration] FATAL: DATABASE_URL not set");
    process.exit(1);
  }

  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`[Migration] FATAL: Excel file not found at ${EXCEL_PATH}`);
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });

  const db = drizzle(pool, { schema });

  const existingProjects = await db.select().from(schema.projectInfo);
  const projectLookup = new Map<string, string>();
  for (const p of existingProjects) {
    projectLookup.set(normalizeProjectName(p.projectName), p.projectName);
  }
  console.log(`[Migration] Loaded ${existingProjects.length} existing projects for matching`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const ws = wb.getWorksheet("Tasks");
  if (!ws) {
    console.error("[Migration] FATAL: Sheet 'Tasks' not found");
    await pool.end();
    process.exit(1);
  }

  const totals = { rows_parsed: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  const statusSummary: Record<string, number> = {};
  const unmappedAssignees = new Set<string>();
  const taskDetails: any[] = [];

  const rowCount = ws.rowCount || 0;
  console.log(`[Migration] Processing ${rowCount - 4} data rows...`);

  for (let rowNum = 5; rowNum <= rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const taskId = cellVal(row, 2);
    const statusRaw = cellVal(row, 4);

    if (!taskId || statusRaw === "Status") {
      totals.skipped++;
      continue;
    }

    totals.rows_parsed++;

    try {
      const taskType = cellVal(row, 1);
      const taskName = cellVal(row, 3);
      const taskContent = cellVal(row, 5);
      const assigneeRaw = cellVal(row, 6);
      const priorityRaw = cellVal(row, 7);
      const latestComment = cellVal(row, 8);
      const commentCountRaw = cellVal(row, 9);
      const dueDateRaw = cellVal(row, 11);
      const startDateRaw = cellVal(row, 12);
      const dateCreatedRaw = cellVal(row, 13);
      const dateUpdatedRaw = cellVal(row, 14);
      const subtaskIds = cellVal(row, 21);
      const subtaskUrls = cellVal(row, 22);
      const siteLabel = cellVal(row, 38);
      const summaryText = cellVal(row, 40);
      const trackingRag = cellVal(row, 41);

      const { mapped: status, warning: statusWarning } = mapStatus(statusRaw);
      statusSummary[statusRaw] = (statusSummary[statusRaw] || 0) + 1;
      if (statusWarning) console.warn(`[Migration] Row ${rowNum}: ${statusWarning}`);

      const assignees = assigneeRaw
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      let ownerUserId = EPM_USER_ID;
      const watchers: string[] = [];
      for (const a of assignees) {
        unmappedAssignees.add(a);
      }
      if (assignees.length > 1) {
        for (let i = 1; i < assignees.length; i++) {
          watchers.push(assignees[i]);
        }
      }
      if (assignees.length > 0) {
        console.warn(`[Migration] Row ${rowNum}: Assignee "${assignees[0]}" not matched to DB user, defaulting to EPM (id=${EPM_USER_ID})`);
      }

      let projectName = siteLabel;
      if (!projectName) {
        projectName = deriveProjectFromTaskName(taskName);
      }
      const normalizedProject = normalizeProjectName(projectName);
      const matchedProject = projectLookup.get(normalizedProject);
      if (matchedProject) {
        projectName = matchedProject;
      }

      const priority = mapPriority(priorityRaw);
      const dueDate = parseDate(dueDateRaw);
      const startDate = parseDate(startDateRaw);
      const commentCount = commentCountRaw ? parseInt(commentCountRaw, 10) || null : null;
      const taskTypeTag = taskType.toUpperCase() === "PROJECT" ? "PROJECT" : "TASK";

      const taskData: any = {
        projectName,
        title: taskName,
        description: taskContent || null,
        status,
        priority,
        ownerUserId,
        assignees: assignees.length > 0 ? assignees : null,
        watchers: watchers.length > 0 ? watchers : null,
        dueDate,
        startDate,
        externalSource: "clickup",
        externalTaskId: taskId,
        externalSubtaskIds: subtaskIds || null,
        externalSubtaskUrls: subtaskUrls || null,
        trackingRag: trackingRag || null,
        summaryText: summaryText || null,
        importedCommentCount: commentCount,
        taskTypeTag,
      };

      const createdTs = parseTimestamp(dateCreatedRaw);
      const updatedTs = parseTimestamp(dateUpdatedRaw);
      if (createdTs) taskData.createdAt = createdTs;
      if (updatedTs) taskData.updatedAt = updatedTs;

      const existing = await db
        .select()
        .from(schema.operationalTasks)
        .where(
          and(
            eq(schema.operationalTasks.externalSource, "clickup"),
            eq(schema.operationalTasks.externalTaskId, taskId)
          )
        )
        .limit(1);

      let insertedId: number;
      let action: string;

      if (existing.length > 0) {
        insertedId = existing[0].id;
        const { createdAt, ...updateData } = taskData;
        await db
          .update(schema.operationalTasks)
          .set(updateData)
          .where(eq(schema.operationalTasks.id, insertedId));
        totals.updated++;
        action = "updated";
      } else {
        const [inserted] = await db
          .insert(schema.operationalTasks)
          .values(taskData)
          .returning({ id: schema.operationalTasks.id });
        insertedId = inserted.id;
        totals.created++;
        action = "created";
      }

      if (latestComment) {
        const commentBody = `[Imported from ClickUp] ${latestComment}`;
        const existingComments = await db
          .select()
          .from(schema.taskComments)
          .where(eq(schema.taskComments.workItemId, insertedId));

        const alreadyImported = existingComments.some((c) => c.body.startsWith("[Imported from ClickUp]"));
        if (!alreadyImported) {
          await db.insert(schema.taskComments).values({
            workItemId: insertedId,
            authorId: null,
            body: commentBody,
          });
        }
      }

      taskDetails.push({
        row: rowNum,
        action,
        external_task_id: taskId,
        title: taskName,
        project: projectName,
        status,
        status_raw: statusRaw,
        assignee_raw: assigneeRaw,
        owner_user_id: ownerUserId,
        priority,
        due_date: dueDate,
        start_date: startDate,
        tracking_rag: trackingRag,
        task_type: taskTypeTag,
      });
    } catch (err: any) {
      totals.errors++;
      console.error(`[Migration] Row ${rowNum} ERROR: ${err.message}`);
      taskDetails.push({
        row: rowNum,
        action: "error",
        external_task_id: taskId,
        error: err.message,
      });
    }
  }

  const report = {
    migration: "clickup-engineering",
    timestamp: new Date().toISOString(),
    totals,
    status_mapping: statusSummary,
    assignee_mapping: {
      default_user_id: EPM_USER_ID,
      unmapped: Array.from(unmappedAssignees),
    },
    tasks: taskDetails,
  };

  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  console.log(`[Migration] JSON report written to ${REPORT_JSON_PATH}`);

  const csvHeaders = [
    "row", "action", "external_task_id", "title", "project",
    "status", "status_raw", "assignee_raw", "owner_user_id",
    "priority", "due_date", "start_date", "tracking_rag", "task_type", "error",
  ];
  const csvLines = [csvHeaders.join(",")];
  for (const t of taskDetails) {
    const line = csvHeaders.map((h) => {
      const val = t[h] ?? "";
      const s = String(val).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    });
    csvLines.push(line.join(","));
  }
  fs.writeFileSync(REPORT_CSV_PATH, csvLines.join("\n"));
  console.log(`[Migration] CSV report written to ${REPORT_CSV_PATH}`);

  console.log("\n[Migration] === SUMMARY ===");
  console.log(`  Rows parsed: ${totals.rows_parsed}`);
  console.log(`  Created:     ${totals.created}`);
  console.log(`  Updated:     ${totals.updated}`);
  console.log(`  Skipped:     ${totals.skipped}`);
  console.log(`  Errors:      ${totals.errors}`);
  console.log(`  Unmapped assignees: ${Array.from(unmappedAssignees).join(", ")}`);

  await pool.end();

  if (totals.errors > 0) {
    console.warn(`[Migration] Completed with ${totals.errors} errors`);
  } else {
    console.log("[Migration] Completed successfully!");
  }
}

main().catch((err) => {
  console.error("[Migration] FATAL:", err);
  process.exit(1);
});
