/**
 * Excel-update-request mailer.
 *
 * Fired by `server/routes/excel-vs-app.routes.ts` when an operator
 * resolves Excel-vs-App drift on the "app value is more truth" side
 * (`keep_app` or `request_approval`). The Tracker workbook is the
 * source of truth for the company tool, so when the operator decides
 * the app value should win, the workbook must be updated to match.
 * This module asks the right humans to do that.
 *
 * Recipients (always — confirmed by user 2026-05-05):
 *   - PROGRAM_MANAGER
 *   - PROGRAM_FINANCE_MANAGER
 *   - CONSTRUCTION_MANAGER
 *
 * Channels:
 *   1. Outlook email via `server/outlook.ts:sendMail` (one combined
 *      email, all recipients in `to:`).
 *   2. In-app notification per recipient via `notification-service`
 *      so the request still surfaces when Graph is mocked or down.
 *
 * Failure mode: every send is wrapped — a Graph or DB error is
 * logged with `console.warn` and swallowed. The caller's resolve
 * action MUST NOT fail because email failed.
 */
import { db } from "../db";
import { and, inArray, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { sendMail } from "../outlook";
import { createNotification } from "./notification-service";
import type { DiffSection } from "@shared/excel-vs-app/contract";

export type ResolveAction = "keep_app" | "request_approval";
export type EmailSection = DiffSection | "MIXED";

export const EXCEL_UPDATE_RECIPIENT_ROLES = [
  "PROGRAM_MANAGER",
  "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER",
] as const;

export interface ExcelUpdateEntry {
  table: "normalized_cost_lines" | "normalized_revenue_lines" | "work_items";
  rowId: number;
  fieldName: string;
}

export interface ExcelUpdateRequestInput {
  projectId: number;
  projectName: string;
  resolveAction: ResolveAction;
  section: EmailSection;
  entries: ExcelUpdateEntry[];
  reason: string;
  requesterUserId: number | null;
  requesterName: string | null;
  requesterEmail?: string | null;
  /** Set when resolveAction is "request_approval" — the
   *  financial_edit_requests row id that was just created. */
  requestId?: number;
}

interface BuiltMail {
  subject: string;
  bodyHtml: string;
  /** Plain-text fallback also used as the in-app notification body. */
  bodyText: string;
  /** Distinct field names across all entries, capped + sorted. */
  fields: string[];
  rowCount: number;
}

/**
 * Pure body-build for unit testing. No DB / network access.
 */
export function buildExcelUpdateMail(input: {
  projectId: number;
  projectName: string;
  resolveAction: ResolveAction;
  section: EmailSection;
  entries: ExcelUpdateEntry[];
  reason: string;
  requesterName: string | null;
  baseUrl: string;
  requestId?: number;
}): BuiltMail {
  const fieldsAll = Array.from(new Set(input.entries.map(e => e.fieldName))).sort();
  const FIELD_LIST_CAP = 25;
  const fields = fieldsAll.slice(0, FIELD_LIST_CAP);
  const fieldsOverflow = Math.max(0, fieldsAll.length - fields.length);
  const rowCount = new Set(input.entries.map(e => `${e.table}|${e.rowId}`)).size;

  const sectionLabel = input.section === "MIXED" ? "multiple sections" : input.section;
  const requester = input.requesterName ?? "An operator";
  const deepLink = `${input.baseUrl.replace(/\/$/, "")}/projects/${input.projectId}/excel-vs-app`;

  const actionVerb = input.resolveAction === "keep_app"
    ? "kept the app value as truth"
    : "requested approval to keep the app value as truth";

  const subject = input.resolveAction === "keep_app"
    ? `[Action required] Update Excel for ${input.projectName} — ${input.entries.length} field(s) kept on app side`
    : `[Approval requested] Update Excel for ${input.projectName} — ${input.entries.length} field(s) pending`;

  const fieldsHtml = fields.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join("");
  const overflowHtml = fieldsOverflow > 0 ? `<li>… and ${fieldsOverflow} more</li>` : "";
  const requestIdLine = input.requestId != null
    ? `<p><strong>Approval request id:</strong> ${input.requestId}</p>`
    : "";

  const bodyHtml = `
<p>${escapeHtml(requester)} has ${escapeHtml(actionVerb)} on
<strong>${escapeHtml(input.projectName)}</strong>
in the <strong>${escapeHtml(sectionLabel)}</strong> section.</p>
<p>The Tracker workbook is the source of truth for the company tool, so the
Excel must now be updated to match the app value for these fields.</p>
<p><strong>Project:</strong> ${escapeHtml(input.projectName)}<br/>
<strong>Section:</strong> ${escapeHtml(sectionLabel)}<br/>
<strong>Field count:</strong> ${input.entries.length} field(s) across ${rowCount} row(s)<br/>
<strong>Reason:</strong> ${escapeHtml(input.reason)}</p>
${requestIdLine}
<p><strong>Fields:</strong></p>
<ul>${fieldsHtml}${overflowHtml}</ul>
<p>Open the diff page to see Excel vs app values:
<a href="${escapeAttr(deepLink)}">${escapeHtml(deepLink)}</a></p>
<hr/>
<p style="color:#6b7280;font-size:12px">
Sent automatically by the Emergent Energy app because an operator decided
the app value should win over the workbook for ${input.entries.length}
field(s). To keep Excel as the source of truth, please update the Tracker
sheet for these fields. If you instead want to revert to the Excel value,
open the link above and choose "Accept Excel".
</p>`.trim();

  const fieldListPlain = fields.join(", ") + (fieldsOverflow > 0 ? `, … and ${fieldsOverflow} more` : "");
  const bodyText = [
    `${requester} has ${actionVerb} on ${input.projectName} in the ${sectionLabel} section.`,
    `The Tracker workbook is the source of truth, so please update the Excel for these fields.`,
    ``,
    `Project: ${input.projectName}`,
    `Section: ${sectionLabel}`,
    `Field count: ${input.entries.length} field(s) across ${rowCount} row(s)`,
    `Reason: ${input.reason}`,
    input.requestId != null ? `Approval request id: ${input.requestId}` : null,
    `Fields: ${fieldListPlain}`,
    ``,
    `Open the diff page: ${deepLink}`,
  ].filter((l): l is string => l !== null).join("\n");

  return { subject, bodyHtml, bodyText, fields, rowCount };
}

/**
 * Resolve recipient user records (id + email) by role. Active,
 * non-deleted users only. Falls back to an empty list if any read
 * fails — caller treats as "nobody to notify".
 */
async function resolveRecipients(): Promise<Array<{ id: number; email: string; name: string }>> {
  try {
    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(
        and(
          inArray(users.role, EXCEL_UPDATE_RECIPIENT_ROLES as unknown as string[]),
          sql`${users.deletedAt} IS NULL`,
          sql`${users.isActive} = true`,
        ),
      );
    return rows.filter((r: { id: number; email: string; name: string }) =>
      typeof r.email === "string" && r.email.includes("@"),
    );
  } catch (err: any) {
    console.warn("[excel-update-mailer] recipient lookup failed:", err?.message ?? err);
    return [];
  }
}

function appBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim() || "https://app.emergentenergy.co.za";
}

/**
 * Fire the email + in-app notifications. Returns the number of
 * recipients reached (email recipients counted once even though a
 * single email goes to all). Never throws.
 */
export async function sendExcelUpdateRequest(input: ExcelUpdateRequestInput): Promise<{
  recipients: number;
  emailSent: boolean;
  notifications: number;
}> {
  const recipients = await resolveRecipients();
  if (recipients.length === 0) {
    console.warn("[excel-update-mailer] no active recipients in roles", EXCEL_UPDATE_RECIPIENT_ROLES.join(","));
    return { recipients: 0, emailSent: false, notifications: 0 };
  }

  const mail = buildExcelUpdateMail({
    projectId: input.projectId,
    projectName: input.projectName,
    resolveAction: input.resolveAction,
    section: input.section,
    entries: input.entries,
    reason: input.reason,
    requesterName: input.requesterName,
    baseUrl: appBaseUrl(),
    requestId: input.requestId,
  });

  let emailSent = false;
  try {
    const cc = input.requesterEmail && input.requesterEmail.includes("@")
      ? [input.requesterEmail]
      : undefined;
    await sendMail({
      to: recipients.map(r => r.email),
      cc,
      subject: mail.subject,
      body: mail.bodyHtml,
      bodyType: "HTML",
    });
    emailSent = true;
  } catch (err: any) {
    console.warn("[excel-update-mailer] sendMail failed:", err?.message ?? err);
  }

  let notifications = 0;
  const eventType = input.resolveAction === "keep_app"
    ? "excel_update_required_keep_app"
    : "excel_update_required_request_approval";
  for (const r of recipients) {
    try {
      // No relatedEntityType/Id passed: per user decision (2026-05-05) we
      // do NOT throttle this notification. Each operator resolve action
      // is an explicit signal and must surface every time, even on
      // repeat clicks against the same project within the 10-minute
      // notification-service throttle window.
      const created = await createNotification({
        recipientUserId: r.id,
        eventType,
        title: mail.subject,
        body: mail.bodyText,
        projectId: input.projectId,
        projectName: input.projectName,
      });
      if (created) notifications++;
    } catch (err: any) {
      console.warn("[excel-update-mailer] in-app notify failed:", err?.message ?? err);
    }
  }

  return { recipients: recipients.length, emailSent, notifications };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
