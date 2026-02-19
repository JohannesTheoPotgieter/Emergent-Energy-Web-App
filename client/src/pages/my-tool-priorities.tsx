import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
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
} from "lucide-react";
import { format } from "date-fns";

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
  createdAt: string;
  updatedAt: string;
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "text-green-700 dark:text-green-400", bg: "bg-green-100 dark:bg-green-950/40" },
  not_started: { label: "Not started", color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-100 dark:bg-slate-800" },
  in_progress: { label: "In progress", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-950/40" },
  complete: { label: "Complete", color: "text-green-700 dark:text-green-400", bg: "bg-green-100 dark:bg-green-950/40" },
  monitoring: { label: "Monitoring", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-950/40" },
  closed: { label: "Closed", color: "text-gray-500 dark:text-gray-400", bg: "bg-gray-100 dark:bg-gray-800" },
};

const departmentColors: Record<string, string> = {
  Accounts: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400",
  "Project Development": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  "Project Management": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
  Operations: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400",
  Engineering: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-400",
  Finance: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400",
};

const defaultDeptColor = "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";

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
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const excoRoles = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"];
  const canEdit = isAdmin || (companyRole ? excoRoles.includes(companyRole) : false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingPriority, setEditingPriority] = useState<CompanyPriority | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>("all_active");
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());

  const { data: priorities = [], isLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

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

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/mytool/company-priorities", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      closeDialog();
      toast({ title: "Priority Created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      closeDialog();
      toast({ title: "Priority Updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

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
  };

  const openCreate = (dept?: string) => {
    setEditingPriority(null);
    setForm({ ...emptyForm, department: dept || "" });
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
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) return;
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
    if (editingPriority) {
      updateMutation.mutate({ id: editingPriority.id, data: payload });
    } else {
      createMutation.mutate(payload);
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
    if (!form.linkedProjectName) return [];
    return allOperationalTasks.filter((t: any) => t._projectName === form.linkedProjectName);
  }, [form.linkedProjectName, allOperationalTasks]);

  const formatDisplayDate = (d: string | null) => {
    if (!d) return "";
    try {
      return format(new Date(d), "M/d/yyyy");
    } catch {
      return d;
    }
  };

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
                          <span className="font-medium truncate" data-testid={`text-priority-${p.id}`}>{p.title}</span>
                          {p.linkedProjectName && (
                            <span title={`Linked to ${p.linkedProjectName}`}>
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
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
                          <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${stat.bg} ${stat.color}`}>
                            {stat.label}
                          </Badge>
                        </div>
                        <div className="pr-2 flex items-center gap-1 text-xs truncate">
                          {p.assignedTo && (
                            <>
                              <User className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{p.assignedTo}</span>
                            </>
                          )}
                        </div>
                        <div className="pr-2 text-xs text-muted-foreground line-clamp-2">{p.nextAction || ""}</div>
                        <div className="pr-2">
                          {p.support && p.support.length > 0 && (
                            <div className="flex flex-col gap-0.5">
                              {p.support.map((s, i) => (
                                <span key={i} className="text-xs text-muted-foreground truncate">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="pr-2 text-xs text-muted-foreground line-clamp-2">{p.definitionOfDone || ""}</div>
                        <div className="text-xs text-muted-foreground">{formatDisplayDate(p.dueDate)}</div>
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
                <Label className="text-xs font-medium text-muted-foreground">Link to Project / Task</Label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Linked Project</Label>
                    <Select
                      value={form.linkedProjectName || "_none"}
                      onValueChange={(v) => setForm({ ...form, linkedProjectName: v === "_none" ? "" : v, linkedTaskId: "", linkedTaskType: "" })}
                    >
                      <SelectTrigger className="mt-1 text-xs" data-testid="select-dialog-project">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {projectNames.map((name: string) => (
                          <SelectItem key={name} value={name}>
                            {name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Linked Task</Label>
                    <Select
                      value={form.linkedTaskId || "_none"}
                      onValueChange={(v) => {
                        if (v === "_none") {
                          setForm({ ...form, linkedTaskId: "", linkedTaskType: "" });
                        } else {
                          setForm({ ...form, linkedTaskId: v, linkedTaskType: "operational" });
                        }
                      }}
                    >
                      <SelectTrigger className="mt-1 text-xs" data-testid="select-dialog-task">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {tasksForProject.map((t: any) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.title?.slice(0, 50)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}
                data-testid="button-dialog-save"
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {editingPriority ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
