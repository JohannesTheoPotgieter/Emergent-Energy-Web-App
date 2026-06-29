/**
 * ProjectDocumentsView — the single, canonical per-project documents surface.
 *
 * One code path, used in three places:
 *   - the standalone /projects/:id/documents page
 *   - the project detail "Documents" department tab
 *   - the Engineering / Quality document pages (via the `discipline` prop)
 *
 * It always leads with the SharePoint connection status, then the per-
 * discipline bound-folder tree (project_discipline_folders) and the
 * managed-document approvals waiting on the user. SharePoint stays the
 * source of truth; this only renders metadata + Graph deep links.
 */

import { useMemo, useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDisciplineFolders } from "@/hooks/use-discipline-folders";
import { DisciplinePanel } from "@/components/documents/DisciplinePanel";
import { DisciplineWorkspace } from "@/components/documents/DisciplineWorkspace";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { ProjectReadinessCard } from "@/components/documents/ProjectReadinessCard";
import { ProjectSharepointConnectionCard } from "@/components/documents/ProjectSharepointConnectionCard";
import { LIFECYCLE_DEPARTMENTS } from "@shared/schema";

export interface ProjectDocumentsViewProps {
  projectId: number;
  /** When set, collapse to a single discipline (Engineering / Quality pages). */
  discipline?: string;
  /** Show the SharePoint connection status banner (default true). */
  showConnection?: boolean;
  /** Show the readiness summary card (default true; hidden in discipline mode). */
  showReadiness?: boolean;
  /** Show the "approvals waiting on you" queue (default true). */
  showApprovals?: boolean;
}

export function ProjectDocumentsView({
  projectId,
  discipline,
  showConnection = true,
  showReadiness = true,
  showApprovals = true,
}: ProjectDocumentsViewProps) {
  const folders = useDisciplineFolders(projectId);

  const initialDiscipline = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("discipline");
  }, []);
  const [activeTab, setActiveTab] = useState<string | null>(initialDiscipline);

  // Show every discipline that has a bound folder, falling back to the full
  // department list so users can still see (and bind) every discipline.
  const boundDisciplines = useMemo(() => {
    const present = new Set((folders.data?.folders ?? []).map((f) => f.discipline));
    return present;
  }, [folders.data]);

  const disciplinesWithRows = useMemo(
    () => LIFECYCLE_DEPARTMENTS.filter((d) => boundDisciplines.has(d)),
    [boundDisciplines],
  );

  const displayDisciplines = useMemo<string[]>(
    () => (disciplinesWithRows.length > 0 ? disciplinesWithRows : [...LIFECYCLE_DEPARTMENTS]),
    [disciplinesWithRows],
  );

  useEffect(() => {
    if (discipline) return; // single-discipline mode ignores the tab state
    if (activeTab) return;
    if (
      initialDiscipline &&
      (displayDisciplines as readonly string[]).includes(initialDiscipline)
    ) {
      setActiveTab(initialDiscipline);
      return;
    }
    setActiveTab(displayDisciplines[0] ?? "ALL");
  }, [activeTab, initialDiscipline, displayDisciplines, discipline]);

  // ---- Single-discipline mode (Engineering / Quality) ----
  //
  // The reworked three-pane workspace. Connection status, approvals, folder
  // binding and the file browser are all composed inside DisciplineWorkspace
  // (left rail + center browser + detail drawer) — the standalone connection
  // card / approvals queue / binder card and the duplicate file list are gone.
  //
  // Here the project is fixed (this consumer is given one projectId), so the
  // rail's project selector reflects that single project. The Engineering /
  // Quality pages drive a full multi-project rail via DisciplineProjectDocuments.
  if (discipline) {
    return (
      <div data-testid={`project-documents-view-${discipline}`}>
        <DisciplineWorkspace
          discipline={discipline}
          projectScope="all"
          projectOptions={[{ id: projectId, name: `Project #${projectId}` }]}
          projectsLoading={false}
          projectId={projectId}
          onProjectChange={() => {}}
        />
      </div>
    );
  }

  // ---- Full project view (standalone page + project detail tab) ----
  return (
    <div className="space-y-4" data-testid="project-documents-view">
      {showConnection && <ProjectSharepointConnectionCard projectId={projectId} />}
      {showReadiness && <ProjectReadinessCard projectId={projectId} />}
      {showApprovals && (
        <ManagedDocumentApprovalQueue projectId={projectId} title="Approvals waiting on you" />
      )}

      <Tabs value={activeTab ?? "ALL"} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="ALL" data-testid="tab-discipline-ALL">
            All disciplines
          </TabsTrigger>
          {displayDisciplines.map((d) => (
            <TabsTrigger key={d} value={d} data-testid={`tab-discipline-${d}`} className="gap-2">
              <span>{d}</span>
              {boundDisciplines.has(d) && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700"
                  data-testid={`tab-discipline-bound-${d}`}
                >
                  bound
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ALL" className="mt-4">
          <AllDisciplinesView projectId={projectId} disciplines={displayDisciplines} />
        </TabsContent>

        {displayDisciplines.map((d) => (
          <TabsContent key={d} value={d} className="mt-4">
            <DisciplinePanel projectId={projectId} discipline={d} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
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
        <DisciplinePanel key={d} projectId={projectId} discipline={d} includeShared={false} />
      ))}
    </div>
  );
}
