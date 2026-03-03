import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertCircle, CheckCircle, ChevronDown, ChevronRight, FileText, Shield,
  AlertTriangle, Clock, User, Lock, Link2, X, Plus, Trash2, Send, Loader2,
  CheckCircle2, Upload, Paperclip, ExternalLink, UserPlus, SquareCheck,
  Download, Eye
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";

function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; progress: string; lightBg: string; gradient: string }> = {
  "planning_design": { bg: "bg-blue-500/10", text: "text-blue-600", border: "border-blue-200", progress: "bg-blue-500", lightBg: "bg-blue-50", gradient: "from-blue-500 to-blue-600" },
  "construction": { bg: "bg-orange-500/10", text: "text-orange-600", border: "border-orange-200", progress: "bg-orange-500", lightBg: "bg-orange-50", gradient: "from-orange-500 to-orange-600" },
  "commissioning": { bg: "bg-purple-500/10", text: "text-purple-600", border: "border-purple-200", progress: "bg-purple-500", lightBg: "bg-purple-50", gradient: "from-purple-500 to-purple-600" },
  "handover": { bg: "bg-green-500/10", text: "text-green-600", border: "border-green-200", progress: "bg-green-500", lightBg: "bg-green-50", gradient: "from-green-500 to-green-600" },
};

function getPhaseColor(phaseKey: string) {
  return PHASE_COLORS[phaseKey] || PHASE_COLORS["planning_design"];
}

function getRiskSeverityColor(severity: string) {
  switch (severity?.toLowerCase()) {
    case "high": return "text-red-500 bg-red-500/10 border-red-500/20";
    case "medium": return "text-orange-500 bg-orange-500/10 border-orange-500/20";
    case "low": return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    default: return "text-muted-foreground bg-muted/50 border-border";
  }
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string; btnClass: string }> = {
  not_started: { label: "Not Started", color: "text-slate-500", bg: "bg-slate-50 border-slate-200", dot: "bg-slate-400", btnClass: "border-slate-300 text-slate-600 hover:bg-slate-100" },
  review: { label: "In Review", color: "text-amber-600", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-500", btnClass: "border-amber-300 text-amber-600 hover:bg-amber-100" },
  pass: { label: "Passed", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", btnClass: "border-emerald-300 text-emerald-600 hover:bg-emerald-100" },
  fail: { label: "Failed", color: "text-red-600", bg: "bg-red-50 border-red-200", dot: "bg-red-500", btnClass: "border-red-300 text-red-600 hover:bg-red-100" },
  na: { label: "N/A", color: "text-slate-400", bg: "bg-slate-50 border-slate-200", dot: "bg-slate-300", btnClass: "border-slate-300 text-slate-400 hover:bg-slate-100" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.not_started;
}

interface QualityTabProps {
  projectName: string;
}

export function QualityTab({ projectName }: QualityTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showRiskQuestions, setShowRiskQuestions] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [linkingPhaseId, setLinkingPhaseId] = useState<number | null>(null);
  const [sendForApprovalItem, setSendForApprovalItem] = useState<number | null>(null);
  const [sfaApprover, setSfaApprover] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showAddItem, setShowAddItem] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState<number | null>(null);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const isQmOrAdmin = ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '') || ['quality_manager', 'QUALITY_MANAGER'].includes(user?.role || '');
  const canEdit = isQmOrAdmin;
  const { allowed: canDeleteQc } = usePermission('pd_quality', 'delete');

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

  const { data: teamMembers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["eng-team-members"],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/eng/team-members", { headers, credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
    queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
    queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
    queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
  };

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemInstanceId, updates }: { itemInstanceId: number; updates: any }) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}`, {
        method: "POST",
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to update item");
      }
      return res.json();
    },
    onSuccess: invalidateAll,
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
    onSuccess: invalidateAll,
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
    onSuccess: invalidateAll,
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createItemMutation = useMutation({
    mutationFn: async ({ itemName, groupId }: { itemName: string; groupId?: number }) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/items`, {
        method: "POST",
        body: JSON.stringify({ itemName, groupId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create item");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setNewItemName("");
      setShowAddItem(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemInstanceId: number) => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete item");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setDeleteConfirmId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
      invalidateAll();
      setLinkingPhaseId(null);
      setLinkingItemId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removePlanLinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await qFetch(`/api/quality/plan-link/${linkId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unlink");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-plan-links", projectName] });
      invalidateAll();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteEvidenceMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      const res = await qFetch(`/api/quality/evidence/${evidenceId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete evidence");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEvidenceFileUpload = async (instanceId: number, file: File) => {
    setEvidenceUploading(instanceId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${instanceId}/evidence/upload`, {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      toast({ title: "Evidence uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setEvidenceUploading(null);
    }
  };

  useEffect(() => {
    if (checklistData?.phases?.length && !selectedPhaseId) {
      setSelectedPhaseId(checklistData.phases[0].id);
      const initial: Record<number, boolean> = {};
      checklistData.phases.forEach((p: any) => {
        const phaseGroups = (checklistData.groups || []).filter((g: any) => g.templatePhaseId === p.id);
        phaseGroups.forEach((g: any) => { initial[g.id] = true; });
      });
      setExpandedGroups(initial);
    }
  }, [checklistData?.phases]);

  const teamMemberMap = useMemo(() => {
    const map = new Map<number, string>();
    teamMembers.forEach(m => map.set(m.id, m.name));
    return map;
  }, [teamMembers]);

  const getItemQmStatus = (instance: any): string => {
    if (instance.qmStatus && instance.qmStatus !== "not_started") return instance.qmStatus;
    if (instance.isApplicable === false) return "na";
    if (instance.approved) return "pass";
    return "not_started";
  };

  const overallStats = useMemo(() => {
    const allInstances = checklistData?.itemInstances || [];
    const applicable = allInstances.filter((i: any) => i.isApplicable !== false);
    const passed = applicable.filter((i: any) => getItemQmStatus(i) === "pass");
    const failed = applicable.filter((i: any) => getItemQmStatus(i) === "fail");
    const inReview = applicable.filter((i: any) => getItemQmStatus(i) === "review");
    const unassigned = applicable.filter((i: any) => !i.assigneeUserId);
    return {
      total: applicable.length,
      passed: passed.length,
      failed: failed.length,
      inReview: inReview.length,
      unassigned: unassigned.length,
      percent: applicable.length > 0 ? Math.round((passed.length / applicable.length) * 100) : 0,
    };
  }, [checklistData?.itemInstances]);

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

  const getPhaseProgress = (phaseId: number) => {
    const phaseGroups = groups.filter((g: any) => g.templatePhaseId === phaseId);
    const phaseGroupIds = phaseGroups.map((g: any) => g.id);
    const phaseTemplateItemIds = templateItems
      .filter((ti: any) => phaseGroupIds.includes(ti.templateGroupId))
      .map((ti: any) => ti.id);
    const phaseInstances = itemInstances.filter((ii: any) => phaseTemplateItemIds.includes(ii.templateItemId));
    const applicable = phaseInstances.filter((i: any) => i.isApplicable !== false);
    const passed = applicable.filter((i: any) => getItemQmStatus(i) === "pass");
    const failed = applicable.filter((i: any) => getItemQmStatus(i) === "fail");
    const inReview = applicable.filter((i: any) => getItemQmStatus(i) === "review");
    return {
      total: phaseInstances.length,
      applicable: applicable.length,
      completed: passed.length,
      failed: failed.length,
      inReview: inReview.length,
      percent: applicable.length > 0 ? Math.round((passed.length / applicable.length) * 100) : 0,
    };
  };

  const getItemInstance = (templateItemId: number) => itemInstances.find((ii: any) => ii.templateItemId === templateItemId);
  const getItemEvidence = (itemInstanceId: number) => evidence.filter((e: any) => e.itemInstanceId === itemInstanceId);
  const getRiskAnswer = (riskQuestionId: number) => riskAnswers.find((ra: any) => ra.templateRiskQuestionId === riskQuestionId);
  const getPhaseRiskQuestions = (phaseId: number) => riskQuestions.filter((rq: any) => rq.templatePhaseId === phaseId);
  const getPhaseLinks = (phaseId: number) => planLinks.filter((l: any) => l.phaseId === phaseId);
  const getItemLinks = (itemInstanceId: number) => planLinks.filter((l: any) => l.itemInstanceId === itemInstanceId);
  const isTaskCompleted = (planItemId: number) => {
    const task = projectTasks.find((t: any) => t.id === planItemId);
    return task && task.actualPctComplete != null && task.actualPctComplete >= 1;
  };

  const meaningfulTasks = projectTasks.filter((t: any) =>
    t.taskNo && t.highLevelProgramme && t.taskNo !== "No." && t.highLevelProgramme !== "HIGH LEVEL PROGRAMME"
  );

  const shouldShowItem = (instance: any) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "unassigned") return !instance.assigneeUserId;
    return getItemQmStatus(instance) === statusFilter;
  };

  const selectedPhase = phases.find((p: any) => p.id === selectedPhaseId);
  const selectedPhaseProgress = selectedPhaseId ? getPhaseProgress(selectedPhaseId) : null;
  const selectedPhaseGroups = groups.filter((g: any) => g.templatePhaseId === selectedPhaseId);
  const selectedPhaseRiskQs = selectedPhaseId ? getPhaseRiskQuestions(selectedPhaseId) : [];
  const selectedPhaseLinkedTasks = selectedPhaseId ? getPhaseLinks(selectedPhaseId) : [];

  const handleBulkStatusChange = (newStatus: string) => {
    selectedItems.forEach(id => {
      updateItemMutation.mutate({ itemInstanceId: id, updates: { qmStatus: newStatus } });
    });
    setSelectedItems(new Set());
  };

  const toggleItemSelection = (id: number) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupId: number) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className="space-y-4" data-testid="quality-tab">
      {!canEdit && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 flex items-center gap-2" data-testid="quality-readonly-banner">
          <Lock className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-600">View-only mode — editing requires Quality Manager access</span>
        </div>
      )}

      {activeWarnings.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 flex items-center gap-3 cursor-pointer hover:bg-red-50 transition-colors" data-testid="quality-warnings">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm font-semibold text-red-600 flex-1">
                {activeWarnings.length} Active Warning{activeWarnings.length !== 1 ? "s" : ""}
              </p>
              <ChevronDown className="w-4 h-4 text-red-400" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border border-t-0 border-red-200 rounded-b-xl p-3 space-y-2 bg-red-50/30">
              {activeWarnings.map((w: any) => (
                <div key={w.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge className={getRiskSeverityColor(w.severity)} variant="outline">{w.severity}</Badge>
                  <span className="flex-1">{w.message || w.warningType}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b" data-testid="phase-tabs">
        {phases.map((phase: any) => {
          const progress = getPhaseProgress(phase.id);
          const colors = getPhaseColor(phase.phaseKey);
          const isActive = selectedPhaseId === phase.id;
          return (
            <button
              key={phase.id}
              onClick={() => setSelectedPhaseId(phase.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all rounded-t-lg ${
                isActive
                  ? `${colors.text} bg-white border border-b-0 ${colors.border} shadow-sm -mb-px z-10`
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              data-testid={`phase-tab-${phase.id}`}
            >
              <div className={`w-2 h-2 rounded-full ${colors.progress}`} />
              <span>{phase.phaseName}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isActive ? colors.text : ""}`}>
                {progress.completed}/{progress.applicable}
              </Badge>
              {progress.failed > 0 && (
                <span className="w-2 h-2 rounded-full bg-red-500 absolute top-1.5 right-1.5" />
              )}
            </button>
          );
        })}
      </div>

      {selectedPhase && selectedPhaseProgress && (
        <div className="space-y-4">
          <Card className={`${getPhaseColor(selectedPhase.phaseKey).border} border`} data-testid="phase-summary-card">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${getPhaseColor(selectedPhase.phaseKey).gradient} flex items-center justify-center`}>
                    <span className="text-white font-bold text-sm">{selectedPhaseProgress.percent}%</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{selectedPhase.phaseName}</p>
                    <p className="text-xs text-muted-foreground">{selectedPhaseProgress.applicable} items</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span data-testid="phase-passed-count">{selectedPhaseProgress.completed} Passed</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span data-testid="phase-failed-count">{selectedPhaseProgress.failed} Failed</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span data-testid="phase-review-count">{selectedPhaseProgress.inReview} In Review</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                    <span>{selectedPhaseProgress.applicable - selectedPhaseProgress.completed - selectedPhaseProgress.failed - selectedPhaseProgress.inReview} Not Started</span>
                  </div>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <Progress value={selectedPhaseProgress.percent} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            {[
              { value: "all", label: `All (${overallStats.total})` },
              { value: "not_started", label: "Not Started" },
              { value: "review", label: `Review (${overallStats.inReview})` },
              { value: "fail", label: `Failed (${overallStats.failed})` },
              { value: "pass", label: `Passed (${overallStats.passed})` },
              { value: "unassigned", label: `Unassigned (${overallStats.unassigned})` },
            ].map(f => (
              <Button
                key={f.value}
                variant={statusFilter === f.value ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px] px-2.5"
                onClick={() => setStatusFilter(f.value)}
                data-testid={`btn-filter-${f.value}`}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {selectedItems.size > 0 && canEdit && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 flex items-center gap-3 flex-wrap" data-testid="bulk-actions-bar">
              <SquareCheck className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">{selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} selected</span>
              <div className="flex items-center gap-1.5 ml-auto">
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => handleBulkStatusChange("pass")} data-testid="bulk-pass">Pass</Button>
                <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600" onClick={() => handleBulkStatusChange("review")} data-testid="bulk-review">Review</Button>
                <Button size="sm" className="h-7 text-xs" variant="destructive" onClick={() => handleBulkStatusChange("fail")} data-testid="bulk-fail">Fail</Button>
                <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => handleBulkStatusChange("na")} data-testid="bulk-na">N/A</Button>
                <Button size="sm" className="h-7 text-xs" variant="ghost" onClick={() => setSelectedItems(new Set())} data-testid="bulk-clear">Clear</Button>
              </div>
            </div>
          )}

          {selectedPhaseLinkedTasks.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phase Linked Tasks</h4>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedPhaseLinkedTasks.map((link: any) => {
                  const task = projectTasks.find((t: any) => t.id === link.planItemId);
                  return (
                    <Badge key={link.id} variant="outline" className="gap-1 py-0.5 pl-2 pr-1 text-[11px]" data-testid={`plan-link-${link.id}`}>
                      {task ? `${task.taskNo} — ${task.highLevelProgramme}` : `Task #${link.planItemId}`}
                      {task?.actualPctComplete != null && (
                        <span className="text-muted-foreground ml-0.5">({Math.round(task.actualPctComplete * 100)}%)</span>
                      )}
                      {canEdit && (
                        <button
                          className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
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
              {linkingPhaseId === selectedPhaseId ? (
                <div className="flex items-center gap-2 flex-1">
                  <Select onValueChange={(val) => { addPlanLinkMutation.mutate({ planItemId: parseInt(val), phaseId: selectedPhaseId! }); }}>
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-link-task-${selectedPhaseId}`}>
                      <SelectValue placeholder="Select a project task to link..." />
                    </SelectTrigger>
                    <SelectContent>
                      {meaningfulTasks
                        .filter((t: any) => !selectedPhaseLinkedTasks.some((l: any) => l.planItemId === t.id))
                        .map((task: any) => (
                          <SelectItem key={task.id} value={String(task.id)}>{task.taskNo} — {task.highLevelProgramme}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setLinkingPhaseId(null)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setLinkingPhaseId(selectedPhaseId)} data-testid={`link-task-phase`}>
                  <Plus className="w-3 h-3" /> Link Project Task
                </Button>
              )}
            </div>
          )}

          {selectedPhaseGroups.map((group: any) => {
            const groupItems = templateItems.filter((ti: any) => ti.templateGroupId === group.id);
            if (groupItems.length === 0) return null;

            const visibleItems = groupItems.filter((ti: any) => {
              const instance = getItemInstance(ti.id);
              return instance && shouldShowItem(instance);
            });

            if (statusFilter !== "all" && visibleItems.length === 0) return null;

            const isGroupExpanded = expandedGroups[group.id] ?? true;
            const displayItems = statusFilter !== "all" ? visibleItems : groupItems;

            return (
              <Collapsible key={group.id} open={isGroupExpanded} onOpenChange={() => toggleGroup(group.id)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded-lg px-2 py-1.5 transition-colors" data-testid={`group-header-${group.id}`}>
                    {isGroupExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <h4 className="text-sm font-semibold flex-1">{group.groupName}</h4>
                    <Badge variant="outline" className="text-[10px] font-medium">{visibleItems.length}/{groupItems.length}</Badge>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2 ml-2 mt-1">
                    {displayItems.map((templateItem: any) => {
                      const instance = getItemInstance(templateItem.id);
                      if (!instance) return null;
                      if (statusFilter !== "all" && !shouldShowItem(instance)) return null;

                      const itemEvidence = getItemEvidence(instance.id);
                      const itemLinks = getItemLinks(instance.id);
                      const hasRedWarning = itemLinks.some((l: any) => isTaskCompleted(l.planItemId)) && !instance.approved;
                      const currentStatus = getItemQmStatus(instance);
                      const statusCfg = getStatusConfig(currentStatus);
                      const assigneeName = instance.assigneeUserId ? teamMemberMap.get(instance.assigneeUserId) : null;
                      const isExpanded = expandedItems[instance.id] ?? false;
                      const isSelected = selectedItems.has(instance.id);

                      return (
                        <div
                          key={instance.id}
                          className={`rounded-xl border transition-all ${
                            isExpanded ? "ring-1 ring-blue-200 shadow-md" :
                            hasRedWarning ? "bg-red-50/50 border-red-300 shadow-sm" :
                            isSelected ? "ring-1 ring-blue-300 bg-blue-50/30" :
                            "bg-white hover:shadow-sm hover:border-slate-300"
                          }`}
                          data-testid={`quality-item-${instance.id}`}
                        >
                          <div className="p-3">
                            <div className="flex items-start gap-2">
                              {canEdit && (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleItemSelection(instance.id)}
                                  className="mt-1"
                                  data-testid={`checkbox-item-${instance.id}`}
                                />
                              )}
                              <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${statusCfg.dot}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`text-sm font-medium ${hasRedWarning ? "text-red-600" : ""}`}>{templateItem.itemName}</p>
                                  {hasRedWarning && (
                                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 shrink-0" data-testid={`warning-unchecked-${instance.id}`}>
                                      <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> Task done — not checked
                                    </Badge>
                                  )}
                                  {itemEvidence.length > 0 && (
                                    <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 h-4">
                                      <Paperclip className="w-2.5 h-2.5" /> {itemEvidence.length}
                                    </Badge>
                                  )}
                                </div>
                                {templateItem.description && !isExpanded && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{templateItem.description}</p>
                                )}
                                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                                  {assigneeName && (
                                    <span className="flex items-center gap-1">
                                      <User className="w-3 h-3" /> {assigneeName}
                                    </span>
                                  )}
                                  {(instance.startDate || instance.endDate) && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {instance.startDate && new Date(instance.startDate).toLocaleDateString()}
                                      {instance.startDate && instance.endDate && " → "}
                                      {instance.endDate && new Date(instance.endDate).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                {canEdit && (
                                  <>
                                    {["pass", "fail", "review", "na"].map(s => {
                                      const sc = getStatusConfig(s);
                                      const isCurrentStatus = currentStatus === s;
                                      return (
                                        <button
                                          key={s}
                                          className={`h-7 px-2 text-[10px] font-medium rounded-md border transition-colors ${
                                            isCurrentStatus ? `${sc.bg} ${sc.color} ring-1 ring-offset-1` : `${sc.btnClass} opacity-60`
                                          }`}
                                          onClick={() => {
                                            if (s === "pass" && (currentStatus === "review" || currentStatus === "fail") && !isQmOrAdmin) return;
                                            updateItemMutation.mutate({ itemInstanceId: instance.id, updates: { qmStatus: s } });
                                          }}
                                          data-testid={`btn-status-${s}-${instance.id}`}
                                        >
                                          {sc.label}
                                        </button>
                                      );
                                    })}
                                  </>
                                )}
                                {!canEdit && (
                                  <Badge className={`${statusCfg.bg} ${statusCfg.color} text-[10px]`}>{statusCfg.label}</Badge>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-[11px] px-2 ml-1"
                                  onClick={() => setExpandedItems(prev => ({ ...prev, [instance.id]: !prev[instance.id] }))}
                                  data-testid={`button-expand-item-${instance.id}`}
                                >
                                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </Button>
                              </div>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t px-4 py-3 space-y-4 bg-slate-50/50">
                              {templateItem.description && (
                                <div>
                                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Description</Label>
                                  <p className="text-sm mt-1">{templateItem.description}</p>
                                </div>
                              )}

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Assignee</Label>
                                  <Select
                                    disabled={!canEdit}
                                    value={String(instance.assigneeUserId || "unassigned")}
                                    onValueChange={(val) => {
                                      const userId = val === "unassigned" ? null : parseInt(val);
                                      updateItemMutation.mutate({ itemInstanceId: instance.id, updates: { assigneeUserId: userId } });
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs mt-1" data-testid={`select-assignee-${instance.id}`}>
                                      <User className="w-3 h-3 shrink-0 mr-1" />
                                      <SelectValue placeholder="Unassigned" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="unassigned">Unassigned</SelectItem>
                                      {teamMembers.map((m: any) => (
                                        <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Start Date</Label>
                                    <Input
                                      type="date"
                                      className="h-8 text-xs mt-1"
                                      disabled={!canEdit}
                                      value={instance.startDate ? instance.startDate.split("T")[0] : ""}
                                      onChange={(e) => updateItemMutation.mutate({ itemInstanceId: instance.id, updates: { startDate: e.target.value } })}
                                      data-testid={`input-start-date-${instance.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">End Date</Label>
                                    <Input
                                      type="date"
                                      className="h-8 text-xs mt-1"
                                      disabled={!canEdit}
                                      value={instance.endDate ? instance.endDate.split("T")[0] : ""}
                                      onChange={(e) => updateItemMutation.mutate({ itemInstanceId: instance.id, updates: { endDate: e.target.value } })}
                                      data-testid={`input-end-date-${instance.id}`}
                                    />
                                  </div>
                                </div>
                              </div>

                              {instance.approved && (
                                <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                                  <CheckCircle2 className="w-4 h-4" />
                                  <span>Approved{instance.approvedAt ? ` on ${new Date(instance.approvedAt).toLocaleDateString()}` : ""}</span>
                                  {instance.approvalComment && <span className="text-muted-foreground ml-2">— {instance.approvalComment}</span>}
                                </div>
                              )}

                              {canEdit && !instance.approved && (
                                <div className="flex items-center gap-2">
                                  {sendForApprovalItem === instance.id ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <Select value={sfaApprover} onValueChange={setSfaApprover}>
                                        <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-approver-${instance.id}`}>
                                          <SelectValue placeholder="Select approver..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {teamMembers.map((m: any) => (
                                            <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Button
                                        size="sm"
                                        className="h-8 text-xs gap-1"
                                        disabled={!sfaApprover}
                                        onClick={() => {
                                          approveItemMutation.mutate({ itemInstanceId: instance.id, approved: true });
                                          setSendForApprovalItem(null);
                                          setSfaApprover("");
                                        }}
                                        data-testid={`btn-confirm-approval-${instance.id}`}
                                      >
                                        <CheckCircle className="w-3 h-3" /> Approve
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSendForApprovalItem(null); setSfaApprover(""); }}>Cancel</Button>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs gap-1 text-amber-600 border-amber-200 hover:bg-amber-50"
                                      onClick={() => setSendForApprovalItem(instance.id)}
                                      data-testid={`btn-send-for-approval-${instance.id}`}
                                    >
                                      <Send className="w-3 h-3" /> Send for Approval
                                    </Button>
                                  )}
                                </div>
                              )}

                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                    Evidence ({itemEvidence.length})
                                  </Label>
                                </div>
                                {itemEvidence.length > 0 && (
                                  <div className="space-y-1.5 mb-2">
                                    {itemEvidence.map((ev: any) => (
                                      <div key={ev.id} className="flex items-center gap-2 text-xs bg-white rounded-lg border p-2" data-testid={`evidence-${ev.id}`}>
                                        <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="flex-1 truncate">{ev.evidenceNote || ev.evidenceUrl}</span>
                                        {ev.evidenceUrl && (
                                          <a href={ev.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                                            <ExternalLink className="w-3 h-3" />
                                          </a>
                                        )}
                                        {canEdit && (
                                          <button
                                            className="text-muted-foreground hover:text-destructive p-0.5"
                                            onClick={() => deleteEvidenceMutation.mutate(ev.id)}
                                            data-testid={`delete-evidence-${ev.id}`}
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {canEdit && (
                                  <div
                                    className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
                                      dragOverItem === instance.id ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                                    }`}
                                    onDragOver={(e) => { e.preventDefault(); setDragOverItem(instance.id); }}
                                    onDragLeave={() => setDragOverItem(null)}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      setDragOverItem(null);
                                      const files = e.dataTransfer.files;
                                      if (files.length > 0) handleEvidenceFileUpload(instance.id, files[0]);
                                    }}
                                    onClick={() => fileInputRefs.current[instance.id]?.click()}
                                    data-testid={`evidence-dropzone-${instance.id}`}
                                  >
                                    <input
                                      type="file"
                                      className="hidden"
                                      ref={(el) => { fileInputRefs.current[instance.id] = el; }}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleEvidenceFileUpload(instance.id, file);
                                        e.target.value = "";
                                      }}
                                      data-testid={`evidence-input-${instance.id}`}
                                    />
                                    {evidenceUploading === instance.id ? (
                                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center gap-1">
                                        <Upload className="w-5 h-5 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">Drop file here or click to upload</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {itemLinks.length > 0 && (
                                <div>
                                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Linked Plan Tasks</Label>
                                  <div className="flex flex-wrap gap-1.5 mt-1">
                                    {itemLinks.map((link: any) => {
                                      const task = projectTasks.find((t: any) => t.id === link.planItemId);
                                      const taskDone = isTaskCompleted(link.planItemId);
                                      return (
                                        <Badge
                                          key={link.id}
                                          variant="outline"
                                          className={`text-[10px] gap-0.5 py-0.5 ${taskDone && !instance.approved ? "border-red-300 text-red-600 bg-red-50/50" : ""}`}
                                          data-testid={`item-link-${link.id}`}
                                        >
                                          <Link2 className="w-2.5 h-2.5" />
                                          {task ? `${task.taskNo} — ${task.highLevelProgramme}` : `#${link.planItemId}`}
                                          {task?.actualPctComplete != null && (
                                            <span className="ml-0.5">({Math.round(task.actualPctComplete * 100)}%)</span>
                                          )}
                                          {canEdit && (
                                            <button
                                              className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                              onClick={() => removePlanLinkMutation.mutate(link.id)}
                                            >
                                              <X className="w-2.5 h-2.5" />
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
                                  {linkingItemId === instance.id ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <Select onValueChange={(val) => { addPlanLinkMutation.mutate({ planItemId: parseInt(val), itemInstanceId: instance.id, phaseId: selectedPhaseId! }); }}>
                                        <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-link-item-task-${instance.id}`}>
                                          <SelectValue placeholder="Link a project task..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {meaningfulTasks
                                            .filter((t: any) => !itemLinks.some((l: any) => l.planItemId === t.id))
                                            .map((task: any) => (
                                              <SelectItem key={task.id} value={String(task.id)}>{task.taskNo} — {task.highLevelProgramme}</SelectItem>
                                            ))}
                                        </SelectContent>
                                      </Select>
                                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setLinkingItemId(null)}>Cancel</Button>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs gap-1"
                                      onClick={() => setLinkingItemId(instance.id)}
                                      data-testid={`link-item-task-${instance.id}`}
                                    >
                                      <Link2 className="w-3 h-3" /> Link Task
                                    </Button>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center gap-2 pt-1 border-t">
                                {canDeleteQc && (
                                  <>
                                    {deleteConfirmId === instance.id ? (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-red-600">Delete this item?</span>
                                        <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => deleteItemMutation.mutate(instance.id)} data-testid={`confirm-delete-${instance.id}`}>Yes, Delete</Button>
                                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                                        onClick={() => setDeleteConfirmId(instance.id)}
                                        data-testid={`delete-item-${instance.id}`}
                                      >
                                        <Trash2 className="w-3 h-3" /> Delete Item
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {canEdit && (
                      <div className="mt-2">
                        {showAddItem === group.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={newItemName}
                              onChange={(e) => setNewItemName(e.target.value)}
                              placeholder="New item name..."
                              className="h-8 text-xs flex-1"
                              data-testid={`input-new-item-${group.id}`}
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1"
                              disabled={!newItemName.trim() || createItemMutation.isPending}
                              onClick={() => createItemMutation.mutate({ itemName: newItemName.trim(), groupId: group.id })}
                              data-testid={`btn-add-item-${group.id}`}
                            >
                              {createItemMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                              Add
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setShowAddItem(null); setNewItemName(""); }}>Cancel</Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1 text-muted-foreground"
                            onClick={() => setShowAddItem(group.id)}
                            data-testid={`btn-show-add-item-${group.id}`}
                          >
                            <Plus className="w-3 h-3" /> Add Item
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          {selectedPhaseRiskQs.length > 0 && (
            <Collapsible open={showRiskQuestions} onOpenChange={setShowRiskQuestions}>
              <CollapsibleTrigger asChild>
                <div className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded-lg px-2 py-2 transition-colors" data-testid="risk-questions-toggle">
                  {showRiskQuestions ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold">Risk Questions ({selectedPhaseRiskQs.length})</span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 mt-2 ml-2">
                  {selectedPhaseRiskQs.map((rq: any) => {
                    const answer = getRiskAnswer(rq.id);
                    return (
                      <Card key={rq.id} className="border shadow-sm" data-testid={`risk-question-${rq.id}`}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start gap-2">
                            <Badge className={getRiskSeverityColor(rq.severity)} variant="outline">{rq.severity}</Badge>
                            <p className="text-sm font-medium">{rq.questionText}</p>
                          </div>
                          {canEdit && answer && (
                            <div className="space-y-2">
                              <Select
                                value={answer.answerValue || "unanswered"}
                                onValueChange={(val) => updateRiskMutation.mutate({ riskAnswerId: answer.id, updates: { answerValue: val === "unanswered" ? null : val } })}
                              >
                                <SelectTrigger className="h-8 text-xs" data-testid={`select-risk-answer-${rq.id}`}>
                                  <SelectValue placeholder="Select answer..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unanswered">Unanswered</SelectItem>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                  <SelectItem value="partial">Partial</SelectItem>
                                  <SelectItem value="na">N/A</SelectItem>
                                </SelectContent>
                              </Select>
                              <Textarea
                                className="text-xs"
                                placeholder="Notes..."
                                rows={2}
                                value={answer.notes || ""}
                                onChange={(e) => updateRiskMutation.mutate({ riskAnswerId: answer.id, updates: { notes: e.target.value } })}
                                data-testid={`input-risk-notes-${rq.id}`}
                              />
                            </div>
                          )}
                          {!canEdit && answer && (
                            <div className="text-xs space-y-1">
                              <p><span className="font-medium">Answer:</span> {answer.answerValue || "Unanswered"}</p>
                              {answer.notes && <p><span className="font-medium">Notes:</span> {answer.notes}</p>}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {!selectedPhase && phases.length > 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">Select a phase above to view quality items</p>
        </div>
      )}
    </div>
  );
}
