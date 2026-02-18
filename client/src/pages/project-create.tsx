import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, CheckCircle } from "lucide-react";

const authFetch = async (url: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...opts, headers, credentials: "include" });
};

export default function ProjectCreatePage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [saving, setSaving] = useState(false);
  const [constants, setConstants] = useState<{ projectPhases: string[]; projectPhaseLabels: Record<string, string> } | null>(null);
  const [form, setForm] = useState({
    projectName: "",
    clientName: "",
    projectCode: "",
    location: "",
    initialPhase: "P0_FIRST_ASSESSMENT",
  });
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    authFetch("/api/template-constants").then(r => r.ok ? r.json() : null).then(d => d && setConstants(d));
  }, []);

  const handleSubmit = async () => {
    if (!form.projectName.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/projects", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        toast({ title: "Project created successfully" });
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin access required</div>;

  const phaseLabels = constants?.projectPhaseLabels || {};

  if (result) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-6" data-testid="project-create-success">
        <Card>
          <CardContent className="pt-6 space-y-4 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Project Created</h2>
            <p className="text-muted-foreground">
              <strong>{result.project?.projectName}</strong> has been created at <strong>{result.phaseLabel}</strong>
            </p>
            {result.templateApplied && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                Phase template was applied: {result.applyResult?.tasksCreated || 0} tasks,
                {" "}{result.applyResult?.deliverablesCreated || 0} deliverables created
              </div>
            )}
            <div className="flex gap-3 justify-center pt-4">
              <Button onClick={() => { setResult(null); setForm({ projectName: "", clientName: "", projectCode: "", location: "", initialPhase: "P0_FIRST_ASSESSMENT" }); }} data-testid="button-create-another">
                <Plus className="w-4 h-4 mr-2" /> Create Another
              </Button>
              <Button variant="outline" onClick={() => setLocation("/exec-portfolio")} data-testid="button-go-portfolio">
                View Portfolio
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
          <CardDescription>Add a new project to the portfolio. Phase templates will be applied automatically if configured.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Project Name *</label>
            <Input value={form.projectName} onChange={(e) => setForm(f => ({ ...f, projectName: e.target.value }))} placeholder="e.g. Acme Solar Park" data-testid="input-project-name" />
          </div>
          <div>
            <label className="text-sm font-medium">Client Name</label>
            <Input value={form.clientName} onChange={(e) => setForm(f => ({ ...f, clientName: e.target.value }))} placeholder="e.g. Acme Corp" data-testid="input-client-name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Project Code</label>
              <Input value={form.projectCode} onChange={(e) => setForm(f => ({ ...f, projectCode: e.target.value }))} placeholder="e.g. PRJ-042" data-testid="input-project-code" />
            </div>
            <div>
              <label className="text-sm font-medium">Location</label>
              <Input value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Gauteng" data-testid="input-location" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Initial Phase</label>
            <Select value={form.initialPhase} onValueChange={(v) => setForm(f => ({ ...f, initialPhase: v }))}>
              <SelectTrigger data-testid="select-initial-phase"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(constants?.projectPhases || ["P0_FIRST_ASSESSMENT"]).map((p) => (
                  <SelectItem key={p} value={p}>{phaseLabels[p] || p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !form.projectName.trim()} data-testid="button-create-project">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Create Project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
