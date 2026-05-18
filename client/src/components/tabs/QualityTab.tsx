import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateProjectV2Queries } from "@/hooks/use-project-v2";
import { useLocation } from "wouter";
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
  Ban, FileWarning, ClipboardCheck, PackagePlus,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import { evaluateQualityGovernanceItem } from "@shared/quality-governance";
import { QualityGovernanceSummary } from "./quality/QualityGovernanceSummary";
import { QualityWarningsPanel } from "./quality/QualityWarningsPanel";

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

function parseRiskYesNo(value: string | null | undefined): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function formatRiskYesNo(value: boolean | null | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unanswered";
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

interface QualityTabProps {
  projectName: string;
  projectInfoId?: number | null;
  initialStatusFilter?: string;
  chip?: string;
  onNavigateSubTab?: (sub: string) => void;
}

const CHIP_DRILLDOWN_CONFIG: Record<string, {
  label: string;
  description: string;
  icon: any;
  color: string;
  filter: string;
  showHandoverPackAction?: boolean;
}> = {
  "handover-blocked": {
    label: "Handover Blocked",
    description: "QC items contributing to the blocked handover",
    icon: Ban,
    color: "border-red-300 bg-red-50 text-red-800",
    filter: "handover_blocking",
    showHandoverPackAction: true,
  },
  "quality-critical": {
    label: "Quality CRITICAL",
    description: "QC items contributing to critical quality risk",
    icon: AlertTriangle,
    color: "border-red-300 bg-red-50 text-red-800",
    filter: "critical_contributors",
  },
  "quality-evidence-gaps": {
    label: "Evidence Gaps",
    description: "Applicable QC items missing required evidence",
    icon: FileWarning,
    color: "border-red-300 bg-red-50 text-red-800",
    filter: "evidence_gap",
  },
  "quality-pending-approvals": {
    label: "Pending quality approvals",
    description: "QC items currently awaiting reviewer sign-off",
    icon: ClipboardCheck,
    color: "border-amber-300 bg-amber-50 text-amber-800",
    filter: "review",
  },
  "pending-quality-approvals": {
    label: "Pending quality approvals",
    description: "QC items currently awaiting reviewer sign-off",
    icon: ClipboardCheck,
    color: "border-amber-300 bg-amber-50 text-amber-800",
    filter: "review",
  },
  "create-from-quality": {
    label: "Create from Quality items",
    description: "Select applicable QC items not yet sent for review and submit them in bulk",
    icon: Send,
    color: "border-blue-300 bg-blue-50 text-blue-800",
    filter: "actionable_for_approval",
  },
};

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
    unansweredRisk: number;
    triggeredRisk: number;
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

export function QualityTab({ projectName, projectInfoId, initialStatusFilter, chip, onNavigateSubTab }: QualityTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [warningsHighOnly, setWarningsHighOnly] = useState(false);
  const [showRiskQuestions, setShowRiskQuestions] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [linkingPhaseId, setLinkingPhaseId] = useState<number | null>(null);
  const [sendForApprovalItem, setSendForApprovalItem] = useState<number | null>(null);
  const [sfaApprover, setSfaApprover] = useState("");
  const [bulkApproverDialogOpen, setBulkApproverDialogOpen] = useState(false);
  const [bulkApprover, setBulkApprover] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [createPackDialogOpen, setCreatePackDialogOpen] = useState(false);
  const [packType, setPackType] = useState<string>("practical_completion");
  const [creatingPack, setCreatingPack] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showAddItem, setShowAddItem] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState<number | null>(null);
  const [evidenceUploadState, setEvidenceUploadState] = useState<Record<number, { state: "uploading" | "uploaded" | "failed" | "too_large"; message: string }>>({});
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const isQmOrAdmin = ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '') || (user?.role || '').toUpperCase() === 'QUALITY_MANAGER';
  const canEdit = isQmOrAdmin;
  const { allowed: canDeleteQc } = usePermission('pd_quality', 'delete');

  useEffect(() => {
    if (!initialStatusFilter) return;
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    setActiveChip(chip || null);
  }, [chip]);

  const chipConfig = activeChip ? CHIP_DRILLDOWN_CONFIG[activeChip] : null;

  // When a chip is active, the chip's predicate is the source of truth for
  // what the user expects to see. Force `statusFilter` to match the chip's
  // filter on every render so the URL `qualityFilter` and any manual filter
  // change cannot drift from the chip's set.
  useEffect(() => {
    if (chipConfig && chipConfig.filter && statusFilter !== chipConfig.filter) {
      setStatusFilter(chipConfig.filter);
    }
  }, [activeChip, chipConfig, statusFilter]);

  const clearChipFilter = useCallback(() => {
    setActiveChip(null);
    setStatusFilter("all");
    setSelectedItems(new Set());
    const url = new URL(window.location.href);
    url.searchParams.delete("chip");
    url.searchParams.delete("qualityFilter");
    setLocation(url.pathname + (url.search ? url.search : ""));
  }, [setLocation]);

  const { data: checklistData, isLoading, error } = useQuery({
    queryKey: ["quality-checklist", projectName],
    queryFn: async () => {
      const res = await qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/checklist`);
      if (!res.ok) throw new Error("Failed to load checklist");
      return res.json();
    },
    enabled: !!projectName,
    refetchOnMount: "always",
    staleTime: 10_000,
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
    staleTime: 10_000,
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
    staleTime: 10_000,
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
    staleTime: 10_000,
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
    staleTime: 10_000,
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
    queryClient.invalidateQueries({ queryKey: ["alert-quality-summary", projectName] });
    queryClient.invalidateQueries({ queryKey: ["project-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/handover/packs"] });
    queryClient.invalidateQueries({ queryKey: ["handover-packs"] });
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
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
      setSendForApprovalItem(null);
      setSfaApprover("");
      toast({ title: "Submitted for review", description: "The item is now in review. The reviewer will pass or fail it." });
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
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
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
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
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
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
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
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
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

  const MAX_EVIDENCE_FILE_SIZE = 50 * 1024 * 1024; // 50MB - matches server limit

  const handleEvidenceFileUpload = async (instanceId: number, file: File) => {
    if (file.size > MAX_EVIDENCE_FILE_SIZE) {
      setEvidenceUploadState((prev) => ({
        ...prev,
        [instanceId]: { state: "too_large", message: `File too large (${Math.round(file.size / (1024 * 1024))}MB). Max 50MB.` },
      }));
      toast({ title: "File too large", description: `Maximum file size is 50MB. Selected file is ${Math.round(file.size / (1024 * 1024))}MB.`, variant: "destructive" });
      return;
    }
    setEvidenceUploadState((prev) => ({ ...prev, [instanceId]: { state: "uploading", message: `Uploading ${file.name}...` } }));
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
      invalidateAll();
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
      setEvidenceUploadState((prev) => ({ ...prev, [instanceId]: { state: "uploaded", message: `${file.name} uploaded` } }));
      toast({ title: "Evidence uploaded" });
    } catch (err: any) {
      setEvidenceUploadState((prev) => ({
        ...prev,
        [instanceId]: { state: "failed", message: err?.message || "Upload failed. Try again." },
      }));
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
    const na = allInstances.filter((i: any) => i.isApplicable === false);
    const unassigned = applicable.filter((i: any) => !i.primaryAssignment);
    const overdue = applicable.filter((i: any) => {
      const status = getItemQmStatus(i);
      if (status === "pass" || status === "na") return false;
      const dueDate = i.endDate || i.scheduledDate;
      if (!dueDate) return false;
      const due = new Date(String(dueDate).split("T")[0] + "T00:00:00").getTime();
      return due < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    });
    const evidenceGap = applicable.filter((i: any) => {
      const ti = (checklistData?.templateItems || []).find((t: any) => t.id === i.templateItemId);
      return ti?.isEvidenceRequired && (checklistData?.evidence || []).filter((e: any) => e.itemInstanceId === i.id).length === 0;
    });
    return {
      total: applicable.length,
      passed: passed.length,
      failed: failed.length,
      inReview: inReview.length,
      na: na.length,
      unassigned: unassigned.length,
      overdue: overdue.length,
      evidenceGap: evidenceGap.length,
      notStarted: applicable.length - passed.length - failed.length - inReview.length,
      percent: applicable.length > 0 ? Math.round((passed.length / applicable.length) * 100) : 0,
    };
  }, [checklistData?.itemInstances, checklistData?.templateItems, checklistData?.evidence]);

  // ── Helpers and drill-down memos — hoisted ABOVE the early returns below so
  // that hook count is identical between the loading render and the loaded
  // render. Violating this triggers React error #310 ("Rendered more hooks
  // than during the previous render"). Each block guards its own data access
  // with optional chaining so it is safe to run while checklistData is still
  // undefined during the initial fetch.
  const buildGovernanceItemLike = (instance: any) => {
    const ti = (checklistData?.templateItems || []).find((t: any) => t.id === instance.templateItemId);
    const evidenceCount = (checklistData?.evidence || []).filter((e: any) => e.itemInstanceId === instance.id).length;
    return {
      isApplicable: instance.isApplicable,
      isEvidenceRequired: ti?.isEvidenceRequired ?? false,
      evidenceCount,
      approved: instance.approved,
      qmStatus: instance.qmStatus,
      approvalState: instance.approvalState,
      approvalStatus: instance.approvalStatus,
      endDate: instance.endDate,
      scheduledDate: instance.scheduledDate,
    };
  };

  const isHandoverBlockingItem = (instance: any) => {
    if (instance.isApplicable === false) return false;
    const ev = evaluateQualityGovernanceItem(buildGovernanceItemLike(instance));
    return ev.evidenceMissing || ev.resubmissionNeeded || ev.overdue || ev.approvalState === "pending_review";
  };

  // Items contributing to CRITICAL risk score are the higher-weighted ones in
  // computeQualityRiskSummary (overdue x2, resubmission x3, evidence gap x2).
  // Pending review alone is weighted 1 and does not push the level to critical.
  const isCriticalContributorItem = (instance: any) => {
    if (instance.isApplicable === false) return false;
    const ev = evaluateQualityGovernanceItem(buildGovernanceItemLike(instance));
    return ev.evidenceMissing || ev.resubmissionNeeded || ev.overdue;
  };

  // Items the user can actionably submit for approval right now: applicable,
  // not already approved, and not already pending review. This matches the
  // server-side `actionableForApprovalCount`.
  const isActionableForApprovalItem = (instance: any) => {
    if (instance.isApplicable === false) return false;
    if (instance.approved) return false;
    const ev = evaluateQualityGovernanceItem(buildGovernanceItemLike(instance));
    if (ev.approvalState === "pending_review" || ev.approvalState === "approved") return false;
    return true;
  };

  // Drill-down items across ALL phases (matches badge counts). When the user
  // has not opened a chip drill-down (chipConfig === null) or data is still
  // loading (checklistData === undefined) this short-circuits to an empty
  // array — keeping the hook call itself unconditional.
  const drillDownInstances = useMemo(() => {
    if (!chipConfig || !checklistData) return [];
    const filterValue = chipConfig.filter;
    const allInst = checklistData.itemInstances || [];
    const tplItems = checklistData.templateItems || [];
    const evid = checklistData.evidence || [];
    return allInst.filter((instance: any) => {
      if (filterValue === "evidence_gap") {
        if (instance.isApplicable === false) return false;
        const ti = tplItems.find((t: any) => t.id === instance.templateItemId);
        return ti?.isEvidenceRequired && evid.filter((e: any) => e.itemInstanceId === instance.id).length === 0;
      }
      if (filterValue === "handover_blocking") {
        return isHandoverBlockingItem(instance);
      }
      if (filterValue === "critical_contributors") {
        return isCriticalContributorItem(instance);
      }
      if (filterValue === "actionable_for_approval") {
        return isActionableForApprovalItem(instance);
      }
      if (filterValue === "review") {
        return getItemQmStatus(instance) === "review";
      }
      return false;
    });
  }, [chipConfig, checklistData]);

  const drillDownInPhase = useMemo(() => {
    if (!chipConfig || !selectedPhaseId || !checklistData) return drillDownInstances;
    const tplItems = checklistData.templateItems || [];
    const grpItems = checklistData.groups || [];
    const phaseTemplateIds = tplItems
      .filter((ti: any) => grpItems.find((g: any) => g.id === ti.templateGroupId)?.templatePhaseId === selectedPhaseId)
      .map((ti: any) => ti.id);
    return drillDownInstances.filter((i: any) => phaseTemplateIds.includes(i.templateItemId));
  }, [chipConfig, drillDownInstances, selectedPhaseId, checklistData]);

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
  const highSeverityWarnings = activeWarnings.filter((w: any) => String(w.severity || "").toLowerCase() === "high");
  const governanceCounts = workspaceData?.counts || {
    overdue: 0,
    resubmissionNeeded: 0,
    evidenceRequired: 0,
    pendingReview: 0,
    unansweredRisk: 0,
    triggeredRisk: 0,
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
    if (statusFilter === "overdue") {
      const status = getItemQmStatus(instance);
      if (status === "pass" || status === "na") return false;
      const dueDate = instance.endDate || instance.scheduledDate;
      if (!dueDate) return false;
      const due = new Date(String(dueDate).split("T")[0] + "T00:00:00").getTime();
      return due < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    }
    if (statusFilter === "evidence_gap") {
      if (instance.isApplicable === false) return false;
      const ti = (checklistData?.templateItems || []).find((t: any) => t.id === instance.templateItemId);
      return ti?.isEvidenceRequired && (checklistData?.evidence || []).filter((e: any) => e.itemInstanceId === instance.id).length === 0;
    }
    if (statusFilter === "handover_blocking") {
      return isHandoverBlockingItem(instance);
    }
    if (statusFilter === "critical_contributors") {
      return isCriticalContributorItem(instance);
    }
    if (statusFilter === "actionable_for_approval") {
      return isActionableForApprovalItem(instance);
    }
    return getItemQmStatus(instance) === statusFilter;
  };

  const selectedPhase = phases.find((p: any) => p.id === selectedPhaseId);
  const selectedPhaseProgress = selectedPhaseId ? getPhaseProgress(selectedPhaseId) : null;
  const selectedPhaseGroups = groups.filter((g: any) => g.templatePhaseId === selectedPhaseId);
  const selectedPhaseRiskQs = selectedPhaseId ? getPhaseRiskQuestions(selectedPhaseId) : [];
  const selectedPhaseLinkedTasks = selectedPhaseId ? getPhaseLinks(selectedPhaseId) : [];

  const handleBulkStatusChange = async (newStatus: string) => {
    const ids = Array.from(selectedItems);
    setSelectedItems(new Set());
    let failCount = 0;
    for (const id of ids) {
      try {
        await updateItemMutation.mutateAsync({ itemInstanceId: id, updates: { qmStatus: newStatus } });
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      toast({ title: "Partial failure", description: `${failCount} of ${ids.length} item(s) failed to update.`, variant: "destructive" });
    } else if (ids.length > 0) {
      toast({ title: "Bulk update complete", description: `${ids.length} item(s) set to ${newStatus}.` });
    }
  };

  // Drill-down memos and the helpers they depend on are now declared above the
  // early returns (React's Rules of Hooks). `allInstances` is still kept here
  // because other code paths below (e.g. bulk actions) reference it post-load.
  const allInstances: any[] = checklistData?.itemInstances || [];
  const blockedApprovalSelections = Array.from(selectedItems)
    .map((id) => allInstances.find((instance: any) => instance.id === id))
    .filter((instance: any) => instance)
    .map((instance: any) => {
      const ti = templateItems.find((t: any) => t.id === instance.templateItemId);
      const evidenceCount = (checklistData?.evidence || []).filter((e: any) => e.itemInstanceId === instance.id).length;
      if (ti?.isEvidenceRequired && evidenceCount === 0) return { id: instance.id, reason: "Required evidence missing" };
      if (instance.approvalState === "pending_review") return { id: instance.id, reason: "Already pending review" };
      if (instance.approvalState === "approved") return { id: instance.id, reason: "Already approved" };
      if (instance.qmStatus === "not_started") return { id: instance.id, reason: "Set item status before submit" };
      return null;
    })
    .filter(Boolean) as Array<{ id: number; reason: string }>;

  const selectAllVisibleDrillDown = () => {
    setSelectedItems(new Set(drillDownInPhase.map((i: any) => i.id)));
  };

  const sendForApprovalRaw = async (itemInstanceId: number, approverUserId: string) => {
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
      throw new Error(err.error || err.message || "Failed");
    }
    return res.json();
  };

  const handleBulkSendForApproval = async () => {
    if (!bulkApprover || selectedItems.size === 0) return;
    const ids = Array.from(selectedItems);
    setBulkSubmitting(true);
    let failCount = 0;
    let successCount = 0;
    for (const id of ids) {
      try {
        // Bypass mutation hook to avoid per-item toasts/invalidations
        await sendForApprovalRaw(id, bulkApprover);
        successCount++;
      } catch {
        failCount++;
      }
    }
    setBulkSubmitting(false);
    setBulkApproverDialogOpen(false);
    setBulkApprover("");
    setSelectedItems(new Set());
    invalidateAll();
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
    if (failCount > 0) {
      toast({
        title: failCount === ids.length ? "Send for approval failed" : "Partial submission",
        description: `${successCount} submitted, ${failCount} failed. Items with missing evidence cannot be submitted.`,
        variant: failCount === ids.length ? "destructive" : "default",
      });
    } else {
      toast({
        title: "Sent for approval",
        description: `${successCount} item${successCount !== 1 ? "s" : ""} submitted for review. Open the Approvals tab to review them.`,
      });
      if (onNavigateSubTab) setTimeout(() => onNavigateSubTab("approvals"), 800);
    }
  };

  const handleCreateHandoverPack = async () => {
    if (!projectInfoId || selectedItems.size === 0) return;
    const ids = Array.from(selectedItems);
    setCreatingPack(true);
    try {
      const packRes = await qFetch("/api/handover/packs", {
        method: "POST",
        body: JSON.stringify({
          projectId: projectInfoId,
          packType: packType,
          status: "draft",
          checklistStatus: "in_progress",
          notes: `Seeded from Quality drill-down (${chipConfig?.label || "Quality items"}) on ${new Date().toLocaleDateString()}`,
        }),
      });
      if (!packRes.ok) {
        const err = await packRes.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Failed to create handover pack");
      }
      const pack = await packRes.json();
      let itemFailures = 0;
      for (const id of ids) {
        const instance = allInstances.find((i: any) => i.id === id);
        const ti = templateItems.find((t: any) => t.id === instance?.templateItemId);
        const itemName = ti?.itemName || `QC item #${id}`;
        try {
          const res = await qFetch(`/api/handover/packs/${pack.id}/items`, {
            method: "POST",
            body: JSON.stringify({
              itemName: itemName,
              category: "inspection",
              required: true,
              status: "pending",
              notes: `Linked QC item instance #${id}`,
            }),
          });
          if (!res.ok) itemFailures++;
        } catch {
          itemFailures++;
        }
      }
      setCreatingPack(false);
      setCreatePackDialogOpen(false);
      setSelectedItems(new Set());
      invalidateAll();
      invalidateProjectV2Queries(queryClient, projectInfoId ?? null);
      toast({
        title: "Handover pack created",
        description: `Pack created with ${ids.length - itemFailures} of ${ids.length} item${ids.length !== 1 ? "s" : ""}.${itemFailures > 0 ? ` (${itemFailures} failed)` : ""}`,
      });
      // Navigate to handover tab
      const url = new URL(window.location.href);
      url.searchParams.set("dept", "pm");
      url.searchParams.set("sub", "handover");
      url.searchParams.delete("chip");
      url.searchParams.delete("qualityFilter");
      setTimeout(() => setLocation(url.pathname + url.search), 600);
    } catch (err: any) {
      setCreatingPack(false);
      toast({ title: "Error", description: err.message || "Failed to create handover pack", variant: "destructive" });
    }
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

      {chipConfig && (() => {
        const ChipIcon = chipConfig.icon;
        return (
        <div
          className={`rounded-lg border px-4 py-3 flex items-center gap-3 flex-wrap ${chipConfig.color}`}
          data-testid={`drilldown-banner-${activeChip}`}
        >
          <ChipIcon className="w-4 h-4 shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">Drill-down: {chipConfig.label}</span>
              <Badge variant="outline" className="bg-white/70 text-[11px]" data-testid={`drilldown-count-total`}>
                {drillDownInstances.length} total
              </Badge>
              {selectedPhaseId && (
                <Badge variant="outline" className="bg-white/70 text-[11px]" data-testid={`drilldown-count-phase`}>
                  {drillDownInPhase.length} in this phase
                </Badge>
              )}
            </div>
            <div className="text-xs opacity-90 mt-0.5">{chipConfig.description}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {drillDownInPhase.length > 0 && canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 bg-white/70"
                onClick={selectAllVisibleDrillDown}
                data-testid="btn-drilldown-select-all"
              >
                <SquareCheck className="w-3 h-3" /> Select all in this phase
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 bg-white/70"
              onClick={clearChipFilter}
              data-testid="btn-drilldown-clear"
            >
              <X className="w-3 h-3" /> Clear filter
            </Button>
          </div>
        </div>
        );
      })()}

      <QualityGovernanceSummary
        counts={governanceCounts}
        risk={{ level: workspaceData?.risk?.level || "low", summary: workspaceData?.risk?.summary || "" }}
        handover={workspaceData?.handover ? {
          blocked: workspaceData.handover.blocked,
          blockers: workspaceData.handover.blockers || [],
          rejectionReason: workspaceData.handover.rejectionReason,
        } : null}
        highSeverityWarningCount={highSeverityWarnings.length}
        onSelectFilter={(filter) => {
          if (filter === "high_warnings") {
            setWarningsHighOnly(true);
            return;
          }
          setWarningsHighOnly(false);
          setStatusFilter(filter);
        }}
      />

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

      <QualityWarningsPanel warnings={activeWarnings} highOnly={warningsHighOnly} onClearHighOnly={() => setWarningsHighOnly(false)} />

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
                    <p className="text-[11px] text-muted-foreground">Not Started</p>
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
                { value: "not_started", label: "Not Started", count: overallStats.notStarted },
                { value: "review", label: "In Review", count: overallStats.inReview },
                { value: "fail", label: "Failed", count: overallStats.failed },
                { value: "pass", label: "Passed", count: overallStats.passed },
                { value: "overdue", label: "Overdue", count: overallStats.overdue },
                { value: "evidence_gap", label: "Evidence Gap", count: overallStats.evidenceGap },
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
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <Button
                  size="sm"
                  className="h-7 text-xs bg-amber-500 hover:bg-amber-600 gap-1"
                  disabled={selectedItems.size === blockedApprovalSelections.length}
                  onClick={() => { setBulkApprover(""); setBulkApproverDialogOpen(true); }}
                  data-testid="bulk-send-for-approval"
                >
                  <Send className="w-3 h-3" /> Send for approval
                </Button>
                {chipConfig?.showHandoverPackAction && projectInfoId && (
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-red-600 hover:bg-red-700 gap-1"
                    onClick={() => setCreatePackDialogOpen(true)}
                    data-testid="bulk-create-handover-pack"
                  >
                    <PackagePlus className="w-3 h-3" /> Create handover pack
                  </Button>
                )}
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
          {selectedItems.size > 0 && blockedApprovalSelections.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 space-y-1" data-testid="bulk-blocked-reasons">
              <p className="font-medium">Some selected items cannot be submitted for review:</p>
              {blockedApprovalSelections.slice(0, 4).map((item) => (
                <p key={item.id}>• Item #{item.id}: {item.reason}</p>
              ))}
              {blockedApprovalSelections.length > 4 && <p>• +{blockedApprovalSelections.length - 4} more blocked item(s)</p>}
            </div>
          )}

          {bulkApproverDialogOpen && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 space-y-2" data-testid="bulk-approver-dialog">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-700" />
                <span className="text-sm font-semibold text-amber-800">
                  Send {selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} for approval
                </span>
              </div>
              <p className="text-xs text-amber-700">
                Select a reviewer for all selected items. Items with missing required evidence will be skipped.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <SearchableSelect
                  value={bulkApprover}
                  onValueChange={setBulkApprover}
                  placeholder="Select reviewer..."
                  triggerClassName="h-8 text-xs flex-1 min-w-[200px]"
                  data-testid="select-bulk-approver"
                  options={teamMembers.map((m: any) => ({ value: String(m.id), label: m.name }))}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={!bulkApprover || bulkSubmitting}
                  onClick={handleBulkSendForApproval}
                  data-testid="btn-confirm-bulk-approval"
                >
                  {bulkSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Submit all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => { setBulkApproverDialogOpen(false); setBulkApprover(""); }}
                  data-testid="btn-cancel-bulk-approval"
                  disabled={bulkSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {createPackDialogOpen && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 space-y-2" data-testid="create-pack-dialog">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-red-700" />
                <span className="text-sm font-semibold text-red-800">
                  Create handover pack from {selectedItems.size} blocking item{selectedItems.size !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-xs text-red-700">
                A new handover pack will be created and seeded with the selected QC items as checklist entries.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <SearchableSelect
                  value={packType}
                  onValueChange={setPackType}
                  placeholder="Pack type..."
                  triggerClassName="h-8 text-xs min-w-[220px]"
                  data-testid="select-pack-type"
                  options={[
                    { value: "practical_completion", label: "Practical Completion" },
                    { value: "client_handover", label: "Client Handover" },
                    { value: "matriarch_handover", label: "Matriarch Handover" },
                    { value: "pd_to_pm", label: "PD → PM Handover" },
                    { value: "sseg_closeout", label: "SSEG Closeout" },
                  ]}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1 bg-red-600 hover:bg-red-700"
                  disabled={creatingPack}
                  onClick={handleCreateHandoverPack}
                  data-testid="btn-confirm-create-pack"
                >
                  {creatingPack ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackagePlus className="w-3 h-3" />} Create pack
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setCreatePackDialogOpen(false)}
                  data-testid="btn-cancel-create-pack"
                  disabled={creatingPack}
                >
                  Cancel
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
                                        {instance.approved && currentStatus !== "pass" && (
                                          <Badge className="text-[9px] gap-0.5 px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 border-emerald-200" variant="outline">
                                            <CheckCircle2 className="w-2.5 h-2.5" /> QC Passed
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
                                            taskId={Number.isFinite(instance.id) ? instance.id : 0}
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
                                        <span className="font-medium">QC Passed{instance.approvedAt ? ` on ${new Date(instance.approvedAt).toLocaleDateString()}` : ""}</span>
                                        {instance.approvalComment && <span className="text-emerald-600/80 ml-1">- {instance.approvalComment}</span>}
                                      </div>
                                    )}

                                    {governance.resubmissionNeeded && instance.approvalComment && (
                                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid={`resubmission-info-${instance.id}`}>
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        <span className="font-medium">Failed — fix and resubmit</span>
                                        <span className="text-amber-700/90">{instance.approvalComment}</span>
                                      </div>
                                    )}

                                    {canEdit && !instance.approved && (
                                      <div>
                                        {governance.evidenceMissing && (
                                          <div className="flex items-center gap-2 text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg p-2.5 mb-2" data-testid={`evidence-warning-${instance.id}`}>
                                            <Paperclip className="w-3.5 h-3.5 shrink-0" />
                                            <span>Evidence is required before this item can be submitted for review.</span>
                                          </div>
                                        )}
                                        {sendForApprovalItem === instance.id ? (
                                          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                            <Send className="w-4 h-4 text-amber-600 shrink-0" />
                                            <SearchableSelect
                                              value={sfaApprover}
                                              onValueChange={setSfaApprover}
                                              placeholder="Select reviewer..."
                                              triggerClassName="h-8 text-xs flex-1"
                                              data-testid={`select-approver-${instance.id}`}
                                              options={teamMembers.map((m: any) => ({ value: String(m.id), label: m.name }))}
                                            />
                                            <Button
                                              size="sm"
                                              className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                                              disabled={!sfaApprover || sendForApprovalMutation.isPending || governance.evidenceMissing}
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
                                            disabled={governance.evidenceMissing}
                                            onClick={() => setSendForApprovalItem(instance.id)}
                                            data-testid={`btn-send-for-approval-${instance.id}`}
                                          >
                                            <Send className="w-3.5 h-3.5" /> Submit for Review
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
                                      {evidenceUploadState[instance.id] && (
                                        <div
                                          className={`mt-2 text-xs rounded-md border px-2.5 py-1.5 ${
                                            evidenceUploadState[instance.id].state === "uploaded"
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                              : evidenceUploadState[instance.id].state === "uploading"
                                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                                : "bg-red-50 text-red-700 border-red-200"
                                          }`}
                                          data-testid={`evidence-upload-status-${instance.id}`}
                                        >
                                          {evidenceUploadState[instance.id].message}
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
                              {rq.responseType === "yesno" ? (
                                <SearchableSelect
                                  value={formatRiskYesNo(answer.answerYesno)}
                                  onValueChange={(val) =>
                                    updateRiskMutation.mutate({
                                      riskAnswerId: answer.id,
                                      updates: { answerYesno: parseRiskYesNo(val === "unanswered" ? null : val) },
                                    })
                                  }
                                  placeholder="Select answer..."
                                  triggerClassName="h-8 text-xs"
                                  data-testid={`select-risk-answer-${rq.id}`}
                                  options={[
                                    { value: "unanswered", label: "Unanswered" },
                                    { value: "yes", label: "Yes" },
                                    { value: "no", label: "No" },
                                  ]}
                                />
                              ) : rq.responseType === "number" ? (
                                <Input
                                  type="number"
                                  step="any"
                                  className="h-8 text-xs"
                                  placeholder="Enter number..."
                                  value={answer.answerNumber ?? ""}
                                  onChange={(e) =>
                                    updateRiskMutation.mutate({
                                      riskAnswerId: answer.id,
                                      updates: {
                                        answerNumber: e.target.value === "" ? null : Number(e.target.value),
                                      },
                                    })
                                  }
                                  data-testid={`input-risk-number-${rq.id}`}
                                />
                              ) : (
                                <Textarea
                                  className="text-xs"
                                  placeholder="Enter response..."
                                  rows={2}
                                  value={answer.answerText || ""}
                                  onChange={(e) =>
                                    updateRiskMutation.mutate({
                                      riskAnswerId: answer.id,
                                      updates: { answerText: e.target.value },
                                    })
                                  }
                                  data-testid={`input-risk-text-${rq.id}`}
                                />
                              )}
                            </div>
                          )}
                          {!canEdit && answer && (
                            <div className="text-xs space-y-1 ml-6">
                              <p>
                                <span className="font-medium">Answer:</span>{" "}
                                {rq.responseType === "yesno"
                                  ? formatRiskYesNo(answer.answerYesno) === "unanswered"
                                    ? "Unanswered"
                                    : formatRiskYesNo(answer.answerYesno) === "yes"
                                      ? "Yes"
                                      : "No"
                                  : rq.responseType === "number"
                                    ? (answer.answerNumber ?? "Unanswered")
                                    : (answer.answerText || "Unanswered")}
                              </p>
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
