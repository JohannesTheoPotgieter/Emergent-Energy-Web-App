import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Lock, Download, MoreHorizontal, Pencil } from "lucide-react";
import type { GraphItem } from "./types";
import { DocumentStatusChip, FileTypeIcon, type ManagedDocState } from "./document-display";

interface Props {
  items: GraphItem[];
  isLoading: boolean;
  onOpen: (item: GraphItem) => void;
  onDownload: (item: GraphItem) => void;
  /** Optional rename affordance (kebab menu). */
  onRename?: (item: GraphItem) => void;
  /** Optional tracked managed-doc state per itemId → renders a status chip. */
  statusByItemId?: Record<string, ManagedDocState | null | undefined>;
  /** Currently-selected item (drawer open). Highlights the row. */
  selectedItemId?: string | null;
  /** Show the richer Status / Rev / Owner columns (discipline workspace). */
  rich?: boolean;
}

function formatSize(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export function FileListTable({
  items,
  isLoading,
  onOpen,
  onDownload,
  onRename,
  statusByItemId,
  selectedItemId,
  rich = false,
}: Props) {
  const colCount = rich ? 6 : 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          {rich && <TableHead>Status</TableHead>}
          {rich && <TableHead>Owner</TableHead>}
          <TableHead>Modified</TableHead>
          {!rich && <TableHead>Modified by</TableHead>}
          {!rich && <TableHead className="text-right">Size</TableHead>}
          <TableHead className="w-16 text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell colSpan={colCount} className="text-sm text-muted-foreground py-8 text-center">
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!isLoading && items.length === 0 && (
          <TableRow>
            <TableCell colSpan={colCount} className="text-sm text-muted-foreground py-8 text-center">
              This folder is empty.
            </TableCell>
          </TableRow>
        )}
        {items.map((item) => {
          const state = statusByItemId?.[item.id] ?? null;
          return (
            <TableRow
              key={item.id}
              className={`cursor-pointer hover:bg-muted/40 ${selectedItemId === item.id ? "bg-emerald-50/70" : ""}`}
              onClick={() => onOpen(item)}
              data-testid={`documents-row-${item.id}`}
            >
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <FileTypeIcon name={item.name} isFolder={item.isFolder} />
                  <span className="text-sm font-medium">{item.name}</span>
                  {item.checkedOutBy && (
                    <Badge variant="outline" className="text-[10px]">
                      <Lock className="h-3 w-3 mr-1" />
                      Checked out
                    </Badge>
                  )}
                </div>
              </TableCell>
              {rich && (
                <TableCell>
                  {!item.isFolder && state ? <DocumentStatusChip state={state} /> : null}
                </TableCell>
              )}
              {rich && (
                <TableCell className="text-xs text-muted-foreground">
                  {item.lastModifiedBy?.displayName ?? "—"}
                </TableCell>
              )}
              <TableCell className="text-xs text-muted-foreground">{formatDate(item.lastModifiedDateTime)}</TableCell>
              {!rich && (
                <TableCell className="text-xs text-muted-foreground">
                  {item.lastModifiedBy?.displayName ?? "—"}
                </TableCell>
              )}
              {!rich && (
                <TableCell className="text-right text-xs text-muted-foreground">
                  {item.isFolder ? "—" : formatSize(item.size)}
                </TableCell>
              )}
              <TableCell className="text-right">
                {onRename ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`Actions for ${item.name}`}
                        data-testid={`documents-actions-${item.id}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      {!item.isFolder && (
                        <DropdownMenuItem
                          onClick={() => onDownload(item)}
                          data-testid={`documents-download-${item.id}`}
                        >
                          <Download className="mr-2 h-3.5 w-3.5" />
                          Download
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onRename(item)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  !item.isFolder && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload(item);
                      }}
                      aria-label={`Download ${item.name}`}
                      data-testid={`documents-download-${item.id}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
