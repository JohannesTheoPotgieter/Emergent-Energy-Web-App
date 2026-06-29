/**
 * Subtasks section for the spine TaskDrawer.
 *
 * Reuses `work_items.parentId` via the spine endpoints:
 *   GET  /api/engineering/tasks/:id/subtasks
 *   POST /api/engineering/tasks/:id/subtasks   { title }
 *   PATCH /api/engineering/tasks/:subId/status { status }   (complete toggle)
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ListTree, Loader2, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { isTaskComplete } from "@/lib/task-status";
import type { useToast } from "@/hooks/use-toast";
import type { SpineSubtasksResponse } from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

export function SpineSubtasksSection({
  taskId,
  open,
  toast,
  onChanged,
}: {
  taskId: number;
  open: boolean;
  toast: ToastFn;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");

  const query = useQuery<SpineSubtasksResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "subtasks"],
    enabled: open,
  });
  const subtasks = useMemo(() => query.data?.subtasks ?? [], [query.data]);

  const total = subtasks.length;
  const done = subtasks.filter((s) => isTaskComplete(s.status)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "subtasks"] });
    onChanged();
  }

  const addMutation = useMutation({
    mutationFn: async (value: string) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/subtasks`, { title: value }),
    onSuccess: () => {
      setTitle("");
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't add subtask",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ subId, status }: { subId: number; status: string }) =>
      apiRequest("PATCH", `/api/engineering/tasks/${subId}/status`, { status }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast({
        title: "Couldn't update subtask",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <ListTree className="h-3.5 w-3.5" />
          Subtasks
        </Label>
        {total > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{total}
          </span>
        ) : null}
      </div>

      {total > 0 ? <Progress value={pct} className="h-1.5" /> : null}

      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading subtasks…</p>
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground">No subtasks yet.</p>
      ) : (
        <ul className="space-y-1">
          {subtasks.map((s) => {
            const complete = isTaskComplete(s.status);
            return (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
                data-testid={`subtask-${s.id}`}
              >
                <Checkbox
                  className="h-4 w-4"
                  checked={complete}
                  disabled={toggleMutation.isPending}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({ subId: s.id, status: checked === true ? "complete" : "to_do" })
                  }
                  aria-label={complete ? "Mark subtask incomplete" : "Mark subtask complete"}
                />
                <span className={complete ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{s.title}</span>
                {s.ownerName ? <span className="text-[10px] text-muted-foreground">{s.ownerName}</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a subtask…"
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) addMutation.mutate(title.trim());
          }}
          data-testid="subtask-input"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!title.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate(title.trim())}
          data-testid="subtask-add"
        >
          {addMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </Button>
      </div>
    </div>
  );
}
