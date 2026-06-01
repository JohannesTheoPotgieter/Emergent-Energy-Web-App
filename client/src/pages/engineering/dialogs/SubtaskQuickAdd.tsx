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
import { useToast } from "@/hooks/use-toast";

export interface SubtaskQuickAddProps {
  taskId: number;
}

export function SubtaskQuickAdd({ taskId }: SubtaskQuickAddProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
    } catch (err) {
      // Surface the failure instead of silently dropping it — a subtask that
      // didn't save with no feedback is a trust bug.
      toast({ title: "Could not add subtask", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
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
      <Button type="submit" size="sm" className="h-8 px-3" disabled={!title.trim()} aria-label="Add subtask" data-testid="subtask-add-btn">
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
