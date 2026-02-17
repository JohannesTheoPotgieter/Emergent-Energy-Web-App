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
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, FileText, Shield, AlertTriangle, Clock, User, Lock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { QmChallengeModal } from "@/components/QmChallengeModal";

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

function getStatusBadge(status: string) {
  switch (status) {
    case "pass":
      return <Badge className="bg-green-500/20 text-green-500 border-green-500/30">Pass</Badge>;
    case "fail":
      return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Fail</Badge>;
    case "na":
      return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">N/A</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">Not Started</Badge>;
  }
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

interface QualityTabProps {
  projectName: string;
}

export function QualityTab({ projectName }: QualityTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [expandedPhases, setExpandedPhases] = useState<Record<number, boolean>>({});
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, any>>({});
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [challengePassed, setChallengePassed] = useState(false);

  const { data: accessStatus } = useQuery({
    queryKey: ["qm-access-status"],
    queryFn: async () => {
      const res = await qFetch("/api/quality/access/status");
      if (!res.ok) return { needsChallenge: false };
      return res.json();
    },
  });

  useEffect(() => {
    if (accessStatus?.needsChallenge && !challengePassed) {
      setShowChallengeModal(true);
    }
  }, [accessStatus, challengePassed]);

  const isQmOrAdmin = user?.role === "admin" || user?.role === "quality_manager";
  const canEdit = isQmOrAdmin && (!accessStatus?.needsChallenge || challengePassed);

  const { data: checklistData, isLoading, error } = useQuery({
    queryKey: ["quality-checklist", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/checklist`);
      if (!res.ok) throw new Error("Failed to load checklist");
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: warnings = [] } = useQuery({
    queryKey: ["quality-warnings", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/warnings`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
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

  if (error || !checklistData?.checklist) {
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

  const activeWarnings = warnings.filter((w: any) => w.status !== "resolved");

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

  const handleItemStatusChange = (itemInstanceId: number, field: string, value: any) => {
    const key = `${itemInstanceId}-${field}`;
    setItemEdits(prev => ({ ...prev, [key]: value }));
    updateItemMutation.mutate({ itemInstanceId, updates: { [field]: value } });
  };

  return (
    <div className="space-y-6">
      <QmChallengeModal
        open={showChallengeModal}
        onSuccess={() => { setChallengePassed(true); setShowChallengeModal(false); }}
        onClose={() => setShowChallengeModal(false)}
      />

      {!canEdit && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 flex items-center gap-2" data-testid="quality-readonly-banner">
          <Lock className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-500">
            {isQmOrAdmin && accessStatus?.needsChallenge && !challengePassed
              ? <button className="underline cursor-pointer font-medium" onClick={() => setShowChallengeModal(true)}>Enter access code to enable editing</button>
              : "View-only mode — editing requires Quality Manager access"}
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

                            return (
                              <div
                                key={instance.id}
                                className="rounded-lg border bg-card/50 p-3 hover:bg-muted/20 transition-colors"
                                data-testid={`quality-item-${instance.id}`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-2">
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{templateItem.itemLabel}</p>
                                        {templateItem.isMandatory && (
                                          <Badge className="bg-red-500/20 text-red-400 text-[10px] shrink-0">Required</Badge>
                                        )}
                                      </div>
                                    </div>
                                    {templateItem.helpText && (
                                      <p className="text-xs text-muted-foreground mt-1">{templateItem.helpText}</p>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                    <Select
                                      disabled={!canEdit}
                                      value={instance.isApplicable === false ? "na" : (instance.approved ? "pass" : "not_started")}
                                      onValueChange={(val) => {
                                        if (val === "na") {
                                          handleItemStatusChange(instance.id, "isApplicable", false);
                                        } else if (val === "pass") {
                                          updateItemMutation.mutate({
                                            itemInstanceId: instance.id,
                                            updates: { isApplicable: true },
                                          });
                                        } else {
                                          handleItemStatusChange(instance.id, "isApplicable", true);
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
                                    </div>
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
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}

      {riskQuestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Risk Assessment Questions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {riskQuestions.map((rq: any) => {
              const answer = getRiskAnswer(rq.id);
              if (!answer) return null;

              const phase = phases.find((p: any) => p.id === rq.templatePhaseId);

              return (
                <div
                  key={rq.id}
                  className={`rounded-lg border p-4 ${getRiskSeverityColor(rq.severity)}`}
                  data-testid={`quality-risk-${rq.id}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{rq.questionText}</p>
                        <Badge variant="outline" className="text-[10px]">{rq.severity}</Badge>
                        {phase && (
                          <Badge variant="outline" className="text-[10px]">{phase.phaseName}</Badge>
                        )}
                      </div>
                      {rq.guidanceNote && (
                        <p className="text-xs text-muted-foreground">{rq.guidanceNote}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {["yes", "no", "na"].map((val) => (
                        <Button
                          key={val}
                          variant={answer.answerYesno === val ? "default" : "outline"}
                          size="sm"
                          disabled={!canEdit}
                          className={`h-8 text-xs min-w-[50px] ${
                            answer.answerYesno === val
                              ? val === "yes"
                                ? "bg-green-600 hover:bg-green-700"
                                : val === "no"
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-gray-600 hover:bg-gray-700"
                              : ""
                          }`}
                          onClick={() => updateRiskMutation.mutate({
                            riskAnswerId: answer.id,
                            updates: { answerYesno: val },
                          })}
                          data-testid={`button-risk-${rq.id}-${val}`}
                        >
                          {val === "na" ? "N/A" : val.charAt(0).toUpperCase() + val.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {answer.answerText && (
                    <p className="text-xs text-muted-foreground mt-2 pl-0">{answer.answerText}</p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
