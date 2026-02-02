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

function toWorkingDays(date: Date, referenceDate: Date): number {
  let count = 0;
  const d = new Date(referenceDate);
  while (d < date) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function fromWorkingDays(workingDays: number, referenceDate: Date): Date {
  const d = new Date(referenceDate);
  let remaining = workingDays;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

function calculateWorkingDuration(startDate: Date, endDate: Date): number {
  let count = 0;
  const d = new Date(startDate);
  while (d <= endDate) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
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

export function applyOverridesToTasks(
  baseTasks: Array<{
    id: number;
    taskNo: string | null;
    name: string | null;
    startDate: string | null;
    endDate: string | null;
    type: string | null;
  }>,
  overrides: Array<{
    importedTaskId: number | null;
    overrideStartDate: string | null;
    overrideEndDate: string | null;
    overrideDurationDays: number | null;
    overrideName: string | null;
    overrideTaskNo: string | null;
    deletedFlag: number;
    isNewTask: number;
    id: number;
  }>
): typeof baseTasks {
  const overrideMap = new Map(
    overrides
      .filter(o => o.importedTaskId && o.deletedFlag !== 1)
      .map(o => [o.importedTaskId!, o])
  );
  
  const result = baseTasks
    .filter(t => {
      const override = overrideMap.get(t.id);
      return !override || override.deletedFlag !== 1;
    })
    .map(t => {
      const override = overrideMap.get(t.id);
      if (!override) return t;
      
      return {
        ...t,
        taskNo: override.overrideTaskNo || t.taskNo,
        name: override.overrideName || t.name,
        startDate: override.overrideStartDate || t.startDate,
        endDate: override.overrideEndDate || t.endDate,
      };
    });
  
  const newTasks = overrides
    .filter(o => o.isNewTask === 1 && o.deletedFlag !== 1)
    .map(o => ({
      id: -o.id,
      taskNo: o.overrideTaskNo,
      name: o.overrideName,
      startDate: o.overrideStartDate,
      endDate: o.overrideEndDate,
      type: 'Task',
    }));
  
  return [...result, ...newTasks];
}

export function applyOverridesToDependencies(
  baseDeps: CPMDependency[],
  overrides: Array<{
    id: number;
    importedDependencyId: number | null;
    predecessorTaskId: number;
    successorTaskId: number;
    dependencyType: string;
    lagDays: number;
    deletedFlag: number;
  }>
): CPMDependency[] {
  const deleteSet = new Set(
    overrides.filter(o => o.importedDependencyId && o.deletedFlag === 1).map(o => o.importedDependencyId!)
  );
  
  const result = baseDeps.filter(d => !deleteSet.has(d.id));
  
  const newDeps = overrides
    .filter(o => !o.importedDependencyId && o.deletedFlag !== 1)
    .map(o => ({
      id: -o.id,
      predecessorTaskId: o.predecessorTaskId,
      successorTaskId: o.successorTaskId,
      dependencyType: o.dependencyType,
      lagDays: o.lagDays,
    }));
  
  return [...result, ...newDeps];
}
