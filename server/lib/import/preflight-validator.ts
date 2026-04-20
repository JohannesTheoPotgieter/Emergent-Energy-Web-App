import { buildNewPlanExternalRef } from "./row-matcher";

export type PreflightWarningCode =
  | "DUPLICATE_PLANNED_REF"
  | "BLANK_OUTLINE_MILESTONE"
  | "MISSING_SOURCE_COORDINATES";

export interface PreflightWarning {
  code: PreflightWarningCode;
  section: "PLAN";
  message: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  taskNo: string | null;
  taskName: string | null;
  plannedRef: string | null;
}

export interface PlannedRefEntry {
  sourceSheet: string;
  sourceRow: number;
  taskNo: string | null;
  taskName: string;
  isMilestone: boolean;
  plannedRef: string;
}

export interface PreflightResult {
  warnings: PreflightWarning[];
  plannedRefs: PlannedRefEntry[];
  counts: {
    duplicatePlannedRefs: number;
    blankOutlineMilestones: number;
    missingSourceCoordinates: number;
    totalPlannedRows: number;
  };
}

interface PlanRowLike {
  taskName?: string | null;
  taskNo?: string | null;
  sourceSheet?: string | null;
  sourceRow?: number | string | null;
  isMilestone?: boolean | null;
  outlineNumber?: string | null;
}

const MAX_DETAIL_WARNINGS_PER_CODE = 25;

export function runPreflightValidator(
  projectId: number | null | undefined,
  planTasks: PlanRowLike[] | null | undefined,
): PreflightResult {
  const tasks = Array.isArray(planTasks) ? planTasks : [];
  const pid = typeof projectId === "number" && Number.isFinite(projectId) ? projectId : 0;

  const warnings: PreflightWarning[] = [];
  const plannedRefs: PlannedRefEntry[] = [];
  const refOccurrences = new Map<string, number[]>();
  const counts = {
    duplicatePlannedRefs: 0,
    blankOutlineMilestones: 0,
    missingSourceCoordinates: 0,
    totalPlannedRows: tasks.length,
  };

  const blankMilestoneSamples: PreflightWarning[] = [];
  const missingCoordSamples: PreflightWarning[] = [];

  tasks.forEach((row, idx) => {
    const sourceSheet = row.sourceSheet ?? null;
    const sourceRowRaw = row.sourceRow;
    const sourceRow =
      sourceRowRaw == null
        ? null
        : Number.isFinite(Number(sourceRowRaw))
        ? Number(sourceRowRaw)
        : null;
    const taskNo = row.taskNo ?? row.outlineNumber ?? null;
    const taskName = row.taskName ?? "";
    const isMilestone = !!row.isMilestone;

    if (!sourceSheet || sourceRow == null) {
      counts.missingSourceCoordinates += 1;
      if (missingCoordSamples.length < MAX_DETAIL_WARNINGS_PER_CODE) {
        missingCoordSamples.push({
          code: "MISSING_SOURCE_COORDINATES",
          section: "PLAN",
          message: `Row ${idx + 1} (${taskName || "untitled"}) is missing source sheet/row metadata; planned identifier cannot be computed.`,
          sourceSheet,
          sourceRow,
          taskNo,
          taskName: taskName || null,
          plannedRef: null,
        });
      }
      return;
    }

    const plannedRef = buildNewPlanExternalRef(pid, {
      sourceSheet,
      sourceRow,
      taskNo,
      isMilestone,
    });

    plannedRefs.push({
      sourceSheet,
      sourceRow,
      taskNo,
      taskName: taskName || "",
      isMilestone,
      plannedRef,
    });

    const occ = refOccurrences.get(plannedRef);
    if (occ) {
      occ.push(idx);
    } else {
      refOccurrences.set(plannedRef, [idx]);
    }

    if (isMilestone && !(taskNo && String(taskNo).trim())) {
      counts.blankOutlineMilestones += 1;
      if (blankMilestoneSamples.length < MAX_DETAIL_WARNINGS_PER_CODE) {
        blankMilestoneSamples.push({
          code: "BLANK_OUTLINE_MILESTONE",
          section: "PLAN",
          message: `Milestone "${taskName || "untitled"}" on sheet "${sourceSheet}" row ${sourceRow} has no outline/task number; will be tagged as 'M'.`,
          sourceSheet,
          sourceRow,
          taskNo: null,
          taskName: taskName || null,
          plannedRef,
        });
      }
    }
  });

  const dupSamples: PreflightWarning[] = [];
  for (const [ref, indices] of refOccurrences) {
    if (indices.length <= 1) continue;
    counts.duplicatePlannedRefs += indices.length;
    if (dupSamples.length >= MAX_DETAIL_WARNINGS_PER_CODE) continue;
    const first = tasks[indices[0]];
    dupSamples.push({
      code: "DUPLICATE_PLANNED_REF",
      section: "PLAN",
      message: `Planned identifier collision: ${indices.length} rows resolve to ${ref} (rows: ${indices.map((i) => i + 1).join(", ")}).`,
      sourceSheet: first?.sourceSheet ?? null,
      sourceRow: typeof first?.sourceRow === "number" ? first.sourceRow : Number(first?.sourceRow ?? 0) || null,
      taskNo: first?.taskNo ?? null,
      taskName: first?.taskName ?? null,
      plannedRef: ref,
    });
  }

  warnings.push(...dupSamples, ...blankMilestoneSamples, ...missingCoordSamples);

  return { warnings, plannedRefs, counts };
}
