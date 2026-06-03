import { isHoliday } from "./lib/sa-holidays";

export interface CPMTask {
  id: number;
  taskNo: string;
  name: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  isCritical: boolean;
  predecessorIds: number[];
  successorIds: number[];
  isMilestone: boolean;
  type: string;
  percentComplete: number | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  actualDurationDays?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  plannedDurationDays?: number | null;
  resource?: string | null;
  isBaseline?: boolean;
}

export interface CPMDependency {
  id: number;
  predecessorTaskId: number;
  successorTaskId: number;
  dependencyType: string;
  lagDays: number;
}

export interface CPMResult {
  tasks: CPMTask[];
  criticalPath: number[];
  projectFinish: number;
  hasCircularDependency: boolean;
  warnings: string[];
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// Working-day calendar — Mon–Fri excluding SA public holidays. Unified with
// server/lib/sa-holidays so the CPM schedule matches the rest of the app
// (previously CPM counted Mon–Fri only and silently ignored holidays).
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function isWorkingDay(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !isHoliday(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
}

function toWorkingDays(date: Date, referenceDate: Date): number {
  let count = 0;
  const d = new Date(referenceDate);
  while (d < date) {
    if (isWorkingDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function calculateWorkingDuration(startDate: Date, endDate: Date): number {
  let count = 0;
  const d = new Date(startDate);
  while (d <= endDate) {
    if (isWorkingDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

function topologicalSort(tasks: CPMTask[], deps: CPMDependency[]): number[] | null {
  const taskMap = new Map<number, CPMTask>();
  tasks.forEach(t => taskMap.set(t.id, t));
  
  const inDegree = new Map<number, number>();
  const successors = new Map<number, number[]>();
  
  tasks.forEach(t => {
    inDegree.set(t.id, 0);
    successors.set(t.id, []);
  });
  
  deps.forEach(d => {
    if (taskMap.has(d.predecessorTaskId) && taskMap.has(d.successorTaskId)) {
      inDegree.set(d.successorTaskId, (inDegree.get(d.successorTaskId) || 0) + 1);
      successors.get(d.predecessorTaskId)!.push(d.successorTaskId);
    }
  });
  
  const queue: number[] = [];
  tasks.forEach(t => {
    if (inDegree.get(t.id) === 0) queue.push(t.id);
  });
  
  const sorted: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    
    for (const succId of successors.get(id) || []) {
      const newDegree = (inDegree.get(succId) || 1) - 1;
      inDegree.set(succId, newDegree);
      if (newDegree === 0) queue.push(succId);
    }
  }
  
  return sorted.length === tasks.length ? sorted : null;
}

export function calculateCPM(
  tasks: Array<{
    id: number;
    taskNo: string | null;
    name: string | null;
    startDate: string | null;
    endDate: string | null;
    type: string | null;
    percentComplete?: number | null;
    actualStartDate?: string | null;
    actualEndDate?: string | null;
    actualDurationDays?: number | null;
    plannedStartDate?: string | null;
    plannedEndDate?: string | null;
    plannedDurationDays?: number | null;
    resource?: string | null;
    isBaseline?: boolean;
  }>,
  dependencies: CPMDependency[]
): CPMResult {
  const warnings: string[] = [];
  
  let projectStart: Date | null = null;
  const validTasks = tasks.filter(t => {
    const start = parseDate(t.startDate);
    const end = parseDate(t.endDate);
    if (!start || !end) {
      warnings.push(`Task "${t.name}" has invalid dates`);
      return false;
    }
    if (!projectStart || start < projectStart) projectStart = start;
    return true;
  });
  
  if (!projectStart) {
    return { tasks: [], criticalPath: [], projectFinish: 0, hasCircularDependency: false, warnings: ["No valid tasks found"] };
  }
  
  const refDate = projectStart;
  
  const cpmTasks: CPMTask[] = validTasks.map(t => {
    const startDate = parseDate(t.startDate)!;
    const endDate = parseDate(t.endDate)!;
    const duration = calculateWorkingDuration(startDate, endDate);
    const startWd = toWorkingDays(startDate, refDate);
    const isMilestone = (t.type?.toLowerCase() || '').includes('milestone') || duration === 1;
    
    return {
      id: t.id,
      taskNo: t.taskNo || '',
      name: t.name || '',
      startDate: t.startDate!,
      endDate: t.endDate!,
      durationDays: duration,
      es: startWd,
      ef: startWd + duration,
      ls: 0,
      lf: 0,
      slack: 0,
      isCritical: false,
      predecessorIds: [],
      successorIds: [],
      isMilestone,
      type: t.type || '',
      percentComplete: t.percentComplete ?? null,
      actualStartDate: t.actualStartDate || null,
      actualEndDate: t.actualEndDate || null,
      actualDurationDays: t.actualDurationDays ?? null,
      plannedStartDate: t.plannedStartDate || null,
      plannedEndDate: t.plannedEndDate || null,
      plannedDurationDays: t.plannedDurationDays ?? null,
      resource: t.resource || null,
      isBaseline: t.isBaseline ?? true,
    };
  });
  
  const taskMap = new Map<number, CPMTask>();
  cpmTasks.forEach(t => taskMap.set(t.id, t));
  
  const validDeps = dependencies.filter(d => 
    taskMap.has(d.predecessorTaskId) && taskMap.has(d.successorTaskId)
  );
  
  validDeps.forEach(d => {
    const pred = taskMap.get(d.predecessorTaskId)!;
    const succ = taskMap.get(d.successorTaskId)!;
    pred.successorIds.push(d.successorTaskId);
    succ.predecessorIds.push(d.predecessorTaskId);
  });
  
  const sortedIds = topologicalSort(cpmTasks, validDeps);
  if (!sortedIds) {
    return { 
      tasks: cpmTasks, 
      criticalPath: [], 
      projectFinish: 0, 
      hasCircularDependency: true, 
      warnings: ["Circular dependency detected in task dependencies"] 
    };
  }
  
  for (const id of sortedIds) {
    const task = taskMap.get(id)!;
    let maxPredEf = 0;
    
    for (const predId of task.predecessorIds) {
      const pred = taskMap.get(predId)!;
      const dep = validDeps.find(d => d.predecessorTaskId === predId && d.successorTaskId === id);
      const lag = dep?.lagDays || 0;
      
      let predContribution = pred.ef + lag;
      
      if (dep?.dependencyType === 'SS') {
        predContribution = pred.es + lag;
      } else if (dep?.dependencyType === 'FF') {
        predContribution = pred.ef + lag - task.durationDays;
      } else if (dep?.dependencyType === 'SF') {
        predContribution = pred.es + lag - task.durationDays;
      }
      
      maxPredEf = Math.max(maxPredEf, predContribution);
    }
    
    if (task.predecessorIds.length > 0) {
      task.es = Math.max(task.es, maxPredEf);
    }
    task.ef = task.es + task.durationDays;
  }
  
  let projectFinish = 0;
  cpmTasks.forEach(t => {
    projectFinish = Math.max(projectFinish, t.ef);
  });
  
  cpmTasks.forEach(t => {
    t.lf = projectFinish;
    t.ls = t.lf - t.durationDays;
  });
  
  for (let i = sortedIds.length - 1; i >= 0; i--) {
    const id = sortedIds[i];
    const task = taskMap.get(id)!;
    
    let minLf = projectFinish;
    for (const succId of task.successorIds) {
      const succ = taskMap.get(succId)!;
      const dep = validDeps.find(d => d.predecessorTaskId === id && d.successorTaskId === succId);
      const lag = dep?.lagDays || 0;
      
      let constraint = succ.ls - lag;
      
      if (dep?.dependencyType === 'FS') {
        constraint = succ.ls - lag;
      } else if (dep?.dependencyType === 'SS') {
        constraint = succ.ls - lag + task.durationDays;
      } else if (dep?.dependencyType === 'FF') {
        constraint = succ.lf - lag;
      } else if (dep?.dependencyType === 'SF') {
        constraint = succ.lf - lag + task.durationDays;
      }
      
      minLf = Math.min(minLf, constraint);
    }
    
    if (task.successorIds.length > 0) {
      task.lf = minLf;
    }
    task.ls = task.lf - task.durationDays;
    task.slack = task.ls - task.es;
    task.isCritical = task.slack <= 0;
  }
  
  const criticalPath = cpmTasks.filter(t => t.isCritical).map(t => t.id);
  
  return {
    tasks: cpmTasks,
    criticalPath,
    projectFinish,
    hasCircularDependency: false,
    warnings,
  };
}

// Date-based critical path (hybrid fallback). Used when a plan has NO
// dependencies entered yet: with no precedence to drive CPM, we infer the
// schedule-defining chain purely from each task's start/end dates. Two tasks
// form a sequential link when one finishes on or before the other starts; the
// critical path is the heaviest such chain (by working-day duration) that ends
// at the project's latest finish date. O(n^2) — fine for plan sizes.
export function calculateCriticalPathByDates(
  tasks: Array<{ id: number; startDate: string | null; endDate: string | null; type?: string | null }>,
): number[] {
  const valid = tasks
    .map(t => {
      const start = parseDate(t.startDate);
      const end = parseDate(t.endDate);
      if (!start || !end) return null;
      return { id: t.id, start, end, dur: calculateWorkingDuration(start, end) };
    })
    .filter((t): t is { id: number; start: Date; end: Date; dur: number } => t !== null);
  if (valid.length === 0) return [];

  // Process earliest-starting first so predecessors are scored before successors.
  const order = [...valid].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
  );
  const longest = new Map<number, number>();
  const parent = new Map<number, number | null>();

  for (const t of order) {
    let best = 0;
    let bestParent: number | null = null;
    for (const p of order) {
      if (p.id === t.id) continue;
      // p precedes t only when p finishes STRICTLY before t starts. Dates are
      // inclusive day ranges [start..end], so p.end === t.start means they share
      // that day (an overlap) and must NOT be chained.
      if (p.end.getTime() < t.start.getTime()) {
        const cand = longest.get(p.id) ?? 0;
        // Heaviest predecessor wins; ties resolve to the lower id for determinism.
        if (cand > best || (cand === best && bestParent !== null && p.id < bestParent)) {
          best = cand;
          bestParent = p.id;
        }
      }
    }
    longest.set(t.id, best + t.dur);
    parent.set(t.id, bestParent);
  }

  // Anchor the path at the project finish (latest end date); heaviest chain wins,
  // ties resolve to the lower id so the result is stable regardless of input order.
  const maxEnd = Math.max(...order.map(t => t.end.getTime()));
  let endId: number | null = null;
  let endWeight = -1;
  for (const t of order) {
    if (t.end.getTime() !== maxEnd) continue;
    const w = longest.get(t.id) ?? 0;
    if (w > endWeight || (w === endWeight && endId !== null && t.id < endId)) {
      endWeight = w;
      endId = t.id;
    }
  }
  if (endId == null) return [];

  const path: number[] = [];
  let cur: number | null = endId;
  while (cur != null) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
  }
  return path;
}

// Override tables dropped (Cleanup Prompt 4) — stubs return input unchanged
export function applyOverridesToTasks(baseTasks: any[], _overrides: any[]): any[] {
  return baseTasks;
}

export function applyOverridesToDependencies(baseDeps: CPMDependency[], _overrides: any[]): CPMDependency[] {
  return baseDeps;
}
