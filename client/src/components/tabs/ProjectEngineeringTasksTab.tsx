/**
 * Project-scoped Engineering Tasks tab.
 *
 * Renders the global Engineering Task Board (EngineeringTasksPage) locked to a
 * single project: identical Kanban columns, cards, filters, task drawer and bulk
 * actions, scoped by projectId. The project-scoped "Generate from Template"
 * action (admin only) and an optional initial status filter are passed through.
 * Page-level chrome (hero title, saved-view controls, walkthroughs, URL sync and
 * keyboard shortcuts) is suppressed via the board's `embedded` flag so it sits
 * cleanly inside the project detail page.
 *
 * The board is lazy-loaded so it stays in its own bundle chunk and does not
 * bloat the already-large project-detail page.
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const EngineeringTasksPage = lazy(() => import("@/pages/EngineeringTasksPage"));

interface ProjectEngineeringTasksTabProps {
  projectInfoId: number | null;
  isAdmin?: boolean;
  projectName: string;
  initialStatusFilter?: string;
}

export function ProjectEngineeringTasksTab({ projectInfoId, isAdmin, projectName, initialStatusFilter }: ProjectEngineeringTasksTabProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground" data-testid="eng-board-loading">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading board…
        </div>
      }
    >
      <EngineeringTasksPage
        embedded
        lockedProjectId={projectInfoId ?? undefined}
        lockedProjectName={projectName}
        initialStatusFilter={initialStatusFilter}
        canGenerateFromTemplate={isAdmin ?? false}
      />
    </Suspense>
  );
}
