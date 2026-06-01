/**
 * DeliverableControlActions — renders the button(s) a user can press to
 * advance a deliverable along the controlled-document lifecycle. Only
 * surfaces actions the user's role is actually allowed to perform; the
 * server re-enforces the same rule.
 *
 * Backend endpoints called (existing, unchanged):
 *   POST /api/eng-stages/deliverables/:id/issue-for-construction
 *   POST /api/eng-stages/deliverables/:id/mark-as-built
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { engFetchRaw as engFetch } from "@/lib/eng-fetch";
import {
  CONTROL_ACTIONS,
  canUserAct,
  deriveControlState,
  type ControlAction,
  type ControlState,
} from "@/lib/engineering-control-state";

interface DeliverableControlActionsProps {
  deliverable: {
    id: number;
    releasedFor?: string | null;
    approvalStatus?: string | null;
    uploadedBy?: number | null;
  };
  userRole: string;
  userId: number;
  /** Called after the action completes successfully. */
  onChanged?: () => void;
  /** Query key (or keys) to invalidate after a successful action. */
  invalidateKeys?: (string | number)[][];
  /** Test id prefix. */
  testIdPrefix?: string;
}

function endpointFor(to: ControlState, deliverableId: number): string | null {
  switch (to) {
    case "issued_for_construction":
      return `/api/eng-stages/deliverables/${deliverableId}/issue-for-construction`;
    case "as_built":
      return `/api/eng-stages/deliverables/${deliverableId}/mark-as-built`;
    default:
      return null;
  }
}

export function DeliverableControlActions({
  deliverable,
  userRole,
  userId,
  onChanged,
  invalidateKeys,
  testIdPrefix,
}: DeliverableControlActionsProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pendingTo, setPendingTo] = useState<ControlState | null>(null);
  // Issuing for construction releases a document for site use — confirm before
  // it fires so a stray click can't put an unreleased drawing on site.
  const [confirmAction, setConfirmAction] = useState<ControlAction | null>(null);

  const current = deriveControlState(deliverable);
  const candidates = CONTROL_ACTIONS[current] ?? [];
  const visibleActions = candidates.filter((a) => canUserAct(a, userRole));

  if (visibleActions.length === 0) return null;

  async function run(action: ControlAction) {
    // Client-side segregation of duties: the person who uploaded the
    // file cannot also issue it for construction. The server re-checks
    // this, but we hide the button for UX clarity.
    if (
      action.to === "issued_for_construction" &&
      deliverable.uploadedBy != null &&
      deliverable.uploadedBy === userId
    ) {
      toast({
        title: "Cannot issue your own upload",
        description:
          "Segregation of duties: a different engineer must issue this document for construction.",
        variant: "destructive",
      });
      return;
    }
    const url = endpointFor(action.to, deliverable.id);
    if (!url) return;
    setPendingTo(action.to);
    try {
      const res = await engFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || data?.error || "Action failed");
      }
      toast({
        title:
          action.to === "issued_for_construction"
            ? "Issued For Construction"
            : action.to === "as_built"
            ? "Marked As-Built"
            : "Updated",
        description:
          action.to === "issued_for_construction"
            ? "Document is now released for site use."
            : undefined,
      });
      if (invalidateKeys) {
        for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      }
      onChanged?.();
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setPendingTo(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleActions.map((action) => {
        const loading = pendingTo === action.to;
        const variant = action.tone === "danger" ? "destructive" : "default";
        const testId = testIdPrefix
          ? `${testIdPrefix}-${action.to}`
          : `deliverable-${deliverable.id}-${action.to}`;
        const needsConfirm = action.to === "issued_for_construction";
        return (
          <Button
            key={action.to}
            size="sm"
            variant={variant}
            className="h-6 text-[10px] gap-1"
            disabled={loading}
            onClick={() => (needsConfirm ? setConfirmAction(action) : run(action))}
            data-testid={testId}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            <span>{action.label}</span>
          </Button>
        );
      })}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title="Issue this document for construction?"
        description="This releases the document for site use. Anyone on the project can treat it as the construction-issue revision."
        confirmLabel="Issue for construction"
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action) run(action);
        }}
      />
    </div>
  );
}

export default DeliverableControlActions;
