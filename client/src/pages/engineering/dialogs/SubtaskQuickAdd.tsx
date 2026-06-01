/**
 * Subtask quick-add form — extracted from EngineeringTaskDrawer.
 *
 * The newSubtaskTitle useState used to sit on the drawer; here it's local so
 * typing in the field doesn't re-render the rest of the drawer.
 */
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { engFetch } from "@/lib/eng-fetch";

export interface SubtaskQuickAddProps {
  taskId: number;
}

export function SubtaskQuickAdd({ taskId }: SubtaskQuickAddProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState<string>("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await engFetch(`/api/eng/tasks/${taskId}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ title: trimmed }),
      });
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["task-subtasks", taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", taskId] });
    } catch {
      // Drawer-level error toasts are handled by other mutations; staying
      // silent here matches the previous in-place behaviour.
    }
  }

  return (
    <form className="flex gap-2" data-testid="subtask-create-form" onSubmit={onSubmit}>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a subtask..."
        className="h-8 text-xs"
        data-testid="subtask-title-input"
      />
      <Button type="submit" size="sm" className="h-8 px-3" disabled={!title.trim()} data-testid="subtask-add-btn">
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
