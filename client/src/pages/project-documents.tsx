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

import { useMemo } from "react";
import { useParams } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useProjectDetail } from "@/hooks/use-project-v2";
import {
  usePublicFolderTaxonomy,
  useProjectFolders,
} from "@/hooks/use-document-management-admin";
import { DisciplinePanel } from "@/components/documents/DisciplinePanel";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";
import { CheckCircle2, FolderX, AlertTriangle } from "lucide-react";

export default function ProjectDocumentsPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr);
  const isValid = Number.isFinite(projectId) && projectId > 0;
  const project = useProjectDetail(isValid ? projectId : undefined);
  const taxonomy = usePublicFolderTaxonomy();
  const folders = useProjectFolders(isValid ? projectId : null);

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

  const overallSummary = useMemo(() => {
    const allRows = (taxonomy.data?.taxonomy ?? []).filter((r) => r.active);
    const folderMap = new Map(
      (folders.data?.folders ?? []).map((f) => [f.taxonomyKey, f] as const),
    );
    let provisioned = 0;
    let errors = 0;
    for (const r of allRows) {
      const f = folderMap.get(r.internalKey);
      if (f?.itemId) provisioned += 1;
      if (f?.verifyError) errors += 1;
    }
    const total = allRows.length;
    return { total, provisioned, missing: total - provisioned, errors };
  }, [taxonomy.data, folders.data]);

  if (!isValid) return <PageError message="Invalid project id" />;
  if (project.isLoading || taxonomy.isLoading || folders.isLoading) return <PageSkeleton />;
  if (project.error) return <PageError message="Failed to load project" />;

  const title = project.data?.project?.projectName ?? `Project #${projectId}`;

  return (
    <PageLayout
      data-testid="project-documents-page"
      header={<PageHeader title={title} subtitle="Documents" />}
    >
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="text-sm font-medium">Overall readiness</div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge
              variant="outline"
              className="bg-emerald-50 text-emerald-700"
              data-testid="overall-summary-provisioned"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {overallSummary.provisioned} of {overallSummary.total} folders provisioned
            </Badge>
            {overallSummary.missing > 0 && (
              <Badge
                variant="outline"
                className="bg-amber-50 text-amber-800"
                data-testid="overall-summary-missing"
              >
                <FolderX className="h-3 w-3 mr-1" />
                {overallSummary.missing} missing
              </Badge>
            )}
            {overallSummary.errors > 0 && (
              <Badge
                variant="outline"
                className="bg-rose-50 text-rose-700"
                data-testid="overall-summary-errors"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                {overallSummary.errors} verify errors
              </Badge>
            )}
          </div>
          {overallSummary.total === 0 && (
            <div className="text-xs text-muted-foreground">
              No taxonomy folders mapped to a discipline yet — set up discipline ownership in
              <em> /admin/document-management</em>.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <ManagedDocumentApprovalQueue projectId={projectId} title="Approvals waiting on you" />
      </div>

      <div className="mt-4">
        <Tabs defaultValue={disciplinesWithRows[0] ?? "ALL"} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="ALL" data-testid="tab-discipline-ALL">
              All disciplines
            </TabsTrigger>
            {disciplinesWithRows.map((d) => (
              <TabsTrigger key={d} value={d} data-testid={`tab-discipline-${d}`}>
                {d}
              </TabsTrigger>
            ))}
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
