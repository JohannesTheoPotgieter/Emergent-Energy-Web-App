import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { engFetch } from "@/lib/eng-fetch";
import { invalidateEngineeringTicketCaches } from "@/lib/task-cache";

/**
 * Project-scoped "Generate from Template" action for the Engineering board.
 *
 * Creates the standard engineering stage-checklist tasks for a single project
 * via POST /api/projects/:id/generate-eng-tasks. That endpoint is admin-only,
 * so callers MUST gate rendering on the user's permission (the button does not
 * re-check it). On success the board's task caches are invalidated so the new
 * tasks appear without a manual refresh.
 */
export function GenerateFromTemplateButton({ projectId, projectName }: { projectId: number; projectName?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const generate = useMutation<{ tasksCreated?: number }, Error>({
    mutationFn: () => engFetch(`/api/projects/${projectId}/generate-eng-tasks`, { method: "POST" }),
    onSuccess: (data) => {
      invalidateEngineeringTicketCaches(queryClient);
      setConfirmOpen(false);
      const n = data?.tasksCreated;
      toast({ title: typeof n === "number" ? `${n} engineering task${n === 1 ? "" : "s"} created` : "Engineering tasks generated" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs gap-1"
        onClick={() => setConfirmOpen(true)}
        disabled={generate.isPending}
        data-testid="button-generate-eng-tasks"
      >
        {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Generate from Template</span>
        <span className="sm:hidden">Generate</span>
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-generate-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ListPlus className="h-5 w-5" /> Generate Engineering Tasks
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will create engineering tasks from the project template for {projectName || "this project"}. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-generate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-generate"
              disabled={generate.isPending}
              onClick={(e) => {
                e.preventDefault();
                generate.mutate();
              }}
            >
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Generate Tasks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
