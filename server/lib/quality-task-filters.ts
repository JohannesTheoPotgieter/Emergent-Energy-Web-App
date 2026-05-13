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

function qualityTokens(task: QualityTaskRecord): string {
  return [
    task.source,
    task.discipline,
    task.taskTypeTag,
    task.title,
    task.description,
  ].map(text).join(" ");
}

export function isQualityTaskRecord(task: QualityTaskRecord): boolean {
  if (typeof task.linkedQualityItemInstanceId === "number" && task.linkedQualityItemInstanceId > 0) {
    return true;
  }
  const tokens = qualityTokens(task);
  return tokens.includes("quality")
    || tokens.includes("ncr")
    || tokens.includes("non-conformance")
    || tokens.includes("non_conformance")
    || tokens.includes("non conformance")
    || tokens.includes("evidence")
    || tokens.includes("snag")
    || tokens.includes("punch")
    || /\b(q[ac])\b/.test(tokens);
}

function matchesSource(task: QualityTaskRecord, source: string): boolean {
  const normalized = source.trim().toLowerCase();
  if (!normalized || normalized === "quality") return true;
  const tokens = qualityTokens(task);
  if (normalized === "evidence") return tokens.includes("evidence") || Boolean(task.linkedQualityItemInstanceId);
  return tokens.includes(normalized);
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
