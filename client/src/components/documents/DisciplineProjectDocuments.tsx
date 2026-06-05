/**
 * DisciplineProjectDocuments — the body of the Engineering / Quality document
 * pages. Pick a project, then see that project's folders for this discipline
 * (plus the SharePoint connection status), all from the one canonical
 * ProjectDocumentsView. Engineering and Quality are just different discipline
 * filters over the same provisioned folder tree.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import { ProjectDocumentsView } from "@/components/documents/ProjectDocumentsView";

export function DisciplineProjectDocuments({ discipline }: { discipline: string }) {
  const { projectsSummary, isLoading } = useProjectsSummary();
  const [projectId, setProjectId] = useState<number | null>(null);

  const projectOptions = useMemo(
    () =>
      (projectsSummary ?? [])
        .filter((p) => typeof p.project_info_id === "number")
        .map((p) => ({ id: p.project_info_id as number, name: p.project_name })),
    [projectsSummary],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="space-y-1 min-w-[280px] max-w-md">
            <label className="text-xs font-medium">Project</label>
            <Select
              value={projectId ? String(projectId) : ""}
              onValueChange={(v) => setProjectId(Number(v))}
              disabled={isLoading}
            >
              <SelectTrigger data-testid={`select-${discipline}-documents-project`}>
                <SelectValue placeholder={isLoading ? "Loading…" : "Choose a project"} />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {projectId ? (
        <ProjectDocumentsView
          projectId={projectId}
          discipline={discipline}
          showApprovals={false}
        />
      ) : (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            Pick a project above to see its {discipline.toLowerCase()} folders and SharePoint
            connection status.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
