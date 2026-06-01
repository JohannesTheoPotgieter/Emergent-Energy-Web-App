import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FolderOpen, Briefcase, FolderTree } from "lucide-react";
import type { CompanyRootSummary, DocumentRootScope } from "./types";

export interface ProjectBrowseOption {
  projectId: number;
  name: string;
}

export interface FolderBrowseOption {
  id: number;
  taxonomyKey: string;
  label: string;
}

interface Props {
  scope: DocumentRootScope;
  onScopeChange: (scope: DocumentRootScope) => void;
  // Company scope — browses a company_sharepoint_roots root.
  company: CompanyRootSummary[];
  selectedCompanyRootId: number | null;
  onCompanyRootSelect: (rootId: number) => void;
  // Project scope — folder-first: pick a project, then one of its provisioned
  // project_folders. There is no single "project root" in the canonical model.
  projects: ProjectBrowseOption[];
  projectsLoading?: boolean;
  selectedProjectId: number | null;
  onProjectSelect: (projectId: number) => void;
  folders: FolderBrowseOption[];
  foldersLoading?: boolean;
  selectedFolderId: number | null;
  onFolderSelect: (folderId: number) => void;
}

export function RootSelector({
  scope,
  onScopeChange,
  company,
  selectedCompanyRootId,
  onCompanyRootSelect,
  projects,
  projectsLoading,
  selectedProjectId,
  onProjectSelect,
  folders,
  foldersLoading,
  selectedFolderId,
  onFolderSelect,
}: Props) {
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

        <TabsContent value="project" className="mt-3 space-y-3">
          <Select
            value={selectedProjectId ? String(selectedProjectId) : ""}
            onValueChange={(v) => onProjectSelect(Number(v))}
            disabled={projectsLoading}
          >
            <SelectTrigger data-testid="documents-project-select">
              <SelectValue placeholder={projectsLoading ? "Loading…" : "Choose a project"} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.projectId} value={String(p.projectId)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedProjectId != null && (
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
              {foldersLoading ? (
                <p className="text-xs text-muted-foreground px-2 py-3">Loading folders…</p>
              ) : folders.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-3">
                  No provisioned folders for this project yet.
                </p>
              ) : (
                folders.map((f) => (
                  <Button
                    key={`folder-${f.id}`}
                    variant={selectedFolderId === f.id ? "secondary" : "ghost"}
                    className="justify-start text-left h-auto py-2"
                    onClick={() => onFolderSelect(f.id)}
                    data-testid={`documents-folder-${f.id}`}
                  >
                    <FolderTree className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate max-w-[200px]">{f.label}</span>
                  </Button>
                ))
              )}
            </div>
          )}
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
                variant={selectedCompanyRootId === r.id && scope === "company" ? "secondary" : "ghost"}
                className="justify-start text-left h-auto py-2"
                onClick={() => onCompanyRootSelect(r.id)}
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
