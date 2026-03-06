import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  CheckCircle, Circle, ArrowRight, ChevronDown, ChevronUp,
  History, Loader2, RotateCcw, ShieldCheck, Lock,
} from "lucide-react";

function authFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

interface GateData {
  gateId: string;
  label: string;
  fromRole: string;
  toRole: string;
  checklist: string[];
  checkedItems: string[];
  status: string;
  completedAt: string | null;
  completedByName: string | null;
}

interface HistoryEntry {
  id: number;
  gateId: string;
  action: string;
  performedByName: string;
  performedByRole: string;
  performedAt: string;
  details: any;
}

function GateCard({ gate, projectId, isAdmin }: { gate: GateData; projectId: number; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [checkedItems, setCheckedItems] = useState<string[]>(gate.checkedItems);
  const [notes, setNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const isComplete = gate.status === "COMPLETE";
  const allChecked = gate.checklist.every(item => checkedItems.includes(item));

  const updateChecklistMutation = useMutation({
    mutationFn: async (items: string[]) => {
      const res = await authFetch(`/api/projects/${projectId}/handover-gates/${gate.gateId}/update-checklist`, {
        method: "POST",
        body: JSON.stringify({ checkedItems: items }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/handover-gates/${gate.gateId}/complete`, {
        method: "POST",
        body: JSON.stringify({ checkedItems, notes: notes || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to complete gate");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: `Gate "${gate.label}" completed` });
      qc.invalidateQueries({ queryKey: ["handover-gates", projectId] });
      qc.invalidateQueries({ queryKey: ["handover-history", projectId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/handover-gates/${gate.gateId}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason: reopenReason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to reopen gate");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: `Gate "${gate.label}" reopened` });
      setShowReopen(false);
      setReopenReason("");
      qc.invalidateQueries({ queryKey: ["handover-gates", projectId] });
      qc.invalidateQueries({ queryKey: ["handover-history", projectId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCheckChange = (item: string, checked: boolean) => {
    const updated = checked ? [...checkedItems, item] : checkedItems.filter(i => i !== item);
    setCheckedItems(updated);
    updateChecklistMutation.mutate(updated);
  };

  return (
    <Card className={`transition-all ${isComplete ? "border-emerald-200 bg-emerald-50/30" : "border-border"}`} data-testid={`gate-card-${gate.gateId}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        data-testid={`gate-header-${gate.gateId}`}
      >
        {isComplete ? (
          <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{gate.label}</span>
            <Badge variant={isComplete ? "default" : "secondary"} className={`text-[10px] ${isComplete ? "bg-emerald-600" : ""}`}>
              {isComplete ? "Complete" : "Pending"}
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <span>{gate.fromRole}</span>
            <ArrowRight className="h-3 w-3" />
            <span>{gate.toRole}</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {checkedItems.length}/{gate.checklist.length}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </div>

      {expanded && (
        <CardContent className="pt-0 pb-4 px-4 space-y-3">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isComplete ? "bg-emerald-500" : "bg-blue-500"}`}
              style={{ width: `${(checkedItems.length / gate.checklist.length) * 100}%` }}
            />
          </div>

          <div className="space-y-2">
            {gate.checklist.map(item => {
              const checked = checkedItems.includes(item);
              return (
                <label key={item} className={`flex items-start gap-2.5 p-2 rounded-md transition-colors ${isComplete ? "opacity-70" : "hover:bg-muted/50"}`}>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => handleCheckChange(item, !!c)}
                    disabled={isComplete}
                    data-testid={`checklist-item-${gate.gateId}-${item.substring(0, 20).replace(/\s/g, '-')}`}
                  />
                  <span className={`text-xs leading-relaxed ${checked ? "line-through text-muted-foreground" : ""}`}>{item}</span>
                </label>
              );
            })}
          </div>

          {!isComplete && (
            <div className="space-y-2 pt-2 border-t">
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes for this handover..."
                className="text-xs min-h-[60px]"
                data-testid={`gate-notes-${gate.gateId}`}
              />
              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={!allChecked || completeMutation.isPending}
                onClick={() => completeMutation.mutate()}
                data-testid={`button-complete-gate-${gate.gateId}`}
              >
                {completeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Complete Gate
              </Button>
              {!allChecked && (
                <p className="text-[10px] text-muted-foreground text-center">
                  All checklist items must be checked before completing
                </p>
              )}
            </div>
          )}

          {isComplete && (
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Completed by {gate.completedByName}</span>
                <span>{gate.completedAt ? new Date(gate.completedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }) : ""}</span>
              </div>
              {isAdmin && !showReopen && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs" onClick={() => setShowReopen(true)} data-testid={`button-reopen-gate-${gate.gateId}`}>
                  <RotateCcw className="h-3 w-3" /> Reopen Gate
                </Button>
              )}
              {showReopen && (
                <div className="space-y-2 p-2 rounded-md bg-amber-50 border border-amber-200">
                  <Textarea
                    value={reopenReason}
                    onChange={e => setReopenReason(e.target.value)}
                    placeholder="Reason for reopening..."
                    className="text-xs min-h-[50px]"
                    data-testid={`reopen-reason-${gate.gateId}`}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setShowReopen(false)}>Cancel</Button>
                    <Button size="sm" variant="destructive" className="flex-1 text-xs gap-1" disabled={!reopenReason.trim() || reopenMutation.isPending} onClick={() => reopenMutation.mutate()} data-testid={`button-confirm-reopen-${gate.gateId}`}>
                      {reopenMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Confirm Reopen
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function HandoverGatePanel({ projectId }: { projectId: number }) {
  const [showHistory, setShowHistory] = useState(false);
  const { user } = useAuth();

  const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin", "PROGRAM_MANAGER"];
  const isAdmin = user?.role ? ADMIN_ROLES.includes(user.role) : false;

  const { data, isLoading } = useQuery<{ projectId: number; projectName: string; gates: GateData[] }>({
    queryKey: ["handover-gates", projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/handover-gates`);
      if (!res.ok) return { projectId, projectName: "", gates: [] };
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: historyData } = useQuery<{ history: HistoryEntry[] }>({
    queryKey: ["handover-history", projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/handover-history`);
      if (!res.ok) return { history: [] };
      return res.json();
    },
    enabled: !!projectId && showHistory,
  });

  const gates = data?.gates || [];
  const completedCount = gates.filter(g => g.status === "COMPLETE").length;
  const history = historyData?.history || [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="handover-gate-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-blue-600" />
          <h3 className="font-semibold text-sm">Handover Gates</h3>
          <Badge variant="secondary" className="text-[10px]" data-testid="text-gate-progress">
            {completedCount}/{gates.length} complete
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setShowHistory(!showHistory)}
          data-testid="button-toggle-gate-history"
        >
          <History className="h-3 w-3" />
          {showHistory ? "Hide" : "Show"} History
        </Button>
      </div>

      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: gates.length > 0 ? `${(completedCount / gates.length) * 100}%` : "0%" }}
        />
      </div>

      <div className="space-y-2">
        {gates.map((gate, idx) => (
          <div key={gate.gateId} className="relative">
            {idx < gates.length - 1 && (
              <div className="absolute left-[18px] top-[44px] bottom-[-8px] w-0.5 bg-border z-0" />
            )}
            <div className="relative z-10">
              <GateCard gate={gate} projectId={projectId} isAdmin={isAdmin} />
            </div>
          </div>
        ))}
      </div>

      {showHistory && (
        <div className="space-y-2 pt-2 border-t" data-testid="gate-history-section">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Gate History
          </h4>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No gate history yet</p>
          ) : (
            <div className="space-y-1">
              {history.map(entry => {
                const gateDef = gates.find(g => g.gateId === entry.gateId);
                return (
                  <div key={entry.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30" data-testid={`gate-history-entry-${entry.id}`}>
                    <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${entry.action === "GATE_COMPLETED" ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium">{gateDef?.label || entry.gateId}</span>
                        <Badge variant={entry.action === "GATE_COMPLETED" ? "default" : "secondary"} className="text-[9px] px-1">
                          {entry.action === "GATE_COMPLETED" ? "Completed" : "Reopened"}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5">
                        {entry.performedByName} ({entry.performedByRole})
                      </p>
                      {entry.details?.reason && (
                        <p className="text-muted-foreground/80 mt-0.5 italic">Reason: {entry.details.reason}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {new Date(entry.performedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
