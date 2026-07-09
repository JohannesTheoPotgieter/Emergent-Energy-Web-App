/**
 * Project-scoped Engineering Tasks tab.
 *
 * Renders the canonical routed Engineering board (EngineeringTaskManagerPage)
 * in `embedded` project-locked mode: same list / Kanban / My Tasks / Timeline
 * views, cards, filters, drawer and bulk actions, scoped to a single project.
 * The project-scoped "Generate from Template" action (admin only), an optional
 * initial status filter, and an optional initial view (e.g. Timeline) are passed
 * through. Page-level chrome (hero title, saved views) is suppressed via the
 * board's `embedded` flag so it sits cleanly inside the project detail page.
 *
 * The board is lazy-loaded so it stays in its own bundle chunk and does not
 * bloat the already-large project-detail page. (This file is now a thin lazy
 * boundary + prop adapter; the previous project-tab board was retired in favour
 * of the routed board.)
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const EngineeringTaskManagerPage = lazy(() => import("@/pages/engineering/EngineeringTaskManagerPage"));

type EmbeddedView = "list" | "kanban" | "mytasks" | "timeline";

interface ProjectEngineeringTasksTabProps {
  projectInfoId: number | null;
  isAdmin?: boolean;
  projectName: string;
  initialStatusFilter?: string;
  initialView?: EmbeddedView;
}

export function ProjectEngineeringTasksTab({
  projectInfoId,
  isAdmin,
  projectName,
  initialStatusFilter,
  initialView,
}: ProjectEngineeringTasksTabProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground" data-testid="eng-board-loading">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading board…
        </div>
      }
    >
      <EngineeringTaskManagerPage
        embedded
        lockedProjectId={projectInfoId ?? undefined}
        lockedProjectName={projectName}
        initialStatusFilter={initialStatusFilter}
        initialView={initialView}
        canGenerateFromTemplate={isAdmin ?? false}
      />
    </Suspense>
  );
}
