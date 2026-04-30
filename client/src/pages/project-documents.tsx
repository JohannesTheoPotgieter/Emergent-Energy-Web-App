import { useParams } from "wouter";
import { DocumentStrip, ApprovalQueueCard } from "@/components/controlled-documents";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { useProjectDetail } from "@/hooks/use-project-v2";

/**
 * Standalone project documents view — one-page access to a project's
 * controlled documents strip. Useful while DocumentStrip waits to be
 * wired into the project-detail tabs as part of R4.
 *
 * Route: /projects/:projectId/documents
 */
export default function ProjectDocumentsPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr);
  const isValid = Number.isFinite(projectId) && projectId > 0;
  const { data: project, isLoading, error } = useProjectDetail(isValid ? projectId : undefined);

  if (!isValid) return <PageError message="Invalid project id" />;
  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load project" />;

  const title = project?.project?.projectName ?? `Project #${projectId}`;
  const subtitle = "Controlled documents (bridge mode)";

  return (
    <PageLayout
      data-testid="project-documents-page"
      header={<PageHeader title={title} subtitle={subtitle} status={<Badge variant="outline">V2 bridge in progress</Badge>} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DocumentStrip projectId={projectId} />
        </div>
        <div>
          <ApprovalQueueCard />
        </div>
      </div>
    </PageLayout>
  );
}
