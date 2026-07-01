export interface QualityTaskFilters {
  status?: string;
  ownerUserId?: number;
  projectId?: number;
  dueBefore?: string;
  source?: string;
  search?: string;
}

export interface QualityTaskRecord {
  title?: string | null;
  description?: string | null;
  status?: string | null;
  source?: string | null;
  discipline?: string | null;
  taskTypeTag?: string | null;
  linkedQualityItemInstanceId?: number | null;
  linkedDeliverableId?: number | null;
  projectName?: string | null;
  dueDate?: string | Date | null;
  ownerUserId?: number | null;
  workstream?: string | null;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === "string" ? value : undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseDateOnly(value: unknown): string | undefined {
  const raw = firstString(value)?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : raw;
}

function parseTrimmed(value: unknown): string | undefined {
  const raw = firstString(value)?.trim();
  return raw ? raw : undefined;
}

export function parseQualityTaskQuery(query: Record<string, unknown>): QualityTaskFilters {
  const status = parseTrimmed(query.status);
  const source = parseTrimmed(query.source);
  const search = parseTrimmed(query.search);
  const ownerUserId = parsePositiveInt(query.owner ?? query.ownerUserId ?? query.assignee);
  const projectId = parsePositiveInt(query.project ?? query.projectId);
  const dueBefore = parseDateOnly(query.dueBefore ?? query.dueDate);

  return {
    ...(status ? { status } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(dueBefore ? { dueBefore } : {}),
    ...(source ? { source } : {}),
    ...(search ? { search } : {}),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

// Split values into whole alphanumeric tokens. Compound values like
// "missing_evidence" / "qa-check" still classify, while "keypunch" no longer
// matches "punch" and "evidences" no longer matches "evidence".
function tokenSet(values: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token) set.add(token);
    }
  }
  return set;
}

// Tokens that mark a work item as quality work wherever they appear. Covers the
// three spellings of non-conformance once tokenised ("non-conformance" and
// "non_conformance" both split to {non, conformance}).
const QUALITY_TOKENS = new Set([
  "quality", "ncr", "nonconformance", "conformance",
  "snag", "snagging", "punch", "punchlist", "qa", "qc",
]);

export function isQualityTaskRecord(task: QualityTaskRecord): boolean {
  // Strongest signals first: an explicit quality-item link or the QUALITY
  // workstream are authoritative regardless of any keyword.
  if (typeof task.linkedQualityItemInstanceId === "number" && task.linkedQualityItemInstanceId > 0) {
    return true;
  }
  if (String(task.workstream ?? "").trim().toUpperCase() === "QUALITY") {
    return true;
  }
  // Structured fields (source/discipline/taskTypeTag) are trusted broadly,
  // including the deliberately-broad "evidence" token.
  const structured = tokenSet([task.source, task.discipline, task.taskTypeTag]);
  for (const token of structured) {
    if (QUALITY_TOKENS.has(token) || token === "evidence") return true;
  }
  // Free text (title/description) contributes only strong, quality-specific
  // keywords, so an incidental mention like "attach evidence of sign-off" on an
  // unrelated engineering task no longer reclassifies it as quality.
  const freeText = tokenSet([task.title, task.description]);
  for (const token of freeText) {
    if (QUALITY_TOKENS.has(token)) return true;
  }
  return false;
}

function matchesSource(task: QualityTaskRecord, source: string): boolean {
  const normalized = source.trim().toLowerCase();
  if (!normalized || normalized === "quality") return true;
  const tokens = tokenSet([task.source, task.discipline, task.taskTypeTag, task.title, task.description]);
  if (normalized === "evidence") return tokens.has("evidence") || Boolean(task.linkedQualityItemInstanceId);
  return tokens.has(normalized);
}

function dateValue(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

export function matchesQualityTaskFilters(task: QualityTaskRecord, filters: QualityTaskFilters): boolean {
  if (filters.status && text(task.status) !== filters.status.toLowerCase()) return false;
  if (filters.ownerUserId && task.ownerUserId !== filters.ownerUserId) return false;
  if (filters.source && !matchesSource(task, filters.source)) return false;
  if (filters.dueBefore) {
    const due = dateValue(task.dueDate);
    const threshold = dateValue(filters.dueBefore);
    if (due == null || threshold == null || due > threshold) return false;
  }
  if (filters.search) {
    const haystack = [
      task.title,
      task.description,
      task.projectName,
      task.status,
      task.taskTypeTag,
    ].map(text).join(" ");
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}
