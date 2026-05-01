/**
 * D6 Phase 4 — DisciplinePanel.
 *
 * Shows the slice of a project's folder taxonomy that belongs to one
 * discipline (ENGINEERING, QUALITY, HSE, ...). Drives the per-discipline
 * panels on department pages.
 *
 * Joins client-side:
 *   /api/folder-taxonomy           (active rows + disciplines + lifecycle)
 *   /api/projects/:id/folders      (per-project SharePoint pointers)
 *
 * For each taxonomy row whose `disciplines` includes the supplied
 * discipline (or empty disciplines, which means "shared / all"), the
 * panel renders:
 *   - the SharePoint path
 *   - provisioning state (provisioned / not provisioned / verify error)
 *   - lifecycle mode + stage code (when set)
 *   - a deep-link affordance once webUrl is wired in a future phase
 *
 * Empty disciplines arrays on a taxonomy row are treated as "shared"
 * and surfaced in every discipline panel (per the planning conversation:
 * 13_Project Photos is shared across the company).
 */

import { useMemo, useState, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePublicFolderTaxonomy,
  useProjectFolders,
} from "@/hooks/use-document-management-admin";
import { FolderFiles } from "@/components/documents/FolderFiles";
import type { FolderTaxonomy } from "@shared/schema";
import {
  CheckCircle2, AlertTriangle, FolderTree, FolderX, ChevronDown, ChevronRight,
} from "lucide-react";

interface ProjectFolder {
  id: number;
  taxonomyKey: string;
  driveId: string | null;
  itemId: string | null;
  sharepointPath: string | null;
  webUrl: string | null;
  provisionedAt: string | null;
  verifyError: string | null;
}

interface JoinedRow {
  taxonomy: FolderTaxonomy;
  folder: ProjectFolder | null;
}

export interface DisciplinePanelProps {
  projectId: number;
  /** LIFECYCLE_DEPARTMENTS code, e.g. "ENGINEERING". */
  discipline: string;
  /** Optional title override (defaults to "{discipline} documents"). */
  title?: string;
  /** When true, also show rows whose `disciplines` array is empty (shared). */
  includeShared?: boolean;
}

export function DisciplinePanel({
  projectId,
  discipline,
  title,
  includeShared = true,
}: DisciplinePanelProps) {
  const taxonomy = usePublicFolderTaxonomy();
  const folders = useProjectFolders(projectId);
  const [expandedFolderId, setExpandedFolderId] = useState<number | null>(null);

  const isLoading = taxonomy.isLoading || folders.isLoading;
  const hasError = Boolean(taxonomy.error || folders.error);

  const rows: JoinedRow[] = useMemo(() => {
    const tax = taxonomy.data?.taxonomy ?? [];
    const folderMap = new Map(
      (folders.data?.folders ?? []).map((f) => [f.taxonomyKey, f] as const),
    );
    return tax
      .filter((t) => {
        if (!t.active) return false;
        const disciplines = (t.disciplines ?? []) as string[];
        if (disciplines.includes(discipline)) return true;
        if (includeShared && disciplines.length === 0) return true;
        return false;
      })
      .sort((a, b) => {
        // Top-level rows first, then by sort_order, then by displayName.
        const ap = a.parentKey ? 1 : 0;
        const bp = b.parentKey ? 1 : 0;
        if (ap !== bp) return ap - bp;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.displayName.localeCompare(b.displayName);
      })
      .map((t) => ({
        taxonomy: t,
        folder: folderMap.get(t.internalKey) ?? null,
      }));
  }, [taxonomy.data, folders.data, discipline, includeShared]);

  const summary = useMemo(() => {
    const total = rows.length;
    const provisioned = rows.filter((r) => r.folder?.itemId).length;
    const errors = rows.filter((r) => r.folder?.verifyError).length;
    return { total, provisioned, errors, missing: total - provisioned };
  }, [rows]);

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
            ) : (
              <>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-50 text-emerald-700"
                  data-testid={`discipline-summary-provisioned-${discipline}`}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {summary.provisioned} provisioned
                </Badge>
                {summary.missing > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-amber-50 text-amber-800"
                    data-testid={`discipline-summary-missing-${discipline}`}
                  >
                    <FolderX className="h-3 w-3 mr-1" />
                    {summary.missing} missing
                  </Badge>
                )}
                {summary.errors > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-rose-50 text-rose-700"
                    data-testid={`discipline-summary-errors-${discipline}`}
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {summary.errors} errors
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            No folders mapped to <strong>{discipline}</strong> yet. Edit the folder taxonomy under
            <em> /admin/document-management </em> to assign folders to this discipline.
          </div>
        ) : (
          <Table data-testid={`discipline-table-${discipline}`}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6"></TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>SharePoint path</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ taxonomy: t, folder }) => {
                const expandable = Boolean(folder?.id && folder.itemId);
                const isExpanded = expandable && expandedFolderId === folder!.id;
                return (
                  <Fragment key={t.internalKey}>
                    <TableRow data-testid={`discipline-row-${discipline}-${t.internalKey}`}>
                      <TableCell>
                        {expandable && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() =>
                              setExpandedFolderId(isExpanded ? null : folder!.id)
                            }
                            data-testid={`btn-folder-toggle-${discipline}-${t.internalKey}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="text-sm font-medium">{t.displayName}</div>
                          {t.parentKey && (
                            <div className="text-[10px] font-mono text-muted-foreground">
                              under {t.parentKey}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.lifecycleMode === "pre_construction" && "Pre-construction"}
                        {t.lifecycleMode === "full_lifecycle" && "Full lifecycle"}
                        {t.lifecycleMode === "both" && "Both"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{t.stageCode ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {folder?.webUrl ? (
                          <a
                            href={folder.webUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-emerald-700 hover:underline"
                            data-testid={`discipline-link-${discipline}-${t.internalKey}`}
                          >
                            {folder.sharepointPath ?? "Open in SharePoint"}
                          </a>
                        ) : (
                          <span className="font-mono text-muted-foreground">
                            {folder?.sharepointPath ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DisciplineFolderStatus folder={folder} />
                      </TableCell>
                    </TableRow>
                    {isExpanded && folder?.id && (
                      <TableRow data-testid={`discipline-files-row-${discipline}-${t.internalKey}`}>
                        <TableCell colSpan={6} className="bg-muted/30 p-0">
                          <FolderFiles
                            projectId={projectId}
                            folderId={folder.id}
                            testIdSuffix={`${discipline}-${t.internalKey}`}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DisciplineFolderStatus({ folder }: { folder: ProjectFolder | null }) {
  if (!folder || !folder.itemId) {
    return (
      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800">
        Not provisioned
      </Badge>
    );
  }
  if (folder.verifyError) {
    return (
      <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Verify error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      Provisioned
    </Badge>
  );
}
