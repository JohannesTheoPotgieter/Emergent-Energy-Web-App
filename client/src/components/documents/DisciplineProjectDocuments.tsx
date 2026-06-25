/**
 * DisciplineProjectDocuments — the body of the Engineering / Quality document
 * pages. Pick a project, then see that project's folders for this discipline
 * (plus the SharePoint connection status), all from the one canonical
 * ProjectDocumentsView. Engineering and Quality are just different discipline
 * filters over the same provisioned folder tree.
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useEngineeringProjectOptions } from "@/hooks/use-engineering-project-options";
import { ProjectDocumentsView } from "@/components/documents/ProjectDocumentsView";

export function DisciplineProjectDocuments({ discipline }: { discipline: string }) {
  // Shared by the Engineering AND Quality document pages: the active-execution-
  // window project picker (alphabetical, live delivery work only).
  const { options: projectOptions, isLoading } = useEngineeringProjectOptions();
  const [projectId, setProjectId] = useState<number | null>(null);

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
        <ProjectDocumentsView projectId={projectId} discipline={discipline} />
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
