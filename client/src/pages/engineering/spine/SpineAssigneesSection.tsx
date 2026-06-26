/**
 * Assignees section for the spine TaskDrawer.
 *
 * Reuses `work_item_assignments` (role 'ASSIGNEE') via the spine endpoints:
 *   GET    /api/engineering/tasks/:id/assignees
 *   POST   /api/engineering/tasks/:id/assignees   { userId, role? }
 *   DELETE /api/engineering/tasks/:id/assignees/:userId
 *
 * The OWNER row comes back from the GET and is shown distinctly; it is NOT
 * removable here (owner is managed via the drawer's owner PATCH).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Crown, Plus, Users, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getAvatarColor, getInitials } from "@/lib/task-formatters";
import type { useToast } from "@/hooks/use-toast";
import type { SpineAssigneesResponse } from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

const ADD_PLACEHOLDER = "__add__";

export function SpineAssigneesSection({
  taskId,
  open,
  toast,
  users,
  onChanged,
}: {
  taskId: number;
  open: boolean;
  toast: ToastFn;
  users: { id: number; name: string }[];
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [picker, setPicker] = useState(ADD_PLACEHOLDER);

  const query = useQuery<SpineAssigneesResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "assignees"],
    enabled: open,
  });
  const assignees = useMemo(() => query.data?.assignees ?? [], [query.data]);
  const assignedIds = useMemo(() => new Set(assignees.map((a) => a.userId)), [assignees]);
  const addable = users.filter((u) => !assignedIds.has(u.id));

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "assignees"] });
    onChanged();
  }

  const addMutation = useMutation({
    mutationFn: async (userId: number) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/assignees`, { userId, role: "ASSIGNEE" }),
    onSuccess: () => {
      setPicker(ADD_PLACEHOLDER);
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't add assignee",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: number) =>
      apiRequest("DELETE", `/api/engineering/tasks/${taskId}/assignees/${userId}`),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast({
        title: "Couldn't remove assignee",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" />
        Assignees
      </Label>

      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading assignees…</p>
      ) : assignees.length === 0 ? (
        <p className="text-xs text-muted-foreground">No assignees yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {assignees.map((a) => {
            const isOwner = a.role === "OWNER";
            return (
              <span
                key={`${a.userId}-${a.role}`}
                className={
                  "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs " +
                  (isOwner ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-border bg-muted/40")
                }
                data-testid={`assignee-${a.userId}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white ${getAvatarColor(a.name)}`}
                >
                  {getInitials(a.name)}
                </span>
                <span className="max-w-[120px] truncate">{a.name}</span>
                {isOwner ? (
                  <Crown className="h-3 w-3 text-emerald-600" aria-label="Owner" />
                ) : (
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(a.userId)}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label={`Remove ${a.name}`}
                    data-testid={`assignee-remove-${a.userId}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Select value={picker} onValueChange={setPicker}>
          <SelectTrigger className="h-8" data-testid="assignee-picker">
            <SelectValue placeholder="Add assignee…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ADD_PLACEHOLDER} disabled>
              Add assignee…
            </SelectItem>
            {addable.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={picker === ADD_PLACEHOLDER || addMutation.isPending}
          onClick={() => addMutation.mutate(Number(picker))}
          data-testid="assignee-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
