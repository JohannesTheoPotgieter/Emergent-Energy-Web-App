import { useMemo } from "react";
import { useLocation } from "wouter";
import { useGatesPipeline, useGatesHandovers, type GateProjectCard } from "@/hooks/use-gates";
import { ApprovalQueueCard } from "@/components/controlled-documents";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sun, ArrowRight, Clock, DollarSign, TrendingUp, Users,
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

/**
 * CEO pre-execution home.
 *
 * Landing for CEO_ADMIN lens. Three concerns, priority-ordered:
 *   1) Waiting on me (approval queue — uses D3 document-control queue)
 *   2) Pre-execution pipeline (deals by stage: First Assessment / Cost
 *      Proposal / Design) with headline cost + revenue, latest activity,
 *      and proposed sign date.
 *   3) Upcoming handovers — projects approaching PD -> PM handover.
 *   4) Overarching lifecycle summary — counts per execution stage so the
 *      CEO has full visibility without leaving this page.
 *
 * Actionable rule: every row + tile deep-links to the specific project /
 * handover / approval — no dead landings.
 */

const PRE_EXEC_STAGES = [
  { code: "S01_FIRST_ASSESSMENT", label: "First Assessment", tint: "bg-sky-50 border-sky-200" },
  { code: "S02_DESIGN_COST_PROPOSAL", label: "Cost Proposal & Design", tint: "bg-violet-50 border-violet-200" },
  { code: "S03_SIGNATURE_FINANCIAL_CLOSE", label: "Signature & Financial Close", tint: "bg-emerald-50 border-emerald-200" },
] as const;

const EXECUTION_STAGES = [
  { code: "S04_PD_PM_HANDOVER", label: "PD→PM Handover" },
  { code: "S04_PLANNING", label: "Planning" },
  { code: "S05_FINANCIAL_REVIEW", label: "Financial Review" },
  { code: "S06_CONSTRUCTION", label: "Construction" },
  { code: "S07_COMMISSIONING", label: "Commissioning" },
  { code: "S08_OM_HANDOVER", label: "O&M Handover" },
  { code: "S09_CLIENT_HANDOVER", label: "Client Handover" },
  { code: "S9B_COMPLIANCE_HANDOVER", label: "Compliance" },
  { code: "S10_POST_HANDOVER_REVIEW", label: "Post-Handover" },
] as const;

export default function CeoHome() {
  const { data: gatesData, isLoading, error } = useGatesPipeline();
  const { data: handoversData } = useGatesHandovers();

  const preExecByStage = useMemo(() => {
    const all = gatesData?.projects ?? [];
    const map = new Map<string, GateProjectCard[]>();
    for (const stage of PRE_EXEC_STAGES) map.set(stage.code, []);
    for (const p of all) {
      if (p.currentStageCode && map.has(p.currentStageCode)) {
        map.get(p.currentStageCode)!.push(p);
      }
    }
    return map;
  }, [gatesData]);

  const executionStageCounts = useMemo(() => {
    const all = gatesData?.projects ?? [];
    const counts = new Map<string, number>();
    for (const stage of EXECUTION_STAGES) counts.set(stage.code, 0);
    for (const p of all) {
      if (p.currentStageCode && counts.has(p.currentStageCode)) {
        counts.set(p.currentStageCode, (counts.get(p.currentStageCode) ?? 0) + 1);
      }
    }
    return counts;
  }, [gatesData]);

  const upcomingHandovers = useMemo(() => {
    return (handoversData?.projects ?? []).slice(0, 8);
  }, [handoversData]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load CEO home" />;

  return (
    <PageLayout
      data-testid="ceo-home-page"
      header={
        <PageHeader
          title="CEO Dashboard"
          subtitle="Pre-execution pipeline, approvals waiting on you, and what's coming up."
        />
      }
    >
      {/* Row 1: Waiting on me */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <ApprovalQueueCard />
        </div>
        <div className="lg:col-span-2">
          <UpcomingHandoversCard rows={upcomingHandovers} />
        </div>
      </div>

      {/* Row 2: Pre-execution pipeline by stage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PRE_EXEC_STAGES.map((stage) => (
          <StageColumn
            key={stage.code}
            stage={stage}
            projects={preExecByStage.get(stage.code) ?? []}
          />
        ))}
      </div>

      {/* Row 3: Overarching lifecycle summary */}
      <LifecycleSummaryStrip counts={executionStageCounts} />
    </PageLayout>
  );
}

function StageColumn({
  stage,
  projects,
}: {
  stage: typeof PRE_EXEC_STAGES[number];
  projects: GateProjectCard[];
}) {
  return (
    <Card data-testid={`stage-col-${stage.code}`}>
      <CardHeader className={`${stage.tint} border-b pb-3`}>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-primary" />
            {stage.label}
          </span>
          <Badge variant="outline" className="text-[10px] bg-white">
            {projects.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No deals at this stage.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {projects.map((p) => (
              <DealCard key={p.projectId} project={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DealCard({ project }: { project: GateProjectCard }) {
  const contractValue = project.contractValue ? Number(project.contractValue) : null;
  return (
    <li data-testid={`deal-card-${project.projectId}`}>
      <Link
        href={`/project/${encodeURIComponent(project.projectName)}`}
        className="block p-3 hover:bg-[hsl(var(--surface-tint))] transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium truncate" title={project.projectName}>
              {project.projectName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {project.clientName || "—"}
            </p>
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
              {project.pd && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {project.pd}
                </span>
              )}
              {project.gateReadinessPct != null && (
                <span className="flex items-center gap-1 tabular-nums">
                  {project.gateReadinessPct}% ready
                </span>
              )}
              {project.daysInStage != null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {project.daysInStage}d
                </span>
              )}
            </div>
            {contractValue != null && contractValue > 0 && (
              <p className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                R{contractValue.toLocaleString("en-ZA")}
              </p>
            )}
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </Link>
    </li>
  );
}

function UpcomingHandoversCard({ rows }: { rows: any[] }) {
  const [, navigate] = useLocation();
  return (
    <Card data-testid="upcoming-handovers-card" className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Upcoming handovers
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No handovers scheduled.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r, i) => (
              <li key={r.projectId ?? i} className="py-2.5 flex items-center justify-between gap-2">
                <button
                  onClick={() => navigate(`/project/${encodeURIComponent(r.projectName)}`)}
                  className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left hover:bg-[hsl(var(--surface-tint))] rounded px-2 -mx-2 py-1 transition-colors"
                  data-testid={`upcoming-handover-${r.projectId ?? i}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.projectName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.clientName || ""} {r.pm ? `· PM: ${r.pm}` : ""}
                    </p>
                  </div>
                  {r.gateReadinessPct != null && (
                    <Badge variant="outline" className="text-[10px] tabular-nums shrink-0">
                      {r.gateReadinessPct}% ready
                    </Badge>
                  )}
                </button>
                {r.projectId ? (
                  <Link
                    href={`/handover/${r.projectId}/live`}
                    className="text-[11px] text-primary hover:underline shrink-0 px-2"
                    data-testid={`open-live-room-${r.projectId}`}
                  >
                    Live room →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LifecycleSummaryStrip({ counts }: { counts: Map<string, number> }) {
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  return (
    <Card data-testid="lifecycle-summary-strip">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Portfolio across execution
          <Badge variant="outline" className="text-[10px]">{total} projects</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {EXECUTION_STAGES.map((stage) => {
            const n = counts.get(stage.code) ?? 0;
            return (
              <Link
                key={stage.code}
                href={`/gates/pipeline?stage=${stage.code}`}
                className="block rounded-md border bg-card p-2.5 hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
                data-testid={`stage-count-${stage.code}`}
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate" title={stage.label}>
                  {stage.label}
                </p>
                <p className="text-lg font-semibold tabular-nums mt-0.5">{n}</p>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
