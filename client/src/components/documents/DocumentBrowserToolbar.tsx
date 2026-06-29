/**
 * DocumentBrowserToolbar — the center-pane toolbar for the discipline document
 * workspace: breadcrumb (left) + search / sort / list-grid toggle / new-folder /
 * upload (right). Pure presentational; all state is owned by the workspace.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpDown, FolderPlus, LayoutGrid, List, Search, Upload,
} from "lucide-react";
import { DocumentsBreadcrumb, type Crumb } from "@/components/documents/Breadcrumb";

export type DocumentSortKey = "name" | "modified";
export type DocumentViewMode = "list" | "grid";

interface Props {
  discipline: string;
  rootLabel: string;
  crumbs: Crumb[];
  onNavigateCrumb: (index: number) => void;

  search: string;
  onSearchChange: (value: string) => void;

  sort: DocumentSortKey;
  onSortChange: (sort: DocumentSortKey) => void;

  view: DocumentViewMode;
  onViewChange: (view: DocumentViewMode) => void;

  canProvision: boolean;
  onNewFolder: () => void;
  onUpload: () => void;
}

const SORT_LABEL: Record<DocumentSortKey, string> = {
  name: "Name",
  modified: "Modified",
};

export function DocumentBrowserToolbar({
  discipline,
  rootLabel,
  crumbs,
  onNavigateCrumb,
  search,
  onSearchChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  canProvision,
  onNewFolder,
  onUpload,
}: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
      data-testid={`discipline-toolbar-${discipline}`}
    >
      <DocumentsBreadcrumb rootLabel={rootLabel} crumbs={crumbs} onNavigate={onNavigateCrumb} />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search documents…"
            className="h-8 w-[200px] pl-8 text-sm"
            data-testid={`discipline-search-${discipline}`}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8" data-testid={`discipline-sort-${discipline}`}>
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
              Sort: {SORT_LABEL[sort]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSortChange("name")}>Name</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSortChange("modified")}>Modified</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center rounded-md border" role="group" aria-label="View mode">
          <Button
            size="sm"
            variant={view === "list" ? "secondary" : "ghost"}
            className="h-8 rounded-r-none px-2.5"
            onClick={() => onViewChange("list")}
            aria-label="List view"
            aria-pressed={view === "list"}
            data-testid={`discipline-view-list-${discipline}`}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant={view === "grid" ? "secondary" : "ghost"}
            className="h-8 rounded-l-none px-2.5"
            onClick={() => onViewChange("grid")}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            data-testid={`discipline-view-grid-${discipline}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
        </div>

        {canProvision && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={onNewFolder}
              data-testid={`discipline-new-folder-${discipline}`}
            >
              <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
              New folder
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={onUpload}
              data-testid={`discipline-upload-${discipline}`}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Upload
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
