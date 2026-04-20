import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiRequest } from "@/lib/queryClient";
import { useUserOptions } from "./usePriorityPickers";

/**
 * Single-priority reassignment dialog. Used from the Department tab card's
 * "Assign Priority" / "Reassign" button.
 */
export function AssignPriorityDialog({
  open,
  onOpenChange,
  priorityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priorityId: number | null;
}) {
  const [userId, setUserId] = useState("");
  const queryClient = useQueryClient();
  const userOptions = useUserOptions(open);

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!priorityId) return;
      await apiRequest("PUT", `/api/priorities/${priorityId}`, {
        assigned_user_id: userId ? parseInt(userId, 10) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      if (priorityId) {
        queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      }
      setUserId("");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Priority</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Assign this priority to a team member. They'll see it in their "My Priorities" tab.
          </p>
          <div>
            <Label className="text-xs">Assign to</Label>
            <SearchableSelect
              options={userOptions}
              value={userId}
              onValueChange={setUserId}
              placeholder="Select person"
              searchPlaceholder="Search people..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => assignMutation.mutate()} disabled={!userId || assignMutation.isPending}>
            {assignMutation.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Multi-select reassignment — opened from the bulk-action bar when N > 0
 * priorities are selected. Loops existing per-id PUTs in the parent's
 * `onConfirm` handler.
 */
export function BulkReassignDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (userId: number) => void;
  isPending: boolean;
}) {
  const [userId, setUserId] = useState("");
  const userOptions = useUserOptions(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign {selectedCount} priorit{selectedCount === 1 ? "y" : "ies"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">All selected priorities will be assigned to this person.</p>
          <div>
            <Label className="text-xs">Assign to</Label>
            <SearchableSelect
              options={userOptions}
              value={userId}
              onValueChange={setUserId}
              placeholder="Select person"
              searchPlaceholder="Search people..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (!userId) return;
              onConfirm(parseInt(userId, 10));
            }}
            disabled={!userId || isPending}
          >
            {isPending ? "Reassigning..." : `Reassign ${selectedCount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
