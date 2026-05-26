// Wave-4 audit (2026-05-26) — Delivery Milestone Tracker.
//
// Split from the (now revenue-billing-only) /milestone-tracker page.
// Surfaces site delivery milestones — Mobilisation, Civils 25%,
// Structures Complete, DC Wiring, AC Connection, First Energization,
// COD — per the audit-scope §3 requirement for planned/actual dates,
// owner, blocker, evidence link.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Milestone, CheckCircle2, Clock, AlertTriangle,
  CircleDot, Ban, FileText, Calendar,
} from "lucide-react";

interface DeliveryMilestone {
  id: number;
  projectId: number;
  milestoneCode: string;
  milestoneName: string;
  phaseCode: string | null;
  sortOrder: number;
  plannedDate: string | null;
  actualDate: string | null;
  status: "planned" | "in_progress" | "complete" | "overdue" | "blocked";
  ownerUserId: number | null;
  blocker: string | null;
  evidenceLink: string | null;
  notes: string | null;
}

interface ProjectInfo {
  id: number;
  projectName: string;
  phase: string | null;
  archivedStatus: string | null;
}

const STATUS_CONFIG: Record<DeliveryMilestone["status"], { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  planned:     { label: "Planned",     cls: "bg-slate-100 text-slate-700",   icon: CircleDot },
  in_progress: { label: "In progress", cls: "bg-blue-100 text-blue-700",     icon: Clock },
  complete:    { label: "Complete",    cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  overdue:     { label: "Overdue",     cls: "bg-red-100 text-red-700",       icon: AlertTriangle },
  blocked:     { label: "Blocked",     cls: "bg-amber-100 text-amber-700",   icon: Ban },
};

function StatusBadge({ status }: { status: DeliveryMilestone["status"] }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.planned;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`${cfg.cls} text-[10px] gap-1`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00Z");
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "2-digit" });
}

function ProjectMilestoneCard({
  project,
  milestones,
  isLoading,
}: {
  project: ProjectInfo;
  milestones: DeliveryMilestone[];
  isLoading: boolean;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const completeMut = useMutation({
    mutationFn: async (id: number) => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await apiRequest("PATCH", `/api/projects/delivery-milestones/${id}`, {
        actualDate: today,
        status: "complete",
      });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["delivery-milestones", project.id] });
      // Server may include a warning if the milestone completed without evidence.
      if (data?.warning) {
        toast({ title: "Milestone complete", description: data.warning, variant: "default" });
      } else {
        toast({ title: "Milestone complete" });
      }
    },
    onError: (err: Error) =>
      toast({ title: "Failed to mark complete", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-3 text-xs text-muted-foreground">Loading milestones…</CardContent>
      </Card>
    );
  }

  const total = milestones.length;
  const complete = milestones.filter((m) => m.status === "complete").length;
  const overdue = milestones.filter((m) => m.status === "overdue").length;
  const blocked = milestones.filter((m) => m.status === "blocked").length;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-sm font-semibold hover:underline truncate cursor-pointer"
            onClick={() => navigate(`/project/id/${project.id}`)}
          >
            {project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
          </span>
          {project.phase && (
            <Badge variant="outline" className="text-[9px]">{project.phase}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">{complete}/{total} complete · {pct}%</span>
          {overdue > 0 && <Badge className="bg-red-100 text-red-700 text-[10px]">{overdue} overdue</Badge>}
          {blocked > 0 && <Badge className="bg-amber-100 text-amber-700 text-[10px]">{blocked} blocked</Badge>}
        </div>
      </div>

      {total === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground italic">
          No delivery milestones recorded yet. Add the first one from Project Detail &gt; Plan.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-1.5 text-left">Milestone</th>
                <th className="px-3 py-1.5 text-center w-24">Planned</th>
                <th className="px-3 py-1.5 text-center w-24">Actual</th>
                <th className="px-3 py-1.5 text-center w-24">Status</th>
                <th className="px-3 py-1.5 text-center w-24">Evidence</th>
                <th className="px-3 py-1.5 text-right w-32">Action</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id} className="border-t last:border-b-0 hover:bg-muted/10">
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{m.milestoneName}</div>
                    {m.blocker && (
                      <div className="text-[9px] text-amber-700 mt-0.5 flex items-center gap-1">
                        <Ban className="h-2.5 w-2.5" />
                        Blocked: {m.blocker}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center text-muted-foreground">{formatDate(m.plannedDate)}</td>
                  <td className={`px-3 py-1.5 text-center ${m.actualDate ? "text-emerald-700 font-medium" : "text-muted-foreground"}`}>
                    {formatDate(m.actualDate)}
                  </td>
                  <td className="px-3 py-1.5 text-center"><StatusBadge status={m.status} /></td>
                  <td className="px-3 py-1.5 text-center">
                    {m.evidenceLink ? (
                      <a
                        href={m.evidenceLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:underline inline-flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" />
                        Open
                      </a>
                    ) : (
                      <span className="text-[9px] text-muted-foreground italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {m.status !== "complete" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2"
                        disabled={completeMut.isPending}
                        onClick={() => completeMut.mutate(m.id)}
                      >
                        Mark complete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function DeliveryMilestonesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DeliveryMilestone["status"]>("all");

  const { data: allProjects, isLoading: projectsLoading, isError, error } = useQuery<ProjectInfo[]>({
    queryKey: ["/api/project-info"],
  });

  const eligibleProjects = useMemo(
    () => (allProjects || []).filter((p) => (p.archivedStatus ?? "ACTIVE") === "ACTIVE"),
    [allProjects],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return eligibleProjects;
    const term = search.toLowerCase();
    return eligibleProjects.filter((p) => (p.projectName || "").toLowerCase().includes(term));
  }, [eligibleProjects, search]);

  const milestonesByProject = useMilestonesByProject(filtered);

  const visible = useMemo(() => {
    if (statusFilter === "all") return filtered;
    return filtered.filter((p) =>
      (milestonesByProject.get(p.id) || []).some((m) => m.status === statusFilter),
    );
  }, [filtered, milestonesByProject, statusFilter]);

  if (projectsLoading) return <PageSkeleton lines={8} />;
  if (isError) return <PageError title="Unable to load projects" message={error instanceof Error ? error.message : "Something went wrong"} />;

  return (
    <PageShell>
      <SectionHeader
        icon={<Milestone className="h-5 w-5" />}
        title="Delivery Milestones"
        description="Site delivery progress — Mobilisation, Civils, Structures, DC/AC, First Energization, COD. Distinct from Revenue Milestones (invoicing/cash)."
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs w-60"
        />
        <div className="flex items-center gap-1">
          {(["all", "overdue", "blocked", "in_progress", "planned", "complete"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All" : STATUS_CONFIG[s].label}
            </Button>
          ))}
        </div>
        <div className="ml-auto text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {visible.length} project{visible.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No projects match this filter.
            </CardContent>
          </Card>
        ) : (
          visible.map((p) => (
            <ProjectMilestoneCard
              key={p.id}
              project={p}
              milestones={milestonesByProject.get(p.id) || []}
              isLoading={false}
            />
          ))
        )}
      </div>
    </PageShell>
  );
}

// ---- Per-project fetch ------------------------------------------------
// One query per visible project so React Query can cache + invalidate
// each card independently. Trades N fetches for cache simplicity; an
// `/api/delivery-milestones/board` endpoint can be added later if the
// project count grows beyond ~50.
function useMilestonesByProject(projects: ProjectInfo[]) {
  const queryClient = useQueryClient();
  const map = new Map<number, DeliveryMilestone[]>();
  for (const p of projects) {
    const queryKey = ["delivery-milestones", p.id];
    const cached = queryClient.getQueryData<{ milestones: DeliveryMilestone[] }>(queryKey);
    if (cached?.milestones) map.set(p.id, cached.milestones);
    queryClient.prefetchQuery({
      queryKey,
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/projects/${p.id}/delivery-milestones`);
        if (!res.ok) throw new Error("Failed");
        return res.json();
      },
      staleTime: 60_000,
    });
  }
  return map;
}
