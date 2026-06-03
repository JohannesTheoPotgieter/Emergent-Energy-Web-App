/**
 * Per-project Documents page (D6 Phase 4 — replaces the legacy
 * DocumentStrip + ApprovalQueueCard surface).
 *
 * Route: /projects/:projectId/documents
 *
 * Layout:
 *   - Page header with project name + readiness summary across all
 *     disciplines.
 *   - Tab strip with one tab per discipline that owns at least one
 *     active taxonomy folder, plus an "All" tab.
 *   - Each tab renders a <DisciplinePanel> scoped to that discipline.
 *
 * The legacy DocumentStrip / ApprovalQueueCard belong to the deprecated
 * controlled-documents flow that D6 retires; both are still mounted
 * elsewhere if they're useful, but this page is the canonical
 * project-documents surface going forward.
 */

import { useMemo, useState, useEffect } from "react";
import { useParams } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectDetail } from "@/hooks/use-project-v2";
import {
  usePublicFolderTaxonomy,
  useProjectFolders,
} from "@/hooks/use-document-management-admin";
import { DisciplinePanel } from "@/components/documents/DisciplinePanel";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { ProjectReadinessCard } from "@/components/documents/ProjectReadinessCard";
import { ProjectSharepointConnectionCard } from "@/components/documents/ProjectSharepointConnectionCard";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";

export default function ProjectDocumentsPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr);
  const isValid = Number.isFinite(projectId) && projectId > 0;
  const project = useProjectDetail(isValid ? projectId : undefined);
  const taxonomy = usePublicFolderTaxonomy();
  const folders = useProjectFolders(isValid ? projectId : null);

  // Deep-linkable tab — readers from other pages (department dashboards,
  // project drawers, etc.) can route to /projects/:id/documents?discipline=ENGINEERING
  // and land on the matching tab.
  const initialDiscipline = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("discipline");
  }, []);
  const [activeTab, setActiveTab] = useState<string | null>(initialDiscipline);

  const disciplinesWithRows = useMemo(() => {
    const rows = taxonomy.data?.taxonomy ?? [];
    const present = new Set<string>();
    for (const r of rows) {
      if (!r.active) continue;
      const ds = (r.disciplines ?? []) as string[];
      for (const d of ds) present.add(d);
    }
    return LIFECYCLE_DEPARTMENTS.filter((d) => present.has(d));
  }, [taxonomy.data]);

  // Per-discipline folder counts for the tab badges.
  const folderCountByDiscipline = useMemo(() => {
    const tax = taxonomy.data?.taxonomy ?? [];
    const out = new Map<string, { total: number; provisioned: number }>();
    const folderMap = new Map(
      (folders.data?.folders ?? []).map((f) => [f.taxonomyKey, f] as const),
    );
    for (const r of tax) {
      if (!r.active) continue;
      const ds = (r.disciplines ?? []) as string[];
      for (const d of ds) {
        const stat = out.get(d) ?? { total: 0, provisioned: 0 };
        stat.total += 1;
        const f = folderMap.get(r.internalKey);
        if (f?.itemId) stat.provisioned += 1;
        out.set(d, stat);
      }
    }
    return out;
  }, [taxonomy.data, folders.data]);

  // Default to the deep-linked discipline if it actually has rows; otherwise
  // fall back to the first discipline with content, then "ALL".
  useEffect(() => {
    if (activeTab) return;
    if (
      initialDiscipline &&
      (disciplinesWithRows as readonly string[]).includes(initialDiscipline)
    ) {
      setActiveTab(initialDiscipline);
      return;
    }
    setActiveTab(disciplinesWithRows[0] ?? "ALL");
  }, [activeTab, initialDiscipline, disciplinesWithRows]);

  if (!isValid) return <PageError message="Invalid project id" />;
  if (project.isLoading || taxonomy.isLoading || folders.isLoading) return <PageSkeleton />;
  if (project.error) return <PageError message="Failed to load project" />;

  const title = project.data?.project?.projectName ?? `Project #${projectId}`;

  return (
    <PageLayout
      data-testid="project-documents-page"
      header={<PageHeader title={title} subtitle="Documents" />}
    >
      <ProjectSharepointConnectionCard projectId={projectId} />

      <div className="mt-4">
        <ProjectReadinessCard projectId={projectId} />
      </div>

      <div className="mt-4">
        <ManagedDocumentApprovalQueue projectId={projectId} title="Approvals waiting on you" />
      </div>

      <div className="mt-4">
        <Tabs
          value={activeTab ?? "ALL"}
          onValueChange={setActiveTab}
          className="w-full"
        >
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="ALL" data-testid="tab-discipline-ALL">
              All disciplines
            </TabsTrigger>
            {disciplinesWithRows.map((d) => {
              const stat = folderCountByDiscipline.get(d);
              return (
                <TabsTrigger
                  key={d}
                  value={d}
                  data-testid={`tab-discipline-${d}`}
                  className="gap-2"
                >
                  <span>{d}</span>
                  {stat && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                      data-testid={`tab-discipline-count-${d}`}
                    >
                      {stat.provisioned}/{stat.total}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="ALL" className="mt-4">
            <AllDisciplinesView projectId={projectId} disciplines={disciplinesWithRows} />
          </TabsContent>

          {disciplinesWithRows.map((d) => (
            <TabsContent key={d} value={d} className="mt-4">
              <DisciplinePanel projectId={projectId} discipline={d} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </PageLayout>
  );
}

function AllDisciplinesView(props: { projectId: number; disciplines: string[] }) {
  const { projectId, disciplines } = props;
  if (disciplines.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground text-center">
          No disciplines have folders mapped yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {disciplines.map((d) => (
        <DisciplinePanel
          key={d}
          projectId={projectId}
          discipline={d}
          includeShared={false}
        />
      ))}
    </div>
  );
}
