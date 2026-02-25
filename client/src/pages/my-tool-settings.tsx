import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation, useSearch } from "wouter";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import {
  Settings,
  Loader2,
  Save,
  Mail,
  AlertCircle,
  CheckCircle2,
  Target,
  Plus,
  Trash2,
  X,
  Clock,
  Keyboard,
  RefreshCw,
} from "lucide-react";

interface UserPreferences {
  defaultView: "today" | "week" | "backlog";
  workdayStartTime: string;
  workdayEndTime: string;
  showCompanyPriorities: boolean;
}

interface OutlookConnection {
  configured: boolean;
  connected: boolean;
  email?: string;
  connectedAt?: string;
  lastSyncAt?: string;
}

interface DodTemplate {
  id: number;
  name: string;
  department: string | null;
  content: string;
  createdAt: string;
}

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
];

function parseTime(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export default function MyToolSettingsPage() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [validationError, setValidationError] = useState<string | null>(null);

  const [form, setForm] = useState<UserPreferences>({
    defaultView: "today",
    workdayStartTime: "08:00",
    workdayEndTime: "17:00",
    showCompanyPriorities: true,
  });

  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: "", department: "", content: "" });

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/mytool/preferences"],
  });

  const { data: outlookStatus, refetch: refetchOutlook } = useQuery<OutlookConnection>({
    queryKey: ["/api/outlook/status"],
    retry: false,
  });

  const [refreshingOutlook, setRefreshingOutlook] = useState(false);
  const handleRefreshOutlook = async () => {
    setRefreshingOutlook(true);
    try {
      const res = await apiRequest("POST", "/api/outlook/refresh");
      const result = await res.json();
      queryClient.setQueryData(["/api/outlook/status"], result);
      if (result.connected) {
        toast({ title: "Outlook reconnected", description: result.email ? `Connected as ${result.email}` : "Connection restored successfully." });
      } else {
        toast({ title: "Still disconnected", description: "The Outlook connection could not be restored. The token may have expired and needs re-authorization from the platform.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setRefreshingOutlook(false);
      refetchOutlook();
    }
  };

  const { data: dodTemplates = [], isLoading: templatesLoading } = useQuery<DodTemplate[]>({
    queryKey: ["/api/mytool/dod-templates"],
  });

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("outlook_error")) {
      const err = params.get("outlook_error");
      const messages: Record<string, string> = {
        connect_failed: "Could not connect to Outlook. Please try again.",
        auth_denied: "Outlook authorisation was cancelled or denied.",
        callback_failed: "Something went wrong during Outlook sign-in.",
      };
      toast({ title: "Outlook error", description: messages[err!] || "An error occurred.", variant: "destructive" });
      setLocation("/my-tool/settings", { replace: true });
    }
  }, [searchString]);

  useEffect(() => {
    if (preferences) setForm(preferences);
  }, [preferences]);

  useEffect(() => {
    const start = parseTime(form.workdayStartTime);
    const end = parseTime(form.workdayEndTime);
    if (start !== null && end !== null && end <= start) {
      setValidationError("End time must be later than start time.");
    } else if (form.workdayStartTime && parseTime(form.workdayStartTime) === null) {
      setValidationError("Start time must be in HH:MM format (e.g. 08:00).");
    } else if (form.workdayEndTime && parseTime(form.workdayEndTime) === null) {
      setValidationError("End time must be in HH:MM format (e.g. 17:00).");
    } else {
      setValidationError(null);
    }
  }, [form.workdayStartTime, form.workdayEndTime]);

  const saveMutation = useMutation({
    mutationFn: async (body: UserPreferences) => {
      await apiRequest("PUT", "/api/mytool/preferences", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/preferences"] });
      toast({ title: "Settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (body: { name: string; department: string | null; content: string }) => {
      await apiRequest("POST", "/api/mytool/dod-templates", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/dod-templates"] });
      setAddTemplateOpen(false);
      setNewTemplate({ name: "", department: "", content: "" });
      toast({ title: "Template created" });
    },
    onError: () => {
      toast({ title: "Failed to create template", variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/dod-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/dod-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete template", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (validationError) {
      toast({ title: "Validation error", description: validationError, variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <MyToolLayout>
        <div className="max-w-2xl space-y-6" data-testid="mytool-settings-skeleton">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-10 w-64" />
            </div>
          ))}
        </div>
      </MyToolLayout>
    );
  }

  return (
    <MyToolLayout>
      <div className="max-w-2xl space-y-8" data-testid="mytool-settings-page">
        {/* Preferences */}
        <section data-testid="section-preferences">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Preferences</h2>
          </div>

          <div className="space-y-5 pl-6">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Default View</Label>
              <Select
                value={form.defaultView}
                onValueChange={(val) => setForm({ ...form, defaultView: val as UserPreferences["defaultView"] })}
              >
                <SelectTrigger className="w-48 h-8 text-sm" data-testid="select-default-view">
                  <SelectValue placeholder="Select default view" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="backlog">Backlog</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Workday Start
                </Label>
                <Input
                  type="time"
                  value={form.workdayStartTime}
                  onChange={(e) => setForm({ ...form, workdayStartTime: e.target.value })}
                  className="h-8 text-sm w-32"
                  data-testid="input-workday-start"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Workday End
                </Label>
                <Input
                  type="time"
                  value={form.workdayEndTime}
                  onChange={(e) => setForm({ ...form, workdayEndTime: e.target.value })}
                  className="h-8 text-sm w-32"
                  data-testid="input-workday-end"
                />
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 text-xs text-red-500" data-testid="text-validation-error">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {validationError}
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <Switch
                checked={form.showCompanyPriorities}
                onCheckedChange={(checked) => setForm({ ...form, showCompanyPriorities: checked })}
                data-testid="switch-show-priorities"
              />
              <span className="text-sm">Show company priorities</span>
            </label>

            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !!validationError}
              size="sm" className="h-8"
              data-testid="button-save-preferences"
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save Preferences
            </Button>
          </div>
        </section>

        <Separator />

        {/* DoD Templates */}
        <section data-testid="section-dod-templates">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Definition of Done Templates</h2>
              <Badge variant="secondary" className="text-[10px] h-4 px-1">{dodTemplates.length}</Badge>
            </div>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => setAddTemplateOpen(!addTemplateOpen)}
              data-testid="button-add-dod-template"
            >
              {addTemplateOpen ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              {addTemplateOpen ? "Cancel" : "Add Template"}
            </Button>
          </div>

          <div className="space-y-3 pl-6">
            <p className="text-xs text-muted-foreground">
              Templates appear as quick-fill buttons when editing a task's Definition of Done.
            </p>

            {addTemplateOpen && (
              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3" data-testid="form-add-dod-template">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Template Name</Label>
                    <Input
                      placeholder="e.g. Standard Delivery"
                      value={newTemplate.name}
                      onChange={(e) => setNewTemplate(t => ({ ...t, name: e.target.value }))}
                      className="h-8 text-sm"
                      data-testid="input-template-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Department (optional)</Label>
                    <Select value={newTemplate.department || "__none__"} onValueChange={(v) => setNewTemplate(t => ({ ...t, department: v === "__none__" ? "" : v }))}>
                      <SelectTrigger className="h-8 text-sm" data-testid="select-template-department">
                        <SelectValue placeholder="Any" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Any</SelectItem>
                        {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Template Content</Label>
                  <Textarea
                    placeholder="e.g. Deliverables submitted, client sign-off received, handover notes completed"
                    value={newTemplate.content}
                    onChange={(e) => setNewTemplate(t => ({ ...t, content: e.target.value }))}
                    className="text-sm min-h-[60px]"
                    data-testid="textarea-template-content"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm" className="h-7 text-xs"
                    onClick={() => createTemplateMutation.mutate({
                      name: newTemplate.name.trim(),
                      department: newTemplate.department || null,
                      content: newTemplate.content.trim(),
                    })}
                    disabled={!newTemplate.name.trim() || !newTemplate.content.trim() || createTemplateMutation.isPending}
                    data-testid="button-save-dod-template"
                  >
                    {createTemplateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                    Create Template
                  </Button>
                </div>
              </div>
            )}

            {templatesLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : dodTemplates.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border rounded-lg" data-testid="empty-dod-templates">
                <Target className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No DoD templates yet.</p>
                <p className="text-[10px] text-muted-foreground mt-1">Create templates to speed up task completion.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dodTemplates.map(template => (
                  <div
                    key={template.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/50 hover:border-border transition-colors group"
                    data-testid={`dod-template-${template.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{template.name}</span>
                        {template.department && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{template.department}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{template.content}</p>
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => deleteTemplateMutation.mutate(template.id)}
                      data-testid={`button-delete-template-${template.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <Separator />

        {/* Outlook Integration */}
        <section data-testid="section-outlook">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Outlook Integration</h2>
          </div>

          <div className="space-y-3 pl-6">
            <p className="text-xs text-muted-foreground">
              Your Microsoft Outlook account is managed through the platform connection.
              Calendar events, time block sync, and approval emails use this connection.
            </p>

            {outlookStatus?.connected ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-900/30" data-testid="outlook-connected">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Connected</span>
                {outlookStatus.email && (
                  <Badge variant="secondary" className="text-xs">{outlookStatus.email}</Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs"
                  onClick={handleRefreshOutlook}
                  disabled={refreshingOutlook}
                  data-testid="button-refresh-outlook"
                >
                  {refreshingOutlook ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="ml-1">Refresh</span>
                </Button>
              </div>
            ) : outlookStatus?.configured === false ? (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30" data-testid="outlook-not-configured">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-sm text-amber-600 dark:text-amber-400">Not configured</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The Outlook connector has not been set up yet. Please ask your administrator to configure it.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30" data-testid="outlook-issue">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-sm text-amber-600 dark:text-amber-400">Connection issue</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The connection may need to be refreshed. Click the button to try reconnecting.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-7 px-3 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={handleRefreshOutlook}
                  disabled={refreshingOutlook}
                  data-testid="button-reconnect-outlook"
                >
                  {refreshingOutlook ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Reconnect
                </Button>
              </div>
            )}
          </div>
        </section>

        <Separator />

        {/* Keyboard Shortcuts */}
        <section data-testid="section-shortcuts">
          <div className="flex items-center gap-2 mb-4">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Keyboard Shortcuts</h2>
          </div>

          <div className="pl-6 space-y-2">
            {[
              { keys: "⌘K", description: "Quick add task" },
              { keys: "⌘⏎", description: "Save in drawer" },
              { keys: "Esc", description: "Close drawer / cancel" },
            ].map(shortcut => (
              <div key={shortcut.keys} className="flex items-center gap-3">
                <kbd className="inline-flex items-center px-2 py-0.5 rounded border border-border bg-muted text-[11px] font-mono text-muted-foreground min-w-[40px] justify-center">
                  {shortcut.keys}
                </kbd>
                <span className="text-sm text-foreground">{shortcut.description}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-3">
              In Quick Add: type P1, P2, P3 for priority · #dept for department · "tomorrow" to schedule
            </p>
          </div>
        </section>
      </div>
    </MyToolLayout>
  );
}
