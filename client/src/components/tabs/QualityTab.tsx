import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import { evaluateQualityGovernanceItem } from "@shared/quality-governance";

function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; progress: string; lightBg: string; gradient: string }> = {
  "planning_design": { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200", progress: "bg-blue-500", lightBg: "bg-blue-50", gradient: "from-blue-500 to-blue-600" },
  "construction": { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", progress: "bg-orange-500", lightBg: "bg-orange-50", gradient: "from-orange-500 to-orange-600" },
  "commissioning": { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200", progress: "bg-purple-500", lightBg: "bg-purple-50", gradient: "from-purple-500 to-purple-600" },
  "handover": { bg: "bg-green-50", text: "text-green-600", border: "border-green-200", progress: "bg-green-500", lightBg: "bg-green-50", gradient: "from-green-500 to-green-600" },
};

function getPhaseColor(phaseKey: string) {
  return PHASE_COLORS[phaseKey] || PHASE_COLORS["planning_design"];
}

function getRiskSeverityColor(severity: string) {
  switch (severity?.toLowerCase()) {
    case "high": return "text-red-500 bg-red-50 border-red-500/20";
    case "medium": return "text-orange-500 bg-orange-50 border-orange-500/20";
    case "low": return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    default: return "text-muted-foreground bg-muted/50 border-border";
  }
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string; btnClass: string; icon: string }> = {
  not_started: { label: "Not Started", color: "text-muted-foreground", bg: "bg-muted border-border", dot: "bg-slate-400", btnClass: "border-border text-muted-foreground hover:bg-muted", icon: "O" },
  review: { label: "In Review", color: "text-amber-600", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-500", btnClass: "border-amber-300 text-amber-600 hover:bg-amber-100", icon: "R" },
  pass: { label: "Passed", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", btnClass: "border-emerald-300 text-emerald-600 hover:bg-emerald-100", icon: "OK" },
  fail: { label: "Failed", color: "text-red-600", bg: "bg-red-50 border-red-200", dot: "bg-red-500", btnClass: "border-red-300 text-red-600 hover:bg-red-100", icon: "X" },
  na: { label: "N/A", color: "text-slate-500", bg: "bg-muted border-border", dot: "bg-slate-300", btnClass: "border-border text-slate-500 hover:bg-muted", icon: "-" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.not_started;
}

function getRiskLevelClass(level: string) {
  switch ((level || "").toLowerCase()) {
    case "critical":
      return "bg-red-50 text-red-700 border-red-200";
    case "high":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "medium":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

interface QualityTabProps {
  projectName: string;
}

interface QualityWorkspaceData {
  projectId: number | null;
  projectName: string;
  hasChecklist: boolean;
  checklistId: number | null;
  counts: {
    overdue: number;
    resubmissionNeeded: number;
    evidenceRequired: number;
    pendingReview: number;
    openWarnings: number;
    blockedHandover: boolean;
    linkedMicrosoftItems: number;
  };
  risk: {
    level: string;
    score: number;
    summary: string;
  };
  handover: {
    status: string;
    rejectionReason: string | null;
    qualityStatus: string | null;
    qualityRequired: boolean;
    readinessStatus: string | null;
    executionEnabled: boolean;
    executionGateStatus: string | null;
    blockers: string[];
    blocked: boolean;
  };
  focusItems: Array<{
    id: number;
    itemName: string;
    phaseName: string;
    groupName: string;
    qmStatus: string;
    approved: boolean;
    approvalState: string;
    resubmissionNeeded: boolean;
    overdue: boolean;
    daysOverdue: number;
    evidenceRequired: boolean;
    evidenceMissing: boolean;
    evidenceCount: number;
    endDate: string | null;
    assigneeName: string | null;
    approvalComment: string | null;
  }>;
  relevantMicrosoftItems: Array<{
    id: number;
    type: string;
    subjectOrTitle: string | null;
    senderOrOrganizer: string | null;
    receivedOrStartDatetime: string | null;
    webLink: string | null;
    actionRequired: boolean | null;
    linkedTaskId: number | null;
    qualityContext?: {
      itemInstanceId: number;
      itemName: string;
      phaseName?: string | null;
      evidenceCount?: number;
    } | null;
  }>;
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

  const { data: workspaceData } = useQuery<QualityWorkspaceData>({
    queryKey: ["quality-workspace", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/workspace`);
      if (!res.ok) throw new Error("Failed to load quality workspace");
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
    queryClient.invalidateQueries({ queryKey: ["quality-workspace", projectName] });
    queryClient.invalidateQueries({ queryKey: ["quality-summary", projectName] });
    queryClient.invalidateQueries({ queryKey: ["quality-warnings", projectName] });
    queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
    queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
    queryClient.invalidateQueries({ queryKey: ["quality-all-items"] });
    queryClient.invalidateQueries({ queryKey: ["quality-dashboard"] });
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

  const sendForApprovalMutation = useMutation({
    mutationFn: async ({ itemInstanceId, approverUserId }: { itemInstanceId: number; approverUserId: string }) => {
      const formData = new FormData();
      formData.append("approverUserId", approverUserId);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/quality/project/${encodeURIComponent(projectName)}/item/${itemInstanceId}/send-for-approval`, {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Failed to send for approval");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setSendForApprovalItem(null);
      setSfaApprover("");
      toast({ title: "Sent for approval", description: "The item is now in review for the selected approver." });
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

  const openQualityItem = useCallback((itemInstanceId: number) => {
    if (!checklistData?.itemInstances?.length) return;

    const instance = checklistData.itemInstances.find((row: any) => row.id === itemInstanceId);
    if (!instance) return;

    const templateItem = (checklistData.templateItems || []).find((row: any) => row.id === instance.templateItemId);
    const group = templateItem
      ? (checklistData.groups || []).find((row: any) => row.id === templateItem.templateGroupId)
      : null;
    const phaseId = group?.templatePhaseId ?? null;

    if (group?.id) {
      setExpandedGroups((prev) => ({ ...prev, [group.id]: true }));
    }
    if (phaseId) {
      setSelectedPhaseId(phaseId);
    }
    setExpandedItems((prev) => ({ ...prev, [itemInstanceId]: true }));

    window.setTimeout(() => {
      document.querySelector(`[data-testid="quality-item-${itemInstanceId}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
  }, [checklistData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deepLinkedItemId = Number(params.get("qualityItemId") || 0);
    if (!deepLinkedItemId) return;
    openQualityItem(deepLinkedItemId);
  }, [openQualityItem]);

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
    const unassigned = applicable.filter((i: any) => !i.primaryAssignment);
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
      <div className="flex items-center justify-center py-16" data-testid="quality-loading">
        <div className="text-center space-y-3">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto animate-pulse" />
          <p className="text-sm text-muted-foreground">Loading quality checklist...</p>
        </div>
      </div>
    );
  }

  if (!checklistData || error) {
    return (
      <Card data-testid="quality-empty">
        <CardContent className="py-16">
          <div className="text-center space-y-3">
            <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
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
  const governanceCounts = workspaceData?.counts || {
    overdue: 0,
    resubmissionNeeded: 0,
    evidenceRequired: 0,
    pendingReview: 0,
    openWarnings: activeWarnings.length,
    blockedHandover: false,
    linkedMicrosoftItems: 0,
  };
  const governanceFocusItems = workspaceData?.focusItems || [];
  const relevantMicrosoftItems = workspaceData?.relevantMicrosoftItems || [];

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
    if (statusFilter === "unassigned") return !instance.primaryAssignment;
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
    <div className="space-y-5" data-testid="quality-tab">
      {!canEdit && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 flex items-center gap-3" data-testid="quality-readonly-banner">
          <Lock className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-700">View-only mode - editing requires Quality Manager access</span>
        </div>
      )}

      <Card className="border-border/70" data-testid="quality-governance-summary">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Quality governance view</p>
              <p className="text-xs text-muted-foreground mt-1">
                {workspaceData?.risk?.summary || "Quality actions, evidence, and handover signals stay visible here."}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={getRiskLevelClass(workspaceData?.risk?.level || "low")}>
                {(workspaceData?.risk?.level || "low").toUpperCase()} risk
              </Badge>
              {workspaceData?.handover?.blocked && (
                <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                  Handover blocked
                </Badge>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Overdue</p>
              <p className="text-lg font-bold text-red-600 mt-1">{governanceCounts.overdue}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Past due and unresolved</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Resubmission</p>
              <p className="text-lg font-bold text-amber-600 mt-1">{governanceCounts.resubmissionNeeded}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Rejected items awaiting rework</p>
            </div>
            <div className="rounded-lg border border-sky-100 bg-sky-50/50 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Evidence gaps</p>
              <p className="text-lg font-bold text-sky-600 mt-1">{governanceCounts.evidenceRequired}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Required proof still missing</p>
            </div>
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pending review</p>
              <p className="text-lg font-bold text-violet-600 mt-1">{governanceCounts.pendingReview}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Items in approval flow</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Linked Microsoft</p>
              <p className="text-lg font-bold text-emerald-600 mt-1">{governanceCounts.linkedMicrosoftItems}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Quality-linked comms and follow-ups</p>
            </div>
          </div>

          {workspaceData?.handover?.blocked && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3" data-testid="quality-handover-blocked">
              <div className="flex items-center gap-2 text-violet-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold">Execution readiness is currently blocked by quality context</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(workspaceData.handover.blockers || []).map((blocker) => (
                  <Badge key={blocker} variant="outline" className="bg-white/80 text-violet-700 border-violet-200">
                    {blocker}
                  </Badge>
                ))}
              </div>
              {workspaceData.handover.rejectionReason && (
                <p className="text-xs text-violet-700/90 mt-2">{workspaceData.handover.rejectionReason}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {(governanceFocusItems.length > 0 || relevantMicrosoftItems.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {governanceFocusItems.length > 0 && (
            <Card data-testid="quality-focus-queue">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Priority quality queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {governanceFocusItems.map((item) => (
                  <div key={item.id} className="rounded-lg border px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground mt-1">{item.phaseName} • {item.groupName}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => openQualityItem(item.id)}
                        data-testid={`open-focus-item-${item.id}`}
                      >
                        Open item
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.resubmissionNeeded && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Resubmission</Badge>
                      )}
                      {item.overdue && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{item.daysOverdue}d overdue</Badge>
                      )}
                      {item.evidenceMissing && (
                        <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">Evidence required</Badge>
                      )}
                      {item.approvalState === "pending_review" && (
                        <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">Pending review</Badge>
                      )}
                    </div>
                    {item.approvalComment && (
                      <p className="text-xs text-muted-foreground mt-2">{item.approvalComment}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {relevantMicrosoftItems.length > 0 && (
            <Card data-testid="quality-microsoft-context">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Relevant Microsoft-linked quality items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {relevantMicrosoftItems.map((item) => (
                  <div key={item.id} className="rounded-lg border px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.subjectOrTitle || "Microsoft item"}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {(item.type || "item").replaceAll("_", " ")} linked to {item.qualityContext?.itemName || "quality context"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.qualityContext?.itemInstanceId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => openQualityItem(item.qualityContext!.itemInstanceId)}
                            data-testid={`open-ms-quality-item-${item.id}`}
                          >
                            Open item
                          </Button>
                        )}
                        {item.webLink && (
                          <a href={item.webLink} target="_blank" rel="noopener noreferrer" className="inline-flex">
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeWarnings.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-red-100/60 transition-colors" data-testid="quality-warnings">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm font-semibold text-red-700 flex-1">
                {activeWarnings.length} Active Warning{activeWarnings.length !== 1 ? "s" : ""}
              </p>
              <ChevronDown className="w-4 h-4 text-red-600" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border border-t-0 border-red-200 rounded-b-lg px-4 py-3 space-y-2 bg-red-50/30">
              {activeWarnings.map((w: any) => (
                <div key={w.id} className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={`warning-item-${w.id}`}>
                  <Badge className={getRiskSeverityColor(w.severity)} variant="outline">{w.severity}</Badge>
                  <span className="flex-1">{w.message || w.warningType}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="bg-card rounded-lg border" data-testid="phase-tabs">
        <div className="flex items-stretch overflow-x-auto">
          {phases.map((phase: any, idx: number) => {
            const progress = getPhaseProgress(phase.id);
            const colors = getPhaseColor(phase.phaseKey);
            const isActive = selectedPhaseId === phase.id;
            return (
              <button
                key={phase.id}
                onClick={() => setSelectedPhaseId(phase.id)}
                className={`relative flex-1 min-w-[140px] flex flex-col items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
                  isActive
                    ? `${colors.text} border-current bg-card`
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/30"
                } ${idx > 0 ? "border-l border-l-slate-100" : ""}`}
                data-testid={`phase-tab-${phase.id}`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${isActive ? colors.progress : "bg-slate-300"}`} />
                  <span className="whitespace-nowrap">{phase.phaseName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors.progress} transition-all`} style={{ width: `${progress.percent}%` }} />
                  </div>
                  <span className={`text-[10px] font-mono ${isActive ? colors.text : "text-muted-foreground"}`}>
                    {progress.completed}/{progress.applicable}
                  </span>
                </div>
                {progress.failed > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedPhase && selectedPhaseProgress && (
        <div className="space-y-4">
          <Card className={`${getPhaseColor(selectedPhase.phaseKey).border} border overflow-hidden`} data-testid="phase-summary-card">
            <div className={`h-1 bg-gradient-to-r ${getPhaseColor(selectedPhase.phaseKey).gradient}`} />
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${getPhaseColor(selectedPhase.phaseKey).gradient} flex items-center justify-center shadow-sm`}>
                    <span className="text-white font-bold text-lg">{selectedPhaseProgress.percent}%</span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">{selectedPhase.phaseName}</h3>
                    <p className="text-sm text-muted-foreground">{selectedPhaseProgress.applicable} applicable items</p>
                  </div>
                </div>

                <div className="flex items-center gap-5 text-sm ml-auto">
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600" data-testid="phase-passed-count">{selectedPhaseProgress.completed}</p>
                    <p className="text-[11px] text-muted-foreground">Passed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-red-600" data-testid="phase-failed-count">{selectedPhaseProgress.failed}</p>
                    <p className="text-[11px] text-muted-foreground">Failed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-amber-600" data-testid="phase-review-count">{selectedPhaseProgress.inReview}</p>
                    <p className="text-[11px] text-muted-foreground">In Review</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-slate-500">{selectedPhaseProgress.applicable - selectedPhaseProgress.completed - selectedPhaseProgress.failed - selectedPhaseProgress.inReview}</p>
                    <p className="text-[11px] text-muted-foreground">Pending</p>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Progress value={selectedPhaseProgress.percent} className="h-2" />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground mr-1">Filter:</span>
              {[
                { value: "all", label: "All", count: overallStats.total },
                { value: "not_started", label: "Not Started", count: overallStats.total - overallStats.passed - overallStats.failed - overallStats.inReview },
                { value: "review", label: "Review", count: overallStats.inReview },
                { value: "fail", label: "Failed", count: overallStats.failed },
                { value: "pass", label: "Passed", count: overallStats.passed },
                { value: "unassigned", label: "Unassigned", count: overallStats.unassigned },
              ].map(f => (
                <Button
                  key={f.value}
                  variant={statusFilter === f.value ? "default" : "outline"}
                  size="sm"
                  className={`h-7 text-[11px] px-2.5 gap-1 ${statusFilter === f.value ? "" : "text-muted-foreground"}`}
                  onClick={() => setStatusFilter(f.value)}
                  data-testid={`btn-filter-${f.value}`}
                >
                  {f.label}
                  <span className={`text-[10px] ${statusFilter === f.value ? "opacity-80" : "opacity-60"}`}>({f.count})</span>
                </Button>
              ))}
            </div>
          </div>

          {selectedItems.size > 0 && canEdit && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 flex items-center gap-3 flex-wrap" data-testid="bulk-actions-bar">
              <SquareCheck className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">{selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} selected</span>
              <div className="flex items-center gap-1.5 ml-auto">
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => handleBulkStatusChange("pass")} data-testid="bulk-pass">
                  <CheckCircle className="w-3 h-3 mr-1" /> Pass
                </Button>
                <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600" onClick={() => handleBulkStatusChange("review")} data-testid="bulk-review">Review</Button>
                <Button size="sm" className="h-7 text-xs" variant="destructive" onClick={() => handleBulkStatusChange("fail")} data-testid="bulk-fail">Fail</Button>
                <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => handleBulkStatusChange("na")} data-testid="bulk-na">N/A</Button>
                <Button size="sm" className="h-7 text-xs" variant="ghost" onClick={() => setSelectedItems(new Set())} data-testid="bulk-clear">
                  <X className="w-3 h-3 mr-1" /> Clear
                </Button>
              </div>
            </div>
          )}

          {selectedPhaseLinkedTasks.length > 0 && (
            <div className="space-y-2" data-testid="phase-linked-tasks">
              <div className="flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phase Linked Tasks</h4>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedPhaseLinkedTasks.map((link: any) => {
                  const task = projectTasks.find((t: any) => t.id === link.planItemId);
                  return (
                    <Badge key={link.id} variant="outline" className="gap-1 py-1 pl-2 pr-1 text-[11px]" data-testid={`plan-link-${link.id}`}>
                      {task ? `${task.taskNo} - ${task.highLevelProgramme}` : `Task #${link.planItemId}`}
                      {task?.actualPctComplete != null && (
                        <span className="text-muted-foreground ml-0.5">({Math.round(task.actualPctComplete * 100)}%)</span>
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
              {linkingPhaseId === selectedPhaseId ? (
                <div className="flex items-center gap-2 flex-1">
                  <SearchableSelect
                    onValueChange={(val) => { addPlanLinkMutation.mutate({ planItemId: parseInt(val), phaseId: selectedPhaseId! }); }}
                    placeholder="Select a project task to link..."
                    triggerClassName="h-8 text-xs flex-1"
                    data-testid={`select-link-task-${selectedPhaseId}`}
                    options={meaningfulTasks
                      .filter((t: any) => !selectedPhaseLinkedTasks.some((l: any) => l.planItemId === t.id))
                      .map((task: any) => ({ value: String(task.id), label: `${task.taskNo} - ${task.highLevelProgramme}` }))}
                  />
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setLinkingPhaseId(null)} data-testid="cancel-link-phase-task">Cancel</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setLinkingPhaseId(selectedPhaseId)} data-testid="link-task-phase">
                  <Plus className="w-3 h-3" /> Link Project Task
                </Button>
              )}
            </div>
          )}

          <div className="space-y-3">
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

              const groupInstances = groupItems.map((ti: any) => getItemInstance(ti.id)).filter(Boolean);
              const groupPassed = groupInstances.filter((i: any) => getItemQmStatus(i) === "pass").length;
              const groupTotal = groupInstances.filter((i: any) => i.isApplicable !== false).length;
              const groupPercent = groupTotal > 0 ? Math.round((groupPassed / groupTotal) * 100) : 0;

              return (
                <Card key={group.id} className="overflow-hidden">
                  <Collapsible open={isGroupExpanded} onOpenChange={() => toggleGroup(group.id)}>
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 px-4 py-3 transition-colors" data-testid={`group-header-${group.id}`}>
                        {isGroupExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <h4 className="text-sm font-semibold flex-1">{group.groupName}</h4>
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${groupPercent}%` }} />
                          </div>
                          <Badge variant="outline" className="text-[10px] font-medium tabular-nums">
                            {visibleItems.length}/{groupItems.length}
                          </Badge>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t">
                        <div className="divide-y">
                          {displayItems.map((templateItem: any) => {
                            const instance = getItemInstance(templateItem.id);
                            if (!instance) return null;
                            if (statusFilter !== "all" && !shouldShowItem(instance)) return null;

                            const itemEvidence = getItemEvidence(instance.id);
                            const itemLinks = getItemLinks(instance.id);
                            const hasRedWarning = itemLinks.some((l: any) => isTaskCompleted(l.planItemId)) && !instance.approved;
                            const currentStatus = getItemQmStatus(instance);
                            const statusCfg = getStatusConfig(currentStatus);
                            const governance = evaluateQualityGovernanceItem({
                              qmStatus: instance.qmStatus,
                              approved: instance.approved,
                              isApplicable: instance.isApplicable,
                              endDate: instance.endDate,
                              scheduledDate: instance.scheduledDate,
                              approvalComment: instance.approvalComment,
                              isEvidenceRequired: templateItem.isEvidenceRequired,
                              evidenceCount: itemEvidence.length,
                            });
                            const assigneeName = instance.primaryAssignment?.displayLabel
                              || (instance.assigneeUserId ? teamMemberMap.get(instance.assigneeUserId) : null);
                            const isExpanded = expandedItems[instance.id] ?? false;
                            const isSelected = selectedItems.has(instance.id);

                            return (
                              <div
                                key={instance.id}
                                className={`transition-all ${
                                  isExpanded ? "bg-muted/70" :
                                  hasRedWarning ? "bg-red-50/40" :
                                  isSelected ? "bg-blue-50/40" :
                                  "hover:bg-muted/50"
                                }`}
                                data-testid={`quality-item-${instance.id}`}
                              >
                                <div className="px-4 py-3">
                                  <div className="flex items-start gap-3">
                                    {canEdit && (
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => toggleItemSelection(instance.id)}
                                        className="mt-0.5"
                                        data-testid={`checkbox-item-${instance.id}`}
                                      />
                                    )}
                                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${statusCfg.dot}`} />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className={`text-sm font-medium ${hasRedWarning ? "text-red-600" : ""}`}>{templateItem.itemName}</p>
                                        {hasRedWarning && (
                                          <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 shrink-0" data-testid={`warning-unchecked-${instance.id}`}>
                                            <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> Task done - not checked
                                          </Badge>
                                        )}
                                        {itemEvidence.length > 0 && (
                                          <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 h-4" data-testid={`evidence-count-${instance.id}`}>
                                            <Paperclip className="w-2.5 h-2.5" /> {itemEvidence.length}
                                          </Badge>
                                        )}
                                        {instance.approved && (
                                          <Badge className="text-[9px] gap-0.5 px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 border-emerald-200" variant="outline">
                                            <CheckCircle2 className="w-2.5 h-2.5" /> Approved
                                          </Badge>
                                        )}
                                        {governance.resubmissionNeeded && (
                                          <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-200">
                                            <AlertCircle className="w-2.5 h-2.5" /> Resubmission
                                          </Badge>
                                        )}
                                        {governance.overdue && (
                                          <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 h-4 bg-red-50 text-red-700 border-red-200">
                                            <Clock className="w-2.5 h-2.5" /> {governance.daysOverdue}d overdue
                                          </Badge>
                                        )}
                                        {governance.evidenceMissing && (
                                          <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0 h-4 bg-sky-50 text-sky-700 border-sky-200">
                                            <Paperclip className="w-2.5 h-2.5" /> Evidence required
                                          </Badge>
                                        )}
                                      </div>
                                      {templateItem.description && !isExpanded && (
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{templateItem.description}</p>
                                      )}
                                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                                        {assigneeName && (
                                          <span className="flex items-center gap-1">
                                            <User className="w-3 h-3" /> {assigneeName}
                                          </span>
                                        )}
                                        {(instance.startDate || instance.endDate) && (
                                          <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {instance.startDate && new Date(instance.startDate).toLocaleDateString()}
                                            {instance.startDate && instance.endDate && " -> "}
                                            {instance.endDate && new Date(instance.endDate).toLocaleDateString()}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {canEdit ? (
                                        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                                          {(["pass", "fail", "review", "na"] as const).map(s => {
                                            const sc = getStatusConfig(s);
                                            const isCurrentStatus = currentStatus === s;
                                            return (
                                              <button
                                                key={s}
                                                className={`h-7 px-2.5 text-[10px] font-medium rounded transition-all ${
                                                  isCurrentStatus ? `${sc.bg} ${sc.color} shadow-sm border` : `text-muted-foreground hover:text-foreground hover:bg-card`
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
                                        </div>
                                      ) : (
                                        <Badge className={`${statusCfg.bg} ${statusCfg.color} text-[10px]`} data-testid={`status-badge-${instance.id}`}>{statusCfg.label}</Badge>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 ml-1"
                                        onClick={() => setExpandedItems(prev => ({ ...prev, [instance.id]: !prev[instance.id] }))}
                                        data-testid={`button-expand-item-${instance.id}`}
                                      >
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                      </Button>
                                    </div>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="border-t bg-card px-4 py-4 ml-6 mr-4 mb-3 rounded-lg border shadow-sm space-y-5">
                                    {templateItem.description && (
                                      <div>
                                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Description</Label>
                                        <p className="text-sm mt-1 text-foreground/80">{templateItem.description}</p>
                                      </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                      <div>
                                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Assignee</Label>
                                        <div className="mt-1">
                                          <UserAssignmentPicker
                                            taskId={instance.id}
                                            taskSource="quality_task"
                                            assignments={instance.assignments || null}
                                            resolvedUsers={instance.assigneeUserId && assigneeName ? [{
                                              id: instance.assigneeUserId,
                                              name: assigneeName,
                                              username: assigneeName,
                                              role: "",
                                            }] : null}
                                            mode="single"
                                            invalidateKeys={["quality-checklist", "quality-workspace", "quality-warnings", "quality-checklists", "quality-all-items", "quality-dashboard"]}
                                            showUnassignedLabel={true}
                                            disabled={!canEdit}
                                            disabledReason="Only Quality authority can change this assignment"
                                          />
                                        </div>
                                      </div>
                                      <div>
                                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Start Date</Label>
                                        <Input
                                          type="date"
                                          className="h-9 text-xs mt-1"
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
                                          className="h-9 text-xs mt-1"
                                          disabled={!canEdit}
                                          value={instance.endDate ? instance.endDate.split("T")[0] : ""}
                                          onChange={(e) => updateItemMutation.mutate({ itemInstanceId: instance.id, updates: { endDate: e.target.value } })}
                                          data-testid={`input-end-date-${instance.id}`}
                                        />
                                      </div>
                                    </div>

                                    {instance.approved && (
                                      <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3" data-testid={`approval-info-${instance.id}`}>
                                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                                        <span className="font-medium">Approved{instance.approvedAt ? ` on ${new Date(instance.approvedAt).toLocaleDateString()}` : ""}</span>
                                        {instance.approvalComment && <span className="text-emerald-600/80 ml-1">- {instance.approvalComment}</span>}
                                      </div>
                                    )}

                                    {governance.resubmissionNeeded && instance.approvalComment && (
                                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid={`resubmission-info-${instance.id}`}>
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        <span className="font-medium">Resubmission required</span>
                                        <span className="text-amber-700/90">{instance.approvalComment}</span>
                                      </div>
                                    )}

                                    {canEdit && !instance.approved && (
                                      <div>
                                        {sendForApprovalItem === instance.id ? (
                                          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                            <Send className="w-4 h-4 text-amber-600 shrink-0" />
                                            <SearchableSelect
                                              value={sfaApprover}
                                              onValueChange={setSfaApprover}
                                              placeholder="Select approver..."
                                              triggerClassName="h-8 text-xs flex-1"
                                              data-testid={`select-approver-${instance.id}`}
                                              options={teamMembers.map((m: any) => ({ value: String(m.id), label: m.name }))}
                                            />
                                            <Button
                                              size="sm"
                                              className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                                              disabled={!sfaApprover || sendForApprovalMutation.isPending}
                                              onClick={() => {
                                                sendForApprovalMutation.mutate({
                                                  itemInstanceId: instance.id,
                                                  approverUserId: sfaApprover,
                                                });
                                              }}
                                              data-testid={`btn-confirm-approval-${instance.id}`}
                                            >
                                              {sendForApprovalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
                                            </Button>
                                            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSendForApprovalItem(null); setSfaApprover(""); }} data-testid={`btn-cancel-approval-${instance.id}`}>Cancel</Button>
                                          </div>
                                        ) : (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
                                            onClick={() => setSendForApprovalItem(instance.id)}
                                            data-testid={`btn-send-for-approval-${instance.id}`}
                                          >
                                            <Send className="w-3.5 h-3.5" /> Send for Approval
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
                                        <div className="space-y-1.5 mb-3">
                                          {itemEvidence.map((ev: any) => (
                                            <div key={ev.id} className="flex items-center gap-2 text-xs bg-muted rounded-lg border p-2.5" data-testid={`evidence-${ev.id}`}>
                                              <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                              <span className="flex-1 truncate">{ev.evidenceNote || ev.evidenceUrl}</span>
                                              {ev.evidenceUrl && (
                                                <a href={ev.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 p-0.5" data-testid={`view-evidence-${ev.id}`}>
                                                  <ExternalLink className="w-3.5 h-3.5" />
                                                </a>
                                              )}
                                              {canEdit && (
                                                <button
                                                  className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-red-50"
                                                  onClick={() => deleteEvidenceMutation.mutate(ev.id)}
                                                  data-testid={`delete-evidence-${ev.id}`}
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {canEdit && (
                                        <div
                                          className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${
                                            dragOverItem === instance.id ? "border-blue-400 bg-blue-50" : "border-border hover:border-blue-300 hover:bg-blue-50/30"
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
                                            <div className="flex flex-col items-center gap-1.5">
                                              <Upload className="w-6 h-6 text-muted-foreground/60" />
                                              <span className="text-xs text-muted-foreground">Drop file here or click to upload</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {itemLinks.length > 0 && (
                                      <div>
                                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Linked Plan Tasks</Label>
                                        <div className="flex flex-wrap gap-1.5 mt-1.5">
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
                                                      {task ? `${task.taskNo} - ${task.highLevelProgramme}` : `#${link.planItemId}`}
                                                {task?.actualPctComplete != null && (
                                                  <span className="ml-0.5">({Math.round(task.actualPctComplete * 100)}%)</span>
                                                )}
                                                {canEdit && (
                                                  <button
                                                    className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                                    onClick={() => removePlanLinkMutation.mutate(link.id)}
                                                    data-testid={`unlink-item-task-${link.id}`}
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
                                            <SearchableSelect
                                              onValueChange={(val) => { addPlanLinkMutation.mutate({ planItemId: parseInt(val), itemInstanceId: instance.id, phaseId: selectedPhaseId! }); }}
                                              placeholder="Link a project task..."
                                              triggerClassName="h-8 text-xs flex-1"
                                              data-testid={`select-link-item-task-${instance.id}`}
                                              options={meaningfulTasks
                                                .filter((t: any) => !itemLinks.some((l: any) => l.planItemId === t.id))
                                      .map((task: any) => ({ value: String(task.id), label: `${task.taskNo} - ${task.highLevelProgramme}` }))}
                                            />
                                            <Button variant="ghost" size="sm" className="h-8" onClick={() => setLinkingItemId(null)} data-testid={`cancel-link-item-task-${instance.id}`}>Cancel</Button>
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

                                    <div className="flex items-center gap-2 pt-3 border-t">
                                      {canDeleteQc && (
                                        <>
                                          {deleteConfirmId === instance.id ? (
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-red-600 font-medium">Delete this item permanently?</span>
                                              <Button size="sm" variant="destructive" className="h-7 text-[11px] px-3" onClick={() => deleteItemMutation.mutate(instance.id)} data-testid={`confirm-delete-${instance.id}`}>Yes, Delete</Button>
                                              <Button size="sm" variant="ghost" className="h-7 text-[11px] px-3" onClick={() => setDeleteConfirmId(null)} data-testid={`cancel-delete-${instance.id}`}>Cancel</Button>
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
                        </div>

                        {canEdit && (
                          <div className="px-4 py-2 border-t bg-muted/50">
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
                                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setShowAddItem(null); setNewItemName(""); }} data-testid={`cancel-add-item-${group.id}`}>Cancel</Button>
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
                </Card>
              );
            })}
          </div>

          {selectedPhaseRiskQs.length > 0 && (
            <Card className="overflow-hidden">
              <Collapsible open={showRiskQuestions} onOpenChange={setShowRiskQuestions}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 px-4 py-3 transition-colors" data-testid="risk-questions-toggle">
                    {showRiskQuestions ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-semibold flex-1">Risk Questions</span>
                    <Badge variant="outline" className="text-[10px]">{selectedPhaseRiskQs.length}</Badge>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t divide-y">
                    {selectedPhaseRiskQs.map((rq: any) => {
                      const answer = getRiskAnswer(rq.id);
                      return (
                        <div key={rq.id} className="px-4 py-3 space-y-2" data-testid={`risk-question-${rq.id}`}>
                          <div className="flex items-start gap-2">
                            <Badge className={getRiskSeverityColor(rq.severity)} variant="outline">{rq.severity}</Badge>
                            <p className="text-sm font-medium">{rq.questionText}</p>
                          </div>
                          {canEdit && answer && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ml-6">
                              <SearchableSelect
                                value={answer.answerValue || "unanswered"}
                                onValueChange={(val) => updateRiskMutation.mutate({ riskAnswerId: answer.id, updates: { answerValue: val === "unanswered" ? null : val } })}
                                placeholder="Select answer..."
                                triggerClassName="h-8 text-xs"
                                data-testid={`select-risk-answer-${rq.id}`}
                                options={[
                                  { value: "unanswered", label: "Unanswered" },
                                  { value: "yes", label: "Yes" },
                                  { value: "no", label: "No" },
                                  { value: "partial", label: "Partial" },
                                  { value: "na", label: "N/A" },
                                ]}
                              />
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
                            <div className="text-xs space-y-1 ml-6">
                              <p><span className="font-medium">Answer:</span> {answer.answerValue || "Unanswered"}</p>
                              {answer.notes && <p><span className="font-medium">Notes:</span> {answer.notes}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}
        </div>
      )}

      {!selectedPhase && phases.length > 0 && (
        <div className="text-center py-12 text-muted-foreground" data-testid="phase-select-prompt">
          <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Select a phase above to view quality items</p>
        </div>
      )}
    </div>
  );
}
