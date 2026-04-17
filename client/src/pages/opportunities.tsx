import { useMemo, useReducer } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageEmpty, PageError, PageSkeleton } from "@/components/ui/page-states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, CircleOff, Loader2, RefreshCw, Sun, TicketPlus, TrendingUp } from "lucide-react";
import { OPPORTUNITY_INTAKE_VIEW_ROLES } from "@shared/roles/pd-roles";

interface WorkingOpportunityRow {
  id: number;
  dealName: string;
  pipedriveDealId: string | null;
  orgClientName: string | null;
  dealOwner: string | null;
  stage: string | null;
  status: string | null;
  siteLocation: string | null;
  hasLinkedClient: boolean;
  hasLinkedProject: boolean;
  linkedProjectCount: number;
  existingEngineeringTicketCount: number;
  lastUpdated: string | null;
  signedDate?: string | null;
}

type MappingMode = "existing_existing" | "existing_new" | "new_new";

interface MappingContextResponse {
  opportunity: { id: number; dealName: string; pipedriveDealId: string | null; stage: string | null; status: string | null; clientId: number | null; clientName: string | null };
  linkedClient: { id: number; name: string | null } | null;
  linkedProject: { id: number; projectName: string; clientId: number | null } | null;
  likelyClients: Array<{ id: number; name: string; clientId: string }>;
  likelyProjects: Array<{ id: number; projectName: string; clientId: number | null }>;
  existingEngineeringTicketCount: number;
}

interface EngineeringPhaseTemplate {
  id: number;
  phase: string;
  name: string;
  version: number;
  itemCount: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function hasTerminalMarker(value: unknown): boolean {
  const v = normalized(value);
  return ["lost", "won", "closed", "signed", "contracted", "deleted"].some((m) => v.includes(m));
}

function stageBadgeClass(stage: string | null): string {
  const s = normalized(stage);
  if (s.includes("prospect")) return "bg-slate-100 text-slate-700";
  if (s.includes("qualification")) return "bg-blue-50 text-blue-700";
  if (s.includes("proposal")) return "bg-indigo-50 text-indigo-700";
  if (s.includes("negotiation")) return "bg-amber-50 text-amber-700";
  return "bg-muted text-muted-foreground";
}

function statusBadgeClass(status: string | null): string {
  const s = normalized(status);
  if (s.includes("active") || s.includes("open")) return "bg-emerald-50 text-emerald-700";
  if (s.includes("at risk")) return "bg-amber-50 text-amber-700";
  return "bg-muted text-muted-foreground";
}

interface DialogState {
  target: WorkingOpportunityRow | null;
  mappingMode: MappingMode;
  existingClientId: string;
  existingProjectId: string;
  newClientName: string;
  newProjectName: string;
  mappingWarnings: string[];
  resolvedClientId: number | null;
  resolvedProjectId: number | null;
  ticketMode: "phase_template" | "custom";
  selectedTemplateId: string;
  templateBaseDueDate: string;
  customTitle: string;
  customPhase: string;
  customDescriptionScope: string;
  customDueDate: string;
  customPriority: string;
  customRequiredOutput: string;
}

const DIALOG_INITIAL: DialogState = {
  target: null,
  mappingMode: "existing_existing",
  existingClientId: "",
  existingProjectId: "",
  newClientName: "",
  newProjectName: "",
  mappingWarnings: [],
  resolvedClientId: null,
  resolvedProjectId: null,
  ticketMode: "phase_template",
  selectedTemplateId: "",
  templateBaseDueDate: "",
  customTitle: "",
  customPhase: "",
  customDescriptionScope: "",
  customDueDate: "",
  customPriority: "Medium",
  customRequiredOutput: "",
};

export default function OpportunitiesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { allowed: canViewEntity } = usePermission("opportunities", "view");
  const [, navigate] = useLocation();

  const role = String(user?.role || "");
  const roleIsPdApproved = (OPPORTUNITY_INTAKE_VIEW_ROLES as readonly string[]).includes(role);
  const canView = canViewEntity && roleIsPdApproved;

  const [dlg, updateDlg] = useReducer(
    (prev: DialogState, action: Partial<DialogState> | "reset") =>
      action === "reset" ? DIALOG_INITIAL : { ...prev, ...action },
    DIALOG_INITIAL,
  );
  const mappingResolved = dlg.resolvedClientId != null && dlg.resolvedProjectId != null;

  const { data = [], isLoading, isError, error, refetch } = useQuery<WorkingOpportunityRow[]>({
    queryKey: ["/api/opportunities/working"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/opportunities/working");
      if (!res.ok) throw new Error(`Failed to fetch opportunities (${res.status})`);
      return res.json();
    },
    enabled: canView,
  });

  const { data: mappingContext, isLoading: mappingLoading } = useQuery<MappingContextResponse>({
    queryKey: ["/api/opportunities", dlg.target?.id, "mapping-context"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/opportunities/${dlg.target!.id}/mapping-context`);
      if (!res.ok) throw new Error(`Failed to load mapping context (${res.status})`);
      return res.json();
    },
    enabled: !!dlg.target?.id,
  });

  const { data: phaseTemplates = [] } = useQuery<EngineeringPhaseTemplate[]>({
    queryKey: ["/api/opportunities/engineering-phase-templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/opportunities/engineering-phase-templates");
      if (!res.ok) throw new Error(`Failed to load phase templates (${res.status})`);
      return res.json();
    },
    enabled: !!dlg.target?.id,
  });

  // Scope metadata for the "Pull from Pipedrive" button. The server
  // derives `scope` from the caller's role — COO/CEO/CCO get the
  // whole pipeline, everyone else only their own deals.
  const { data: pullScope } = useQuery<{
    role: string;
    scope: "all" | "owner";
    ownerEmail: string | null;
    configured: boolean;
    canPull: boolean;
    blockedReason: string | null;
  }>({
    queryKey: ["/api/pipedrive/pull/scope"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pipedrive/pull/scope");
      if (!res.ok) throw new Error(`Failed to load pipedrive pull scope (${res.status})`);
      return res.json();
    },
    enabled: canView,
    staleTime: 60_000,
  });

  const pullPipedriveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipedrive/pull");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          body?.message ||
          body?.error ||
          `Pipedrive pull failed (${res.status}).`;
        throw new Error(message);
      }
      return body as {
        dealsProcessed: number;
        dealsCreated: number;
        dealsUpdated: number;
        errors: string[];
        syncStatus: "completed" | "partial" | "failed";
        scope: "all" | "owner";
        ownerEmail: string | null;
      };
    },
    onSuccess: (result) => {
      const scopeLabel = result.scope === "all" ? "all Pipedrive deals" : "your Pipedrive deals";
      const summary = `${result.dealsProcessed} processed · ${result.dealsCreated} new · ${result.dealsUpdated} updated`;
      const variant = result.syncStatus === "completed" ? undefined : "destructive";
      toast({
        title:
          result.syncStatus === "completed"
            ? `Pulled ${scopeLabel}`
            : result.syncStatus === "partial"
              ? `Partial pull: ${scopeLabel}`
              : `Pull failed: ${scopeLabel}`,
        description:
          result.errors.length > 0
            ? `${summary}. ${result.errors.length} error${result.errors.length === 1 ? "" : "s"} — see Admin → Pipedrive for details.`
            : summary,
        variant,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities/working"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
    onError: (err: Error) => {
      toast({ title: "Pipedrive pull failed", description: err.message, variant: "destructive" });
    },
  });

  const resolveMappingMutation = useMutation({
    mutationFn: async () => {
      if (!dlg.target?.id) throw new Error("No opportunity selected");
      const body = {
        mode: dlg.mappingMode,
        existingClientId: dlg.existingClientId ? Number(dlg.existingClientId) : undefined,
        existingProjectId: dlg.existingProjectId ? Number(dlg.existingProjectId) : undefined,
        newClientName: dlg.newClientName.trim() || undefined,
        newProjectName: dlg.newProjectName.trim() || undefined,
      };
      const res = await apiRequest("POST", `/api/opportunities/${dlg.target.id}/resolve-mapping`, body);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
        updateDlg({ mappingWarnings: warnings });
        throw new Error(payload?.error || "Failed to resolve mapping");
      }
      return payload;
    },
    onSuccess: (payload: Record<string, unknown>) => {
      const client = payload?.client as { id: number } | undefined;
      const project = payload?.project as { id: number } | undefined;
      updateDlg({ resolvedClientId: client?.id ?? null, resolvedProjectId: project?.id ?? null, mappingWarnings: [] });
    },
    onError: (err: Error) => {
      toast({
        title: "Mapping failed",
        description: err?.message || "Unable to resolve opportunity mapping.",
        variant: "destructive",
      });
    },
  });

  const createEngineeringTicketsMutation = useMutation({
    mutationFn: async () => {
      if (!dlg.target?.id || !dlg.resolvedClientId || !dlg.resolvedProjectId) {
        throw new Error("Resolve client/project mapping before creating tickets.");
      }
      const body: Record<string, unknown> = {
        mode: dlg.ticketMode,
        clientId: dlg.resolvedClientId,
        projectId: dlg.resolvedProjectId,
      };
      if (dlg.ticketMode === "phase_template") {
        body.phaseTemplateId = dlg.selectedTemplateId ? Number(dlg.selectedTemplateId) : undefined;
        body.templateBaseDueDate = dlg.templateBaseDueDate || undefined;
      } else {
        body.customTicket = {
          title: dlg.customTitle.trim(),
          phase: dlg.customPhase.trim(),
          descriptionScope: dlg.customDescriptionScope.trim(),
          dueDate: dlg.customDueDate,
          priority: dlg.customPriority,
          requiredOutput: dlg.customRequiredOutput.trim(),
        };
      }
      const res = await apiRequest("POST", `/api/opportunities/${dlg.target.id}/create-engineering-tickets`, body);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to create engineering tickets");
      return payload;
    },
    onSuccess: (payload: Record<string, unknown>) => {
      const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
      if (warnings.length > 0) {
        toast({ title: "Tickets created with duplicate warnings", description: warnings.join(" "), variant: "default" });
      } else {
        toast({ title: "Engineering tickets created", description: `${payload?.createdCount || 0} ticket(s) created with traceability links.` });
      }
      updateDlg("reset");
      refetch();
    },
    onError: (err: Error) => {
      toast({
        title: "Engineering ticket creation failed",
        description: err?.message || "Unable to create engineering ticket(s).",
        variant: "destructive",
      });
    },
  });

  // Safety net: if upstream filtering drifts, never render terminal deals in
  // this active working view.
  const activeRows = useMemo(
    () => data.filter((row) => !hasTerminalMarker(row.status) && !hasTerminalMarker(row.stage) && !row.signedDate),
    [data],
  );

  const clientOptions = useMemo(() => {
    const base = mappingContext?.likelyClients || [];
    if (mappingContext?.linkedClient && !base.some((c) => c.id === mappingContext.linkedClient!.id)) {
      return [{ id: mappingContext.linkedClient.id, name: mappingContext.linkedClient.name || "Linked client", clientId: "" }, ...base];
    }
    return base;
  }, [mappingContext]);

  const projectOptions = useMemo(() => {
    const base = mappingContext?.likelyProjects || [];
    if (mappingContext?.linkedProject && !base.some((p) => p.id === mappingContext.linkedProject!.id)) {
      return [{ id: mappingContext.linkedProject.id, projectName: mappingContext.linkedProject.projectName, clientId: mappingContext.linkedProject.clientId }, ...base];
    }
    return base;
  }, [mappingContext]);

  function openMapping(row: WorkingOpportunityRow) {
    updateDlg({
      ...DIALOG_INITIAL,
      target: row,
      newClientName: row.orgClientName || "",
      newProjectName: row.dealName || "",
      templateBaseDueDate: new Date().toISOString().slice(0, 10),
      customTitle: row.dealName || "",
      customPhase: "First Assessment",
    });
  }

  if (!canView) {
    return (
      <PageShell className="p-4 md:p-6">
        <PageError
          title="Access restricted"
          message="This active Opportunities working view is limited to Project Development approved roles."
        />
      </PageShell>
    );
  }

  if (isLoading) return <PageSkeleton lines={6} />;

  if (isError) {
    return (
      <PageShell className="p-4 md:p-6">
        <PageError
          title="Unable to load active opportunities"
          message={error instanceof Error ? error.message : "Failed to fetch active opportunities."}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-opportunities-working">
      <SectionHeader
        icon={<TrendingUp className="h-5 w-5" />}
        eyebrow="Project Development"
        title="Opportunities (Active Working List)"
        description="Only active Pipedrive opportunities are shown here. Lost, won/signed/closed, and converted deals are excluded."
        actions={
          pullScope ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={
                !pullScope.configured ||
                !pullScope.canPull ||
                pullPipedriveMutation.isPending
              }
              onClick={() => pullPipedriveMutation.mutate()}
              title={
                !pullScope.configured
                  ? "Pipedrive is not configured. Ask an admin to set PIPEDRIVE_API_TOKEN."
                  : pullScope.blockedReason ??
                    (pullScope.scope === "all"
                      ? "Pulls every deal from Pipedrive. Existing opportunities are updated in place — no duplicates."
                      : `Pulls only deals owned by ${pullScope.ownerEmail ?? "you"} in Pipedrive. Existing opportunities are updated in place.`)
              }
              data-testid="btn-pull-from-pipedrive"
            >
              {pullPipedriveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {pullScope.scope === "all" ? "Pull all from Pipedrive" : "Pull my Pipedrive deals"}
            </Button>
          ) : null
        }
      />

      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="p-3 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
          <div>
            <p className="font-medium text-emerald-800">Active-only engineering intake list</p>
            <p className="text-emerald-700">{activeRows.length} active opportunity row{activeRows.length === 1 ? "" : "s"} ready for next-step action scaffolding.</p>
          </div>
        </CardContent>
      </Card>

      {activeRows.length === 0 ? (
        <PageEmpty
          icon={Sun}
          title="No active opportunities"
          description="No active Pipedrive opportunities currently qualify for this working list."
        />
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm" data-testid="table-opportunities-working">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Deal</th>
                <th className="text-left px-3 py-2">Stage</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Project</th>
                <th className="text-left px-3 py-2">Eng tickets</th>
                <th className="text-left px-3 py-2">Updated</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => (
                <tr key={row.id} className="border-t hover:bg-muted/20" data-testid={`opportunity-row-${row.id}`}>
                  <td className="px-3 py-2 align-top min-w-[260px]">
                    <p className="font-medium text-foreground">{row.dealName || `Deal #${row.id}`}</p>
                    <p className="text-xs text-muted-foreground">PD #{row.pipedriveDealId || "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{row.orgClientName || "Unknown org"}{row.dealOwner ? ` • Owner: ${row.dealOwner}` : ""}</p>
                    {row.siteLocation ? <p className="text-xs text-muted-foreground">{row.siteLocation}</p> : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge className={`text-[10px] ${stageBadgeClass(row.stage)}`}>{row.stage || "—"}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge className={`text-[10px] ${statusBadgeClass(row.status)}`}>{row.status || "—"}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {row.hasLinkedClient ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Linked</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Unlinked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {row.hasLinkedProject ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {row.linkedProjectCount} linked</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-600"><CircleOff className="h-3.5 w-3.5" /> None</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge variant="outline">{row.existingEngineeringTicketCount || 0}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                    {row.lastUpdated ? new Date(row.lastUpdated).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      data-testid={`btn-create-engineering-ticket-${row.id}`}
                      onClick={() => openMapping(row)}
                    >
                      <TicketPlus className="h-3.5 w-3.5" />
                      Create Engineering Ticket
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!dlg.target} onOpenChange={(open) => { if (!open) updateDlg("reset"); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Engineering Ticket — Mapping</DialogTitle>
            <DialogDescription>
              Project Developer is the mapping authority. Choose how this opportunity maps to client/project before ticket creation.
            </DialogDescription>
          </DialogHeader>

          {mappingLoading ? (
            <div className="text-sm text-muted-foreground">Loading mapping context…</div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                <p>Deal: <span className="font-medium text-foreground">{mappingContext?.opportunity?.dealName || dlg.target?.dealName}</span></p>
                <p>Linked client: {mappingContext?.linkedClient ? "Yes" : "No"} • Linked project: {mappingContext?.linkedProject ? "Yes" : "No"}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Mapping mode</Label>
                <div className="grid gap-1 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" checked={dlg.mappingMode === "existing_existing"} onChange={() => updateDlg({ mappingMode: "existing_existing" })} /> Existing client + existing project</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={dlg.mappingMode === "existing_new"} onChange={() => updateDlg({ mappingMode: "existing_new" })} /> Existing client + create new project shell</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={dlg.mappingMode === "new_new"} onChange={() => updateDlg({ mappingMode: "new_new" })} /> Create new client + new project shell</label>
                </div>
              </div>

              {dlg.mappingMode !== "new_new" && (
                <div className="space-y-1">
                  <Label className="text-xs">Client</Label>
                  <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.existingClientId} onChange={(e) => updateDlg({ existingClientId: e.target.value })}>
                    <option value="">Select client…</option>
                    {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {dlg.mappingMode === "existing_existing" && (
                <div className="space-y-1">
                  <Label className="text-xs">Project</Label>
                  <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.existingProjectId} onChange={(e) => updateDlg({ existingProjectId: e.target.value })}>
                    <option value="">Select project…</option>
                    {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
                  </select>
                </div>
              )}

              {dlg.mappingMode === "existing_new" && (
                <div className="space-y-1">
                  <Label className="text-xs">New project shell name</Label>
                  <Input value={dlg.newProjectName} onChange={(e) => updateDlg({ newProjectName: e.target.value })} placeholder="Enter project shell name" />
                </div>
              )}

              {dlg.mappingMode === "new_new" && (
                <div className="grid gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">New client name</Label>
                    <Input value={dlg.newClientName} onChange={(e) => updateDlg({ newClientName: e.target.value })} placeholder="Enter client name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">New project shell name</Label>
                    <Input value={dlg.newProjectName} onChange={(e) => updateDlg({ newProjectName: e.target.value })} placeholder="Enter project shell name" />
                  </div>
                </div>
              )}

              {dlg.mappingWarnings.length > 0 && (
                <div className="text-xs rounded border border-amber-300 bg-amber-50 p-2 text-amber-800">
                  {dlg.mappingWarnings.map((w, i) => <p key={i}>• {w}</p>)}
                </div>
              )}

              {mappingResolved && (
                <div className="space-y-3 border-t pt-3">
                  <div className="text-xs text-muted-foreground">
                    Mapping resolved • client #{dlg.resolvedClientId} • project #{dlg.resolvedProjectId}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Ticket creation mode</Label>
                    <div className="grid gap-1 text-sm">
                      <label className="flex items-center gap-2"><input type="radio" checked={dlg.ticketMode === "phase_template"} onChange={() => updateDlg({ ticketMode: "phase_template" })} /> Phase template</label>
                      <label className="flex items-center gap-2"><input type="radio" checked={dlg.ticketMode === "custom"} onChange={() => updateDlg({ ticketMode: "custom" })} /> Custom ticket</label>
                    </div>
                  </div>

                  {dlg.ticketMode === "phase_template" ? (
                    <div className="grid gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Predefined phase template</Label>
                        <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.selectedTemplateId} onChange={(e) => updateDlg({ selectedTemplateId: e.target.value })}>
                          <option value="">Select template…</option>
                          {phaseTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.phase} • {t.name} (v{t.version}, {t.itemCount} item{t.itemCount === 1 ? "" : "s"})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Template base due date</Label>
                        <Input type="date" value={dlg.templateBaseDueDate} onChange={(e) => updateDlg({ templateBaseDueDate: e.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Title</Label>
                        <Input value={dlg.customTitle} onChange={(e) => updateDlg({ customTitle: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Phase</Label>
                        <Input value={dlg.customPhase} onChange={(e) => updateDlg({ customPhase: e.target.value })} placeholder="e.g. First Assessment" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description / Scope</Label>
                        <Input value={dlg.customDescriptionScope} onChange={(e) => updateDlg({ customDescriptionScope: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Due date</Label>
                          <Input type="date" value={dlg.customDueDate} onChange={(e) => updateDlg({ customDueDate: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Priority</Label>
                          <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.customPriority} onChange={(e) => updateDlg({ customPriority: e.target.value })}>
                            {["Critical", "High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Required output</Label>
                        <Input value={dlg.customRequiredOutput} onChange={(e) => updateDlg({ customRequiredOutput: e.target.value })} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => updateDlg("reset")}>Cancel</Button>
            {!mappingResolved ? (
              <Button onClick={() => resolveMappingMutation.mutate()} disabled={resolveMappingMutation.isPending || mappingLoading}>
                {resolveMappingMutation.isPending ? "Resolving…" : "Resolve Mapping"}
              </Button>
            ) : (
              <Button onClick={() => createEngineeringTicketsMutation.mutate()} disabled={createEngineeringTicketsMutation.isPending}>
                {createEngineeringTicketsMutation.isPending ? "Creating…" : dlg.ticketMode === "phase_template" ? "Generate Template Ticket(s)" : "Create Custom Ticket"}
              </Button>
            )}
            {mappingResolved && (
              <Button
                variant="secondary"
                onClick={() => {
                  const q = new URLSearchParams({
                    opportunityId: String(dlg.target!.id),
                    clientId: String(dlg.resolvedClientId),
                    projectId: String(dlg.resolvedProjectId),
                  });
                  navigate(`/pd/tickets/create?${q.toString()}`);
                }}
              >
                Open full manual form
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
