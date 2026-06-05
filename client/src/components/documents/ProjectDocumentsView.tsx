/**
 * ProjectDocumentsView — the single, canonical per-project documents surface.
 *
 * One code path, used in three places:
 *   - the standalone /projects/:id/documents page
 *   - the project detail "Documents" department tab
 *   - the Engineering / Quality document pages (via the `discipline` prop)
 *
 * It always leads with the SharePoint connection status, then the per-
 * discipline folder tree (folder_taxonomy + project_folders) and the
 * managed-document approvals waiting on the user. SharePoint stays the
 * source of truth; this only renders metadata + Graph deep links.
 */

import { useMemo, useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePublicFolderTaxonomy,
  useProjectFolders,
} from "@/hooks/use-document-management-admin";
import { DisciplinePanel } from "@/components/documents/DisciplinePanel";
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
  const taxonomy = usePublicFolderTaxonomy();
  const folders = useProjectFolders(projectId);

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

  useEffect(() => {
    if (discipline) return; // single-discipline mode ignores the tab state
    if (activeTab) return;
    if (
      initialDiscipline &&
      (disciplinesWithRows as readonly string[]).includes(initialDiscipline)
    ) {
      setActiveTab(initialDiscipline);
      return;
    }
    setActiveTab(disciplinesWithRows[0] ?? "ALL");
  }, [activeTab, initialDiscipline, disciplinesWithRows, discipline]);

  // ---- Single-discipline mode (Engineering / Quality) ----
  if (discipline) {
    return (
      <div className="space-y-4" data-testid={`project-documents-view-${discipline}`}>
        {showConnection && <ProjectSharepointConnectionCard projectId={projectId} />}
        {showApprovals && (
          <ManagedDocumentApprovalQueue projectId={projectId} title="Approvals waiting on you" />
        )}
        <DisciplinePanel projectId={projectId} discipline={discipline} />
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
          {disciplinesWithRows.map((d) => {
            const stat = folderCountByDiscipline.get(d);
            return (
              <TabsTrigger key={d} value={d} data-testid={`tab-discipline-${d}`} className="gap-2">
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
