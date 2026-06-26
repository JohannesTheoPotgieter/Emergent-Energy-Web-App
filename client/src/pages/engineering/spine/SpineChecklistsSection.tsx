/**
 * Checklists section for the spine TaskDrawer.
 *
 * Reuses `task_checklists` + `task_checklist_items` via the spine endpoints:
 *   GET    /api/engineering/tasks/:id/checklists
 *   POST   /api/engineering/tasks/:id/checklists                 { title }
 *   DELETE /api/engineering/tasks/:id/checklists/:checklistId
 *   POST   /api/engineering/tasks/:id/checklists/:checklistId/items { content }
 *   PATCH  /api/engineering/tasks/:id/checklist-items/:itemId    { isDone?, content? }
 *   DELETE /api/engineering/tasks/:id/checklist-items/:itemId
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { useToast } from "@/hooks/use-toast";
import type { SpineChecklist, SpineChecklistsResponse } from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

export function SpineChecklistsSection({
  taskId,
  open,
  toast,
}: {
  taskId: number;
  open: boolean;
  toast: ToastFn;
}) {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");

  const query = useQuery<SpineChecklistsResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "checklists"],
    enabled: open,
  });
  const checklists = useMemo(() => query.data?.checklists ?? [], [query.data]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "checklists"] });
  }

  function onError(title: string) {
    return (e: unknown) =>
      toast({ title, description: e instanceof Error ? e.message : undefined, variant: "destructive" });
  }

  const addChecklistMutation = useMutation({
    mutationFn: async (title: string) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/checklists`, { title }),
    onSuccess: () => {
      setNewTitle("");
      invalidate();
    },
    onError: onError("Couldn't add checklist"),
  });

  const deleteChecklistMutation = useMutation({
    mutationFn: async (checklistId: number) =>
      apiRequest("DELETE", `/api/engineering/tasks/${taskId}/checklists/${checklistId}`),
    onSuccess: invalidate,
    onError: onError("Couldn't delete checklist"),
  });

  const addItemMutation = useMutation({
    mutationFn: async ({ checklistId, content }: { checklistId: number; content: string }) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/checklists/${checklistId}/items`, { content }),
    onSuccess: invalidate,
    onError: onError("Couldn't add item"),
  });

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, isDone }: { itemId: number; isDone: boolean }) =>
      apiRequest("PATCH", `/api/engineering/tasks/${taskId}/checklist-items/${itemId}`, { isDone }),
    onSuccess: invalidate,
    onError: onError("Couldn't update item"),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: number) =>
      apiRequest("DELETE", `/api/engineering/tasks/${taskId}/checklist-items/${itemId}`),
    onSuccess: invalidate,
    onError: onError("Couldn't delete item"),
  });

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <ListChecks className="h-3.5 w-3.5" />
        Checklists
      </Label>

      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading checklists…</p>
      ) : checklists.length === 0 ? (
        <p className="text-xs text-muted-foreground">No checklists yet.</p>
      ) : (
        <div className="space-y-2">
          {checklists.map((cl) => (
            <ChecklistBlock
              key={cl.id}
              checklist={cl}
              onAddItem={(content) => addItemMutation.mutate({ checklistId: cl.id, content })}
              onToggleItem={(itemId, isDone) => toggleItemMutation.mutate({ itemId, isDone })}
              onDeleteItem={(itemId) => deleteItemMutation.mutate(itemId)}
              onDeleteChecklist={() => deleteChecklistMutation.mutate(cl.id)}
              busy={addItemMutation.isPending || toggleItemMutation.isPending || deleteItemMutation.isPending}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New checklist…"
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTitle.trim()) addChecklistMutation.mutate(newTitle.trim());
          }}
          data-testid="checklist-input"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!newTitle.trim() || addChecklistMutation.isPending}
          onClick={() => addChecklistMutation.mutate(newTitle.trim())}
          data-testid="checklist-add"
        >
          {addChecklistMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </Button>
      </div>
    </div>
  );
}

function ChecklistBlock({
  checklist,
  onAddItem,
  onToggleItem,
  onDeleteItem,
  onDeleteChecklist,
  busy,
}: {
  checklist: SpineChecklist;
  onAddItem: (content: string) => void;
  onToggleItem: (itemId: number, isDone: boolean) => void;
  onDeleteItem: (itemId: number) => void;
  onDeleteChecklist: () => void;
  busy: boolean;
}) {
  const [openState, setOpenState] = useState(true);
  const [itemContent, setItemContent] = useState("");

  const total = checklist.items.length;
  const done = checklist.items.filter((i) => i.isDone).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Collapsible
      open={openState}
      onOpenChange={setOpenState}
      className="rounded-md border border-border/60"
      data-testid={`checklist-${checklist.id}`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex flex-1 items-center gap-1.5 text-left text-xs font-medium">
            {openState ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className="truncate">{checklist.title}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {done}/{total}
            </span>
          </button>
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={onDeleteChecklist}
          className="text-muted-foreground hover:text-red-600"
          aria-label="Delete checklist"
          data-testid={`checklist-delete-${checklist.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {total > 0 ? <Progress value={pct} className="mx-2 h-1" /> : null}
      <CollapsibleContent className="space-y-1 px-2 py-2">
        {checklist.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-xs" data-testid={`checklist-item-${item.id}`}>
            <Checkbox
              className="h-4 w-4"
              checked={item.isDone}
              disabled={busy}
              onCheckedChange={(checked) => onToggleItem(item.id, checked === true)}
              aria-label={item.isDone ? "Mark incomplete" : "Mark complete"}
            />
            <span className={cn("flex-1", item.isDone && "text-muted-foreground line-through")}>{item.content}</span>
            <button
              type="button"
              onClick={() => onDeleteItem(item.id)}
              className="text-muted-foreground hover:text-red-600"
              aria-label="Delete item"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={itemContent}
            onChange={(e) => setItemContent(e.target.value)}
            placeholder="Add an item…"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && itemContent.trim()) {
                onAddItem(itemContent.trim());
                setItemContent("");
              }
            }}
            data-testid={`checklist-item-input-${checklist.id}`}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={!itemContent.trim()}
            onClick={() => {
              onAddItem(itemContent.trim());
              setItemContent("");
            }}
            aria-label="Add item"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
