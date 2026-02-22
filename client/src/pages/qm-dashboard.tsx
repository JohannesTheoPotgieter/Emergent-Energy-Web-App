import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Shield, ShieldCheck, AlertTriangle, Search, ChevronRight, ClipboardCheck, BarChart3, CheckCircle2, Eye, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface ChecklistPhase {
  phaseId: number;
  phaseName: string;
  total: number;
  completed: number;
}

interface Checklist {
  id: number;
  projectName: string;
  templateId: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  phases?: ChecklistPhase[];
  warningCount?: number;
}

interface Warning {
  id: number;
  projectName: string;
  severity: string;
  warningType: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

export default function QmDashboardPage() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWarning, setSelectedWarning] = useState<Warning | null>(null);
  const [actionType, setActionType] = useState<"override" | "resolve" | null>(null);
  const [reasonText, setReasonText] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: checklists = [], isLoading: checklistsLoading } = useQuery<Checklist[]>({
    queryKey: ["quality-checklists"],
    queryFn: () => qFetch("/api/quality/checklists"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: warnings = [], isLoading: warningsLoading } = useQuery<Warning[]>({
    queryKey: ["quality-warnings-all"],
    queryFn: () => qFetch("/api/quality/warnings?status=open"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (data: { warningId: number; note: string }) =>
      qFetch(`/api/quality/warning/${data.warningId}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ note: data.note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Warning overridden", description: "The warning has been acknowledged and overridden." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to override warning.", variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (data: { warningId: number; note: string }) =>
      qFetch(`/api/quality/warning/${data.warningId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ note: data.note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Warning resolved", description: "The warning has been closed." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to resolve warning.", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setSelectedWarning(null);
    setActionType(null);
    setReasonText("");
  };

  const handleAction = () => {
    if (!selectedWarning || !actionType) return;
    if (actionType === "override") {
      acknowledgeMutation.mutate({ warningId: selectedWarning.id, note: reasonText });
    } else {
      resolveMutation.mutate({ warningId: selectedWarning.id, note: reasonText });
    }
  };

  const filtered = checklists.filter(c =>
    c.projectName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalProjects = checklists.length;
  const completedChecklists = checklists.filter(c => c.status === "completed").length;
  const activeWarnings = warnings.length;
  const avgCompletion = checklists.length > 0
    ? Math.round(
        checklists.reduce((sum, c) => {
          if (!c.phases || c.phases.length === 0) return sum;
          const total = c.phases.reduce((t, p) => t + p.total, 0);
          const completed = c.phases.reduce((t, p) => t + p.completed, 0);
          return sum + (total > 0 ? (completed / total) * 100 : 0);
        }, 0) / checklists.length
      )
    : 0;

  return (
    <div className="space-y-6" data-testid="qm-dashboard-page">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-emerald-500" />
        <div>
          <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold" data-testid="text-qm-title">Quality Management</h2>
          <p className="text-sm text-muted-foreground">Overview of all project quality checklists</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"><ClipboardCheck className="h-5 w-5" /></div>
          <div><p className="text-2xl font-bold" data-testid="stat-total-projects">{totalProjects}</p><p className="text-xs text-muted-foreground">Total Projects</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"><ShieldCheck className="h-5 w-5" /></div>
          <div><p className="text-2xl font-bold" data-testid="stat-completed">{completedChecklists}</p><p className="text-xs text-muted-foreground">Completed</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"><AlertTriangle className="h-5 w-5" /></div>
          <div><p className="text-2xl font-bold" data-testid="stat-warnings">{activeWarnings}</p><p className="text-xs text-muted-foreground">Active Warnings</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400"><BarChart3 className="h-5 w-5" /></div>
          <div><p className="text-2xl font-bold" data-testid="stat-avg-completion">{avgCompletion}%</p><p className="text-xs text-muted-foreground">Avg Completion</p></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-lg">Project Checklists</CardTitle>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-9"
              data-testid="input-qm-search"
            />
          </div>
        </CardHeader>
        <CardContent>
          {checklistsLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading checklists...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No checklists found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-sm text-muted-foreground">
                    <th className="text-left py-2 px-4 font-medium">Project Name</th>
                    <th className="text-left py-2 px-4 font-medium">Status</th>
                    <th className="text-left py-2 px-4 font-medium hidden md:table-cell">Phase Progress</th>
                    <th className="text-center py-2 px-4 font-medium">Warnings</th>
                    <th className="text-left py-2 px-4 font-medium hidden sm:table-cell">Last Updated</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((checklist) => {
                    const projectWarnings = warnings.filter(w => w.projectName === checklist.projectName);
                    return (
                      <tr
                        key={checklist.id}
                        data-testid={`qm-project-row-${checklist.id}`}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/project/${encodeURIComponent(checklist.projectName)}?tab=quality`)}
                      >
                        <td className="py-3 px-4 font-medium">{checklist.projectName}</td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              checklist.status === "completed" ? "default" :
                              checklist.status === "active" ? "secondary" : "outline"
                            }
                            className={
                              checklist.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                              checklist.status === "active" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : ""
                            }
                          >
                            {checklist.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell">
                          {checklist.phases && checklist.phases.length > 0 ? (
                            <div className="flex items-center gap-2 max-w-xs">
                              {checklist.phases.map((phase) => (
                                <div key={phase.phaseId} className="flex-1 min-w-0" title={`${phase.phaseName}: ${phase.completed}/${phase.total}`}>
                                  <div className="text-[10px] text-muted-foreground truncate mb-0.5">{phase.phaseName}</div>
                                  <Progress
                                    value={phase.total > 0 ? (phase.completed / phase.total) * 100 : 0}
                                    className="h-1.5"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {(checklist.warningCount ?? projectWarnings.length) > 0 ? (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {checklist.warningCount ?? projectWarnings.length}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              <ShieldCheck className="h-3 w-3 mr-1" />0
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-xs hidden sm:table-cell">
                          {checklist.updatedAt
                            ? new Date(checklist.updatedAt).toLocaleDateString()
                            : checklist.createdAt
                              ? new Date(checklist.createdAt).toLocaleDateString()
                              : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!warningsLoading && warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Active Warnings ({warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {warnings.slice(0, 20).map((warning) => (
                <div
                  key={warning.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setSelectedWarning(warning)}
                  data-testid={`warning-row-${warning.id}`}
                >
                  <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${
                    warning.severity === "High" ? "text-red-500" : "text-amber-500"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{warning.title}</span>
                      <Badge variant="outline" className={
                        warning.severity === "High"
                          ? "bg-red-500/10 text-red-400 border-red-500/30 text-xs"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs"
                      }>
                        {warning.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{warning.projectName}</p>
                    {warning.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{warning.description}</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                </div>
              ))}
              {warnings.length > 20 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Showing 20 of {warnings.length} warnings
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedWarning && !actionType} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${selectedWarning?.severity === "High" ? "text-red-500" : "text-amber-500"}`} />
              Warning Details
            </DialogTitle>
          </DialogHeader>
          {selectedWarning && (
            <div className="space-y-4">
              <div>
                <p className="font-semibold text-sm">{selectedWarning.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={
                    selectedWarning.severity === "High"
                      ? "bg-red-500/10 text-red-500 border-red-500/30 text-xs"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/30 text-xs"
                  }>
                    {selectedWarning.severity}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {selectedWarning.warningType}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Project:</span>{" "}
                  <span className="font-medium">{selectedWarning.projectName}</span>
                </div>
                {selectedWarning.description && (
                  <div>
                    <span className="text-muted-foreground">Description:</span>
                    <p className="mt-1 text-sm bg-muted/50 p-2 rounded">{selectedWarning.description}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  <span>{new Date(selectedWarning.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setLocation(`/project/${encodeURIComponent(selectedWarning.projectName)}?tab=quality`);
                    closeDialog();
                  }}
                  data-testid="btn-go-to-project"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View Project
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => setActionType("override")}
                  data-testid="btn-override-warning"
                >
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  Override
                </Button>
                <Button
                  size="sm"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setActionType("resolve")}
                  data-testid="btn-resolve-warning"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Close / Resolve
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionType} onOpenChange={(open) => { if (!open) { setActionType(null); setReasonText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === "override" ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                  Override Warning
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Close / Resolve Warning
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedWarning && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg text-sm">
                <p className="font-medium">{selectedWarning.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{selectedWarning.projectName}</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {actionType === "override" ? "Override reason" : "Resolution notes"}
                  {actionType === "resolve" && <span className="text-muted-foreground font-normal"> (optional)</span>}
                </label>
                <Textarea
                  placeholder={actionType === "override"
                    ? "Explain why this warning is being overridden..."
                    : "Describe how this issue was resolved..."
                  }
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  rows={3}
                  data-testid="input-warning-reason"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setActionType(null); setReasonText(""); }} data-testid="btn-cancel-action">
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={actionType === "override" && !reasonText.trim()}
              className={actionType === "override"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }
              data-testid="btn-confirm-action"
            >
              {(acknowledgeMutation.isPending || resolveMutation.isPending) ? "Saving..." :
                actionType === "override" ? "Confirm Override" : "Confirm Resolve"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
