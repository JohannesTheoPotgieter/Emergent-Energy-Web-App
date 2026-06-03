/**
 * Per-project Documents page — the canonical project-documents surface.
 *
 * Route: /projects/:projectId/documents
 *
 * Thin wrapper: the actual surface (SharePoint connection status +
 * per-discipline folder tree + approvals) lives in <ProjectDocumentsView>,
 * which is shared with the project detail "Documents" tab and the
 * Engineering / Quality document pages so there is a single code path.
 */

import { useParams } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { useProjectDetail } from "@/hooks/use-project-v2";
import { ProjectDocumentsView } from "@/components/documents/ProjectDocumentsView";

export default function ProjectDocumentsPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr);
  const isValid = Number.isFinite(projectId) && projectId > 0;
  const project = useProjectDetail(isValid ? projectId : undefined);

  if (!isValid) return <PageError message="Invalid project id" />;
  if (project.isLoading) return <PageSkeleton />;
  if (project.error) return <PageError message="Failed to load project" />;

  const title = project.data?.project?.projectName ?? `Project #${projectId}`;

  return (
    <PageLayout
      data-testid="project-documents-page"
      header={<PageHeader title={title} subtitle="Documents" />}
    >
      <ProjectDocumentsView projectId={projectId} />
    </PageLayout>
  );
}
