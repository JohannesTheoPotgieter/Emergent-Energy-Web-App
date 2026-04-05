/**
 * GovernedProcessDetail — Wave 3
 *
 * Detail view for a single governed process.
 * Shows process header, checklist with status toggles, and action buttons.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CheckCircle, Clock, AlertCircle, ArrowRight, ShieldCheck, X, Play, Send,
} from "lucide-react";

interface GovernedProcessDetailProps {
  processId: number;
  onClose?: () => void;
}

interface ChecklistItem {
  id: number;
  item_code: string;
  title: string;
  category: string;
  status: string;
  blocks_gate: boolean;
  evidence_url: string | null;
  notes: string | null;
  owner_name: string | null;
  completed_at: string | null;
}

interface ProcessDetail {
  process: {
    id: number;
    process_type: string;
    status: string;
    title: string;
    owner_name: string | null;
    reviewer_name: string | null;
    phase_name: string | null;
    started_at: string | null;
    completed_at: string | null;
    process_data: any;
  };
  checklistItems: ChecklistItem[];
}

const STATUS_STYLES: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  draft: { label: "Draft", color: "bg-muted text-muted-foreground", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700", icon: Play },
  awaiting_review: { label: "Awaiting Review", color: "bg-amber-100 text-amber-700", icon: Send },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700", icon: X },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700", icon: ShieldCheck },
  cancelled: { label: "Cancelled", color: "bg-muted text-muted-foreground", icon: X },
};

const TYPE_LABELS: Record<string, string> = {
  pd_to_pm_handover: "PD→PM Handover",
  financial_review: "Financial Review",
  phase_gate_review: "Phase Gate Review",
  change_request: "Change Request",
  payment_batch: "Payment Batch",
  gate_exception: "Gate Exception",
};

export function GovernedProcessDetail({ processId, onClose }: GovernedProcessDetailProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ProcessDetail>({
    queryKey: ["governed-process", processId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/governed-processes/${processId}`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/governed-processes/${processId}`, { status: newStatus });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["governed-process", processId] });
      queryClient.invalidateQueries({ queryKey: ["governed-processes"] });
      toast({ title: "Process updated" });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message || "Check checklist items", variant: "destructive" });
    },
  });

  const checklistMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/governed-processes/${processId}/checklist/${itemId}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["governed-process", processId] });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4">
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { process, checklistItems } = data;
  const statusStyle = STATUS_STYLES[process.status] || STATUS_STYLES.draft;
  const StatusIcon = statusStyle.icon;
  const completedCount = checklistItems.filter((i) => i.status === "complete" || i.status === "not_applicable").length;
  const blockingIncomplete = checklistItems.filter((i) => i.blocks_gate && i.status !== "complete" && i.status !== "not_applicable").length;
  const isTerminal = ["approved", "completed", "cancelled"].includes(process.status);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <Badge className={cn("text-xs mb-1", statusStyle.color)}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusStyle.label}
            </Badge>
            <CardTitle className="text-base">{process.title}</CardTitle>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{TYPE_LABELS[process.process_type] || process.process_type}</span>
              {process.owner_name && <span>Owner: {process.owner_name}</span>}
              {process.reviewer_name && <span>Reviewer: {process.reviewer_name}</span>}
              {process.phase_name && <span>Phase: {process.phase_name}</span>}
            </div>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Progress */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="text-muted-foreground">Checklist:</span>
          <span className="font-medium">{completedCount}/{checklistItems.length} complete</span>
          {blockingIncomplete > 0 && (
            <Badge variant="destructive" className="text-xs">{blockingIncomplete} blocking</Badge>
          )}
        </div>

        {/* Checklist */}
        <div className="space-y-2 mb-4">
          {checklistItems.map((item) => {
            const isComplete = item.status === "complete" || item.status === "not_applicable";
            return (
              <div key={item.id} className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2",
                isComplete && "bg-muted/50"
              )}>
                <Checkbox
                  checked={isComplete}
                  disabled={isTerminal}
                  onCheckedChange={(checked) => {
                    checklistMutation.mutate({
                      itemId: item.id,
                      status: checked ? "complete" : "pending",
                    });
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm", isComplete && "line-through text-muted-foreground")}>
                    {item.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                    {item.blocks_gate && !isComplete && (
                      <Badge variant="destructive" className="text-xs">Blocks gate</Badge>
                    )}
                  </div>
                </div>
                {isComplete && <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        {!isTerminal && (
          <div className="flex gap-2 border-t pt-3">
            {process.status === "draft" && (
              <Button size="sm" onClick={() => statusMutation.mutate("in_progress")}>
                <Play className="h-4 w-4 mr-1" />
                Start Process
              </Button>
            )}
            {process.status === "in_progress" && (
              <Button size="sm" onClick={() => statusMutation.mutate("awaiting_review")}>
                <Send className="h-4 w-4 mr-1" />
                Submit for Review
              </Button>
            )}
            {process.status === "awaiting_review" && (
              <>
                <Button size="sm" onClick={() => statusMutation.mutate("approved")} disabled={blockingIncomplete > 0}>
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => statusMutation.mutate("rejected")}>
                  <X className="h-4 w-4 mr-1" />
                  Reject
                </Button>
              </>
            )}
            {process.status === "rejected" && (
              <Button size="sm" onClick={() => statusMutation.mutate("in_progress")}>
                <ArrowRight className="h-4 w-4 mr-1" />
                Reopen
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => statusMutation.mutate("cancelled")}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
