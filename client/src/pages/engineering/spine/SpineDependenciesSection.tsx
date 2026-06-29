/**
 * Dependencies section for the spine TaskDrawer.
 *
 * Reuses `work_item_dependencies` (FS only) via the spine endpoints:
 *   GET    /api/engineering/tasks/:id/dependencies          -> { blockedBy, blocks }
 *   GET    /api/engineering/tasks/:id/dependency-candidates -> { candidates }
 *   POST   /api/engineering/tasks/:id/dependencies          { dependsOnTaskId }
 *   DELETE /api/engineering/tasks/:id/dependencies/:depId
 *
 * A "Blocked" badge shows when any blockedBy dependency is not yet complete.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitBranch, Link2, Plus, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { isTaskComplete } from "@/lib/task-status";
import { getTaskStatusLabel } from "@shared/task-status";
import type { useToast } from "@/hooks/use-toast";
import type {
  SpineDependenciesResponse,
  SpineDependency,
  SpineDependencyCandidatesResponse,
} from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

const ADD_PLACEHOLDER = "__add__";

export function SpineDependenciesSection({
  taskId,
  open,
  toast,
}: {
  taskId: number;
  open: boolean;
  toast: ToastFn;
}) {
  const qc = useQueryClient();
  const [picker, setPicker] = useState(ADD_PLACEHOLDER);

  const depQuery = useQuery<SpineDependenciesResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "dependencies"],
    enabled: open,
  });
  const candidatesQuery = useQuery<SpineDependencyCandidatesResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "dependency-candidates"],
    enabled: open,
  });

  const blockedBy = useMemo(() => depQuery.data?.blockedBy ?? [], [depQuery.data]);
  const blocks = useMemo(() => depQuery.data?.blocks ?? [], [depQuery.data]);
  const candidates = candidatesQuery.data?.candidates ?? [];
  const isBlocked = blockedBy.some((d) => !isTaskComplete(d.status));

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "dependencies"] });
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "dependency-candidates"] });
  }

  const addMutation = useMutation({
    mutationFn: async (dependsOnTaskId: number) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/dependencies`, { dependsOnTaskId }),
    onSuccess: () => {
      setPicker(ADD_PLACEHOLDER);
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't add dependency",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const removeMutation = useMutation({
    mutationFn: async (depId: number) =>
      apiRequest("DELETE", `/api/engineering/tasks/${taskId}/dependencies/${depId}`),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast({
        title: "Couldn't remove dependency",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          Dependencies
        </Label>
        {isBlocked ? (
          <Badge variant="outline" className="border-red-200 bg-red-50 text-[10px] text-red-700" data-testid="dep-blocked-badge">
            Blocked
          </Badge>
        ) : null}
      </div>

      <DependencyList
        title="Blocked by"
        deps={blockedBy}
        loading={depQuery.isLoading}
        onRemove={(depId) => removeMutation.mutate(depId)}
        highlightOpen
      />
      <DependencyList
        title="Blocks"
        deps={blocks}
        loading={depQuery.isLoading}
        onRemove={(depId) => removeMutation.mutate(depId)}
      />

      <div className="flex items-center gap-2">
        <Select value={picker} onValueChange={setPicker}>
          <SelectTrigger className="h-8" data-testid="dep-picker">
            <SelectValue placeholder="Add a blocker…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ADD_PLACEHOLDER} disabled>
              Add a blocker…
            </SelectItem>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                <span className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={
                      "px-1 py-0 text-[9px] " +
                      (c.kind === "plan"
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : "border-border text-muted-foreground")
                    }
                  >
                    {c.kind === "plan" ? "Plan" : "Task"}
                  </Badge>
                  {c.title}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={picker === ADD_PLACEHOLDER || addMutation.isPending}
          onClick={() => addMutation.mutate(Number(picker))}
          data-testid="dep-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

function DependencyList({
  title,
  deps,
  loading,
  onRemove,
  highlightOpen = false,
}: {
  title: string;
  deps: SpineDependency[];
  loading: boolean;
  onRemove: (depId: number) => void;
  highlightOpen?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : deps.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1">
          {deps.map((d) => {
            const stillOpen = highlightOpen && !isTaskComplete(d.status);
            return (
              <li
                key={d.depId}
                className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs"
                data-testid={`dep-${d.depId}`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <Badge
                    variant="outline"
                    className={
                      "px-1 py-0 text-[9px] " +
                      (d.kind === "plan"
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : "border-border text-muted-foreground")
                    }
                  >
                    {d.kind === "plan" ? "Plan" : "Task"}
                  </Badge>
                  <span className="truncate">{d.title}</span>
                  <span className={"text-[10px] " + (stillOpen ? "text-red-600" : "text-muted-foreground")}>
                    {getTaskStatusLabel(d.status)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(d.depId)}
                  className="text-muted-foreground hover:text-red-600"
                  aria-label="Remove dependency"
                  data-testid={`dep-remove-${d.depId}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
