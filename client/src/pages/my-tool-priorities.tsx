import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  CheckCircle,
  Archive,
} from "lucide-react";

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
  createdAt: string;
  updatedAt: string;
}

const severityConfig: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "Critical", color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400", dot: "bg-red-500" },
  important: { label: "Important", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400", dot: "bg-amber-500" },
  normal: { label: "Normal", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400", dot: "bg-blue-500" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  completed: { label: "Completed", color: "bg-slate-100 text-slate-700 dark:bg-slate-950/40 dark:text-slate-400" },
  archived: { label: "Archived", color: "bg-gray-100 text-gray-500 dark:bg-gray-950/40 dark:text-gray-400" },
};

const emptyForm = {
  title: "",
  description: "",
  department: "",
  horizon: "week" as string,
  ownerRole: "",
  linkedProjectName: "",
  severity: "normal" as string,
};

export default function MyToolPrioritiesPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingPriority, setEditingPriority] = useState<CompanyPriority | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>("active");

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

  const filteredPriorities = priorities.filter(p =>
    statusFilter === "all" ? true : p.status === statusFilter
  );

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

  const openCreate = () => {
    setEditingPriority(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEdit = (p: CompanyPriority) => {
    setEditingPriority(p);
    setForm({
      title: p.title,
      description: p.description || "",
      department: p.department || "",
      horizon: p.horizon,
      ownerRole: p.ownerRole || "",
      linkedProjectName: p.linkedProjectName || "",
      severity: p.severity,
    });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) return;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      department: form.department.trim() || null,
      horizon: form.horizon,
      ownerRole: form.ownerRole.trim() || null,
      linkedProjectName: form.linkedProjectName || null,
      severity: form.severity,
    };
    if (editingPriority) {
      updateMutation.mutate({ id: editingPriority.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const toggleStatus = (p: CompanyPriority, newStatus: string) => {
    updateMutation.mutate({ id: p.id, data: { status: newStatus } });
  };

  const projectNames = projects.map((p: any) => p.projectName || p.project_name).filter(Boolean);

  return (
    <MyToolLayout>
      <div className="space-y-6 max-w-4xl" data-testid="mytool-priorities-page">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Flag className="h-5 w-5 text-red-500" />
              Company Priorities
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isAdmin ? "Manage company-wide priorities, assign departments, and link to projects." : "View current company-wide priorities."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && (
              <Button size="sm" onClick={openCreate} data-testid="button-create-priority">
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
              <p className="text-muted-foreground text-sm">No {statusFilter !== "all" ? statusFilter : ""} priorities found.</p>
              {isAdmin && statusFilter === "active" && (
                <Button variant="outline" size="sm" className="mt-3" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create First Priority
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredPriorities.map((p) => {
              const sev = severityConfig[p.severity] || severityConfig.normal;
              const stat = statusConfig[p.status] || statusConfig.active;
              return (
                <Card key={p.id} className={`transition-all hover:shadow-sm ${p.status !== "active" ? "opacity-60" : ""}`} data-testid={`priority-row-${p.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${sev.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-sm" data-testid={`text-priority-${p.id}`}>{p.title}</h3>
                          <Badge variant="secondary" className={`text-[10px] h-4 px-1.5 ${sev.color}`}>{sev.label}</Badge>
                          <Badge variant="secondary" className={`text-[10px] h-4 px-1.5 ${stat.color}`}>{stat.label}</Badge>
                          {p.horizon && <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{p.horizon}</Badge>}
                        </div>
                        {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
                          {p.department && <span>Dept: {p.department}</span>}
                          {p.ownerRole && <span>Owner: {p.ownerRole}</span>}
                          {p.linkedProjectName && (
                            <span>Project: {p.linkedProjectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          {p.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-green-600"
                              onClick={() => toggleStatus(p, "completed")}
                              title="Mark completed"
                              data-testid={`button-complete-priority-${p.id}`}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {p.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-slate-600"
                              onClick={() => toggleStatus(p, "archived")}
                              title="Archive"
                              data-testid={`button-archive-priority-${p.id}`}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {p.status !== "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-green-600"
                              onClick={() => toggleStatus(p, "active")}
                              title="Reactivate"
                              data-testid={`button-reactivate-priority-${p.id}`}
                            >
                              <Flag className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(p)}
                            data-testid={`button-edit-priority-${p.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" data-testid={`button-delete-priority-${p.id}`}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Priority</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to permanently delete "{p.title}"?
                                </AlertDialogDescription>
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingPriority ? "Edit Priority" : "New Company Priority"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Priority title..."
                  className="mt-1"
                  autoFocus
                  data-testid="input-dialog-title"
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional details..."
                  className="mt-1 h-20"
                  data-testid="input-dialog-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Severity</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                    <SelectTrigger className="mt-1" data-testid="select-dialog-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="important">Important</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Horizon</Label>
                  <Select value={form.horizon} onValueChange={(v) => setForm({ ...form, horizon: v })}>
                    <SelectTrigger className="mt-1" data-testid="select-dialog-horizon">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                      <SelectItem value="quarter">Quarter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Department</Label>
                  <Input
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    placeholder="e.g. Engineering"
                    className="mt-1"
                    data-testid="input-dialog-department"
                  />
                </div>
                <div>
                  <Label className="text-xs">Owner Role</Label>
                  <Input
                    value={form.ownerRole}
                    onChange={(e) => setForm({ ...form, ownerRole: e.target.value })}
                    placeholder="e.g. COO"
                    className="mt-1"
                    data-testid="input-dialog-owner"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Linked Project</Label>
                <Select
                  value={form.linkedProjectName || "_none"}
                  onValueChange={(v) => setForm({ ...form, linkedProjectName: v === "_none" ? "" : v })}
                >
                  <SelectTrigger className="mt-1" data-testid="select-dialog-project">
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
    </MyToolLayout>
  );
}
