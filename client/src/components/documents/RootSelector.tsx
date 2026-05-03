import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FolderOpen, Briefcase } from "lucide-react";
import type { CompanyRootSummary, DocumentRootScope, ProjectRootSummary } from "./types";

interface Props {
  scope: DocumentRootScope;
  onScopeChange: (scope: DocumentRootScope) => void;
  projects: ProjectRootSummary[];
  company: CompanyRootSummary[];
  selectedRootId: number | null;
  onRootSelect: (rootId: number) => void;
}

export function RootSelector({ scope, onScopeChange, projects, company, selectedRootId, onRootSelect }: Props) {
  return (
    <div className="space-y-3">
      <Tabs value={scope} onValueChange={(v) => onScopeChange(v as DocumentRootScope)}>
        <TabsList>
          <TabsTrigger value="project" data-testid="documents-scope-project">
            <Briefcase className="h-3.5 w-3.5 mr-1.5" />
            Projects
          </TabsTrigger>
          <TabsTrigger value="company" data-testid="documents-scope-company">
            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
            Company
          </TabsTrigger>
        </TabsList>
        <TabsContent value="project" className="mt-3">
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
            {projects.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3">
                No project SharePoint roots configured yet.
              </p>
            )}
            {projects.map((p) => (
              <Button
                key={`project-${p.id}`}
                variant={selectedRootId === p.id && scope === "project" ? "secondary" : "ghost"}
                className="justify-start text-left h-auto py-2"
                onClick={() => onRootSelect(p.id)}
                data-testid={`documents-root-project-${p.id}`}
              >
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium truncate max-w-[220px]">{p.name}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                    {p.projectCode ? `${p.projectCode} · ` : ""}
                    {p.rootPath}
                  </span>
                </div>
              </Button>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="company" className="mt-3">
          <div className="flex flex-col gap-1">
            {company.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3">
                No company-wide SharePoint roots configured yet.
              </p>
            )}
            {company.map((r) => (
              <Button
                key={`company-${r.id}`}
                variant={selectedRootId === r.id && scope === "company" ? "secondary" : "ghost"}
                className="justify-start text-left h-auto py-2"
                onClick={() => onRootSelect(r.id)}
                data-testid={`documents-root-company-${r.id}`}
              >
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium">{r.displayName}</span>
                  <span className="text-xs text-muted-foreground">{r.rootPath}</span>
                </div>
              </Button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
