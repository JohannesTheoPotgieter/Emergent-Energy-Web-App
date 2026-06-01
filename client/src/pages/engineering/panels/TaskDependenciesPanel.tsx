/**
 * TaskDependenciesPanel — proper dependency management using the
 * work_item_dependencies table and the /api/dependencies/* endpoints.
 *
 * Replaces the legacy DependenciesTab which stored dependencies as
 * HTML comments inside task descriptions (now migrated). That
 * approach had no referential integrity, no circular detection, and
 * dependencies would vanish on any description edit.
 *
 * This component is the Phase 2 UX extraction from the 4832-line
 * EngineeringTasksPage.tsx monolith.
 */
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowRight, Plus, X, Loader2 } from "lucide-react";
import { engFetch } from "@/lib/eng-fetch";
import { getTaskStatusBadgeClass, getTaskStatusLabel } from "@/lib/task-status";

interface Dependency {
  id: number;
  type: "blocks" | "blocked_by";
  depType: string;
  lagDays: number;
  linkedTaskId: number;
  linkedTaskTitle: string;
  linkedTaskStatus: string;
}

/** Minimal task shape — intentionally loose so this component accepts
 *  both the shared Task type and raw API responses. */
interface TaskLike {
  id: number;
  title: string;
  status: string;
  projectId?: number | null;
}

interface TaskDependenciesPanelProps {
  task: TaskLike;
  /** Optional pool of tasks for the add-dependency search.
   *  If omitted, fetches from /api/eng/tasks. */
  allTasks?: TaskLike[];
}

export function TaskDependenciesPanel({ task, allTasks }: TaskDependenciesPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [depType, setDepType] = useState<"blocked_by" | "blocks">("blocked_by");
  const [adding, setAdding] = useState(false);

  // Fetch dependencies from the proper table via server API
  const { data: depsData, isLoading, isError, refetch } = useQuery<{ dependencies: Dependency[] }>({
    queryKey: ["task-dependencies", task.id],
    queryFn: () => engFetch(`/api/dependencies/task/${task.id}`),
  });
  const deps = depsData?.dependencies ?? [];

  const addDep = async (depTask: TaskLike) => {
    setAdding(true);
    try {
      // Map UI terminology to the API model:
      //   "blocked_by X" means X is the predecessor, current task is the successor
      //   "blocks X" means current task is the predecessor, X is the successor
      const body = depType === "blocked_by"
        ? { predecessorId: depTask.id, successorId: task.id, depType: "FS" }
        : { predecessorId: task.id, successorId: depTask.id, depType: "FS" };

      const res = await fetch("/api/dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add dependency");
      }
      queryClient.invalidateQueries({ queryKey: ["task-dependencies", task.id] });
      toast({ title: `Dependency added: ${depType === "blocked_by" ? "blocked by" : "blocks"} ${depTask.title.slice(0, 30)}` });
      setSearch("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const removeDep = async (depId: number) => {
    try {
      const res = await fetch(`/api/dependencies/${depId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove dependency");
      queryClient.invalidateQueries({ queryKey: ["task-dependencies", task.id] });
      toast({ title: "Dependency removed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  // Task pool for the add-dependency search
  const { data: fetchedTasks = [] } = useQuery<TaskLike[]>({
    queryKey: ["eng-tasks"],
    queryFn: () => engFetch("/api/eng/tasks"),
    enabled: !allTasks,
  });
  const pool = allTasks || fetchedTasks;

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const term = search.toLowerCase();
    const existingIds = new Set(deps.map(d => d.linkedTaskId));
    return pool
      .filter(t => t.id !== task.id && !existingIds.has(t.id) && t.title.toLowerCase().includes(term))
      .slice(0, 8);
  }, [pool, search, task.id, deps]);

  const blockedBy = deps.filter(d => d.type === "blocked_by");
  const blocks = deps.filter(d => d.type === "blocks");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6" data-testid="dependencies-loading">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground ml-2">Loading dependencies...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-700" data-testid="dependencies-error">
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Couldn&apos;t load dependencies.
        </span>
        <button
          type="button"
          className="rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100"
          onClick={() => refetch()}
          data-testid="dependencies-retry"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="dependencies-panel">
      {blockedBy.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Blocked by</p>
          {blockedBy.map(d => (
            <div key={d.id} className="flex items-center gap-2 text-xs p-1.5 border rounded mb-1 bg-red-50/50">
              <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
              <span className="flex-1 truncate">{d.linkedTaskTitle}</span>
              <Badge className={`text-[8px] ${getTaskStatusBadgeClass(d.linkedTaskStatus)}`}>
                {getTaskStatusLabel(d.linkedTaskStatus)}
              </Badge>
              <button
                type="button"
                className="text-muted-foreground hover:text-red-500"
                onClick={() => removeDep(d.id)}
                aria-label={`Remove dependency: ${d.linkedTaskTitle}`}
                data-testid={`dep-remove-${d.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {blocks.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Blocks</p>
          {blocks.map(d => (
            <div key={d.id} className="flex items-center gap-2 text-xs p-1.5 border rounded mb-1 bg-amber-50/50">
              <ArrowRight className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="flex-1 truncate">{d.linkedTaskTitle}</span>
              <Badge className={`text-[8px] ${getTaskStatusBadgeClass(d.linkedTaskStatus)}`}>
                {getTaskStatusLabel(d.linkedTaskStatus)}
              </Badge>
              <button
                type="button"
                className="text-muted-foreground hover:text-red-500"
                onClick={() => removeDep(d.id)}
                aria-label={`Remove dependency: ${d.linkedTaskTitle}`}
                data-testid={`dep-remove-${d.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={depType === "blocked_by"}
            className={`text-[10px] px-2 py-1 rounded font-medium ${depType === "blocked_by" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}
            onClick={() => setDepType("blocked_by")}
          >
            Blocked by
          </button>
          <button
            type="button"
            aria-pressed={depType === "blocks"}
            className={`text-[10px] px-2 py-1 rounded font-medium ${depType === "blocks" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}
            onClick={() => setDepType("blocks")}
          >
            Blocks
          </button>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks to link..."
          className="h-8 text-xs"
          data-testid="dep-search-input"
          disabled={adding}
        />
        {filtered.map(t => (
          <button
            key={t.id}
            className="w-full text-left p-2 text-xs border rounded hover:bg-muted/50 transition-colors flex items-center gap-2"
            onClick={() => addDep(t)}
            disabled={adding}
          >
            <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="truncate flex-1">{t.title}</span>
            <Badge className={`text-[8px] ${getTaskStatusBadgeClass(t.status)}`}>
              {getTaskStatusLabel(t.status)}
            </Badge>
          </button>
        ))}
      </div>
      {deps.length === 0 && !search && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No dependencies. Search for a task above to add one.
        </p>
      )}
    </div>
  );
}

export default TaskDependenciesPanel;
