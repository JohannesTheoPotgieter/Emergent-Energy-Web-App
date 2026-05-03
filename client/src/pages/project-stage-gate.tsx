import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/layout/page-shell";
import { StageDetailPanel } from "@/components/stage-lifecycle/StageDetailPanel";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { findProjectById, findProjectByName } from "@/lib/project-route-identity";

export default function ProjectStageGatePage() {
  const [isNameRoute, nameParams] = useRoute("/project/:projectName/gate/:stageCode");
  const [isIdRoute, idParams] = useRoute("/project/id/:projectId/gate/:stageCode");
  const [, setLocation] = useLocation();
  const { projectsSummary, isLoading } = useProjectsSummary();
  const { user } = useAuth();

  const projectNameFromRoute = isNameRoute && nameParams?.projectName ? decodeURIComponent(nameParams.projectName) : "";
  const projectIdFromRoute = isIdRoute && idParams?.projectId ? Number(idParams.projectId) : null;
  const stageCode = (isIdRoute ? idParams?.stageCode : nameParams?.stageCode) ? decodeURIComponent((isIdRoute ? idParams?.stageCode : nameParams?.stageCode) as string) : "";
  const projectByName = findProjectByName(projectsSummary as any[] | undefined, projectNameFromRoute);
  const projectById = findProjectById(projectsSummary as any[] | undefined, projectIdFromRoute);
  const projectInfo = projectById ?? projectByName;
  const projectInfoId = projectInfo?.project_info_id;
  const projectName = projectInfo?.project_name ?? projectNameFromRoute;

  const isAdmin = ["COO_ADMIN", "CEO_ADMIN"].includes(user?.role || "");

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    setLocation(projectInfoId ? `/project/id/${projectInfoId}` : `/project/${encodeURIComponent(projectName)}`);
  };

  if (isLoading) {
    return (
      <PageShell className="p-3 md:p-4 space-y-3">
        <Button variant="outline" size="sm" onClick={handleBack} className="w-fit">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <p className="text-sm text-muted-foreground">Loading gate details...</p>
      </PageShell>
    );
  }

  if (!projectInfoId || !stageCode) {
    return (
      <PageShell className="p-3 md:p-4 space-y-3">
        <Button variant="outline" size="sm" onClick={handleBack} className="w-fit">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Gate details could not be loaded for this project.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="p-3 md:p-4 space-y-3">
      <Button variant="outline" size="sm" onClick={handleBack} className="w-fit" data-testid="button-back-project-gate">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back
      </Button>

      <StageDetailPanel
        projectId={projectInfoId}
        stageCode={stageCode}
        isAdmin={isAdmin}
      />
    </PageShell>
  );
}
