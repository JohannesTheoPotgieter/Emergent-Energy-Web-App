/**
 * GovernedProcessList — Wave 3
 *
 * Filterable list of governed processes for embedding in department dashboards.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { GovernedProcessDetail } from "./GovernedProcessDetail";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, Plus, ChevronRight, CheckCircle, Clock, AlertCircle,
} from "lucide-react";

interface GovernedProcessSummary {
  id: number;
  process_type: string;
  status: string;
  title: string;
  owner_name: string | null;
  reviewer_name: string | null;
  phase_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  checklist_total: number;
  checklist_done: number;
}

interface GovernedProcessListProps {
  projectInstanceId?: number;
  processTypes?: string[];
  title?: string;
  showCreateButton?: boolean;
  defaultProcessType?: string;
}

const TYPE_LABELS: Record<string, string> = {
  pd_to_pm_handover: "PD→PM Handover",
  financial_review: "Financial Review",
  phase_gate_review: "Phase Gate Review",
  change_request: "Change Request",
  payment_batch: "Payment Batch",
  gate_exception: "Gate Exception",
};

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle; color: string }> = {
  draft: { icon: Clock, color: "text-muted-foreground" },
  in_progress: { icon: Clock, color: "text-blue-600" },
  awaiting_review: { icon: AlertCircle, color: "text-amber-600" },
  approved: { icon: CheckCircle, color: "text-emerald-600" },
  rejected: { icon: AlertCircle, color: "text-red-600" },
  completed: { icon: CheckCircle, color: "text-emerald-600" },
  cancelled: { icon: Clock, color: "text-muted-foreground" },
};

export function GovernedProcessList({
  projectInstanceId,
  processTypes,
  title = "Governed Processes",
  showCreateButton = true,
  defaultProcessType,
}: GovernedProcessListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProcess, setNewProcess] = useState({ processType: defaultProcessType || "", title: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryParams = new URLSearchParams();
  if (projectInstanceId) queryParams.set("projectInstanceId", String(projectInstanceId));
  if (processTypes && processTypes.length === 1) queryParams.set("type", processTypes[0]);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);

  const { data: processes, isLoading } = useQuery<GovernedProcessSummary[]>({
    queryKey: ["governed-processes", queryParams.toString()],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/governed-processes?${queryParams}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const filteredProcesses = processes?.filter((p) => {
    if (processTypes && processTypes.length > 1 && !processTypes.includes(p.process_type)) return false;
    return true;
  });

  const createMutation = useMutation({
    mutationFn: async (data: { processType: string; title: string }) => {
      const res = await apiRequest("POST", "/api/governed-processes", {
        processType: data.processType,
        projectInstanceId,
        title: data.title || undefined,
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["governed-processes"] });
      setCreateOpen(false);
      setNewProcess({ processType: defaultProcessType || "", title: "" });
      setSelectedId(result.id);
      toast({ title: "Process created" });
    },
    onError: () => {
      toast({ title: "Failed to create process", variant: "destructive" });
    },
  });

  // Show detail view if a process is selected
  if (selectedId) {
    return (
      <GovernedProcessDetail
        processId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="awaiting_review">Awaiting Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
            {showCreateButton && projectInstanceId && (
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                New
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {filteredProcesses && filteredProcesses.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No processes found.
          </div>
        )}

        {filteredProcesses && filteredProcesses.length > 0 && (
          <div className="space-y-2">
            {filteredProcesses.map((p) => {
              const statusIcon = STATUS_ICONS[p.status] || STATUS_ICONS.draft;
              const Icon = statusIcon.icon;
              const completionPct = p.checklist_total > 0 ? Math.round((p.checklist_done / p.checklist_total) * 100) : 0;

              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="w-full text-left flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <Icon className={cn("h-4 w-4 shrink-0", statusIcon.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-xs">
                        {TYPE_LABELS[p.process_type] || p.process_type}
                      </Badge>
                      {p.owner_name && <span>{p.owner_name}</span>}
                      <span>{completionPct}% complete</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Create Process Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Process</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Process Type *</Label>
              <Select value={newProcess.processType} onValueChange={(v) => setNewProcess((p) => ({ ...p, processType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {(processTypes || Object.keys(TYPE_LABELS)).map((type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type] || type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={newProcess.title} onChange={(e) => setNewProcess((p) => ({ ...p, title: e.target.value }))} placeholder="Optional — auto-generated if blank" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newProcess)} disabled={!newProcess.processType || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
