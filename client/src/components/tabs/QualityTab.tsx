import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, FileText, Shield, AlertTriangle, Clock, User, Lock, Link2, X, Plus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; progress: string }> = {
  "planning_design": { bg: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/20", progress: "bg-blue-500" },
  "construction": { bg: "bg-orange-500/10", text: "text-orange-500", border: "border-orange-500/20", progress: "bg-orange-500" },
  "commissioning": { bg: "bg-purple-500/10", text: "text-purple-500", border: "border-purple-500/20", progress: "bg-purple-500" },
  "handover": { bg: "bg-green-500/10", text: "text-green-500", border: "border-green-500/20", progress: "bg-green-500" },
};

function getPhaseColor(phaseKey: string) {
  return PHASE_COLORS[phaseKey] || PHASE_COLORS["planning_design"];
}

function getRiskSeverityColor(severity: string) {
  switch (severity?.toLowerCase()) {
    case "high":
      return "text-red-500 bg-red-500/10 border-red-500/20";
    case "medium":
      return "text-orange-500 bg-orange-500/10 border-orange-500/20";
    case "low":
      return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    default:
      return "text-muted-foreground bg-muted/50 border-border";
  }
}

function calculateBusinessDays(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

interface QualityTabProps {
  projectName: string;
}

export function QualityTab({ projectName }: QualityTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [expandedPhases, setExpandedPhases] = useState<Record<number, boolean>>({});
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, any>>({});
  const [linkingPhaseId, setLinkingPhaseId] = useState<number | null>(null);
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const isQmOrAdmin = user?.role === "admin" || user?.role === "quality_manager";
  const canEdit = isQmOrAdmin;

  const { data: checklistData, isLoading, error } = useQuery({
    queryKey: ["quality-checklist", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/checklist`);
      if (!res.ok) throw new Error("Failed to load checklist");
      return res.json();
    },
    enabled: !!projectName,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: warnings = [] } = useQuery({
    queryKey: ["quality-warnings", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/warnings`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: planLinks = [] } = useQuery({
    queryKey: ["quality-plan-links", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/plan-links`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: projectTasks = [] } = useQuery({
    queryKey: ["project-plan-tasks", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/project-plan/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemInstanceId, updates }: { itemInstanceId: number; updates: any }) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}`, {
        method: "POST",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
  });

  const approveItemMutation = useMutation({
    mutationFn: async ({ itemInstanceId, approved }: { itemInstanceId: number; approved: boolean }) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approved }),
      });
      if (!res.ok) throw new Error("Failed to update approval");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
  });

  const updateRiskMutation = useMutation({
    mutationFn: async ({ riskAnswerId, updates }: { riskAnswerId: number; updates: any }) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/risk-answer`, {
        method: "POST",
        body: JSON.stringify({ riskAnswerId, ...updates }),
      });
      if (!res.ok) throw new Error("Failed to update risk answer");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
  });

  const addPlanLinkMutation = useMutation({
    mutationFn: async ({ planItemId, phaseId, itemInstanceId }: { planItemId: number; phaseId?: number; itemInstanceId?: number }) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/plan-link`, {
        method: "POST",
        body: JSON.stringify({
          planItemId,
          phaseId: phaseId || null,
          itemInstanceId: itemInstanceId || null,
          linkType: itemInstanceId ? "item_task" : "phase_task",
        }),
      });
      if (!res.ok) throw new Error("Failed to link task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-plan-links", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      setLinkingPhaseId(null);
      setLinkingItemId(null);
    },
  });

  const removePlanLinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await qFetch(`/api/quality/plan-link/${linkId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unlink");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-plan-links", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
  });

  useEffect(() => {
    if (checklistData?.phases) {
      const initial: Record<number, boolean> = {};
      checklistData.phases.forEach((p: any) => { initial[p.id] = true; });
      setExpandedPhases(initial);
    }
  }, [checklistData?.phases]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-3">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto animate-pulse" />
          <p className="text-sm text-muted-foreground">Loading quality checklist...</p>
        </div>
      </div>
    );
  }

  if (!checklistData || error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center space-y-3">
            <Shield className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              {error ? "Failed to load quality checklist" : "No quality checklist found for this project"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { phases = [], groups = [], templateItems = [], itemInstances = [], riskQuestions = [], riskAnswers = [], evidence = [] } = checklistData;

  const activeWarnings = Array.isArray(warnings) ? warnings.filter((w: any) => w.status !== "resolved") : [];

  const togglePhase = (phaseId: number) => {
    setExpandedPhases(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const getPhaseProgress = (phaseId: number) => {
    const phaseGroups = groups.filter((g: any) => g.templatePhaseId === phaseId);
    const phaseGroupIds = phaseGroups.map((g: any) => g.id);
    const phaseTemplateItemIds = templateItems
      .filter((ti: any) => phaseGroupIds.includes(ti.templateGroupId))
      .map((ti: any) => ti.id);
    const phaseInstances = itemInstances.filter((ii: any) => phaseTemplateItemIds.includes(ii.templateItemId));

    const applicable = phaseInstances.filter((i: any) => i.isApplicable !== false);
    const completed = applicable.filter((i: any) => i.approved);

    return {
      total: phaseInstances.length,
      applicable: applicable.length,
      completed: completed.length,
      percent: applicable.length > 0 ? Math.round((completed.length / applicable.length) * 100) : 0,
    };
  };

  const getItemInstance = (templateItemId: number) => {
    return itemInstances.find((ii: any) => ii.templateItemId === templateItemId);
  };

  const getItemEvidence = (itemInstanceId: number) => {
    return evidence.filter((e: any) => e.itemInstanceId === itemInstanceId);
  };

  const getRiskAnswer = (riskQuestionId: number) => {
    return riskAnswers.find((ra: any) => ra.templateRiskQuestionId === riskQuestionId);
  };

  const getPhaseRiskQuestions = (phaseId: number) => {
    return riskQuestions.filter((rq: any) => rq.templatePhaseId === phaseId);
  };

  const getPhaseLinks = (phaseId: number) => {
    return planLinks.filter((l: any) => l.phaseId === phaseId);
  };

  const getItemLinks = (itemInstanceId: number) => {
    return planLinks.filter((l: any) => l.itemInstanceId === itemInstanceId);
  };

  const isTaskCompleted = (planItemId: number) => {
    const task = projectTasks.find((t: any) => t.id === planItemId);
    return task && task.actualPctComplete != null && task.actualPctComplete >= 1;
  };

  const handleItemStatusChange = (itemInstanceId: number, field: string, value: any) => {
    const key = `${itemInstanceId}-${field}`;
    setItemEdits(prev => ({ ...prev, [key]: value }));
    updateItemMutation.mutate({ itemInstanceId, updates: { [field]: value } });
  };

  const meaningfulTasks = projectTasks.filter((t: any) =>
    t.taskNo && t.highLevelProgramme && t.taskNo !== "No." && t.highLevelProgramme !== "HIGH LEVEL PROGRAMME"
  );

  return (
    <div className="space-y-6">
      {!canEdit && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 flex items-center gap-2" data-testid="quality-readonly-banner">
          <Lock className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-500">
            View-only mode — editing requires Quality Manager access
          </span>
        </div>
      )}

      {activeWarnings.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4" data-testid="quality-warnings">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-medium text-red-500">
                {activeWarnings.length} Active Warning{activeWarnings.length !== 1 ? "s" : ""}
              </p>
              {activeWarnings.map((w: any) => (
                <div key={w.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge className={getRiskSeverityColor(w.severity)} variant="outline">
                    {w.severity}
                  </Badge>
                  <span>{w.message || w.warningType}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {phases.map((phase: any) => {
          const progress = getPhaseProgress(phase.id);
          const colors = getPhaseColor(phase.phaseKey);
          return (
            <Card key={phase.id} className={`${colors.border} border`}>
              <CardContent className="p-4 space-y-2">
                <p className={`text-xs font-medium ${colors.text}`}>{phase.phaseName}</p>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-bold">{progress.percent}%</span>
                  <span className="text-xs text-muted-foreground">{progress.completed}/{progress.applicable}</span>
                </div>
                <Progress value={progress.percent} className="h-1.5" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {phases.map((phase: any) => {
        const phaseGroups = groups.filter((g: any) => g.templatePhaseId === phase.id);
        const colors = getPhaseColor(phase.phaseKey);
        const progress = getPhaseProgress(phase.id);
        const isExpanded = expandedPhases[phase.id] ?? true;
        const phaseRiskQs = getPhaseRiskQuestions(phase.id);
        const phaseLinkedTasks = getPhaseLinks(phase.id);

        return (
          <Card key={phase.id} className={`${colors.border} border`} data-testid={`quality-phase-${phase.id}`}>
            <Collapsible open={isExpanded} onOpenChange={() => togglePhase(phase.id)}>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className={`w-5 h-5 ${colors.text}`} />
                      ) : (
                        <ChevronRight className={`w-5 h-5 ${colors.text}`} />
                      )}
                      <CardTitle className="text-base">
                        <span className={colors.text}>{phase.phaseName}</span>
                      </CardTitle>
                      <Badge variant="outline" className="text-xs">
                        {progress.completed}/{progress.applicable} items
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{progress.percent}%</span>
                      <div className="w-24">
                        <Progress value={progress.percent} className="h-2" />
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0 space-y-6">
                  {phaseLinkedTasks.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-muted-foreground" />
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked Project Tasks</h4>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {phaseLinkedTasks.map((link: any) => {
                          const task = projectTasks.find((t: any) => t.id === link.planItemId);
                          return (
                            <Badge key={link.id} variant="outline" className="gap-1.5 py-1 pl-2 pr-1" data-testid={`plan-link-${link.id}`}>
                              <span className="text-xs">
                                {task ? `${task.taskNo} — ${task.highLevelProgramme}` : `Task #${link.planItemId}`}
                              </span>
                              {task?.actualPctComplete != null && (
                                <span className="text-[10px] text-muted-foreground ml-1">
                                  ({Math.round(task.actualPctComplete * 100)}%)
                                </span>
                              )}
                              {canEdit && (
                                <button
                                  className="ml-1 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                  onClick={() => removePlanLinkMutation.mutate(link.id)}
                                  data-testid={`unlink-task-${link.id}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      {linkingPhaseId === phase.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Select
                            onValueChange={(val) => {
                              addPlanLinkMutation.mutate({ planItemId: parseInt(val), phaseId: phase.id });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-link-task-${phase.id}`}>
                              <SelectValue placeholder="Select a project task to link..." />
                            </SelectTrigger>
                            <SelectContent>
                              {meaningfulTasks
                                .filter((t: any) => !phaseLinkedTasks.some((l: any) => l.planItemId === t.id))
                                .map((task: any) => (
                                  <SelectItem key={task.id} value={String(task.id)}>
                                    {task.taskNo} — {task.highLevelProgramme}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-8" onClick={() => setLinkingPhaseId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => setLinkingPhaseId(phase.id)}
                          data-testid={`link-task-${phase.id}`}
                        >
                          <Plus className="w-3 h-3" />
                          Link Project Task
                        </Button>
                      )}
                    </div>
                  )}

                  {phaseGroups.map((group: any) => {
                    const groupItems = templateItems.filter((ti: any) => ti.templateGroupId === group.id);
                    if (groupItems.length === 0) return null;

                    return (
                      <div key={group.id} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <h4 className="text-sm font-semibold">{group.groupName}</h4>
                          <Badge variant="outline" className="text-xs">{groupItems.length}</Badge>
                        </div>

                        <div className="space-y-2">
                          {groupItems.map((templateItem: any) => {
                            const instance = getItemInstance(templateItem.id);
                            if (!instance) return null;
                            const itemEvidence = getItemEvidence(instance.id);
                            const isEditing = editingItem === instance.id;
                            const itemLinks = getItemLinks(instance.id);
                            const hasRedWarning = itemLinks.some((l: any) => isTaskCompleted(l.planItemId)) && !instance.approved;

                            return (
                              <div
                                key={instance.id}
                                className={`rounded-lg border p-3 transition-colors ${
                                  hasRedWarning
                                    ? "bg-red-500/10 border-red-500 ring-1 ring-red-500/40"
                                    : "bg-card/50 hover:bg-muted/20"
                                }`}
                                data-testid={`quality-item-${instance.id}`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`text-sm font-medium truncate ${hasRedWarning ? "text-red-600 dark:text-red-400" : ""}`}>{templateItem.itemName}</p>
                                      {hasRedWarning && (
                                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 shrink-0" data-testid={`warning-unchecked-${instance.id}`}>
                                          <AlertCircle className="w-3 h-3 mr-0.5" />
                                          Task done — not checked
                                        </Badge>
                                      )}
                                    </div>
                                    {itemLinks.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {itemLinks.map((link: any) => {
                                          const task = projectTasks.find((t: any) => t.id === link.planItemId);
                                          const taskDone = isTaskCompleted(link.planItemId);
                                          return (
                                            <Badge
                                              key={link.id}
                                              variant="outline"
                                              className={`text-[10px] gap-1 py-0.5 ${taskDone && !instance.approved ? "border-red-500 text-red-600 dark:text-red-400 bg-red-500/5" : ""}`}
                                              data-testid={`item-link-${link.id}`}
                                            >
                                              <Link2 className="w-3 h-3" />
                                              {task ? `${task.taskNo}` : `#${link.planItemId}`}
                                              {task?.actualPctComplete != null && (
                                                <span className="ml-0.5">({Math.round(task.actualPctComplete * 100)}%)</span>
                                              )}
                                              {canEdit && (
                                                <button
                                                  className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                                  onClick={(e) => { e.stopPropagation(); removePlanLinkMutation.mutate(link.id); }}
                                                >
                                                  <X className="w-2.5 h-2.5" />
                                                </button>
                                              )}
                                            </Badge>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                    <Select
                                      disabled={!canEdit}
                                      value={instance.isApplicable === false ? "na" : (instance.approved ? "pass" : "not_started")}
                                      onValueChange={(val) => {
                                        if (val === "na") {
                                          handleItemStatusChange(instance.id, "isApplicable", false);
                                          if (instance.approved) {
                                            approveItemMutation.mutate({ itemInstanceId: instance.id, approved: false });
                                          }
                                        } else if (val === "pass") {
                                          if (!instance.isApplicable) {
                                            updateItemMutation.mutate({ itemInstanceId: instance.id, updates: { isApplicable: true } });
                                          }
                                          approveItemMutation.mutate({ itemInstanceId: instance.id, approved: true });
                                        } else {
                                          handleItemStatusChange(instance.id, "isApplicable", true);
                                          if (instance.approved) {
                                            approveItemMutation.mutate({ itemInstanceId: instance.id, approved: false });
                                          }
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="w-[120px] h-8 text-xs" data-testid={`select-status-${instance.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="not_started">Not Started</SelectItem>
                                        <SelectItem value="pass">Pass</SelectItem>
                                        <SelectItem value="na">N/A</SelectItem>
                                      </SelectContent>
                                    </Select>

                                    {itemEvidence.length > 0 && (
                                      <Badge variant="outline" className="text-xs gap-1">
                                        <FileText className="w-3 h-3" />
                                        {itemEvidence.length}
                                      </Badge>
                                    )}

                                    {canEdit && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        title="Link project task"
                                        onClick={(e) => { e.stopPropagation(); setLinkingItemId(linkingItemId === instance.id ? null : instance.id); }}
                                        data-testid={`link-item-task-${instance.id}`}
                                      >
                                        <Link2 className={`w-4 h-4 ${linkingItemId === instance.id ? "text-primary" : "text-muted-foreground"}`} />
                                      </Button>
                                    )}

                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 text-xs"
                                      onClick={() => setEditingItem(isEditing ? null : instance.id)}
                                      data-testid={`button-edit-item-${instance.id}`}
                                    >
                                      {isEditing ? "Close" : "Details"}
                                    </Button>
                                  </div>
                                </div>

                                {linkingItemId === instance.id && (
                                  <div className="mt-2 flex items-center gap-2">
                                    <Select
                                      onValueChange={(val) => {
                                        addPlanLinkMutation.mutate({ planItemId: parseInt(val), itemInstanceId: instance.id });
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-link-item-task-${instance.id}`}>
                                        <SelectValue placeholder="Select a project task to link..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {meaningfulTasks
                                          .filter((t: any) => !itemLinks.some((l: any) => l.planItemId === t.id))
                                          .map((task: any) => (
                                            <SelectItem key={task.id} value={String(task.id)}>
                                              {task.taskNo} — {task.highLevelProgramme} {task.actualPctComplete != null ? `(${Math.round(task.actualPctComplete * 100)}%)` : ""}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setLinkingItemId(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                )}

                                {isEditing && (
                                  <div className="mt-4 pt-4 border-t space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                          <User className="w-3 h-3" /> Responsible Person
                                        </label>
                                        <Input
                                          className="h-8 text-sm"
                                          placeholder="Enter name"
                                          defaultValue={instance.approvalComment || ""}
                                          onBlur={(e) => handleItemStatusChange(instance.id, "approvalComment", e.target.value)}
                                          data-testid={`input-responsible-${instance.id}`}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                          <Clock className="w-3 h-3" /> Start Date
                                        </label>
                                        <Input
                                          type="date"
                                          className="h-8 text-sm"
                                          defaultValue={instance.startDate || ""}
                                          onBlur={(e) => handleItemStatusChange(instance.id, "startDate", e.target.value)}
                                          data-testid={`input-start-date-${instance.id}`}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                          <Clock className="w-3 h-3" /> End Date
                                        </label>
                                        <Input
                                          type="date"
                                          className="h-8 text-sm"
                                          defaultValue={instance.endDate || ""}
                                          onBlur={(e) => handleItemStatusChange(instance.id, "endDate", e.target.value)}
                                          data-testid={`input-end-date-${instance.id}`}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Working Days</label>
                                        <Input
                                          className="h-8 text-sm"
                                          value={instance.workingDays ?? "—"}
                                          disabled
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Allowed Working Days</label>
                                        <Input
                                          type="number"
                                          className="h-8 text-sm"
                                          placeholder="Enter allowed days"
                                          min="0"
                                          disabled={!canEdit}
                                          defaultValue={instance.allowedWorkingDays ?? ""}
                                          onBlur={(e) => {
                                            const val = e.target.value ? parseInt(e.target.value) : null;
                                            handleItemStatusChange(instance.id, "allowedWorkingDays", val);
                                          }}
                                          data-testid={`input-allowed-days-${instance.id}`}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Actual Working Days</label>
                                        <Input
                                          className="h-8 text-sm"
                                          value={instance.startDate && instance.endDate ? calculateBusinessDays(instance.startDate, instance.endDate) : "—"}
                                          disabled
                                          data-testid={`input-actual-days-${instance.id}`}
                                        />
                                      </div>
                                    </div>
                                    {instance.endDate && instance.startDate && new Date(instance.endDate) < new Date(instance.startDate) && (
                                      <p className="text-xs text-red-500 font-medium" data-testid={`date-error-${instance.id}`}>End date cannot be before start date</p>
                                    )}
                                    {(() => {
                                      const actualDays = instance.startDate && instance.endDate ? calculateBusinessDays(instance.startDate, instance.endDate) : null;
                                      const allowed = instance.allowedWorkingDays;
                                      if (actualDays !== null && allowed && allowed > 0 && actualDays > allowed) {
                                        return (
                                          <Badge variant="destructive" className="text-xs gap-1" data-testid={`badge-overdue-${instance.id}`}>
                                            <AlertCircle className="w-3 h-3" />
                                            Overdue by {actualDays - allowed} day{actualDays - allowed !== 1 ? "s" : ""}
                                          </Badge>
                                        );
                                      }
                                      if (actualDays !== null && allowed && allowed > 0 && actualDays <= allowed) {
                                        return (
                                          <Badge className="text-xs gap-1 bg-green-600 hover:bg-green-700" data-testid={`badge-ontrack-${instance.id}`}>
                                            <CheckCircle className="w-3 h-3" />
                                            On Track
                                          </Badge>
                                        );
                                      }
                                      if (!instance.startDate && !instance.endDate) {
                                        return (
                                          <Badge variant="secondary" className="text-xs gap-1" data-testid={`badge-notstarted-${instance.id}`}>
                                            Not started
                                          </Badge>
                                        );
                                      }
                                      if (instance.startDate && !instance.endDate) {
                                        return (
                                          <Badge variant="secondary" className="text-xs gap-1" data-testid={`badge-inprogress-${instance.id}`}>
                                            In progress
                                          </Badge>
                                        );
                                      }
                                      return null;
                                    })()}
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-medium text-muted-foreground">Notes</label>
                                      <Textarea
                                        className="text-sm min-h-[60px]"
                                        placeholder="Add notes..."
                                        defaultValue={instance.notApplicableReason || ""}
                                        onBlur={(e) => handleItemStatusChange(instance.id, "notApplicableReason", e.target.value)}
                                        data-testid={`textarea-notes-${instance.id}`}
                                      />
                                    </div>
                                    {itemEvidence.length > 0 && (
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Evidence</label>
                                        <div className="space-y-1">
                                          {itemEvidence.map((ev: any) => (
                                            <div key={ev.id} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/30">
                                              <FileText className="w-3 h-3 text-muted-foreground" />
                                              <a href={ev.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                                                {ev.evidenceUrl}
                                              </a>
                                              {ev.evidenceNote && <span className="text-muted-foreground">— {ev.evidenceNote}</span>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {phaseRiskQs.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-dashed">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        <h4 className="text-sm font-semibold">Risk Assessment</h4>
                        <Badge variant="outline" className="text-xs">{phaseRiskQs.length}</Badge>
                      </div>

                      <div className="space-y-2">
                        {(() => {
                          const sorted = [...phaseRiskQs].sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
                          const grouped: { parent: any; children: any[] }[] = [];
                          for (const rq of sorted) {
                            if (rq.responseType === "yesno") {
                              grouped.push({ parent: rq, children: [] });
                            } else if (grouped.length > 0) {
                              grouped[grouped.length - 1].children.push(rq);
                            }
                          }

                          const riskOptions: { label: string; value: boolean | null; color: string }[] = [
                            { label: "Yes", value: true, color: "bg-green-600 hover:bg-green-700" },
                            { label: "No", value: false, color: "bg-red-600 hover:bg-red-700" },
                            { label: "N/A", value: null, color: "bg-gray-600 hover:bg-gray-700" },
                          ];

                          return grouped.map(({ parent, children }) => {
                            const parentAnswer = getRiskAnswer(parent.id);
                            if (!parentAnswer) return null;

                            return (
                              <div key={parent.id} className="space-y-2">
                                <div
                                  className="rounded-lg border bg-card/50 p-3"
                                  data-testid={`quality-risk-${parent.id}`}
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                                    <div className="flex-1 space-y-1">
                                      <p className="text-sm font-medium">{parent.questionText}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {riskOptions.map((opt) => {
                                        const isActive = parentAnswer.answerYesno === opt.value;
                                        return (
                                          <Button
                                            key={opt.label}
                                            variant={isActive ? "default" : "outline"}
                                            size="sm"
                                            disabled={!canEdit}
                                            className={`h-8 text-xs min-w-[50px] ${isActive ? opt.color : ""}`}
                                            onClick={() => {
                                              updateRiskMutation.mutate({
                                                riskAnswerId: parentAnswer.id,
                                                updates: { answerYesno: opt.value },
                                              });
                                              if (opt.value !== null) {
                                                for (const child of children) {
                                                  const childAnswer = getRiskAnswer(child.id);
                                                  if (!childAnswer) continue;
                                                  const textLower = (child.questionText || "").trim().toLowerCase();
                                                  const showOnNo = /^if\s+no\b/i.test(textLower);
                                                  const shouldShow = showOnNo ? opt.value === false : opt.value === true;
                                                  if (!shouldShow) {
                                                    updateRiskMutation.mutate({
                                                      riskAnswerId: childAnswer.id,
                                                      updates: { answerText: null, answerNumber: null },
                                                    });
                                                  }
                                                }
                                              }
                                            }}
                                            data-testid={`button-risk-${parent.id}-${opt.label.toLowerCase()}`}
                                          >
                                            {opt.label}
                                          </Button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>

                                {children.map((child: any) => {
                                  const childAnswer = getRiskAnswer(child.id);
                                  if (!childAnswer) return null;
                                  const textTrimmed = (child.questionText || "").trim();
                                  const showOnNo = /^if\s+no\b/i.test(textTrimmed);
                                  const shouldShow = showOnNo
                                    ? parentAnswer.answerYesno === false
                                    : parentAnswer.answerYesno === true;

                                  if (!shouldShow) return null;

                                  return (
                                    <div
                                      key={child.id}
                                      className="ml-6 rounded-lg border border-dashed bg-muted/30 p-3 space-y-2"
                                      data-testid={`quality-risk-followup-${child.id}`}
                                    >
                                      <label className="text-xs font-medium text-muted-foreground">{child.questionText}</label>
                                      {child.responseType === "text" ? (
                                        <Textarea
                                          className="text-sm min-h-[40px]"
                                          placeholder="Enter response..."
                                          disabled={!canEdit}
                                          defaultValue={childAnswer.answerText || ""}
                                          onBlur={(e) => {
                                            updateRiskMutation.mutate({
                                              riskAnswerId: childAnswer.id,
                                              updates: { answerText: e.target.value },
                                            });
                                          }}
                                          data-testid={`input-risk-text-${child.id}`}
                                        />
                                      ) : (
                                        <Input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          max="100"
                                          className="h-8 text-sm"
                                          placeholder="Enter value..."
                                          disabled={!canEdit}
                                          defaultValue={childAnswer.answerNumber ?? ""}
                                          onBlur={(e) => {
                                            updateRiskMutation.mutate({
                                              riskAnswerId: childAnswer.id,
                                              updates: { answerNumber: e.target.value ? parseFloat(e.target.value) : null },
                                            });
                                          }}
                                          data-testid={`input-risk-number-${child.id}`}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
}
