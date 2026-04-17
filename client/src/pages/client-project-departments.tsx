import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import {
  ArrowLeft, Wrench, TrendingUp, ShieldCheck, Target,
  Zap, User, AlertTriangle, CheckCircle, ClipboardList,
  BarChart3, DollarSign, Milestone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import { useProjectDetail } from "@/hooks/use-project-v2";

async function qFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
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

interface Client {
  id: number;
  clientId: string;
  name: string;
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

function RagDot({ status, size = "md" }: { status: string | null | undefined; size?: "sm" | "md" }) {
  const s = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";
  const color = status === "green" ? "bg-emerald-500"
    : status === "amber" ? "bg-amber-500"
    : status === "red" ? "bg-red-500"
    : "bg-gray-300";
  return <span className={`inline-block rounded-full ${s} ${color}`} />;
}

interface DepartmentCardProps {
  icon: React.ReactNode;
  title: string;
  color: string;
  metrics: { label: string; value: string | number; warning?: boolean }[];
  ragStatus?: string | null;
  onClick: () => void;
}

function DepartmentCard({ icon, title, color, metrics, ragStatus, onClick }: DepartmentCardProps) {
  return (
    <Card
      className={`transition-all hover:shadow-lg hover:scale-[1.01] cursor-pointer border-t-4 ${color} h-full`}
      onClick={onClick}
      data-testid={`dept-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {icon}
            <h3 className="font-bold text-sm uppercase tracking-wide">{title}</h3>
          </div>
          {ragStatus && <RagDot status={ragStatus} />}
        </div>

        <div className="space-y-2">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{m.label}</span>
              <span className={`font-semibold ${m.warning ? "text-amber-600" : "text-foreground"}`}>
                {m.warning && <AlertTriangle className="inline h-3 w-3 mr-1" />}
                {m.value}
              </span>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t">
          <span className="text-xs font-semibold text-primary">
            Open {title} →
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClientProjectDepartmentsPage() {
  const [, params] = useRoute("/clients/:clientId/project/:projectId");
  const clientId = params?.clientId ? Number(params.clientId) : null;
  const projectId = params?.projectId ? Number(params.projectId) : null;
  const [, setLocation] = useLocation();

  // Load client info
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => qFetch("/api/pd/clients"),
  });
  const client = clients.find(c => c.id === clientId);

  // Load project info from summary
  const { data: allProjects = [], isLoading: projectsLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["projects-summary-for-dept-hub"],
    queryFn: () => qFetch("/api/projects-summary"),
  });
  const project = allProjects.find(p => p.project_info_id === projectId);

  // V2 project detail (has plan/quality/finance summaries)
  const { data: v2Detail, isLoading: v2Loading } = useProjectDetail(projectId ?? undefined);

  // Health summary for RAG + engineering metrics
  const { data: healthSummary } = useQuery<{
    schedule: { rag: string; overdueTasks: number; completionPct: number };
    cost: { rag: string; ratio: number; totalExpenses: number; budgetTotal: number };
    quality: { rag: string; gatesTotal: number; gatesPassed: number; totalItems: number; approvedItems: number; progressPct: number };
    revenue: { contractValue: number; realisedPct: number; totalPaidInflows: number };
    engineering: { progressPct: number; totalTasks: number; completedTasks: number };
    overall: { rag: string };
    alerts: { overduePlanTasks: number; overdueEngineeringTasks: number; pendingQualityApprovals: number };
  }>({
    queryKey: ["health-summary", project?.project_name],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/projects/${encodeURIComponent(project!.project_name)}/health-summary`, { headers, credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!project?.project_name,
    staleTime: 30_000,
  });

  // PD tickets count
  const { data: pdTickets = [] } = useQuery<any[]>({
    queryKey: ["pd-tickets-for-project", projectId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/pd/tickets?projectId=${projectId}`, { headers, credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  // Stage lifecycle data
  const { data: stageData } = useQuery<{ currentStage?: { stageCode: string; label: string } }>({
    queryKey: ["stage-lifecycle", projectId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/stage-lifecycle/${projectId}`, { headers, credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const isLoading = projectsLoading || v2Loading;

  if (isLoading) return <PageSkeleton lines={5} />;
  if (!project) return <PageShell className="p-4 md:p-6"><PageError title="Project not found" message="The requested project does not exist." /></PageShell>;

  const projectName = project.project_name;
  const encodedName = encodeURIComponent(projectName);
  const phase = project.phase;
  const phaseColors = phase ? PHASE_COLORS[phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT : PHASE_COLORS.P0_FIRST_ASSESSMENT;
  const completionPct = project.project_pct_complete != null ? Math.round(project.project_pct_complete * 100) : null;
  const overallRag = healthSummary?.overall?.rag ?? project.rag_status;

  // Engineering metrics
  const engTotal = healthSummary?.engineering?.totalTasks ?? 0;
  const engCompleted = healthSummary?.engineering?.completedTasks ?? 0;
  const engProgress = healthSummary?.engineering?.progressPct ?? 0;
  const engOverdue = healthSummary?.alerts?.overdueEngineeringTasks ?? 0;

  // Quality metrics
  const qualityProgress = healthSummary?.quality?.progressPct ?? v2Detail?.qualitySummary?.checklistProgress ?? 0;
  const qualityWarnings = v2Detail?.qualitySummary?.openWarnings ?? 0;
  const qualityPendingApprovals = healthSummary?.alerts?.pendingQualityApprovals ?? 0;

  // PM metrics
  const planCompletion = healthSummary?.schedule?.completionPct ?? v2Detail?.planSummary?.completionPct ?? 0;
  const planOverdue = healthSummary?.alerts?.overduePlanTasks ?? v2Detail?.planSummary?.tasksOverdue ?? 0;
  const planTotal = v2Detail?.planSummary?.taskCount ?? 0;
  const planCompleted = v2Detail?.planSummary?.tasksCompleted ?? 0;
  const currentGate = stageData?.currentStage?.label ?? "—";

  // PD / Finance metrics
  const contractValue = healthSummary?.revenue?.contractValue ?? v2Detail?.financeSummary?.contractValue ?? 0;
  const revenueRealisedPct = healthSummary?.revenue?.realisedPct ?? 0;
  const pdTicketCount = Array.isArray(pdTickets) ? pdTickets.filter((t: any) => t.status !== "closed" && t.status !== "CLOSED").length : 0;

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="department-hub-page">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <Link href="/clients" className="hover:text-foreground transition-colors">Clients</Link>
        <span>/</span>
        {client ? (
          <Link href={`/clients/${clientId}`} className="hover:text-foreground transition-colors">{client.name}</Link>
        ) : (
          <span>Client</span>
        )}
        <span>/</span>
        <span className="text-foreground font-medium">{projectName}</span>
      </div>

      {/* Project header */}
      <div className="space-y-3 pb-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-foreground">{projectName}</h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${phaseColors.bg} ${phaseColors.text} ${phaseColors.border}`}>
                {getPhaseLabel(phase)}
              </span>
              {project.size_kwp && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" /> {project.size_kwp.toFixed(0)} kWp
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <RagDot status={overallRag} />
                <span className="text-xs font-medium">{overallRag ? overallRag.charAt(0).toUpperCase() + overallRag.slice(1) : "—"}</span>
              </div>
              {completionPct != null && (
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(completionPct, 100)}%` }} />
                  </div>
                  <span className="text-xs font-medium">{completionPct}%</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
              {project.pm && <span className="flex items-center gap-1"><User className="h-3 w-3" /> PM: {project.pm}</span>}
              {project.pd && <span className="flex items-center gap-1"><User className="h-3 w-3" /> PD: {project.pd}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Department cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Department Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DepartmentCard
            icon={<Wrench className="h-5 w-5 text-blue-600" />}
            title="Engineering"
            color="border-t-blue-500"
            ragStatus={healthSummary?.quality?.rag}
            metrics={[
              { label: "Progress", value: `${Math.round(engProgress)}%` },
              { label: "Tasks", value: `${engCompleted} / ${engTotal}` },
              { label: "Overdue", value: `${engOverdue} tasks`, warning: engOverdue > 0 },
            ]}
            onClick={() => setLocation(`/project/${encodedName}?dept=eng`)}
          />

          <DepartmentCard
            icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
            title="Project Development"
            color="border-t-emerald-500"
            ragStatus={healthSummary?.cost?.rag}
            metrics={[
              { label: "Contract", value: contractValue > 0 ? `R ${(contractValue / 1000000).toFixed(1)}M` : "—" },
              { label: "Revenue Realised", value: `${Math.round(revenueRealisedPct)}%` },
              { label: "Project Development Tickets", value: `${pdTicketCount} open` },
            ]}
            onClick={() => setLocation(`/project/${encodedName}?dept=pd`)}
          />

          <DepartmentCard
            icon={<ShieldCheck className="h-5 w-5 text-purple-600" />}
            title="Quality"
            color="border-t-purple-500"
            ragStatus={healthSummary?.quality?.rag}
            metrics={[
              { label: "Checklist", value: `${Math.round(qualityProgress)}%` },
              { label: "Warnings", value: `${qualityWarnings}`, warning: qualityWarnings > 0 },
              { label: "Pending Approvals", value: `${qualityPendingApprovals}` },
            ]}
            onClick={() => setLocation(`/project/${encodedName}?dept=quality`)}
          />

          <DepartmentCard
            icon={<Target className="h-5 w-5 text-amber-600" />}
            title="Project Management"
            color="border-t-amber-500"
            ragStatus={healthSummary?.schedule?.rag}
            metrics={[
              { label: "Completion", value: `${Math.round(planCompletion)}%` },
              { label: "Tasks", value: `${planCompleted} / ${planTotal}` },
              { label: "Overdue", value: `${planOverdue} tasks`, warning: planOverdue > 0 },
              { label: "Current Gate", value: currentGate },
            ]}
            onClick={() => setLocation(`/project/${encodedName}?dept=pm`)}
          />
        </div>
      </div>
    </PageShell>
  );
}
