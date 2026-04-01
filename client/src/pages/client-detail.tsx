import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  Search, Plus, Building2, ArrowLeft, Link2, Unlink,
  ChevronsUpDown, Check, User, Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

interface Client {
  id: number;
  clientId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectSummary {
  project_info_id: number;
  project_name: string;
  client_id: number | null;
  phase: string | null;
  size_kwp: number | null;
  pd: string | null;
  pm: string | null;
  rag_status: string | null;
  project_pct_complete: number | null;
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-muted", text: "text-foreground", border: "border-border" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-300" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-300" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-300" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-100", text: "text-teal-700", border: "border-teal-300" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
};

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}

function RagDot({ status }: { status: string | null }) {
  const color = status === "green" ? "bg-emerald-500"
    : status === "amber" ? "bg-amber-500"
    : status === "red" ? "bg-red-500"
    : "bg-gray-300";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

export default function ClientDetailPage() {
  const [, params] = useRoute("/clients/:clientId");
  const clientId = params?.clientId ? Number(params.clientId) : null;
  const [search, setSearch] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: clients = [], isLoading: clientsLoading, isError, error, refetch } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => qFetch("/api/pd/clients"),
  });

  const client = clients.find(c => c.id === clientId);

  const { data: allProjects = [], isLoading: projectsLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["projects-summary-for-client-detail"],
    queryFn: () => qFetch("/api/projects-summary"),
  });

  const clientProjects = useMemo(() => {
    if (!clientId) return [];
    let projects = allProjects.filter(p => p.client_id === clientId);
    if (search) {
      const q = search.toLowerCase();
      projects = projects.filter(p => p.project_name.toLowerCase().includes(q));
    }
    return projects;
  }, [clientId, allProjects, search]);

  const unassignedProjects = useMemo(() => {
    return allProjects
      .filter(p => p.client_id === null)
      .sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [allProjects]);

  const assignProjectMutation = useMutation({
    mutationFn: ({ projectInfoId, clientId: cid }: { projectInfoId: number; clientId: number | null }) =>
      qFetch(`/api/project-info/${projectInfoId}`, {
        method: "PATCH",
        body: JSON.stringify({ clientId: cid }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clients-project-counts"] });
      queryClient.invalidateQueries({ queryKey: ["projects-summary-for-client-detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setAssignOpen(false);
      setSelectedProjectId("");
      toast({ title: "Project assigned successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleAssignProject = () => {
    if (!selectedProjectId || !clientId) return;
    assignProjectMutation.mutate({ projectInfoId: Number(selectedProjectId), clientId });
  };

  const handleUnassignProject = (projectInfoId: number) => {
    assignProjectMutation.mutate({ projectInfoId, clientId: null });
  };

  const isLoading = clientsLoading || projectsLoading;

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4 md:p-6"><PageError title="Unable to load client" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;
  if (!client) return <PageShell className="p-4 md:p-6"><PageError title="Client not found" message="The requested client does not exist." onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell className="max-w-6xl p-4 md:p-6" data-testid="client-detail-page">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/clients" className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Clients
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{client.name}</span>
      </div>

      <SectionHeader
        icon={<Building2 className="h-5 w-5" />}
        title={client.name}
        eyebrow="Client Detail"
        description={`Client ID: ${client.clientId} · Created ${client.createdAt ? format(new Date(client.createdAt), "dd MMM yyyy") : "—"}`}
        badges={[
          { label: `${clientProjects.length} project${clientProjects.length === 1 ? "" : "s"}`, variant: "outline" },
        ]}
        actions={(
          <Button
            onClick={() => setAssignOpen(true)}
            size="sm"
            className="gap-2"
            data-testid="button-assign-project"
          >
            <Plus className="w-4 h-4" />
            Assign Project
          </Button>
        )}
      />

      {/* Search filter */}
      {clientProjects.length > 3 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Project card grid */}
      {clientProjects.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No projects linked to this client yet.</p>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setAssignOpen(true)}>
            <Link2 className="h-3.5 w-3.5" />
            Assign a Project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clientProjects.map((project) => {
            const phaseColors = project.phase ? PHASE_COLORS[project.phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT : PHASE_COLORS.P0_FIRST_ASSESSMENT;
            const completionPct = project.project_pct_complete != null ? Math.round(project.project_pct_complete * 100) : null;

            return (
              <Link
                key={project.project_info_id}
                href={`/clients/${clientId}/project/${project.project_info_id}`}
                className="block group"
              >
                <Card className="transition-all hover:shadow-md hover:border-primary/30 cursor-pointer h-full" data-testid={`project-card-${project.project_info_id}`}>
                  <CardContent className="p-4 space-y-3">
                    {/* Project name and phase */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm group-hover:text-primary transition-colors leading-tight">
                        {project.project_name}
                      </h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 shrink-0"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUnassignProject(project.project_info_id); }}
                        title="Unlink project"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Phase badge */}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${phaseColors.bg} ${phaseColors.text} ${phaseColors.border}`}>
                      {getPhaseLabel(project.phase)}
                    </span>

                    {/* Details grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {project.size_kwp && (
                        <div className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          <span>{project.size_kwp.toFixed(0)} kWp</span>
                        </div>
                      )}
                      {project.pm && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>PM: {project.pm}</span>
                        </div>
                      )}
                      {project.pd && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>PD: {project.pd}</span>
                        </div>
                      )}
                    </div>

                    {/* RAG + completion */}
                    <div className="flex items-center justify-between pt-1 border-t">
                      <div className="flex items-center gap-2">
                        <RagDot status={project.rag_status} />
                        <span className="text-xs text-muted-foreground">
                          {project.rag_status ? project.rag_status.charAt(0).toUpperCase() + project.rag_status.slice(1) : "No status"}
                        </span>
                      </div>
                      {completionPct != null && (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${Math.min(completionPct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{completionPct}%</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Assign project dialog */}
      <Dialog open={assignOpen} onOpenChange={(open) => { if (!open) { setAssignOpen(false); setSelectedProjectId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Project to {client.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Search and select a project to link to this client. Only unassigned projects are shown.
            </p>
            <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {selectedProjectId
                    ? unassignedProjects.find(p => String(p.project_info_id) === selectedProjectId)?.project_name || "Select a project..."
                    : "Search and select a project..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search projects..." />
                  <CommandList>
                    <CommandEmpty>No unassigned projects found.</CommandEmpty>
                    <CommandGroup>
                      {unassignedProjects.map((p) => (
                        <CommandItem
                          key={p.project_info_id}
                          value={p.project_name}
                          onSelect={() => { setSelectedProjectId(String(p.project_info_id)); setProjectPopoverOpen(false); }}
                        >
                          <Check className={`mr-2 h-4 w-4 ${selectedProjectId === String(p.project_info_id) ? "opacity-100" : "opacity-0"}`} />
                          {p.project_name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignOpen(false); setSelectedProjectId(""); }}>Cancel</Button>
            <Button onClick={handleAssignProject} disabled={!selectedProjectId || assignProjectMutation.isPending}>
              {assignProjectMutation.isPending ? "Assigning..." : "Assign Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
