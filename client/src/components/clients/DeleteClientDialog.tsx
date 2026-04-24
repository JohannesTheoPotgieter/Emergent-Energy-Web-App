/**
 * Soft-delete a client (Task #73).
 *
 * The DELETE endpoint refuses with HTTP 409 + a per-table blocker
 * payload when live records still reference the client. In that case
 * this dialog flips into a "merge instead" pivot so the user can solve
 * the duplicate without leaving the row.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ApiError } from "@/lib/api-error";

interface ClientLite {
  id: number;
  clientId: string;
  name: string;
}

export interface DeleteClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientLite | null;
  /** Called when the user clicks "Merge instead" (or when blockers
   *  force them to). The parent should open MergeClientDialog. */
  onPivotToMerge?: (client: ClientLite) => void;
  onDeleted?: () => void;
}

const PRETTY_BLOCKER_LABELS: Record<string, string> = {
  projects: "linked projects",
  opportunities: "open opportunities",
  engineering_tickets: "engineering tickets",
};

export function DeleteClientDialog(props: DeleteClientDialogProps) {
  const { open, onOpenChange, client, onPivotToMerge, onDeleted } = props;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [blockers, setBlockers] = useState<Record<string, number> | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // `apiRequest` adds bearer + CSRF and throws an ApiError on non-2xx,
      // so the 409-blocker payload arrives via the thrown error's body
      // instead of a manual res.status branch.
      try {
        const res = await apiRequest("DELETE", `/api/pd/clients/${client!.id}`);
        return res.json();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const body = (err.body ?? {}) as { error?: string; blockers?: Record<string, number> };
          const wrapped = new Error(body.error || "Delete blocked") as Error & {
            blockers?: Record<string, number>;
          };
          wrapped.blockers = body.blockers ?? {};
          throw wrapped;
        }
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["/api/pd/clients"] });
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      qc.invalidateQueries({ queryKey: ["clients-project-counts"] });
      toast({ title: `Deleted ${client?.name}` });
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (err: Error & { blockers?: Record<string, number> }) => {
      if (err.blockers) {
        setBlockers(err.blockers);
        return;
      }
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  // Reset blockers each time the dialog re-opens for a new client.
  const handleOpenChange = (next: boolean) => {
    if (!next) setBlockers(null);
    onOpenChange(next);
  };

  const blockerEntries = blockers
    ? Object.entries(blockers).filter(([, n]) => n > 0)
    : [];
  const hasBlockers = blockerEntries.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-delete-client">
        <DialogHeader>
          <DialogTitle>
            {hasBlockers ? "Cannot delete this client" : "Delete client"}
          </DialogTitle>
          <DialogDescription>
            {hasBlockers ? (
              <>This client still has live records attached. Re-assign or merge them first.</>
            ) : (
              <>
                Soft-delete <strong>{client?.name}</strong>? It will disappear from pickers and
                listings, but the underlying row stays in the database for audit.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {hasBlockers ? (
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium">{client?.name}</p>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground" data-testid="list-delete-blockers">
                  {blockerEntries.map(([table, count]) => (
                    <li key={table} data-testid={`blocker-${table}`}>
                      <span className="font-mono">{count}</span>{" "}
                      {PRETTY_BLOCKER_LABELS[table] ?? table}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              The cleanest fix is usually to merge this client into the canonical one, which moves
              every linked record over and soft-deletes the duplicate in a single step.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>You can restore this client later via the API. Pickers and reports will hide it immediately.</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-delete-cancel">
            Cancel
          </Button>
          {hasBlockers && client && onPivotToMerge ? (
            <Button
              onClick={() => {
                onPivotToMerge(client);
                handleOpenChange(false);
              }}
              data-testid="button-delete-pivot-to-merge"
            >
              Merge instead…
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete client"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
