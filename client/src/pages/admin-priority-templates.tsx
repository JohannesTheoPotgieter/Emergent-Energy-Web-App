import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useConfirmDialog } from "@/components/priorities/ConfirmActionDialog";
import { apiRequest } from "@/lib/queryClient";
import {
  DEPARTMENT_OPTIONS,
  isPriorityAdminRole,
  isDepartmentHeadRole,
} from "@/config/priorities";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";

interface PriorityTemplate {
  id: number;
  name: string;
  description: string | null;
  titleTemplate: string;
  bodyTemplate: string | null;
  scopeDefault: string;
  severityDefault: string;
  horizonDefault: string;
  departmentKey: string | null;
  targetOutcome: string | null;
  definitionOfDone: string | null;
  nextAction: string | null;
  ownerRole: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type TemplateForm = {
  name: string;
  description: string;
  title_template: string;
  body_template: string;
  scope_default: "company" | "department" | "role";
  severity_default: "normal" | "important" | "critical";
  horizon_default: "today" | "week" | "month" | "quarter";
  department_key: string;
  target_outcome: string;
  definition_of_done: string;
  next_action: string;
  owner_role: string;
};

const emptyTemplateForm: TemplateForm = {
  name: "",
  description: "",
  title_template: "",
  body_template: "",
  scope_default: "role",
  severity_default: "normal",
  horizon_default: "week",
  department_key: "",
  target_outcome: "",
  definition_of_done: "",
  next_action: "",
  owner_role: "",
};

export default function AdminPriorityTemplatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const canManage = isPriorityAdminRole(user?.role) || isDepartmentHeadRole(user?.role);
  const userDept = user?.role ? ROLE_DEPARTMENT_MAP[user.role] : undefined;

  const templatesQuery = useQuery<PriorityTemplate[]>({
    queryKey: ["/api/priority-templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/priority-templates");
      return res.json();
    },
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TemplateForm>(emptyTemplateForm);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyTemplateForm,
      department_key: isPriorityAdminRole(user?.role) ? "" : (userDept ?? ""),
    });
    setDialogOpen(true);
  };

  const openEdit = (t: PriorityTemplate) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      description: t.description ?? "",
      title_template: t.titleTemplate,
      body_template: t.bodyTemplate ?? "",
      scope_default: (t.scopeDefault as TemplateForm["scope_default"]) ?? "role",
      severity_default: (t.severityDefault as TemplateForm["severity_default"]) ?? "normal",
      horizon_default: (t.horizonDefault as TemplateForm["horizon_default"]) ?? "week",
      department_key: t.departmentKey ?? "",
      target_outcome: t.targetOutcome ?? "",
      definition_of_done: t.definitionOfDone ?? "",
      next_action: t.nextAction ?? "",
      owner_role: t.ownerRole ?? "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        title_template: form.title_template,
        body_template: form.body_template || null,
        scope_default: form.scope_default,
        severity_default: form.severity_default,
        horizon_default: form.horizon_default,
        department_key: form.department_key || null,
        target_outcome: form.target_outcome || null,
        definition_of_done: form.definition_of_done || null,
        next_action: form.next_action || null,
        owner_role: form.owner_role || null,
      };
      if (editingId == null) {
        await apiRequest("POST", "/api/priority-templates", payload);
      } else {
        await apiRequest("PUT", `/api/priority-templates/${editingId}`, payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priority-templates"] });
      toast({ title: editingId == null ? "Template created" : "Template updated" });
      setDialogOpen(false);
    },
    onError: (err) => toast({
      title: editingId == null ? "Could not create template" : "Could not update template",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/priority-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priority-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err) => toast({
      title: "Could not delete template",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const visibleTemplates = useMemo(() => {
    return (templatesQuery.data ?? []).filter((t) => !t.deletedAt);
  }, [templatesQuery.data]);

  return (
    <PageLayout>
      <PageHeader
        title="Priority templates"
        subtitle="Reusable priority shapes (weekly standups, monthly reviews, recurring checklists). Anyone can instantiate a template; only priority admins or department heads can create, edit, or delete one."
      />

      {canManage && (
        <div className="flex justify-end mb-3">
          <Button size="sm" onClick={openCreate} data-testid="btn-new-template">
            <Plus className="w-4 h-4 mr-1" /> New template
          </Button>
        </div>
      )}

      {templatesQuery.isLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}

      {!templatesQuery.isLoading && visibleTemplates.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium mb-1">No templates yet</p>
            <p className="text-xs">
              Create a template for a recurring priority (e.g. "Weekly Engineering Review") so the
              team doesn't retype the title, target outcome, and definition-of-done each week.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {visibleTemplates.map((t) => (
          <Card key={t.id} data-testid={`template-card-${t.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-sm">{t.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {t.scopeDefault}
                    </span>
                    {t.departmentKey && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
                        {DEPARTMENT_OPTIONS.find((d) => d.value === t.departmentKey)?.label ?? t.departmentKey}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{t.horizonDefault} · {t.severityDefault}</span>
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mb-2">{t.description}</p>}
                  <p className="text-xs text-foreground italic">"{t.titleTemplate}"</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-muted-foreground hover:text-red-600"
                      aria-label={`Delete ${t.name}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete "${t.name}"?`,
                          description:
                            "Existing priorities created from this template are NOT affected — only future use is blocked. Deletion is soft (the row stays in the database for audit).",
                          confirmLabel: "Delete template",
                          destructive: true,
                        });
                        if (ok) deleteMutation.mutate(t.id);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId == null ? "New template" : "Edit template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Template name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekly Engineering Review" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Title (what the priority will be called) *</Label>
              <Input value={form.title_template} onChange={(e) => setForm({ ...form, title_template: e.target.value })} placeholder="e.g. Weekly Engineering Review" />
            </div>
            <div>
              <Label className="text-xs">Body / context</Label>
              <Textarea value={form.body_template} onChange={(e) => setForm({ ...form, body_template: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Default scope</Label>
                <Select value={form.scope_default} onValueChange={(v) => setForm({ ...form, scope_default: v as TemplateForm["scope_default"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {isPriorityAdminRole(user?.role) && <SelectItem value="company">Company</SelectItem>}
                    <SelectItem value="department">Department</SelectItem>
                    <SelectItem value="role">My Priorities</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Default severity</Label>
                <Select value={form.severity_default} onValueChange={(v) => setForm({ ...form, severity_default: v as TemplateForm["severity_default"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="important">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Default horizon</Label>
                <Select value={form.horizon_default} onValueChange={(v) => setForm({ ...form, horizon_default: v as TemplateForm["horizon_default"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">Week</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="quarter">Quarter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Select
                value={form.department_key || "__none__"}
                onValueChange={(v) => setForm({ ...form, department_key: v === "__none__" ? "" : v })}
                disabled={!isPriorityAdminRole(user?.role)}
              >
                <SelectTrigger><SelectValue placeholder="Any department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any department</SelectItem>
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isPriorityAdminRole(user?.role) && (
                <p className="text-[10px] text-muted-foreground mt-1">Dept heads are pinned to their own department.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Target outcome</Label>
              <Textarea value={form.target_outcome} onChange={(e) => setForm({ ...form, target_outcome: e.target.value })} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Definition of done</Label>
              <Textarea value={form.definition_of_done} onChange={(e) => setForm({ ...form, definition_of_done: e.target.value })} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Default next action</Label>
              <Input value={form.next_action} onChange={(e) => setForm({ ...form, next_action: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Suggested owner role (optional)</Label>
              <Input value={form.owner_role} onChange={(e) => setForm({ ...form, owner_role: e.target.value })} placeholder="e.g. ENGINEERING_MANAGER" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.name.trim() || !form.title_template.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : (editingId == null ? "Create template" : "Save changes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </PageLayout>
  );
}
