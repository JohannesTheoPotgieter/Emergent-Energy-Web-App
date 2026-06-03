// Schedule reflow engine (Phase 2 — auto-reschedule).
//
// Given the plan's leaf tasks + dependencies, recompute each task's dates so
// successors respect their predecessors (FS/SS/FF/SF + lag) on the SA working
// calendar. Pure + deterministic so it can be unit-tested and run in either
// "preview" (return proposed changes) or "commit" mode by the caller.
//
// Anchored tasks are NEVER moved: a task is anchored when it is manually
// scheduled (`isFixed`, i.e. taskMode='manual' / a manual date override) or it
// has no predecessors (a schedule root). This implements the owner-chosen
// "respect manual dates" behaviour.
import { addWorkingDays, subtractWorkingDays, saWorkingDays } from "./sa-holidays";

export interface RescheduleInputTask {
  id: number;
  taskNo: string | null;
  name: string | null;
  startDate: string | null; // YYYY-MM-DD (primary = actual ?? planned)
  endDate: string | null;
  durationDays?: number | null;
  isFixed: boolean; // manual / anchored — never moved
}

export interface RescheduleDep {
  predecessorTaskId: number;
  successorTaskId: number;
  dependencyType: string; // FS | SS | FF | SF
  lagDays: number;
}

export interface RescheduleChange {
  id: number;
  taskNo: string | null;
  name: string | null;
  oldStart: string | null;
  oldEnd: string | null;
  newStart: string;
  newEnd: string;
  slipDays: number; // working-day delta of newEnd vs oldEnd (+ = later/behind)
}

export interface RescheduleResult {
  changes: RescheduleChange[];
  hasCircularDependency: boolean;
  warnings: string[];
}

function topoSort(ids: number[], deps: RescheduleDep[]): number[] | null {
  const inDegree = new Map<number, number>();
  const successors = new Map<number, number[]>();
  ids.forEach((id) => {
    inDegree.set(id, 0);
    successors.set(id, []);
  });
  deps.forEach((d) => {
    if (inDegree.has(d.successorTaskId) && successors.has(d.predecessorTaskId)) {
      inDegree.set(d.successorTaskId, (inDegree.get(d.successorTaskId) || 0) + 1);
      successors.get(d.predecessorTaskId)!.push(d.successorTaskId);
    }
  });
  const queue = ids.filter((id) => (inDegree.get(id) || 0) === 0);
  const sorted: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const s of successors.get(id) || []) {
      const nd = (inDegree.get(s) || 1) - 1;
      inDegree.set(s, nd);
      if (nd === 0) queue.push(s);
    }
  }
  return sorted.length === ids.length ? sorted : null;
}

// Latest (max) of two YYYY-MM-DD date strings; lexicographic compare is valid.
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function computeReschedule(
  tasks: RescheduleInputTask[],
  deps: RescheduleDep[],
): RescheduleResult {
  const warnings: string[] = [];
  const taskMap = new Map<number, RescheduleInputTask>();
  tasks.forEach((t) => taskMap.set(t.id, t));

  const validDeps = deps.filter(
    (d) => taskMap.has(d.predecessorTaskId) && taskMap.has(d.successorTaskId),
  );

  const order = topoSort(
    tasks.map((t) => t.id),
    validDeps,
  );
  if (!order) {
    return {
      changes: [],
      hasCircularDependency: true,
      warnings: ["Circular dependency detected — cannot reschedule until the loop is resolved."],
    };
  }

  const predsBySucc = new Map<number, RescheduleDep[]>();
  for (const d of validDeps) {
    if (!predsBySucc.has(d.successorTaskId)) predsBySucc.set(d.successorTaskId, []);
    predsBySucc.get(d.successorTaskId)!.push(d);
  }

  const durationOf = (t: RescheduleInputTask): number => {
    if (t.durationDays && t.durationDays > 0) return t.durationDays;
    const wd = saWorkingDays(t.startDate, t.endDate);
    return wd && wd > 0 ? wd : 1;
  };

  // newDates seeds from current; anchors keep theirs, auto tasks get recomputed.
  const newDates = new Map<number, { start: string | null; end: string | null }>();

  for (const id of order) {
    const t = taskMap.get(id)!;
    const preds = predsBySucc.get(id) || [];

    // Anchor: manual/fixed, no predecessors, or missing dates to schedule from.
    if (t.isFixed || preds.length === 0 || !t.startDate || !t.endDate) {
      newDates.set(id, { start: t.startDate, end: t.endDate });
      continue;
    }

    const dur = durationOf(t);
    let startConstraint: string | null = null; // latest required start

    for (const dep of preds) {
      const pred = newDates.get(dep.predecessorTaskId);
      if (!pred?.start || !pred?.end) continue;
      const type = (dep.dependencyType || "FS").toUpperCase();
      const lag = dep.lagDays || 0;
      let candidateStart: string | null = null;
      if (type === "SS") {
        candidateStart = addWorkingDays(pred.start, lag);
      } else if (type === "FF") {
        const endC = addWorkingDays(pred.end, lag);
        candidateStart = subtractWorkingDays(endC, Math.max(0, dur - 1));
      } else if (type === "SF") {
        const endC = addWorkingDays(pred.start, lag);
        candidateStart = subtractWorkingDays(endC, Math.max(0, dur - 1));
      } else {
        // FS (default): successor starts the working day after predecessor ends.
        candidateStart = addWorkingDays(pred.end, lag + 1);
      }
      startConstraint = laterOf(startConstraint, candidateStart);
    }

    if (!startConstraint) {
      newDates.set(id, { start: t.startDate, end: t.endDate });
      continue;
    }
    const newStart = startConstraint;
    const newEnd = addWorkingDays(newStart, Math.max(0, dur - 1))!;
    newDates.set(id, { start: newStart, end: newEnd });
  }

  const changes: RescheduleChange[] = [];
  for (const t of tasks) {
    const nd = newDates.get(t.id);
    if (!nd?.start || !nd?.end) continue;
    if (nd.start === t.startDate && nd.end === t.endDate) continue;
    let slipDays = 0;
    if (t.endDate) {
      if (nd.end > t.endDate) slipDays = (saWorkingDays(t.endDate, nd.end) ?? 1) - 1;
      else if (nd.end < t.endDate) slipDays = -((saWorkingDays(nd.end, t.endDate) ?? 1) - 1);
    }
    changes.push({
      id: t.id,
      taskNo: t.taskNo,
      name: t.name,
      oldStart: t.startDate,
      oldEnd: t.endDate,
      newStart: nd.start,
      newEnd: nd.end,
      slipDays,
    });
  }

  return { changes, hasCircularDependency: false, warnings };
}
