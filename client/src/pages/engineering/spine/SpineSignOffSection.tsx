/**
 * Sign-off section for the spine TaskDrawer.
 *
 * Reuses `approvals` via the spine endpoints:
 *   POST /api/engineering/tasks/:id/sign-off { decision, kind, note? }
 *   GET  /api/engineering/tasks/:id/sign-offs -> { signOffs }
 *
 * Surfacing rules (by current task status):
 *   - 'needs_approval'                         -> QC Approve / Reject (kind 'qc')
 *   - 'qc_approved' | 'operational_approval'   -> Operational sign-off (kind 'operational')
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/task-formatters";
import type { useToast } from "@/hooks/use-toast";
import type { SpineSignOffKind, SpineSignOffDecision, SpineSignOffsResponse } from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

export function SpineSignOffSection({
  taskId,
  status,
  open,
  toast,
  onChanged,
}: {
  taskId: number;
  status: string;
  open: boolean;
  toast: ToastFn;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const query = useQuery<SpineSignOffsResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "sign-offs"],
    enabled: open,
  });
  const signOffs = useMemo(() => query.data?.signOffs ?? [], [query.data]);

  const showQc = status === "needs_approval";
  const showOperational = status === "qc_approved" || status === "operational_approval";

  const mutation = useMutation({
    mutationFn: async ({ decision, kind }: { decision: SpineSignOffDecision; kind: SpineSignOffKind }) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/sign-off`, {
        decision,
        kind,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "sign-offs"] });
      qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "comments"] });
      onChanged();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't record sign-off",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const activeKind: SpineSignOffKind | null = showQc ? "qc" : showOperational ? "operational" : null;

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <Label className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" />
        Sign-off
      </Label>

      {activeKind ? (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {activeKind === "qc" ? "QC review required." : "Operational sign-off required."}
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision note (optional)"
            className="min-h-[56px] text-sm"
            data-testid="sign-off-note"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ decision: "approved", kind: activeKind })}
              data-testid="sign-off-approve"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ decision: "rejected", kind: activeKind })}
              data-testid="sign-off-reject"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No sign-off action at this status.</p>
      )}

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">History</p>
        {query.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : signOffs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sign-offs yet.</p>
        ) : (
          <ul className="space-y-1">
            {signOffs.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs"
                data-testid={`sign-off-${s.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">
                      {s.kind}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        "px-1 py-0 text-[9px] " +
                        (s.decision === "approved"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-red-200 bg-red-50 text-red-700")
                      }
                    >
                      {s.decision}
                    </Badge>
                    <span className="text-muted-foreground">{s.decidedByName ?? "—"}</span>
                  </div>
                  {s.note ? <p className="mt-0.5 text-[11px] text-foreground/80">{s.note}</p> : null}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(s.decidedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
