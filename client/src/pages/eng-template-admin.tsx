import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Shield,
  ListChecks,
  FileText,
  AlertTriangle,
  Users,
} from "lucide-react";

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as any || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers, credentials: "include" });
}

export default function EngTemplateAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const userRole = localStorage.getItem("company_role") || "";
  const isCoo = ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(userRole);

  const { data, isLoading } = useQuery({
    queryKey: ["eng-stage-templates"],
    queryFn: async () => {
      const res = await engFetch("/api/eng-stages/templates");
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
  });

  const templates = data?.templates || [];

  async function toggleActive(id: number, isActive: boolean) {
    try {
      const res = await engFetch(`/api/eng-stages/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast({ title: `Template ${isActive ? "deactivated" : "activated"}` });
      qc.invalidateQueries({ queryKey: ["eng-stage-templates"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  if (!isCoo) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Access restricted to COO/Admin roles.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="eng-template-admin">
      <div>
        <h1 className="text-2xl font-bold" data-testid="page-title">Engineering Stage Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the 5 engineering stage templates used across all projects.
        </p>
      </div>

      <div className="space-y-4">
        {templates.map((template: any) => (
          <TemplateCard
            key={template.id}
            template={template}
            expanded={expandedId === template.id}
            onToggleExpand={() => setExpandedId(expandedId === template.id ? null : template.id)}
            onToggleActive={() => toggleActive(template.id, template.isActive)}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ template, expanded, onToggleExpand, onToggleActive }: {
  template: any; expanded: boolean; onToggleExpand: () => void; onToggleActive: () => void;
}) {
  const { data: detail } = useQuery({
    queryKey: ["eng-stage-template-detail", template.id],
    queryFn: async () => {
      const res = await engFetch(`/api/eng-stages/templates/${template.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: expanded,
  });

  return (
    <Card className={`transition-all ${!template.isActive ? "opacity-60" : ""}`} data-testid={`template-card-${template.id}`}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={onToggleExpand}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <div>
              <CardTitle className="text-base">{template.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{template.purpose}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" /> {template.taskCount} tasks</span>
              <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {template.deliverableCount} deliverables</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs">{template.isActive ? "Active" : "Inactive"}</span>
              <Switch checked={template.isActive} onCheckedChange={onToggleActive} data-testid={`toggle-active-${template.id}`} />
            </div>
          </div>
        </div>
      </CardHeader>

      {expanded && detail && (
        <CardContent className="p-4 pt-2 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2 bg-blue-50 rounded">
              <span className="font-medium text-blue-800">Responsible:</span>
              <span className="ml-1 text-blue-600">{template.raciResponsible}</span>
            </div>
            <div className="p-2 bg-green-50 rounded">
              <span className="font-medium text-green-800">Accountable:</span>
              <span className="ml-1 text-green-600">{template.raciAccountable}</span>
            </div>
            <div className="p-2 bg-purple-50 rounded">
              <span className="font-medium text-purple-800">Consulted:</span>
              <span className="ml-1 text-purple-600">{template.raciConsulted}</span>
            </div>
            <div className="p-2 bg-muted rounded">
              <span className="font-medium text-foreground">Informed:</span>
              <span className="ml-1 text-muted-foreground">{template.raciInformed}</span>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
              <ListChecks className="h-4 w-4" /> Tasks
            </h4>
            <div className="space-y-1">
              {detail.tasks.map((task: any) => (
                <div key={task.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted/30 rounded">
                  <span className="text-muted-foreground w-5 text-right">{task.sequence}.</span>
                  <span className="flex-1">{task.title}</span>
                  {task.isRequired && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                  <span className="text-muted-foreground text-[10px]">{task.defaultOwnerRole}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
              <FileText className="h-4 w-4" /> Deliverables
            </h4>
            <div className="space-y-1">
              {detail.deliverables.map((del: any) => (
                <div key={del.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted/30 rounded">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="flex-1">{del.name}</span>
                  {del.isRequired && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                  <span className="text-muted-foreground text-[10px]">x{del.requiredCount}</span>
                </div>
              ))}
            </div>
          </div>

          {template.failureModes?.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1 text-orange-700">
                <AlertTriangle className="h-4 w-4" /> Failure Modes
              </h4>
              <ul className="list-disc list-inside text-xs text-orange-600 space-y-0.5">
                {template.failureModes.map((fm: string, i: number) => <li key={i}>{fm}</li>)}
              </ul>
            </div>
          )}

          {template.stageGateRules && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                <Shield className="h-4 w-4" /> Stage Gate Rules
              </h4>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(template.stageGateRules as Record<string, boolean>).map(([key, val]) => (
                  <Badge key={key} variant={val ? "default" : "secondary"} className="text-[10px]">
                    {key.replace(/([A-Z])/g, " $1").trim()}: {val ? "Yes" : "No"}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
