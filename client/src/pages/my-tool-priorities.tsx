import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Flag,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Calendar,
  User,
  Users,
  X,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

interface PriorityLink {
  id: number;
  priorityId: number;
  linkType: string;
  projectName: string | null;
  taskId: number | null;
  taskType: string | null;
}

interface CompanyPriority {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  horizon: string;
  ownerRole: string | null;
  linkedProjectName: string | null;
  severity: string;
  status: string;
  priorityRank: number | null;
  assignedTo: string | null;
  nextAction: string | null;
  support: string[] | null;
  definitionOfDone: string | null;
  dueDate: string | null;
  linkedTaskId: number | null;
  linkedTaskType: string | null;
  links: PriorityLink[];
  createdAt: string;
  updatedAt: string;
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "text-green-700", bg: "bg-green-100" },
  not_started: { label: "Not started", color: "text-muted-foreground", bg: "bg-muted" },
  in_progress: { label: "In progress", color: "text-amber-700", bg: "bg-amber-100" },
  complete: { label: "Complete", color: "text-green-700", bg: "bg-green-100" },
  monitoring: { label: "Monitoring", color: "text-blue-700", bg: "bg-blue-100" },
  closed: { label: "Closed", color: "text-muted-foreground", bg: "bg-muted" },
};

const departmentColors: Record<string, string> = {
  Accounts: "bg-yellow-100 text-yellow-800",
  "Project Development": "bg-emerald-100 text-emerald-800",
  "Project Management": "bg-blue-100 text-blue-800",
  Operations: "bg-purple-100 text-purple-800",
  Engineering: "bg-orange-100 text-orange-800",
  Finance: "bg-indigo-100 text-indigo-800",
};

const defaultDeptColor = "bg-muted text-foreground";

interface PendingLink {
  linkType: string;
  projectName: string;
  taskId: string;
  taskType: string;
}

const emptyForm = {
  title: "",
  description: "",
  department: "",
  assignedTo: "",
  nextAction: "",
  supportText: "",
  definitionOfDone: "",
  dueDate: "",
  linkedProjectName: "",
  linkedTaskId: "",
  linkedTaskType: "",
  severity: "normal" as string,
  status: "in_progress" as string,
  priorityRank: "",
};

export default function MyToolPrioritiesPage() {
  const { user, isAdmin } = useAuth();
  const { allowed: canView } = usePermission('company_priorities', 'view');
  const { allowed: canEditPerm } = usePermission('company_priorities', 'edit');
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const editRoles = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "admin"];
  const canEdit = canEditPerm || isAdmin || (companyRole ? editRoles.includes(companyRole) : false) || user?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingPriority, setEditingPriority] = useState<CompanyPriority | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>("all_active");
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [existingLinks, setExistingLinks] = useState<PriorityLink[]>([]);
  const [linkProjectPicker, setLinkProjectPicker] = useState("");
  const [linkTaskPicker, setLinkTaskPicker] = useState("");
  const [inlineEdit, setInlineEdit] = useState<{ id: number; field: string; value: string } | null>(null);

  const { data: priorities = [], isLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: string }) => {
      const payload: Record<string, any> = {};
      if (field === "priorityRank") {
        payload[field] = value ? parseInt(value) : null;
      } else {
        payload[field] = value.trim() || null;
      }
      return apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const commitInlineEdit = useCallback(() => {
    if (!inlineEdit) return;
    const original = priorities.find(p => p.id === inlineEdit.id);
    if (!original) { setInlineEdit(null); return; }
    const origVal = (original as any)[inlineEdit.field] ?? "";
    if (String(origVal) !== inlineEdit.value) {
      inlineUpdateMutation.mutate({ id: inlineEdit.id, field: inlineEdit.field, value: inlineEdit.value });
    }
    setInlineEdit(null);
  }, [inlineEdit, priorities]);

  const startInlineEdit = (id: number, field: string, currentValue: string) => {
    if (!canEdit) return;
    setInlineEdit({ id, field, value: currentValue ?? "" });
  };

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["/api/projects-summary"],
    select: (data: any) => {
      if (Array.isArray(data)) return data;
      if (data?.projects) return data.projects;
      return [];
    },
  });

  const { data: allOperationalTasks = [] } = useQuery<any[]>({
    queryKey: ["/api/operational-tasks-all"],
    queryFn: async () => {
      const projectNames = projects.map((p: any) => p.projectName || p.project_name).filter(Boolean);
      const results: any[] = [];
      for (const pn of projectNames.slice(0, 50)) {
        try {
          const res = await fetch(`/api/operational-tasks/${encodeURIComponent(pn)}`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            const tasks = Array.isArray(data) ? data : data.tasks || [];
            tasks.forEach((t: any) => results.push({ ...t, _projectName: pn }));
          }
        } catch {}
      }
      return results;
    },
    enabled: projects.length > 0 && canEdit,
  });

  const filteredPriorities = useMemo(() => {
    return priorities.filter(p => {
      if (statusFilter === "all_active") return !["closed", "complete"].includes(p.status);
      if (statusFilter === "all") return true;
      return p.status === statusFilter;
    });
  }, [priorities, statusFilter]);

  const groupedByDept = useMemo(() => {
    const groups: Record<string, CompanyPriority[]> = {};
    filteredPriorities.forEach(p => {
      const dept = p.department || "Unassigned";
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(p);
    });
    Object.values(groups).forEach(items => {
      items.sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999));
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
    return sortedKeys.map(dept => ({ department: dept, items: groups[dept] }));
  }, [filteredPriorities]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/mytool/company-priorities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      toast({ title: "Priority Removed" });
    },
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingPriority(null);
    setForm(emptyForm);
    setPendingLinks([]);
    setExistingLinks([]);
    setLinkProjectPicker("");
    setLinkTaskPicker("");
  };

  const openCreate = (dept?: string) => {
    setEditingPriority(null);
    setForm({ ...emptyForm, department: dept || "" });
    setPendingLinks([]);
    setExistingLinks([]);
    setShowDialog(true);
  };

  const openEdit = (p: CompanyPriority) => {
    setEditingPriority(p);
    setForm({
      title: p.title,
      description: p.description || "",
      department: p.department || "",
      assignedTo: p.assignedTo || "",
      nextAction: p.nextAction || "",
      supportText: (p.support || []).join(", "),
      definitionOfDone: p.definitionOfDone || "",
      dueDate: p.dueDate || "",
      linkedProjectName: p.linkedProjectName || "",
      linkedTaskId: p.linkedTaskId?.toString() || "",
      linkedTaskType: p.linkedTaskType || "",
      severity: p.severity,
      status: p.status,
      priorityRank: p.priorityRank?.toString() || "",
    });
    setExistingLinks(p.links || []);
    setPendingLinks([]);
    setLinkProjectPicker("");
    setLinkTaskPicker("");
    setShowDialog(true);
  };

  const savePendingLinks = async (priorityId: number) => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    for (const pl of pendingLinks) {
      await fetch(`/api/mytool/company-priorities/${priorityId}/links`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(pl),
      });
    }
  };

  const removeExistingLink = async (linkId: number) => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetch(`/api/mytool/priority-links/${linkId}`, {
      method: "DELETE",
      headers,
      credentials: "include",
    });
    setExistingLinks(prev => prev.filter(l => l.id !== linkId));
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
  };

  const addPendingProjectLink = () => {
    if (!linkProjectPicker) return;
    const alreadyExists = existingLinks.some(l => l.linkType === "project" && l.projectName === linkProjectPicker)
      || pendingLinks.some(l => l.linkType === "project" && l.projectName === linkProjectPicker);
    if (alreadyExists) {
      toast({ title: "Already linked", description: "This project is already linked.", variant: "destructive" });
      return;
    }
    setPendingLinks(prev => [...prev, { linkType: "project", projectName: linkProjectPicker, taskId: "", taskType: "" }]);
  };

  const addPendingTaskLink = () => {
    if (!linkTaskPicker || !linkProjectPicker) return;
    const alreadyExists = existingLinks.some(l => l.linkType === "task" && l.taskId === parseInt(linkTaskPicker))
      || pendingLinks.some(l => l.linkType === "task" && l.taskId === linkTaskPicker);
    if (alreadyExists) {
      toast({ title: "Already linked", description: "This task is already linked.", variant: "destructive" });
      return;
    }
    setPendingLinks(prev => [...prev, { linkType: "task", projectName: linkProjectPicker, taskId: linkTaskPicker, taskType: "operational" }]);
    setLinkTaskPicker("");
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setIsSaving(true);
    const supportArr = form.supportText.split(",").map(s => s.trim()).filter(Boolean);
    const payload: any = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      department: form.department.trim() || null,
      assignedTo: form.assignedTo.trim() || null,
      nextAction: form.nextAction.trim() || null,
      support: supportArr.length > 0 ? supportArr : null,
      definitionOfDone: form.definitionOfDone.trim() || null,
      dueDate: form.dueDate.trim() || null,
      linkedProjectName: form.linkedProjectName || null,
      linkedTaskId: form.linkedTaskId ? parseInt(form.linkedTaskId) : null,
      linkedTaskType: form.linkedTaskType || null,
      severity: form.severity,
      status: form.status,
      priorityRank: form.priorityRank ? parseInt(form.priorityRank) : null,
    };
    try {
      if (editingPriority) {
        await apiRequest("PATCH", `/api/mytool/company-priorities/${editingPriority.id}`, payload);
        if (pendingLinks.length > 0) {
          await savePendingLinks(editingPriority.id);
        }
        toast({ title: "Priority Updated" });
      } else {
        const res = await apiRequest("POST", "/api/mytool/company-priorities", payload);
        const created = await res.json();
        if (created?.id && pendingLinks.length > 0) {
          await savePendingLinks(created.id);
        }
        toast({ title: "Priority Created" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      closeDialog();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleDept = (dept: string) => {
    setCollapsedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const projectNames = projects.map((p: any) => p.projectName || p.project_name).filter(Boolean);

  const tasksForProject = useMemo(() => {
    if (!linkProjectPicker) return [];
    return allOperationalTasks.filter((t: any) => t._projectName === linkProjectPicker);
  }, [linkProjectPicker, allOperationalTasks]);

  const formatDisplayDate = (d: string | null) => {
    if (!d) return "";
    try {
      return format(new Date(d), "M/d/yyyy");
    } catch {
      return d;
    }
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="space-y-4 max-w-[1400px] mx-auto" data-testid="company-priorities-page">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Flag className="h-5 w-5 text-red-500" />
              Emergent Energy Company Priorities
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {filteredPriorities.length} {statusFilter === "all_active" ? "active" : statusFilter} priorities across {groupedByDept.length} departments
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active">Active</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            {canEdit && (
              <Button size="sm" onClick={() => openCreate()} data-testid="button-create-priority">
                <Plus className="h-4 w-4 mr-1" />
                New Priority
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredPriorities.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Flag className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">No priorities found.</p>
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => openCreate()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create First Priority
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-background">
            <div className="grid grid-cols-[40px_130px_1fr_100px_120px_1fr_140px_1fr_90px] gap-0 text-[11px] font-medium text-muted-foreground border-b bg-muted/30 px-3 py-2 sticky top-0">
              <span className="text-center">#</span>
              <span>Department</span>
              <span>Priorities</span>
              <span>Status</span>
              <span>Assigned to</span>
              <span>Next Action</span>
              <span>Support</span>
              <span>Definition of Done</span>
              <span>Due Date</span>
            </div>

            {groupedByDept.map(({ department, items }) => {
              const isCollapsed = collapsedDepts.has(department);
              const deptColor = departmentColors[department] || defaultDeptColor;
              return (
                <div key={department} data-testid={`dept-group-${department}`}>
                  <button
                    onClick={() => toggleDept(department)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 hover:bg-muted/40 transition-colors border-b text-left"
                    data-testid={`dept-toggle-${department}`}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="text-sm font-semibold">Department: {department}</span>
                    <span className="text-xs text-muted-foreground">({items.length})</span>
                  </button>
                  {!isCollapsed && items.map((p, idx) => {
                    const stat = statusConfig[p.status] || statusConfig.active;
                    return (
                      <div
                        key={p.id}
                        className="grid grid-cols-[40px_130px_1fr_100px_120px_1fr_140px_1fr_90px] gap-0 px-3 py-2.5 border-b hover:bg-muted/10 transition-colors items-start group text-sm"
                        data-testid={`priority-row-${p.id}`}
                      >
                        <span className="text-center text-muted-foreground text-xs font-medium pt-0.5">{p.priorityRank ?? (idx + 1)}</span>
                        <div className="pr-2">
                          <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${deptColor} truncate max-w-[120px]`}>
                            {department === "Project Development" ? "Project Develop..." :
                             department === "Project Management" ? "Project Manage..." :
                             department.length > 14 ? department.slice(0, 12) + "..." : department}
                          </Badge>
                        </div>
                        <div className="pr-2 flex items-center gap-1.5 min-w-0">
                          {inlineEdit?.id === p.id && inlineEdit.field === "title" ? (
                            <Input
                              autoFocus
                              className="h-7 text-sm px-1.5"
                              value={inlineEdit.value}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") commitInlineEdit(); if (e.key === "Escape") setInlineEdit(null); }}
                              data-testid={`inline-edit-title-${p.id}`}
                            />
                          ) : (
                            <span
                              className={`font-medium truncate ${canEdit ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
                              onClick={() => startInlineEdit(p.id, "title", p.title)}
                              data-testid={`text-priority-${p.id}`}
                            >
                              {p.title}
                            </span>
                          )}
                          {(p.links?.length > 0 || p.linkedProjectName) && (
                            <span title={p.links?.length > 0
                              ? `${p.links.length} linked item(s): ${p.links.map(l => l.linkType === 'project' ? (l.projectName || '').replace(/_Tracker.*$/i, '').replace(/_/g, ' ') : `Task #${l.taskId}`).join(', ')}`
                              : `Linked to ${p.linkedProjectName}`
                            } className="flex items-center gap-0.5">
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                              {p.links?.length > 1 && (
                                <span className="text-[10px] text-muted-foreground font-medium">{p.links.length}</span>
                              )}
                            </span>
                          )}
                          {canEdit && (
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 ml-1">
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEdit(p)} data-testid={`button-edit-priority-${p.id}`}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" data-testid={`button-delete-priority-${p.id}`}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Priority</AlertDialogTitle>
                                    <AlertDialogDescription>Are you sure you want to permanently delete "{p.title}"?</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteMutation.mutate(p.id)}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </div>
                        <div className="pr-2">
                          {inlineEdit?.id === p.id && inlineEdit.field === "status" ? (
                            <Select
                              value={inlineEdit.value}
                              onValueChange={(val) => {
                                inlineUpdateMutation.mutate({ id: p.id, field: "status", value: val });
                                setInlineEdit(null);
                              }}
                              open={true}
                              onOpenChange={(open) => { if (!open) setInlineEdit(null); }}
                            >
                              <SelectTrigger className="h-7 text-[10px] px-1.5 w-24" data-testid={`inline-edit-status-${p.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="not_started">Not started</SelectItem>
                                <SelectItem value="in_progress">In progress</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="monitoring">Monitoring</SelectItem>
                                <SelectItem value="complete">Complete</SelectItem>
                                <SelectItem value="closed">Closed</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge
                              variant="secondary"
                              className={`text-[10px] px-2 py-0.5 ${stat.bg} ${stat.color} ${canEdit ? "cursor-pointer hover:ring-1 hover:ring-primary/40" : ""}`}
                              onClick={() => startInlineEdit(p.id, "status", p.status)}
                              data-testid={`badge-status-${p.id}`}
                            >
                              {stat.label}
                            </Badge>
                          )}
                        </div>
                        <div className="pr-2 flex items-center gap-1 text-xs truncate">
                          {inlineEdit?.id === p.id && inlineEdit.field === "assignedTo" ? (
                            <Input
                              autoFocus
                              className="h-7 text-xs px-1.5"
                              value={inlineEdit.value}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") commitInlineEdit(); if (e.key === "Escape") setInlineEdit(null); }}
                              data-testid={`inline-edit-assigned-${p.id}`}
                            />
                          ) : (
                            <span
                              className={`truncate flex items-center gap-1 ${canEdit ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
                              onClick={() => startInlineEdit(p.id, "assignedTo", p.assignedTo || "")}
                              data-testid={`text-assigned-${p.id}`}
                            >
                              {p.assignedTo && <User className="h-3 w-3 text-muted-foreground shrink-0" />}
                              {p.assignedTo || (canEdit ? <span className="text-muted-foreground/50 italic">assign...</span> : "")}
                            </span>
                          )}
                        </div>
                        <div className="pr-2 text-xs text-muted-foreground">
                          {inlineEdit?.id === p.id && inlineEdit.field === "nextAction" ? (
                            <Input
                              autoFocus
                              className="h-7 text-xs px-1.5"
                              value={inlineEdit.value}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") commitInlineEdit(); if (e.key === "Escape") setInlineEdit(null); }}
                              data-testid={`inline-edit-nextaction-${p.id}`}
                            />
                          ) : (
                            <span
                              className={`line-clamp-2 ${canEdit ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
                              onClick={() => startInlineEdit(p.id, "nextAction", p.nextAction || "")}
                              data-testid={`text-nextaction-${p.id}`}
                            >
                              {p.nextAction || (canEdit ? <span className="text-muted-foreground/50 italic">add...</span> : "")}
                            </span>
                          )}
                        </div>
                        <div className="pr-2">
                          {p.support && p.support.length > 0 && (
                            <div className="flex flex-col gap-0.5">
                              {p.support.map((s, i) => (
                                <span key={i} className="text-xs text-muted-foreground truncate">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="pr-2 text-xs text-muted-foreground">
                          {inlineEdit?.id === p.id && inlineEdit.field === "definitionOfDone" ? (
                            <Input
                              autoFocus
                              className="h-7 text-xs px-1.5"
                              value={inlineEdit.value}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") commitInlineEdit(); if (e.key === "Escape") setInlineEdit(null); }}
                              data-testid={`inline-edit-dod-${p.id}`}
                            />
                          ) : (
                            <span
                              className={`line-clamp-2 ${canEdit ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
                              onClick={() => startInlineEdit(p.id, "definitionOfDone", p.definitionOfDone || "")}
                              data-testid={`text-dod-${p.id}`}
                            >
                              {p.definitionOfDone || (canEdit ? <span className="text-muted-foreground/50 italic">add...</span> : "")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {inlineEdit?.id === p.id && inlineEdit.field === "dueDate" ? (
                            <Input
                              autoFocus
                              type="date"
                              className="h-7 text-xs px-1"
                              value={inlineEdit.value}
                              onChange={(e) => {
                                inlineUpdateMutation.mutate({ id: p.id, field: "dueDate", value: e.target.value });
                                setInlineEdit(null);
                              }}
                              onBlur={commitInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") setInlineEdit(null); }}
                              data-testid={`inline-edit-duedate-${p.id}`}
                            />
                          ) : (
                            <span
                              className={`${canEdit ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
                              onClick={() => startInlineEdit(p.id, "dueDate", p.dueDate || "")}
                              data-testid={`text-duedate-${p.id}`}
                            >
                              {formatDisplayDate(p.dueDate) || (canEdit ? <span className="text-muted-foreground/50 italic">set...</span> : "")}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog(); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPriority ? "Edit Priority" : "New Company Priority"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-medium">Priority Title *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Coega 19.8 MWp costing Finalisation"
                  className="mt-1"
                  autoFocus
                  data-testid="input-dialog-title"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs font-medium">Priority Rank</Label>
                  <Input
                    type="number"
                    value={form.priorityRank}
                    onChange={(e) => setForm({ ...form, priorityRank: e.target.value })}
                    placeholder="1"
                    className="mt-1"
                    data-testid="input-dialog-rank"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Department</Label>
                  <Input
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    placeholder="e.g. Project Management"
                    className="mt-1"
                    data-testid="input-dialog-department"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger className="mt-1" data-testid="select-dialog-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Not started</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="monitoring">Monitoring</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Assigned to</Label>
                  <Input
                    value={form.assignedTo}
                    onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                    placeholder="e.g. Tanaka Zimuto"
                    className="mt-1"
                    data-testid="input-dialog-assigned"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Due Date</Label>
                  <Input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="mt-1"
                    data-testid="input-dialog-duedate"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Next Action</Label>
                <Textarea
                  value={form.nextAction}
                  onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
                  placeholder="What needs to happen next..."
                  className="mt-1 h-16"
                  data-testid="input-dialog-next-action"
                />
              </div>

              <div>
                <Label className="text-xs font-medium">Support (comma-separated names)</Label>
                <Input
                  value={form.supportText}
                  onChange={(e) => setForm({ ...form, supportText: e.target.value })}
                  placeholder="e.g. Mary Boakye, Natasha Watkins-Baker"
                  className="mt-1"
                  data-testid="input-dialog-support"
                />
              </div>

              <div>
                <Label className="text-xs font-medium">Definition of Done</Label>
                <Textarea
                  value={form.definitionOfDone}
                  onChange={(e) => setForm({ ...form, definitionOfDone: e.target.value })}
                  placeholder="What does completion look like..."
                  className="mt-1 h-16"
                  data-testid="input-dialog-dod"
                />
              </div>

              <div>
                <Label className="text-xs font-medium">Description (optional)</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Additional context..."
                  className="mt-1 h-16"
                  data-testid="input-dialog-description"
                />
              </div>

              <div className="border-t pt-4">
                <Label className="text-xs font-medium text-muted-foreground">Linked Projects & Tasks</Label>

                {(existingLinks.length > 0 || pendingLinks.length > 0) && (
                  <div className="mt-2 space-y-1">
                    {existingLinks.map((l) => (
                      <div key={`existing-${l.id}`} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1.5" data-testid={`link-existing-${l.id}`}>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {l.linkType === "project" ? "Project" : "Task"}
                        </Badge>
                        <span className="flex-1 truncate">
                          {l.linkType === "project"
                            ? (l.projectName || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ")
                            : `Task #${l.taskId} in ${(l.projectName || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ")}`}
                        </span>
                        {canEdit && (
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeExistingLink(l.id)} data-testid={`btn-remove-link-${l.id}`}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {pendingLinks.map((l, idx) => (
                      <div key={`pending-${idx}`} className="flex items-center gap-2 text-xs bg-blue-50 rounded px-2 py-1.5" data-testid={`link-pending-${idx}`}>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700">
                          {l.linkType === "project" ? "Project" : "Task"} (new)
                        </Badge>
                        <span className="flex-1 truncate">
                          {l.linkType === "project"
                            ? (l.projectName || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ")
                            : `Task #${l.taskId} in ${(l.projectName || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ")}`}
                        </span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => setPendingLinks(prev => prev.filter((_, i) => i !== idx))} data-testid={`btn-remove-pending-${idx}`}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label className="text-[10px] text-muted-foreground">Add Project Link</Label>
                      <Select
                        value={linkProjectPicker || "_none"}
                        onValueChange={(v) => setLinkProjectPicker(v === "_none" ? "" : v)}
                      >
                        <SelectTrigger className="mt-1 text-xs" data-testid="select-link-project">
                          <SelectValue placeholder="Select project..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Select project...</SelectItem>
                          {projectNames.map((name: string) => (
                            <SelectItem key={name} value={name}>
                              {name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={addPendingProjectLink} disabled={!linkProjectPicker} data-testid="btn-add-project-link">
                      <Plus className="h-3 w-3 mr-1" /> Project
                    </Button>
                  </div>

                  {linkProjectPicker && tasksForProject.length > 0 && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-[10px] text-muted-foreground">Add Task Link (from selected project)</Label>
                        <Select
                          value={linkTaskPicker || "_none"}
                          onValueChange={(v) => setLinkTaskPicker(v === "_none" ? "" : v)}
                        >
                          <SelectTrigger className="mt-1 text-xs" data-testid="select-link-task">
                            <SelectValue placeholder="Select task..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">Select task...</SelectItem>
                            {tasksForProject.map((t: any) => (
                              <SelectItem key={t.id} value={String(t.id)}>
                                {t.title?.slice(0, 50)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={addPendingTaskLink} disabled={!linkTaskPicker} data-testid="btn-add-task-link">
                        <Plus className="h-3 w-3 mr-1" /> Task
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={!form.title.trim() || isSaving}
                data-testid="button-dialog-save"
              >
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {editingPriority ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
