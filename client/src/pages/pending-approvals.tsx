import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/ui/loading-state";
import { Inbox, CheckCircle2, XCircle, AlertCircle, Clock } from "lucide-react";

type Status = "pending" | "approved" | "rejected" | "failed";

interface PendingRow {
  id: number;
  kind: string;
  targetTable: string;
  summary: string;
  payload: Record<string, unknown>;
  sourceLabel: string;
  sourceRef: string | null;
  status: Status;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: number | null;
  rejectionReason: string | null;
  appliedRecordId: string | null;
  applyError: string | null;
}

interface ListResponse {
  rows: PendingRow[];
  summary: { total: number; byKind: Record<string, number> };
}

const KIND_LABELS: Record<string, string> = {
  pipedrive_opportunity_create: "Pipedrive opportunity",
  pipedrive_client_create: "Pipedrive client",
  sharepoint_intake_request_create: "SharePoint intake",
  sharepoint_project_shell_create: "SharePoint project shell",
  cos_period_lock_create: "COS period lock",
  ee_info_update_seed: "EE info update",
};

function fmtKind(k: string): string {
  return KIND_LABELS[k] ?? k;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function PendingApprovalsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("pending");
  const [rejectTarget, setRejectTarget] = useState<PendingRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/pending-approvals", status],
    queryFn: async () => {
      const r = await fetch(`/api/pending-approvals?status=${status}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const approveMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/pending-approvals/${id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Approve failed");
      return r.json();
    },
    onSuccess: (row: PendingRow) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-approvals"] });
      if (row.status === "failed") {
        toast({ title: "Approval failed", description: row.applyError ?? "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Released", description: `Created ${row.targetTable} #${row.appliedRecordId}` });
      }
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: async (args: { id: number; reason: string }) => {
      const r = await fetch(`/api/pending-approvals/${args.id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: args.reason }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Reject failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-approvals"] });
      setRejectTarget(null);
      setRejectReason("");
      toast({ title: "Rejected" });
    },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? { total: 0, byKind: {} };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-pending-approvals">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Inbox className="h-7 w-7 text-emerald-600" />
            <h1 className="text-2xl font-semibold tracking-tight">Pending Approvals</h1>
            <Badge variant="secondary" data-testid="badge-pending-total">{summary.total} pending</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Every scheduled job, sync, and seed routes its proposed writes here. Nothing is created until you release it.
          </p>
        </div>
      </header>

      {summary.total > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.byKind).map(([k, n]) => (
            <Badge key={k} variant="outline" data-testid={`badge-kind-${k}`}>
              {fmtKind(k)}: {n}
            </Badge>
          ))}
        </div>
      )}

      <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">
            <Clock className="h-4 w-4 mr-1" /> Pending
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Approved
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            <XCircle className="h-4 w-4 mr-1" /> Rejected
          </TabsTrigger>
          <TabsTrigger value="failed" data-testid="tab-failed">
            <AlertCircle className="h-4 w-4 mr-1" /> Failed
          </TabsTrigger>
        </TabsList>

        <TabsContent value={status} className="mt-4 space-y-3">
          {isLoading && <LoadingState />}
          {!isLoading && rows.length === 0 && (
            <Card><CardContent className="py-10 text-center text-muted-foreground" data-testid="text-empty">
              Nothing here right now.
            </CardContent></Card>
          )}
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <Card key={row.id} data-testid={`card-approval-${row.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base font-medium" data-testid={`text-summary-${row.id}`}>
                        {row.summary}
                      </CardTitle>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{fmtKind(row.kind)}</Badge>
                        <span>from {row.sourceLabel}</span>
                        <span>· proposed {fmtTime(row.createdAt)}</span>
                        {row.decidedAt && <span>· decided {fmtTime(row.decidedAt)}</span>}
                      </div>
                      {row.applyError && (
                        <p className="text-xs text-red-600 mt-2" data-testid={`text-error-${row.id}`}>
                          Error: {row.applyError}
                        </p>
                      )}
                      {row.rejectionReason && (
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          Reason: {row.rejectionReason}
                        </p>
                      )}
                    </div>
                    {row.status === "pending" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={approveMut.isPending}
                          onClick={() => approveMut.mutate(row.id)}
                          data-testid={`button-approve-${row.id}`}
                        >
                          Release
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRejectTarget(row)}
                          data-testid={`button-reject-${row.id}`}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                    data-testid={`button-toggle-payload-${row.id}`}
                  >
                    {expanded ? "Hide" : "Show"} payload
                  </button>
                  {expanded && (
                    <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto max-h-72 overflow-y-auto">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this proposal?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{rejectTarget?.summary}</p>
          <Textarea
            placeholder="Reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            data-testid="input-reject-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} data-testid="button-cancel-reject">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectMut.isPending}
              onClick={() => rejectTarget && rejectMut.mutate({ id: rejectTarget.id, reason: rejectReason })}
              data-testid="button-confirm-reject"
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
