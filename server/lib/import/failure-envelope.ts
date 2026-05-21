/**
 * Shared import-failure envelope used by both the scheduled folder
 * importer (`server/services/scheduled-import-v2.ts`) and the
 * single-file upload route (`server/smart-import-routes.ts:/api/smart-import/upload`).
 *
 * Both paths need to:
 *  1. Wrap raw exceptions with an operator-friendly label that names the
 *     pipeline step, the file, the cause, and (when the message matches a
 *     known pattern) a concrete suggestion.
 *  2. Persist the envelope on a `smart_import_runs` row so the Import
 *     Control Tower can show what happened without the operator chasing
 *     logs.
 *
 * Keeping the helpers here guarantees that the two entry surfaces present
 * the same error vocabulary on the same UI rendering pass.
 */

import { db } from "../../db";
import { smartImportRuns } from "@shared/schema";

export type ImportFailureStep =
  | "upload"
  | "download"
  | "preview"
  | "planner"
  | "auto_commit"
  | "commit";

export interface ImportFailureEnvelope {
  /** Which pipeline step failed — operators read this first. */
  step: ImportFailureStep;
  /** Human-friendly message: file name + cause + (optional) suggestion. */
  message: string;
  /** Raw error string for support / audit follow-up. */
  raw: string;
  /** ISO timestamp of the failure. */
  failedAt: string;
  /** Always copy the source file name so the Tower can group by file. */
  fileName: string;
}

const STEP_LABELS: Record<ImportFailureStep, (fileName: string) => string> = {
  upload: (f) => `Could not accept "${f}" as a Smart Import upload`,
  download: (f) => `Could not download "${f}" from SharePoint`,
  preview: (f) => `Could not parse "${f}" as a Smart Import workbook`,
  planner: (f) => `Could not plan the import for "${f}"`,
  auto_commit: (f) => `Auto-commit failed for "${f}"`,
  commit: (f) => `Commit failed for "${f}"`,
};

const SUGGESTION_PATTERNS: Array<{ rx: RegExp; hint: string }> = [
  { rx: /401|unauthor/i, hint: "Re-authorise the SharePoint connection in Admin → Integrations." },
  { rx: /403|forbid|access denied/i, hint: "Grant the integration user read access to the folder." },
  { rx: /404|not found/i, hint: "The file may have been moved or renamed in SharePoint." },
  { rx: /timeout|timed out|ETIMEDOUT/i, hint: "SharePoint is responding slowly — the scheduler will retry on the next tick." },
  { rx: /PARSE_ERROR|corrupt|not a valid Excel/i, hint: "Re-export the file from Excel and re-upload it." },
  { rx: /Missing.*sheet|section.*missing/i, hint: "Confirm the workbook includes the expected Project Plan / Revenue Tracking / Expenditure Breakdown sheets." },
  { rx: /no project|project not found|extracted/i, hint: "Add the project to the app first OR rename the file to match an existing project code." },
  { rx: /file size|too large|payload too large/i, hint: "Split the workbook or contact an admin — the file exceeds the upload size limit." },
  { rx: /resurrection_decision_required/i, hint: "The file contains rows you previously deleted; pick Keep deleted or Restore on each before re-running." },
];

/**
 * Wrap any error with an operator-facing envelope. Step + file name go
 * into the label; raw cause is preserved verbatim; a pattern-matched hint
 * is appended when we recognise the error.
 */
export function buildImportFailureEnvelope(
  step: ImportFailureStep,
  fileName: string,
  raw: unknown,
): ImportFailureEnvelope {
  const rawString = raw instanceof Error ? raw.message : String(raw ?? "");
  const baseLabel = STEP_LABELS[step](fileName);
  const hint = SUGGESTION_PATTERNS.find((s) => s.rx.test(rawString))?.hint;
  const message = hint ? `${baseLabel}: ${rawString}. ${hint}` : `${baseLabel}: ${rawString}`;
  return {
    step,
    message,
    raw: rawString,
    failedAt: new Date().toISOString(),
    fileName,
  };
}

interface RecordFailedRunOptions {
  fileName: string;
  fileHash: string | null;
  envelope: ImportFailureEnvelope;
  /** Optional extra summary metadata (e.g. schedulerV2 batch id). */
  extraSummary?: Record<string, unknown>;
  /** Optional fallback project name when nothing could be inferred. */
  projectName?: string;
  /** Operator who triggered the failed action (null = scheduler). */
  uploadedBy?: number | null;
}

/**
 * Persist a failed file as a `failed` smart_import_runs row so the Import
 * Control Tower's existing list view surfaces it alongside successful
 * runs. Returns the new run id, or null if persistence itself failed
 * (logged but non-blocking — the caller still returns HTTP error).
 */
export async function persistFailedImportRun(
  opts: RecordFailedRunOptions,
): Promise<number | null> {
  try {
    const projectName =
      opts.projectName ?? "Unmatched — import failure";
    const [row] = await db
      .insert(smartImportRuns)
      .values({
        projectId: null,
        projectName,
        uploadedBy: opts.uploadedBy ?? null,
        sourceFileName: opts.fileName,
        sourceFileHash: opts.fileHash,
        status: "failed",
        summaryJson: {
          ...(opts.extraSummary ?? {}),
          error: opts.envelope,
        },
      })
      .returning({ id: smartImportRuns.id });
    return row?.id ?? null;
  } catch (err) {
    console.error(
      `[ImportFailure] Could not persist failure row for ${opts.fileName}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
