// ============================================================
// /project/v2/:projectId — collapsed 4-tab project workspace.
//
// PR-E of the truth/clear/simple redesign.
//
// Today: /project/id/:id has 9 departments × ~27 sub-tabs nested
// inside each other. A user opening the Quality tab can't see the
// project name without scrolling because it scrolls away with the
// active tab. The audit found this is the highest-density surface
// in the app.
//
// Tomorrow (this PR): four tabs (Plan / Money / Quality / Handover).
// Each tab is a vertical stack of sections; sub-departments become
// section headers, not nested tabs. A sticky header strip at the
// top is always visible with name · phase · RAG · last updated.
//
// Migration plan:
//   - Legacy /project/id/:id stays the default. No change to anyone
//     navigating from old bookmarks / mid-flow links.
//   - This page is reachable at /project/v2/:projectId.
//   - The legacy page surfaces a "Try the new workspace (beta)" link
//     at the top so users opt in voluntarily.
//   - After two releases of telemetry, we flip the default.
//
// Truth: each section header explicitly names what's inside, so the
// user can trust the tab labels. Empty sections show "—".
// Clear: 4 tabs (not 9×27). One H1 for the project name, H2 per
// section. Sticky strip always shows project state.
// Simple: the existing tab components are reused as-is — no rewrite
// of the underlying content. Just composed differently.
// ============================================================

import { useMemo } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { findProjectById } from "@/lib/project-route-identity";
import { TYPOGRAPHY, statusClasses, ragLevel } from "@/lib/design-tokens";
import {
  PROJECT_WORKSPACE_TABS,
  PROJECT_WORKSPACE_TAB_LABELS,
  PROJECT_WORKSPACE_SECTIONS,
  type ProjectWorkspaceTab,
} from "./project-workspace-tabs";

// Lazy-load the heavy tab components only when the user lands on
// their parent tab. Each one is multi-KB and we'd kill TTFB if we
// mounted them all up-front.
import { lazy, Suspense } from "react";
const UnifiedPlanTab = lazy(() => import("@/components/tabs/UnifiedPlanTab"));
const RevenueTrackingTab = lazy(() =>
  import("@/components/tabs/RevenueTrackingTab").then((m) => ({ default: m.RevenueTrackingTab })),
);
const ExpenditureEditableTab = lazy(() =>
  import("@/components/tabs/ExpenditureEditableTab").then((m) => ({ default: m.ExpenditureEditableTab })),
);
const CashflowTab = lazy(() =>
  import("@/components/tabs/CashflowTab").then((m) => ({ default: m.CashflowTab })),
);
const QualityTab = lazy(() =>
  import("@/components/tabs/QualityTab").then((m) => ({ default: m.QualityTab })),
);
const ProjectHandoverTab = lazy(() =>
  import("@/components/tabs/ProjectHandoverTab").then((m) => ({ default: m.ProjectHandoverTab })),
);
const ProjectRaidTab = lazy(() =>
  import("@/components/tabs/ProjectRaidTab").then((m) => ({ default: m.ProjectRaidTab })),
);

import { Loader2 } from "lucide-react";

// ===================== Page =====================

export default function ProjectWorkspacePage() {
  const [, idParams] = useRoute("/project/v2/:projectId");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const projectId = idParams?.projectId ? Number(idParams.projectId) : null;

  const { projectsSummary, isLoading } = useProjectsSummary();
  const project = useMemo(() => {
    if (projectId == null) return null;
    return findProjectById(projectsSummary as any[] | undefined, projectId) ?? null;
  }, [projectsSummary, projectId]);

  const requestedTab = (searchParams.get("tab") as ProjectWorkspaceTab) || "plan";
  const activeTab: ProjectWorkspaceTab = PROJECT_WORKSPACE_TABS.includes(requestedTab)
    ? requestedTab
    : "plan";

  const setActiveTab = (next: string) => {
    const params = new URLSearchParams(searchString);
    if (next === "plan") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    setLocation(`/project/v2/${projectId}${qs ? "?" + qs : ""}`);
  };

  if (projectId == null) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4 text-center">
        <h1 className={`${TYPOGRAPHY.PAGE_TITLE} mb-2`}>Project not found</h1>
        <p className={`text-sm ${statusClasses("neutral", "text")}`}>
          The URL is missing a project ID.
        </p>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4 text-center">
        <h1 className={`${TYPOGRAPHY.PAGE_TITLE} mb-2`}>Project not found</h1>
        <p className={`text-sm ${statusClasses("neutral", "text")}`}>
          We couldn't find a project with this ID.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setLocation("/portfolio")}
          >
            Back to portfolio
          </button>
        </p>
      </div>
    );
  }

  const projectName = String(project.project_name || "");
  const cleanName = projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
  const phase = project.phase || project.execution_phase || null;
  const rag = (project as any).rag_status ?? null;
  const lastUpdated = project.shared_summary?.latestUpdate?.updatedAt ?? null;

  return (
    <div className="min-h-screen">
      {/* Sticky header strip — always visible across tabs. */}
      <ProjectHeaderStrip
        name={cleanName}
        phase={phase}
        rag={rag}
        lastUpdated={lastUpdated}
        onLegacy={() => setLocation(`/project/id/${projectId}`)}
      />

      <div className="max-w-7xl mx-auto px-4 pb-12">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-transparent border-b rounded-none p-0 h-auto">
            {PROJECT_WORKSPACE_TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm"
              >
                {PROJECT_WORKSPACE_TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Plan tab — WBS + delivery milestones + RAID stacked. */}
          <TabsContent value="plan" className="space-y-6">
            <Section title="Schedule (WBS)">
              <Suspense fallback={<SectionFallback />}>
                <UnifiedPlanTab projectName={projectName} projectId={projectId} />
              </Suspense>
            </Section>
            <Section title="RAID — Risks, Assumptions, Issues, Decisions">
              <Suspense fallback={<SectionFallback />}>
                <ProjectRaidTab projectName={projectName} projectId={projectId} />
              </Suspense>
            </Section>
          </TabsContent>

          {/* Money tab — revenue + expenditure + cashflow stacked. */}
          <TabsContent value="money" className="space-y-6">
            <Section title="Revenue tracking">
              <Suspense fallback={<SectionFallback />}>
                <RevenueTrackingTab projectName={projectName} />
              </Suspense>
            </Section>
            <Section title="Expenditure">
              <Suspense fallback={<SectionFallback />}>
                <ExpenditureEditableTab projectName={projectName} />
              </Suspense>
            </Section>
            <Section title="Cashflow">
              <Suspense fallback={<SectionFallback />}>
                <CashflowTab projectName={projectName} />
              </Suspense>
            </Section>
          </TabsContent>

          {/* Quality tab — checklist (the QC engine). */}
          <TabsContent value="quality" className="space-y-6">
            <Section title="Quality checklist">
              <Suspense fallback={<SectionFallback />}>
                <QualityTab projectName={projectName} projectInfoId={projectId} />
              </Suspense>
            </Section>
          </TabsContent>

          {/* Handover tab — formal sign-off of PD→PM / PM→O&M / EPC→Client. */}
          <TabsContent value="handover" className="space-y-6">
            <Section title="Handover">
              <Suspense fallback={<SectionFallback />}>
                <ProjectHandoverTab projectName={projectName} projectId={projectId} />
              </Suspense>
            </Section>
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}

// ===================== Sub-components =====================

function ProjectHeaderStrip({
  name,
  phase,
  rag,
  lastUpdated,
  onLegacy,
}: {
  name: string;
  phase: string | null;
  rag: string | null;
  lastUpdated: string | null;
  onLegacy: () => void;
}) {
  const ragClass = ragDotClass(rag);
  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-semibold truncate flex-1 min-w-0">
          {name}
        </h1>
        {phase && <span className="text-[11px] text-muted-foreground">{phase}</span>}
        <span
          className={`inline-block w-2 h-2 rounded-full ${ragClass}`}
          aria-label={`RAG ${rag || "unknown"}`}
          title={rag || "RAG unknown"}
        />
        {lastUpdated && (
          <span className="text-[11px] text-muted-foreground">
            updated {formatAgo(lastUpdated)}
          </span>
        )}
        <Button variant="ghost" size="sm" className="text-[11px]" onClick={onLegacy}>
          Legacy view →
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const legacy = PROJECT_WORKSPACE_SECTIONS.find((s) => s.title === title)?.legacyLocation;
  return (
    <section className="space-y-2">
      <h2
        className={`${TYPOGRAPHY.SECTION} text-foreground/90 mt-2 mb-2`}
        title={legacy ? `Was: ${legacy}` : undefined}
      >
        {title}
      </h2>
      <Card className="overflow-hidden">{children}</Card>
    </section>
  );
}

function SectionFallback() {
  return (
    <div className="p-6 text-center text-muted-foreground text-xs">
      <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
      Loading…
    </div>
  );
}

function ragDotClass(rag: string | null | undefined): string {
  const level = ragLevel(rag);
  if (level === "healthy") return "bg-emerald-500";
  if (level === "warning") return "bg-amber-500";
  if (level === "critical") return "bg-red-500";
  return "bg-slate-400";
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
