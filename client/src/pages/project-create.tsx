import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePermission } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Building2, CheckCircle, Loader2, Plus } from "lucide-react";

const authFetch = async (url: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...opts, headers, credentials: "include" });
};

export default function ProjectCreatePage() {
  const { allowed: canCreateProject, loading: permLoading } = usePermission("create_project", "edit");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [saving, setSaving] = useState(false);
  const [constants, setConstants] = useState<{
    projectPhases: string[];
    projectPhaseLabels: Record<string, string>;
  } | null>(null);
  const [form, setForm] = useState({
    projectName: "",
    clientId: "",
    projectCode: "",
    location: "",
    initialPhase: "P0_FIRST_ASSESSMENT",
  });
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    authFetch("/api/template-constants")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setConstants(data));
  }, []);

  const { data: clients = [], isLoading: clientsLoading } = useQuery<
    Array<{ id: number; name: string; clientId: string }>
  >({
    queryKey: ["/api/clients", "project-create"],
    queryFn: async () => {
      const response = await authFetch("/api/clients");
      if (!response.ok) throw new Error("Failed to load clients");
      return response.json();
    },
    staleTime: 60_000,
  });

  const selectedClient = clients.find((client) => String(client.id) === form.clientId) || null;

  const resetForm = () => {
    setResult(null);
    setForm({
      projectName: "",
      clientId: "",
      projectCode: "",
      location: "",
      initialPhase: "P0_FIRST_ASSESSMENT",
    });
  };

  const handleSubmit = async () => {
    if (!form.projectName.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const body = {
        ...form,
        clientId: form.clientId ? Number(form.clientId) : null,
        clientName: selectedClient?.name || null,
      };
      const response = await authFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        return;
      }

      setResult(data);
      toast({ title: "Project created successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (permLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (!canCreateProject) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        You don't have permission to create projects. Contact your admin to request access.
      </div>
    );
  }

  const phaseLabels = constants?.projectPhaseLabels || {};

  if (result) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-6" data-testid="project-create-success">
        <Card>
          <CardContent className="pt-6 space-y-4 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Project Created</h2>
            <p className="text-muted-foreground">
              <strong>{result.project?.projectName}</strong> has been created at{" "}
              <strong>{result.phaseLabel}</strong>
            </p>
            {result.clientName ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700">
                Linked client: <strong>{result.clientName}</strong>
              </div>
            ) : null}
            {result.templateApplied && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                Phase template was applied: {result.applyResult?.tasksCreated || 0} tasks,{" "}
                {result.applyResult?.deliverablesCreated || 0} deliverables created
              </div>
            )}
            {result.engStagesGenerated && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                Engineering stages generated: {result.engStagesResult?.stagesCreated || 0} stage(s),{" "}
                {result.engStagesResult?.tasksCreated || 0} engineering task(s) created
                {result.engStagesResult?.stageDetails?.length > 0 ? (
                  <span> - {result.engStagesResult.stageDetails.join(", ")}</span>
                ) : null}
              </div>
            )}
            <div className="flex gap-3 justify-center pt-4">
              <Button onClick={resetForm} data-testid="button-create-another">
                <Plus className="w-4 h-4 mr-2" /> Create Another
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/lifecycle-board")}
                data-testid="button-go-portfolio"
              >
                View Lifecycle Board
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6" data-testid="project-create-page">
      <Card>
        <CardHeader>
          <CardTitle>Create New Project</CardTitle>
          <CardDescription>
            Add a new project to the portfolio. Phase templates will be applied automatically if
            configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Project Name *</label>
            <Input
              value={form.projectName}
              onChange={(event) => setForm((current) => ({ ...current, projectName: event.target.value }))}
              placeholder="e.g. Acme Solar Park"
              data-testid="input-project-name"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium">Client</label>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-0 text-cyan-700"
                onClick={() => setLocation("/project-lifecycle/client-overview")}
              >
                <Building2 className="w-4 h-4 mr-1" />
                Create or manage clients
              </Button>
            </div>
            <SearchableSelect
              value={form.clientId}
              onValueChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
              placeholder={clientsLoading ? "Loading clients..." : "Select linked client"}
              searchPlaceholder="Search clients..."
              emptyText="No matching client. Create it in Project Lifecycle first."
              options={clients.map((client) => ({
                value: String(client.id),
                label: `${client.name} (${client.clientId})`,
              }))}
              disabled={clientsLoading}
              data-testid="select-project-client"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Project-client linkage stays authoritative through the shared client master.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Project Code</label>
              <Input
                value={form.projectCode}
                onChange={(event) => setForm((current) => ({ ...current, projectCode: event.target.value }))}
                placeholder="e.g. PRJ-042"
                data-testid="input-project-code"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Location</label>
              <Input
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="e.g. Gauteng"
                data-testid="input-location"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Initial Phase</label>
            <SearchableSelect
              value={form.initialPhase}
              onValueChange={(value) => setForm((current) => ({ ...current, initialPhase: value }))}
              data-testid="select-initial-phase"
              options={(constants?.projectPhases || ["P0_FIRST_ASSESSMENT"]).map((phase) => ({
                value: phase,
                label: phaseLabels[phase] || phase,
              }))}
            />
          </div>
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={saving || !form.projectName.trim()}
            data-testid="button-create-project"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Create Project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
