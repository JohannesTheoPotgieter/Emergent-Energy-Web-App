/**
 * DisciplinePanel — per-discipline document surface (browse-and-bind model).
 *
 * Shows the SharePoint folder bound to one discipline (ENGINEERING, QUALITY,
 * HSE, ...) for a project, plus its live contents. Drives the per-discipline
 * panels on department pages.
 *
 * Reads:
 *   GET /api/projects/:id/discipline-folders                     (bound folder)
 *   GET /api/projects/:id/discipline-folders/:discipline/documents (contents)
 *
 * SharePoint stays the source of truth; this only renders metadata + Graph
 * deep links. Binding/unbinding lives in DisciplineFolderBinder.
 */

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDisciplineFolders,
  useDisciplineFolderDocuments,
} from "@/hooks/use-discipline-folders";
import {
  CheckCircle2, FolderTree, FolderX, ExternalLink, File, Folder,
} from "lucide-react";

export interface DisciplinePanelProps {
  projectId: number;
  /** LIFECYCLE_DEPARTMENTS code, e.g. "ENGINEERING". */
  discipline: string;
  /** Optional title override (defaults to "{discipline} documents"). */
  title?: string;
  /** Retained for API compatibility; no longer used (shared rows are gone). */
  includeShared?: boolean;
}

export function DisciplinePanel({
  projectId,
  discipline,
  title,
}: DisciplinePanelProps) {
  const foldersQuery = useDisciplineFolders(projectId);

  const folder = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  const docsQuery = useDisciplineFolderDocuments(projectId, discipline, !!folder);

  const isLoading = foldersQuery.isLoading;
  const hasError = Boolean(foldersQuery.error);

  const items = docsQuery.data?.items ?? [];
  const heading = title ?? `${discipline} documents`;

  if (hasError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Failed to load discipline folders.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`discipline-panel-${discipline}`}>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{heading}</h3>
          <div className="ml-auto flex flex-wrap gap-1">
            {isLoading ? (
              <Skeleton className="h-5 w-32" />
            ) : folder ? (
              <Badge
                variant="outline"
                className="text-[10px] bg-emerald-50 text-emerald-700"
                data-testid={`discipline-summary-bound-${discipline}`}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Folder bound
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] bg-amber-50 text-amber-800"
                data-testid={`discipline-summary-unbound-${discipline}`}
              >
                <FolderX className="h-3 w-3 mr-1" />
                No folder bound
              </Badge>
            )}
          </div>
        </div>

        {folder?.sharepointPath && (
          <div className="text-xs">
            {folder.webUrl ? (
              <a
                href={folder.webUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-emerald-700 hover:underline"
                data-testid={`discipline-link-${discipline}`}
              >
                <ExternalLink className="h-3 w-3" />
                {folder.sharepointPath}
              </a>
            ) : (
              <span className="font-mono text-muted-foreground">{folder.sharepointPath}</span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !folder ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            No SharePoint folder bound to <strong>{discipline}</strong> yet. Use the binder above to
            connect this project's <em>{discipline.toLowerCase()}</em> folder.
          </div>
        ) : docsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : docsQuery.isError ? (
          <div className="rounded-md border p-4 text-sm text-destructive">
            Couldn't load this folder's contents.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            This folder is empty.
          </div>
        ) : (
          <Table data-testid={`discipline-table-${discipline}`}>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.itemId}
                  data-testid={`discipline-row-${discipline}-${item.itemId}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {item.isFolder ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      ) : (
                        <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm truncate" title={item.name}>{item.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.state ? (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {item.state.replace(/_/g, " ")}
                      </Badge>
                    ) : !item.isFolder ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        untracked
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.webUrl ? (
                      <a
                        href={item.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-emerald-700"
                        title="Open in SharePoint"
                        data-testid={`discipline-file-link-${discipline}-${item.itemId}`}
                      >
                        <ExternalLink className="inline-block h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
