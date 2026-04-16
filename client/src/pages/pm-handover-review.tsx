import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";

async function loadQueue() {
  const res = await fetch("/api/pd-pm-handover/submitted", { credentials: "include" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ||
        "Could not load PM review queue. Likely reason: temporary server or network issue. How to fix: refresh and retry. If it persists, contact your admin.",
    );
  }
  return body;
}

export default function PmHandoverReviewPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { allowed: canApprove } = usePermission("handover", "approve");
  const [rejectTarget, setRejectTarget] = useState<{ projectId: number; projectName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { data, isLoading, error, refetch, isRefetching } = useQuery<{ items: any[] }>({
    queryKey: ["pm-handover-review"],
    queryFn: loadQueue,
    retry: false,
  });
  const actionMutation = useMutation({
    mutationFn: async ({ projectId, action, reason }: { projectId: number; action: "accept" | "reject"; reason?: string }) => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Could not ${action} handover.`);
      return body;
    },
    onSuccess: (_data, vars) => {
      toast({ title: vars.action === "accept" ? "Handover accepted" : "Handover rejected" });
      qc.invalidateQueries({ queryKey: ["pm-handover-review"] });
      qc.invalidateQueries({ queryKey: ["/api/pd-pm-handover/control"] });
    },
    onError: (err: any) => toast({ title: "Action failed", description: err?.message || "Please retry.", variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">PM Handover Review Queue</h1>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading review queue...</p> : null}

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700 space-y-2">
            <div className="font-semibold inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Could not load PM review queue.
            </div>
            <p>{(error as Error).message}</p>
            <button className="text-sm underline font-medium" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching ? "Retrying..." : "Retry queue load"}
            </button>
          </CardContent>
        </Card>
      ) : null}

      {(data?.items || []).map((i) => (
        <div key={i.project_id} className="border rounded p-3 flex items-center justify-between">
          <div>
            <p className="font-medium">{i.project_name}</p>
            <p className="text-xs text-muted-foreground">Status: {i.status} · PD: {i.pd || "—"} · PM: {i.pm || "—"}</p>
          </div>
          <div className="flex items-center gap-2">
            {canApprove && i.status === "SUBMITTED_FOR_PM_REVIEW" && (
              <>
                <Button
                  size="sm"
                  onClick={() => actionMutation.mutate({ projectId: i.project_id, action: "accept" })}
                  disabled={actionMutation.isPending}
                  data-testid={`btn-accept-handover-${i.project_id}`}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setRejectTarget({ projectId: i.project_id, projectName: i.project_name });
                    setRejectReason("");
                  }}
                  disabled={actionMutation.isPending}
                  data-testid={`btn-reject-handover-${i.project_id}`}
                >
                  Reject
                </Button>
              </>
            )}
            <Link href={`/pd/handover/${i.project_id}`} className="text-blue-600 underline">Review handover</Link>
          </div>
        </div>
      ))}

      {!error && !isLoading && (data?.items || []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No submitted or recently returned handovers are waiting for PM review.</p>
      ) : null}

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject handover</DialogTitle>
            <DialogDescription>
              {rejectTarget ? `Reject the PD→PM handover for "${rejectTarget.projectName}".` : ""} The reason is stored in
              the handover history and shown to the PD team.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="What is missing or incorrect? Be specific enough for PD to act on it."
            className="min-h-[120px]"
            data-testid="textarea-reject-reason"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
              disabled={actionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={actionMutation.isPending || !rejectReason.trim()}
              onClick={() => {
                if (!rejectTarget || !rejectReason.trim()) return;
                actionMutation.mutate(
                  { projectId: rejectTarget.projectId, action: "reject", reason: rejectReason.trim() },
                  {
                    onSuccess: () => {
                      setRejectTarget(null);
                      setRejectReason("");
                    },
                  },
                );
              }}
              data-testid="btn-confirm-reject-handover"
            >
              {actionMutation.isPending ? "Submitting…" : "Reject handover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
