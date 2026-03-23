import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Loader2,
  Save,
  Settings,
  Plus,
  Pencil,
  Trash2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

type Horizon = "today" | "week" | "month" | "quarter";
type Severity = "critical" | "important" | "normal";
type PriorityStatus = "active" | "monitoring" | "closed";

interface FeatureSettings {
  enabled: boolean;
  allowedRoles: string;
  defaultPriorityHorizon: Horizon;
}

interface CompanyPriority {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  horizon: Horizon;
  linkedProjectName: string | null;
  ownerRole: string | null;
  status: PriorityStatus;
}

interface PriorityFormData {
  title: string;
  description: string;
  severity: Severity;
  horizon: Horizon;
  linkedProjectName: string;
  ownerRole: string;
}

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  important: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  normal: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
};

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  monitoring: "bg-yellow-100 text-yellow-700",
  closed: "bg-muted text-muted-foreground",
};

const emptyPriorityForm: PriorityFormData = {
  title: "",
  description: "",
  severity: "normal",
  horizon: "week",
  linkedProjectName: "",
  ownerRole: "",
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityColors[severity] || severityColors.normal;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border} border`}
      data-testid={`badge-severity-${severity}`}
    >
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusColors[status] || statusColors.active}`}
      data-testid={`badge-status-${status}`}
    >
      {status}
    </span>
  );
}

function HorizonBadge({ horizon }: { horizon: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200"
      data-testid={`badge-horizon-${horizon}`}
    >
      {horizon}
    </span>
  );
}

export default function MyToolAdminSettingsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [settingsForm, setSettingsForm] = useState<FeatureSettings>({
    enabled: true,
    allowedRoles: "admin",
    defaultPriorityHorizon: "week",
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<PriorityFormData>({ ...emptyPriorityForm });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<PriorityFormData>({ ...emptyPriorityForm });

  const { data: settings, isLoading: settingsLoading } = useQuery<FeatureSettings>({
    queryKey: ["/api/mytool/settings"],
  });

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  useEffect(() => {
    if (settings) {
      setSettingsForm(settings);
    }
  }, [settings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (body: FeatureSettings) => {
      await apiRequest("PUT", "/api/mytool/settings", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/settings"] });
      toast({ title: "Settings saved", description: "Feature settings have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const createPriorityMutation = useMutation({
    mutationFn: async (body: PriorityFormData) => {
      await apiRequest("POST", "/api/mytool/company-priorities", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      setShowAddForm(false);
      setAddForm({ ...emptyPriorityForm });
      toast({ title: "Priority created", description: "New company priority has been added." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create priority.", variant: "destructive" });
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, ...body }: PriorityFormData & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      setEditingId(null);
      toast({ title: "Priority updated", description: "Company priority has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update priority.", variant: "destructive" });
    },
  });

  const closePriorityMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, { status: "closed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      toast({ title: "Priority closed", description: "Priority has been marked as closed." });
    },
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/company-priorities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      toast({ title: "Priority deleted", description: "Company priority has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete priority.", variant: "destructive" });
    },
  });

  const startEdit = (p: CompanyPriority) => {
    setEditingId(p.id);
    setEditForm({
      title: p.title,
      description: p.description,
      severity: p.severity,
      horizon: p.horizon,
      linkedProjectName: p.linkedProjectName || "",
      ownerRole: p.ownerRole || "",
    });
  };

  const handleSaveEdit = (id: number) => {
    updatePriorityMutation.mutate({ id, ...editForm });
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You do not have admin privileges to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = settingsLoading || prioritiesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto" data-testid="mytool-admin-settings-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">
          My Work — Administration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage global settings and company priorities</p>
      </header>

      <Card data-testid="card-feature-settings">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Feature Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Switch
              id="mytool-enabled"
              checked={settingsForm.enabled}
              onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, enabled: checked })}
              data-testid="switch-enabled"
            />
            <Label htmlFor="mytool-enabled" data-testid="label-enabled">
              Enable My Work for the organization
            </Label>
          </div>

          <div className="space-y-2 max-w-md">
            <Label htmlFor="allowed-roles" data-testid="label-allowed-roles">Allowed Roles</Label>
            <Input
              id="allowed-roles"
              type="text"
              placeholder="admin,member"
              value={settingsForm.allowedRoles}
              onChange={(e) => setSettingsForm({ ...settingsForm, allowedRoles: e.target.value })}
              data-testid="input-allowed-roles"
            />
            <p className="text-xs text-muted-foreground">Comma-separated list of roles that can access My Work</p>
          </div>

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="default-horizon" data-testid="label-default-horizon">Default Priority Horizon (Today page)</Label>
            <SearchableSelect
              value={settingsForm.defaultPriorityHorizon}
              onValueChange={(val) => setSettingsForm({ ...settingsForm, defaultPriorityHorizon: val as Horizon })}
              placeholder="Select horizon"
              options={[
                { value: "today", label: "Today" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "quarter", label: "Quarter" },
              ]}
              data-testid="select-default-horizon"
            />
          </div>

          <div className="pt-2">
            <Button
              onClick={() => saveSettingsMutation.mutate(settingsForm)}
              disabled={saveSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-company-priorities">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4 text-violet-600" />
              Company Priorities
              <Badge variant="secondary" className="text-xs" data-testid="badge-priorities-count">
                {priorities.length}
              </Badge>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAddForm(!showAddForm);
                setAddForm({ ...emptyPriorityForm });
              }}
              data-testid="button-add-priority"
            >
              {showAddForm ? <XCircle className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              {showAddForm ? "Cancel" : "Add Priority"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddForm && (
            <PriorityForm
              form={addForm}
              setForm={setAddForm}
              onSave={() => createPriorityMutation.mutate(addForm)}
              onCancel={() => setShowAddForm(false)}
              saving={createPriorityMutation.isPending}
              testIdPrefix="add"
            />
          )}

          {priorities.length === 0 && !showAddForm ? (
            <p className="text-sm text-gray-400 py-6 text-center" data-testid="empty-priorities">
              No company priorities defined. Click "Add Priority" to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {priorities.map((p) => (
                <div key={p.id}>
                  {editingId === p.id ? (
                    <PriorityForm
                      form={editForm}
                      setForm={setEditForm}
                      onSave={() => handleSaveEdit(p.id)}
                      onCancel={() => setEditingId(null)}
                      saving={updatePriorityMutation.isPending}
                      testIdPrefix={`edit-${p.id}`}
                    />
                  ) : (
                    <div
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted  transition-colors"
                      data-testid={`priority-row-${p.id}`}
                    >
                      <SeverityBadge severity={p.severity} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground" data-testid={`text-priority-title-${p.id}`}>
                          {p.title}
                        </span>
                        {p.description && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-priority-desc-${p.id}`}>
                            {p.description}
                          </p>
                        )}
                      </div>
                      <HorizonBadge horizon={p.horizon} />
                      {p.linkedProjectName && (
                        <span className="text-xs text-blue-600 shrink-0" data-testid={`text-priority-project-${p.id}`}>
                          {p.linkedProjectName}
                        </span>
                      )}
                      <StatusBadge status={p.status} />
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => startEdit(p)}
                          title="Edit"
                          data-testid={`button-edit-priority-${p.id}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {p.status !== "closed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-yellow-600 hover:text-yellow-700"
                            onClick={() => closePriorityMutation.mutate(p.id)}
                            disabled={closePriorityMutation.isPending}
                            title="Close"
                            data-testid={`button-close-priority-${p.id}`}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                          onClick={() => deletePriorityMutation.mutate(p.id)}
                          disabled={deletePriorityMutation.isPending}
                          title="Delete"
                          data-testid={`button-delete-priority-${p.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PriorityForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  testIdPrefix,
}: {
  form: PriorityFormData;
  setForm: (f: PriorityFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  testIdPrefix: string;
}) {
  return (
    <div className="p-4 rounded-lg border border-blue-200 bg-blue-50/30 space-y-3" data-testid={`form-priority-${testIdPrefix}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label data-testid={`label-${testIdPrefix}-title`}>Title</Label>
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Priority title"
            data-testid={`input-${testIdPrefix}-title`}
          />
        </div>
        <div className="space-y-1">
          <Label data-testid={`label-${testIdPrefix}-description`}>Description</Label>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Brief description"
            data-testid={`input-${testIdPrefix}-description`}
          />
        </div>
        <div className="space-y-1">
          <Label data-testid={`label-${testIdPrefix}-severity`}>Severity</Label>
          <SearchableSelect
            value={form.severity}
            onValueChange={(val) => setForm({ ...form, severity: val as Severity })}
            options={[
              { value: "critical", label: "Critical" },
              { value: "important", label: "Important" },
              { value: "normal", label: "Normal" },
            ]}
            data-testid={`select-${testIdPrefix}-severity`}
          />
        </div>
        <div className="space-y-1">
          <Label data-testid={`label-${testIdPrefix}-horizon`}>Horizon</Label>
          <SearchableSelect
            value={form.horizon}
            onValueChange={(val) => setForm({ ...form, horizon: val as Horizon })}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
            ]}
            data-testid={`select-${testIdPrefix}-horizon`}
          />
        </div>
        <div className="space-y-1">
          <Label data-testid={`label-${testIdPrefix}-project`}>Linked Project Name</Label>
          <Input
            value={form.linkedProjectName}
            onChange={(e) => setForm({ ...form, linkedProjectName: e.target.value })}
            placeholder="Project name (optional)"
            data-testid={`input-${testIdPrefix}-project`}
          />
        </div>
        <div className="space-y-1">
          <Label data-testid={`label-${testIdPrefix}-owner`}>Owner Role</Label>
          <Input
            value={form.ownerRole}
            onChange={(e) => setForm({ ...form, ownerRole: e.target.value })}
            placeholder="e.g. admin"
            data-testid={`input-${testIdPrefix}-owner`}
          />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !form.title.trim()}
          data-testid={`button-save-${testIdPrefix}`}
        >
          {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid={`button-cancel-${testIdPrefix}`}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
