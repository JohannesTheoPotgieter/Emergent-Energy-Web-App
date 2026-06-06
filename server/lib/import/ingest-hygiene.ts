/**
 * Ingest hygiene + per-project dedupe for the SharePoint scheduled importer
 * (server/services/scheduled-import-v2.ts).
 *
 * Goal: one project = one candidate per ingest cycle; junk never enters the
 * pipeline; nothing is silently dropped.
 *
 *  - Office lock/temp files ("~$Foo.xlsx") and zero-byte files are SKIPPED —
 *    the caller debug-logs them; no run row is created and nothing reaches the
 *    finance write path.
 *  - "(conflicted copy)" / "Copy of …" / "… - Copy" / numbered-duplicate
 *    artefacts are QUARANTINED: parked as `awaiting_review` with a clear
 *    reason, never auto-committed, so a stray copy cannot silently
 *    double-count a project.
 *  - When two or more files in the same cycle resolve to the SAME project, the
 *    most-recently-modified file is kept as the candidate and the older
 *    revisions are quarantined naming the kept file.
 *
 * This module is intentionally DB-free and side-effect-free so it can be
 * unit-tested directly. The scheduler injects the (async) project resolver
 * that mirrors its binding + name-match logic.
 */

export interface IngestFile {
  /** SharePoint driveItem id. */
  id: string;
  /** File name (a path may be present; only the basename is inspected). */
  name: string;
  /** Size in bytes; null when the listing did not report one. */
  size: number | null;
  /** ISO last-modified timestamp; null when unknown. */
  lastModifiedDateTime: string | null;
}

export type QuarantineKind = "conflicted_copy" | "older_revision";

export interface QuarantinedFile {
  file: IngestFile;
  kind: QuarantineKind;
  /** Operator-facing reason surfaced in the awaiting_review UI. */
  reason: string;
  /** older_revision: the kept (newer) file's name. */
  chosenFile?: string;
  /** older_revision: the resolved project id the group shares. */
  projectKey?: number | null;
}

export interface SkippedFile {
  file: IngestFile;
  reason: string;
}

export type IngestDecision =
  | { action: "skip"; reason: string }
  | { action: "quarantine"; kind: "conflicted_copy"; reason: string }
  | { action: "process" };

export interface IngestPlan {
  skipped: SkippedFile[];
  quarantined: QuarantinedFile[];
  candidates: IngestFile[];
}

function basename(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

/** Office/Excel lock or temp file, e.g. "~$ProjectTracker.xlsx". */
export function isOfficeLockFile(name: string): boolean {
  return basename(name).startsWith("~$");
}

/**
 * OneDrive / Dropbox / SharePoint / Windows duplicate artefacts that must
 * never silently double-count a project. Matches:
 *   - "… (conflicted copy …).xlsx"   (OneDrive / Dropbox sync conflict)
 *   - "Copy of ….xlsx"               (explicit copy)
 *   - "… - Copy.xlsx" / "… - Copy (2).xlsx"
 *   - "… (1).xlsx"                   (Windows/SharePoint collision rename; 1–3
 *                                     digits only, so a year like "(2024)" is
 *                                     treated as a normal name, not a copy)
 */
export function isDuplicateArtifactName(name: string): boolean {
  const base = basename(name);
  if (/conflicted copy/i.test(base)) return true;
  if (/^copy of /i.test(base)) return true;
  if (/[-_ ]copy(\s*\(\d+\))?\s*\.(xlsx|xlsm|xls)$/i.test(base)) return true;
  if (/\s\(\d{1,3}\)\s*\.(xlsx|xlsm|xls)$/i.test(base)) return true;
  return false;
}

/**
 * Classify a single file by name + size alone (no project resolution).
 * Order: lock file → zero-byte → duplicate artefact → process.
 *
 * Zero-byte only triggers when the listing reports a numeric size of 0; an
 * unknown (null) size is never treated as empty so we don't skip real files.
 */
export function classifyIngestFile(file: IngestFile): IngestDecision {
  const base = basename(file.name);
  if (isOfficeLockFile(base)) {
    return { action: "skip", reason: "Office lock/temp file (~$…)" };
  }
  if (typeof file.size === "number" && file.size <= 0) {
    return { action: "skip", reason: "zero-byte file" };
  }
  if (isDuplicateArtifactName(base)) {
    return {
      action: "quarantine",
      kind: "conflicted_copy",
      reason:
        `Duplicate-copy artefact ("${base}"). Parked for review so a stray copy ` +
        `cannot silently double-count a project. Delete the duplicate in ` +
        `SharePoint, or open this run to commit it deliberately.`,
    };
  }
  return { action: "process" };
}

function modifiedMs(file: IngestFile): number {
  if (!file.lastModifiedDateTime) return 0;
  const t = Date.parse(file.lastModifiedDateTime);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Among files that passed classification, keep the most-recently-modified file
 * per resolved project as the candidate and quarantine the rest as older
 * revisions. Files with no resolved project (projectKey == null) cannot be
 * proven to be the same project, so each is kept as its own candidate.
 */
export function pickLatestRevisionPerProject(
  eligible: Array<IngestFile & { projectKey: number | null }>,
): { candidates: IngestFile[]; quarantined: QuarantinedFile[] } {
  const groups = new Map<number, Array<IngestFile & { projectKey: number | null }>>();
  const candidates: IngestFile[] = [];
  const quarantined: QuarantinedFile[] = [];

  for (const f of eligible) {
    if (f.projectKey == null) {
      candidates.push(f);
      continue;
    }
    const group = groups.get(f.projectKey) ?? [];
    group.push(f);
    groups.set(f.projectKey, group);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      candidates.push(group[0]);
      continue;
    }
    // Newest first; ties keep listing order (stable enough within one tick).
    const sorted = [...group].sort((a, b) => modifiedMs(b) - modifiedMs(a));
    const chosen = sorted[0];
    candidates.push(chosen);
    for (const older of sorted.slice(1)) {
      quarantined.push({
        file: older,
        kind: "older_revision",
        reason:
          `Older revision of "${chosen.name}" — a newer tracker for the same ` +
          `project arrived in this cycle, so this file was not committed. ` +
          `Check whether this is actually the file you want.`,
        chosenFile: chosen.name,
        projectKey: older.projectKey,
      });
    }
  }

  return { candidates, quarantined };
}

/**
 * Build the full ingest plan for one scheduler tick. `resolveProjectKey`
 * returns the auto-mapped project id for a file name (or null) using the
 * scheduler's existing binding + name-match logic; it is injected so this
 * module stays DB-free and testable.
 */
export async function planFolderIngest(
  files: IngestFile[],
  resolveProjectKey: (fileName: string) => Promise<number | null>,
): Promise<IngestPlan> {
  const skipped: SkippedFile[] = [];
  const quarantined: QuarantinedFile[] = [];
  const eligible: Array<IngestFile & { projectKey: number | null }> = [];

  for (const file of files) {
    const decision = classifyIngestFile(file);
    if (decision.action === "skip") {
      skipped.push({ file, reason: decision.reason });
      continue;
    }
    if (decision.action === "quarantine") {
      quarantined.push({ file, kind: decision.kind, reason: decision.reason });
      continue;
    }
    const projectKey = await resolveProjectKey(file.name);
    eligible.push({ ...file, projectKey });
  }

  const latest = pickLatestRevisionPerProject(eligible);
  return {
    skipped,
    quarantined: [...quarantined, ...latest.quarantined],
    candidates: latest.candidates,
  };
}
