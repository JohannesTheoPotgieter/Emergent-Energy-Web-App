import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, FileText, Shield, AlertTriangle, Clock, User, Lock, Link2, X, Plus, Trash2, Send, Loader2, CheckCircle2, Upload, FolderOpen, Paperclip, ExternalLink, ArrowLeft, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";

function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; progress: string; lightBg: string }> = {
  "planning_design": { bg: "bg-blue-500/10", text: "text-blue-600", border: "border-blue-200", progress: "bg-blue-500", lightBg: "bg-blue-50" },
  "construction": { bg: "bg-orange-500/10", text: "text-orange-600", border: "border-orange-200", progress: "bg-orange-500", lightBg: "bg-orange-50" },
  "commissioning": { bg: "bg-purple-500/10", text: "text-purple-600", border: "border-purple-200", progress: "bg-purple-500", lightBg: "bg-purple-50" },
  "handover": { bg: "bg-green-500/10", text: "text-green-600", border: "border-green-200", progress: "bg-green-500", lightBg: "bg-green-50" },
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

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  not_started: { label: "Not Started", color: "text-slate-500", bg: "bg-slate-50 border-slate-200", dot: "bg-slate-400" },
  review: { label: "In Review", color: "text-amber-600", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  pass: { label: "Passed", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  fail: { label: "Failed", color: "text-red-600", bg: "bg-red-50 border-red-200", dot: "bg-red-500" },
  na: { label: "N/A", color: "text-slate-400", bg: "bg-slate-50 border-slate-200", dot: "bg-slate-300" },
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
  const [expandedPhases, setExpandedPhases] = useState<Record<number, boolean>>({});
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, any>>({});
  const [linkingPhaseId, setLinkingPhaseId] = useState<number | null>(null);
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [showAddItem, setShowAddItem] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [sendForApprovalItem, setSendForApprovalItem] = useState<number | null>(null);
  const [sfaApprover, setSfaApprover] = useState("");
  const [sfaNote, setSfaNote] = useState("");
  const [sfaFile, setSfaFile] = useState<File | null>(null);
  const [sfaSending, setSfaSending] = useState(false);
  const [evidenceMode, setEvidenceMode] = useState<Record<number, "upload" | "sharepoint" | null>>({});
  const [evidenceUploading, setEvidenceUploading] = useState<number | null>(null);
  const [spBrowseItemId, setSpBrowseItemId] = useState<number | null>(null);
  const [spFolderStack, setSpFolderStack] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "Root" }]);
  const [spLinking, setSpLinking] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const isQmOrAdmin = ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '') || ['quality_manager', 'QUALITY_MANAGER'].includes(user?.role || '');
  const canEdit = isQmOrAdmin;
  const { allowed: canDeleteQc } = usePermission('pd_quality', 'delete');
  const { allowed: canEditQc } = usePermission('pd_quality', 'edit');

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    },
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
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
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
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
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
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
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
      queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
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

  const currentSpFolderId = spFolderStack[spFolderStack.length - 1]?.id || null;
  const { data: spBrowseData, isLoading: spBrowseLoading } = useQuery({
    queryKey: ["quality-sp-browse", currentSpFolderId],
    queryFn: async () => {
      const url = currentSpFolderId
        ? `/api/quality/sp-browse?folderId=${currentSpFolderId}`
        : `/api/quality/sp-browse`;
      const res = await qFetch(url);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: spBrowseItemId !== null,
    staleTime: 30000,
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
      setEvidenceMode(prev => ({ ...prev, [instanceId]: null }));
    } catch (err: any) {
      console.error("Evidence upload failed:", err);
    } finally {
      setEvidenceUploading(null);
    }
  };

  const handleSpFileSelect = async (instanceId: number, spItemId: string, fileName: string) => {
    setSpLinking(spItemId);
    try {
      const res = await qFetch(`/api/quality/sp-file-link?itemId=${spItemId}`);
      if (!res.ok) throw new Error("Failed to get file link");
      const meta = await res.json();
      const evidenceUrl = meta.webUrl || `sharepoint://${spItemId}`;
      await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${instanceId}/evidence`, {
        method: "POST",
        body: JSON.stringify({ evidenceUrl, evidenceNote: `SharePoint: ${fileName}` }),
      });
      queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
      setSpBrowseItemId(null);
      setSpFolderStack([{ id: null, name: "Root" }]);
      setEvidenceMode(prev => ({ ...prev, [instanceId]: null }));
    } catch (err: any) {
      console.error("SharePoint link failed:", err);
    } finally {
      setSpLinking(null);
    }
  };

  useEffect(() => {
    if (checklistData?.phases) {
      const initial: Record<number, boolean> = {};
      checklistData.phases.forEach((p: any) => { initial[p.id] = true; });
      setExpandedPhases(initial);
    }
  }, [checklistData?.phases]);

  const teamMemberMap = useMemo(() => {
    const map = new Map<number, string>();
    teamMembers.forEach(m => map.set(m.id, m.name));
    return map;
  }, [teamMembers]);

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

  const getItemQmStatus = (instance: any): string => {
    if (instance.qmStatus && instance.qmStatus !== "not_started") return instance.qmStatus;
    if (instance.isApplicable === false) return "na";
    if (instance.approved) return "pass";
    return "not_started";
  };

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

  const overallStats = useMemo(() => {
    const applicable = itemInstances.filter((i: any) => i.isApplicable !== false);
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
  }, [itemInstances]);

  const shouldShowItem = (instance: any) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "unassigned") return !instance.assigneeUserId;
    return getItemQmStatus(instance) === statusFilter;
  };

  return (
    <div className="space-y-5">
      {!canEdit && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 flex items-center gap-2" data-testid="quality-readonly-banner">
          <Lock className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-600">
            View-only mode — editing requires Quality Manager access
          </span>
        </div>
      )}

      {activeWarnings.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-4" data-testid="quality-warnings">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-semibold text-red-600">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {phases.map((phase: any) => {
          const progress = getPhaseProgress(phase.id);
          const colors = getPhaseColor(phase.phaseKey);
          return (
            <Card key={phase.id} className={`${colors.border} border shadow-sm hover:shadow-md transition-shadow`}>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${colors.progress}`} />
                  <p className={`text-xs font-semibold ${colors.text} uppercase tracking-wider`}>{phase.phaseName}</p>
                </div>
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-bold">{progress.percent}%</span>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[11px] text-muted-foreground font-medium">{progress.completed}/{progress.applicable}</span>
                    {progress.failed > 0 && <span className="text-[10px] text-red-500 font-medium">{progress.failed} failed</span>}
                    {progress.inReview > 0 && <span className="text-[10px] text-amber-500 font-medium">{progress.inReview} review</span>}
                  </div>
                </div>
                <Progress value={progress.percent} className="h-1.5" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">Filter:</span>
        {[
          { value: "all", label: `All (${overallStats.total})` },
          { value: "not_started", label: `Not Started` },
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

      {phases.map((phase: any) => {
        const phaseGroups = groups.filter((g: any) => g.templatePhaseId === phase.id);
        const colors = getPhaseColor(phase.phaseKey);
        const progress = getPhaseProgress(phase.id);
        const isExpanded = expandedPhases[phase.id] ?? true;
        const phaseRiskQs = getPhaseRiskQuestions(phase.id);
        const phaseLinkedTasks = getPhaseLinks(phase.id);

        return (
          <Card key={phase.id} className={`${colors.border} border shadow-sm`} data-testid={`quality-phase-${phase.id}`}>
            <Collapsible open={isExpanded} onOpenChange={() => togglePhase(phase.id)}>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {isExpanded ? (
                        <ChevronDown className={`w-4 h-4 ${colors.text}`} />
                      ) : (
                        <ChevronRight className={`w-4 h-4 ${colors.text}`} />
                      )}
                      <div className={`w-2 h-2 rounded-full ${colors.progress}`} />
                      <CardTitle className="text-sm sm:text-base">
                        <span className={colors.text}>{phase.phaseName}</span>
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px] font-medium">
                        {progress.completed}/{progress.applicable}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                      {progress.failed > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{progress.failed} failed</Badge>
                      )}
                      {progress.inReview > 0 && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-600 border-amber-200">{progress.inReview} review</Badge>
                      )}
                      <span className="text-sm font-bold tabular-nums">{progress.percent}%</span>
                      <div className="w-20 sm:w-24">
                        <Progress value={progress.percent} className="h-2" />
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0 space-y-5 px-4 pb-5">
                  {phaseLinkedTasks.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Linked Project Tasks</h4>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {phaseLinkedTasks.map((link: any) => {
                          const task = projectTasks.find((t: any) => t.id === link.planItemId);
                          return (
                            <Badge key={link.id} variant="outline" className="gap-1 py-0.5 pl-2 pr-1 text-[11px]" data-testid={`plan-link-${link.id}`}>
                              {task ? `${task.taskNo} — ${task.highLevelProgramme}` : `Task #${link.planItemId}`}
                              {task?.actualPctComplete != null && (
                                <span className="text-muted-foreground ml-0.5">
                                  ({Math.round(task.actualPctComplete * 100)}%)
                                </span>
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

                    const visibleItems = groupItems.filter((ti: any) => {
                      const instance = getItemInstance(ti.id);
                      return instance && shouldShowItem(instance);
                    });

                    if (statusFilter !== "all" && visibleItems.length === 0) return null;

                    return (
                      <div key={group.id} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <h4 className="text-sm font-semibold">{group.groupName}</h4>
                          <Badge variant="outline" className="text-[10px] font-medium">{groupItems.length}</Badge>
                        </div>

                        <div className="space-y-1.5">
                          {(statusFilter !== "all" ? visibleItems : groupItems).map((templateItem: any) => {
                            const instance = getItemInstance(templateItem.id);
                            if (!instance) return null;
                            if (statusFilter !== "all" && !shouldShowItem(instance)) return null;
                            const itemEvidence = getItemEvidence(instance.id);
                            const isEditing = editingItem === instance.id;
                            const itemLinks = getItemLinks(instance.id);
                            const hasRedWarning = itemLinks.some((l: any) => isTaskCompleted(l.planItemId)) && !instance.approved;
                            const currentStatus = getItemQmStatus(instance);
                            const statusCfg = getStatusConfig(currentStatus);
                            const assigneeName = instance.assigneeUserId ? teamMemberMap.get(instance.assigneeUserId) : null;

                            return (
                              <div
                                key={instance.id}
                                className={`rounded-xl border transition-all ${
                                  isEditing ? "ring-2 ring-blue-200 shadow-md" :
                                  hasRedWarning ? "bg-red-50/50 border-red-300 shadow-sm" :
                                  "bg-white hover:shadow-sm hover:border-slate-300"
                                }`}
                                data-testid={`quality-item-${instance.id}`}
                              >
                                <div className="p-3">
                                  <div className="flex flex-col gap-2">
                                    <div className="flex items-start gap-2 sm:gap-3">
                                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusCfg.dot}`} />

                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <p className={`text-sm font-medium ${hasRedWarning ? "text-red-600" : ""}`}>{templateItem.itemName}</p>
                                          {hasRedWarning && (
                                            <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 shrink-0" data-testid={`warning-unchecked-${instance.id}`}>
                                              <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                                              Task done — not checked
                                            </Badge>
                                          )}
                                          {itemEvidence.length > 0 && (
                                            <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 h-4">
                                              <Paperclip className="w-2.5 h-2.5" />
                                              {itemEvidence.length}
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
                                                  className={`text-[9px] gap-0.5 py-0 ${taskDone && !instance.approved ? "border-red-300 text-red-600 bg-red-50/50" : ""}`}
                                                  data-testid={`item-link-${link.id}`}
                                                >
                                                  <Link2 className="w-2.5 h-2.5" />
                                                  {task ? `${task.taskNo}` : `#${link.planItemId}`}
                                                  {task?.actualPctComplete != null && (
                                                    <span className="ml-0.5">({Math.round(task.actualPctComplete * 100)}%)</span>
                                                  )}
                                                  {canEdit && (
                                                    <button
                                                      className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                                      onClick={(e) => { e.stopPropagation(); removePlanLinkMutation.mutate(link.id); }}
                                                    >
                                                      <X className="w-2 h-2" />
                                                    </button>
                                                  )}
                                                </Badge>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                        <Select
                                          disabled={!canEdit}
                                          value={String(instance.assigneeUserId || "unassigned")}
                                          onValueChange={(val) => {
                                            const userId = val === "unassigned" ? null : parseInt(val);
                                            handleItemStatusChange(instance.id, "assigneeUserId", userId);
                                          }}
                                        >
                                          <SelectTrigger
                                            className={`h-7 text-[11px] w-[110px] sm:w-[130px] gap-1 ${!instance.assigneeUserId ? "text-muted-foreground border-dashed" : ""}`}
                                            data-testid={`select-assignee-${instance.id}`}
                                          >
                                            <User className="w-3 h-3 shrink-0" />
                                            <SelectValue placeholder="Assign..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="unassigned">Unassigned</SelectItem>
                                            {teamMembers.map((m: any) => (
                                              <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>

                                        <Select
                                          disabled={!canEdit}
                                          value={currentStatus}
                                          onValueChange={(val) => {
                                            const needsQmToPass = currentStatus === "review" || currentStatus === "fail";
                                            const canSetPass = isQmOrAdmin || !needsQmToPass;
                                            if (val === "pass" && !canSetPass) return;
                                            updateItemMutation.mutate({
                                              itemInstanceId: instance.id,
                                              updates: { qmStatus: val },
                                            });
                                          }}
                                        >
                                          <SelectTrigger
                                            className={`h-7 text-[11px] w-[100px] sm:w-[110px] border ${statusCfg.bg}`}
                                            data-testid={`select-status-${instance.id}`}
                                          >
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="not_started">Not Started</SelectItem>
                                            {(isQmOrAdmin || !(currentStatus === "review" || currentStatus === "fail")) && (
                                              <SelectItem value="pass">Pass</SelectItem>
                                            )}
                                            <SelectItem value="review">Review</SelectItem>
                                            <SelectItem value="fail">Failed</SelectItem>
                                            <SelectItem value="na">N/A</SelectItem>
                                          </SelectContent>
                                        </Select>

                                        {(() => {
                                          const canSendForApproval = currentStatus === "not_started" || currentStatus === "fail" || currentStatus === "review";
                                          return canSendForApproval ? (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-7 text-[10px] px-2 gap-1 text-amber-600 border-amber-200 hover:bg-amber-50 hidden sm:flex"
                                              onClick={(e) => { e.stopPropagation(); setSendForApprovalItem(instance.id); }}
                                              data-testid={`btn-send-for-approval-qm-${instance.id}`}
                                            >
                                              <Send className="w-3 h-3" /> Approve
                                            </Button>
                                          ) : null;
                                        })()}

                                        {canEdit && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            title="Link project task"
                                            onClick={(e) => { e.stopPropagation(); setLinkingItemId(linkingItemId === instance.id ? null : instance.id); }}
                                            data-testid={`link-item-task-${instance.id}`}
                                          >
                                            <Link2 className={`w-3.5 h-3.5 ${linkingItemId === instance.id ? "text-primary" : "text-muted-foreground"}`} />
                                          </Button>
                                        )}

                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 text-[11px] px-2"
                                          onClick={() => setEditingItem(isEditing ? null : instance.id)}
                                          data-testid={`button-edit-item-${instance.id}`}
                                        >
                                          {isEditing ? "Close" : "Details"}
                                        </Button>

                                        {canDeleteQc && deleteConfirmId !== instance.id && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(instance.id); }}
                                            className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                            data-testid={`btn-delete-qc-item-${instance.id}`}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        )}
                                        {deleteConfirmId === instance.id && (
                                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                            <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => deleteItemMutation.mutate(instance.id)} disabled={deleteItemMutation.isPending} data-testid={`btn-confirm-delete-qc-${instance.id}`}>
                                              {deleteItemMutation.isPending ? "..." : "Delete"}
                                            </Button>
                                            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setDeleteConfirmId(null)} data-testid={`btn-cancel-delete-qc-${instance.id}`}>No</Button>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Mobile: send for approval button */}
                                    {(() => {
                                      const canSendForApproval = currentStatus === "not_started" || currentStatus === "fail" || currentStatus === "review";
                                      return canSendForApproval ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 text-[10px] px-2 gap-1 text-amber-600 border-amber-200 hover:bg-amber-50 sm:hidden w-fit"
                                          onClick={(e) => { e.stopPropagation(); setSendForApprovalItem(instance.id); }}
                                          data-testid={`btn-send-for-approval-qm-mobile-${instance.id}`}
                                        >
                                          <Send className="w-3 h-3" /> Send for Approval
                                        </Button>
                                      ) : null;
                                    })()}
                                  </div>
                                </div>

                                {linkingItemId === instance.id && (
                                  <div className="px-3 pb-3 flex items-center gap-2">
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
                                  <div className="border-t bg-slate-50/50 px-3 pb-3 pt-3 space-y-3 rounded-b-xl">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                      <div className="space-y-1.5">
                                        <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1 uppercase tracking-wider">
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
                                        <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1 uppercase tracking-wider">
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
                                        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Allowed Days</label>
                                        <Input
                                          type="number"
                                          className="h-8 text-sm"
                                          placeholder="Days"
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
                                    </div>

                                    <div className="flex items-center gap-3 flex-wrap">
                                      {instance.startDate && instance.endDate && (
                                        <span className="text-[11px] text-muted-foreground">
                                          Actual: {calculateBusinessDays(instance.startDate, instance.endDate)} working days
                                        </span>
                                      )}
                                      {instance.endDate && instance.startDate && new Date(instance.endDate) < new Date(instance.startDate) && (
                                        <span className="text-[11px] text-red-500 font-medium" data-testid={`date-error-${instance.id}`}>End date before start date</span>
                                      )}
                                      {(() => {
                                        const actualDays = instance.startDate && instance.endDate ? calculateBusinessDays(instance.startDate, instance.endDate) : null;
                                        const allowed = instance.allowedWorkingDays;
                                        if (actualDays !== null && allowed && allowed > 0 && actualDays > allowed) {
                                          return (
                                            <Badge variant="destructive" className="text-[10px] gap-1" data-testid={`badge-overdue-${instance.id}`}>
                                              <AlertCircle className="w-3 h-3" />
                                              Overdue by {actualDays - allowed} day{actualDays - allowed !== 1 ? "s" : ""}
                                            </Badge>
                                          );
                                        }
                                        if (actualDays !== null && allowed && allowed > 0 && actualDays <= allowed) {
                                          return (
                                            <Badge className="text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700" data-testid={`badge-ontrack-${instance.id}`}>
                                              <CheckCircle className="w-3 h-3" />
                                              On Track
                                            </Badge>
                                          );
                                        }
                                        if (!instance.startDate && !instance.endDate) {
                                          return (
                                            <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-notstarted-${instance.id}`}>
                                              Not started
                                            </Badge>
                                          );
                                        }
                                        if (instance.startDate && !instance.endDate) {
                                          return (
                                            <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-inprogress-${instance.id}`}>
                                              In progress
                                            </Badge>
                                          );
                                        }
                                        return null;
                                      })()}
                                    </div>

                                    <div className="space-y-1.5">
                                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                                      <Textarea
                                        className="text-sm min-h-[50px]"
                                        placeholder="Add notes..."
                                        defaultValue={instance.notApplicableReason || ""}
                                        onBlur={(e) => handleItemStatusChange(instance.id, "notApplicableReason", e.target.value)}
                                        data-testid={`textarea-notes-${instance.id}`}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between">
                                        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                          <Paperclip className="w-3 h-3" /> Evidence {itemEvidence.length > 0 && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{itemEvidence.length}</Badge>}
                                        </label>
                                        {canEdit && !evidenceMode[instance.id] && (
                                          <div className="flex gap-1">
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-6 text-[10px] px-2 gap-1"
                                              onClick={() => setEvidenceMode(prev => ({ ...prev, [instance.id]: "upload" }))}
                                              data-testid={`btn-upload-evidence-${instance.id}`}
                                            >
                                              <Upload className="w-3 h-3" /> Upload File
                                            </Button>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-6 text-[10px] px-2 gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                              onClick={() => { setEvidenceMode(prev => ({ ...prev, [instance.id]: "sharepoint" })); setSpBrowseItemId(instance.id); setSpFolderStack([{ id: null, name: "Root" }]); }}
                                              data-testid={`btn-sp-evidence-${instance.id}`}
                                            >
                                              <FolderOpen className="w-3 h-3" /> SharePoint
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                      {itemEvidence.length > 0 && (
                                        <div className="space-y-1">
                                          {itemEvidence.map((ev: any) => {
                                            const isLocal = ev.evidenceUrl?.startsWith("/uploads/");
                                            const isSp = ev.evidenceNote?.startsWith("SharePoint:");
                                            const displayName = isSp ? ev.evidenceNote.replace("SharePoint: ", "") : (ev.evidenceNote || ev.evidenceUrl);
                                            return (
                                              <div key={ev.id} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${isSp ? "bg-blue-50/50" : "bg-muted/30"}`} data-testid={`evidence-item-${ev.id}`}>
                                                {isSp ? <FolderOpen className="w-3 h-3 text-blue-500 shrink-0" /> : <FileText className="w-3 h-3 text-muted-foreground shrink-0" />}
                                                <a href={ev.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate flex-1 flex items-center gap-1">
                                                  {displayName}
                                                  <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
                                                </a>
                                                {isSp && <Badge className="text-[8px] bg-blue-100 text-blue-700 px-1 py-0 h-3.5">SharePoint</Badge>}
                                                {isLocal && <Badge className="text-[8px] bg-green-100 text-green-700 px-1 py-0 h-3.5">Uploaded</Badge>}
                                                {canEdit && (
                                                  <button
                                                    onClick={() => deleteEvidenceMutation.mutate(ev.id)}
                                                    className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                                                    data-testid={`btn-delete-evidence-${ev.id}`}
                                                  >
                                                    <Trash2 className="h-3 w-3" />
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      {itemEvidence.length === 0 && !evidenceMode[instance.id] && (
                                        <p className="text-[10px] text-muted-foreground italic">No evidence attached</p>
                                      )}
                                      {evidenceMode[instance.id] === "upload" && (
                                        <div className="space-y-2">
                                          <div
                                            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-green-400 hover:bg-green-50/30 border-muted`}
                                            onClick={() => {
                                              const input = document.createElement("input");
                                              input.type = "file";
                                              input.onchange = (e) => {
                                                const file = (e.target as HTMLInputElement).files?.[0];
                                                if (file) handleEvidenceFileUpload(instance.id, file);
                                              };
                                              input.click();
                                            }}
                                            data-testid={`dropzone-evidence-${instance.id}`}
                                          >
                                            {evidenceUploading === instance.id ? (
                                              <div className="flex items-center justify-center gap-2 text-xs">
                                                <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                                                <span>Uploading...</span>
                                              </div>
                                            ) : (
                                              <div className="text-xs text-muted-foreground flex flex-col items-center gap-1">
                                                <Upload className="h-5 w-5" />
                                                Click to select a file
                                              </div>
                                            )}
                                          </div>
                                          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEvidenceMode(prev => ({ ...prev, [instance.id]: null }))} data-testid={`btn-cancel-upload-${instance.id}`}>Cancel</Button>
                                        </div>
                                      )}
                                      {evidenceMode[instance.id] === "sharepoint" && spBrowseItemId === instance.id && (
                                        <div className="border rounded-lg p-3 space-y-2 bg-blue-50/30">
                                          <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
                                            <FolderOpen className="w-3.5 h-3.5" />
                                            SharePoint — Select a file
                                          </div>
                                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap">
                                            {spFolderStack.map((f, idx) => (
                                              <span key={idx} className="flex items-center gap-0.5">
                                                {idx > 0 && <ChevronRight className="w-2.5 h-2.5" />}
                                                <button
                                                  className="hover:text-blue-600 hover:underline"
                                                  onClick={() => setSpFolderStack(prev => prev.slice(0, idx + 1))}
                                                  data-testid={`sp-breadcrumb-${idx}`}
                                                >{f.name}</button>
                                              </span>
                                            ))}
                                          </div>
                                          {spBrowseLoading ? (
                                            <div className="flex items-center justify-center py-4">
                                              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                            </div>
                                          ) : (
                                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                                              {!spBrowseData?.items?.length && <p className="text-[10px] text-muted-foreground py-2 text-center">No items found</p>}
                                              {spBrowseData?.items?.map((item: any) => (
                                                <div
                                                  key={item.id}
                                                  className={`flex items-center gap-2 text-xs p-1.5 rounded cursor-pointer transition-colors ${item.isFolder ? "hover:bg-blue-100/50" : "hover:bg-green-100/50"}`}
                                                  onClick={() => {
                                                    if (item.isFolder) {
                                                      setSpFolderStack(prev => [...prev, { id: item.id, name: item.name }]);
                                                    } else {
                                                      handleSpFileSelect(instance.id, item.id, item.name);
                                                    }
                                                  }}
                                                  data-testid={`sp-item-${item.id}`}
                                                >
                                                  {item.isFolder ? (
                                                    <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                                  ) : (
                                                    <FileText className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                                  )}
                                                  <span className="truncate flex-1">{item.name}</span>
                                                  {item.isFolder && <span className="text-[10px] text-muted-foreground">{item.childCount} items</span>}
                                                  {!item.isFolder && spLinking === item.id && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setSpBrowseItemId(null); setEvidenceMode(prev => ({ ...prev, [instance.id]: null })); setSpFolderStack([{ id: null, name: "Root" }]); }} data-testid={`btn-cancel-sp-${instance.id}`}>Cancel</Button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {canEditQc && showAddItem !== group.id && (
                            <button
                              onClick={() => { setShowAddItem(group.id); setNewItemName(""); }}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
                              data-testid={`btn-add-qc-item-${group.id}`}
                            >
                              <Plus className="w-3 h-3" /> Add item
                            </button>
                          )}
                          {showAddItem === group.id && (
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                autoFocus
                                className="flex-1 h-7 text-xs border rounded px-2"
                                placeholder="Item name..."
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && newItemName.trim()) createItemMutation.mutate({ itemName: newItemName.trim(), groupId: group.id }); if (e.key === 'Escape') setShowAddItem(null); }}
                                data-testid={`input-new-qc-item-${group.id}`}
                              />
                              <Button size="sm" className="h-7 text-xs px-2" onClick={() => { if (newItemName.trim()) createItemMutation.mutate({ itemName: newItemName.trim(), groupId: group.id }); }} disabled={!newItemName.trim() || createItemMutation.isPending} data-testid={`btn-save-qc-item-${group.id}`}>
                                {createItemMutation.isPending ? "..." : "Add"}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setShowAddItem(null)}>Cancel</Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {phaseRiskQs.length > 0 && (
                    <div className="space-y-3 pt-3 border-t border-dashed">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        <h4 className="text-sm font-semibold">Risk Assessment</h4>
                        <Badge variant="outline" className="text-[10px] font-medium">{phaseRiskQs.length}</Badge>
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
                                  className="rounded-xl border bg-white p-3"
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
                                            className={`h-7 text-xs min-w-[46px] ${isActive ? opt.color : ""}`}
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
                                      className="ml-6 rounded-xl border border-dashed bg-muted/30 p-3 space-y-2"
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

      <Dialog open={sendForApprovalItem !== null} onOpenChange={(open) => {
        if (!open) { setSendForApprovalItem(null); setSfaApprover(""); setSfaNote(""); setSfaFile(null); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4 text-amber-600" /> Send for Approval
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Approver <span className="text-red-500">*</span></Label>
              <Select value={sfaApprover} onValueChange={setSfaApprover}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-qm-send-approver">
                  <SelectValue placeholder="Select approver..." />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.filter((m: any) => m.id !== user?.id).map((m: any) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Evidence File (optional)</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 ${sfaFile ? "border-amber-400 bg-amber-50/20" : "border-muted"}`}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) setSfaFile(file);
                  };
                  input.click();
                }}
                data-testid="dropzone-qm-approval-file"
              >
                {sfaFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-amber-600" />
                    <span className="truncate max-w-[200px]">{sfaFile.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); setSfaFile(null); }} className="text-muted-foreground hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Click to upload evidence file</div>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Note (optional)</Label>
              <Textarea
                value={sfaNote}
                onChange={(e) => setSfaNote(e.target.value)}
                placeholder="Add context for the approver..."
                className="min-h-[60px] text-sm"
                data-testid="textarea-qm-send-approval-note"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 h-9 text-sm bg-amber-600 hover:bg-amber-700 gap-1.5"
                disabled={!sfaApprover || sfaSending}
                onClick={async () => {
                  if (!sendForApprovalItem) return;
                  setSfaSending(true);
                  try {
                    const formData = new FormData();
                    formData.append("approverUserId", sfaApprover);
                    formData.append("note", sfaNote);
                    if (sfaFile) formData.append("file", sfaFile);
                    const token = localStorage.getItem("auth_token");
                    const headers: Record<string, string> = {};
                    if (token) headers["Authorization"] = `Bearer ${token}`;
                    const res = await fetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${sendForApprovalItem}/send-for-approval`, {
                      method: "POST",
                      headers,
                      body: formData,
                      credentials: "include",
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({ error: "Failed" }));
                      throw new Error(err.error);
                    }
                    toast({ title: "Sent for approval", description: "The item has been submitted for review." });
                    setSendForApprovalItem(null);
                    setSfaApprover(""); setSfaNote(""); setSfaFile(null);
                    queryClient.invalidateQueries({ queryKey: ["quality-checklist", projectName] });
                    queryClient.invalidateQueries({ queryKey: ["quality-evidence", projectName] });
                  } catch (err: any) {
                    toast({ title: "Error", description: err.message || "Failed to send for approval", variant: "destructive" });
                  } finally {
                    setSfaSending(false);
                  }
                }}
                data-testid="btn-confirm-qm-send-approval"
              >
                {sfaSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sfaSending ? "Sending..." : "Send for Approval"}
              </Button>
              <Button variant="outline" className="h-9 text-sm" onClick={() => { setSendForApprovalItem(null); setSfaApprover(""); setSfaNote(""); setSfaFile(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
