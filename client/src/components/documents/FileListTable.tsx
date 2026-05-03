import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Folder, FileText, Lock, Download } from "lucide-react";
import type { GraphItem } from "./types";

interface Props {
  items: GraphItem[];
  isLoading: boolean;
  onOpen: (item: GraphItem) => void;
  onDownload: (item: GraphItem) => void;
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

export function FileListTable({ items, isLoading, onOpen, onDownload }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Modified</TableHead>
          <TableHead>Modified by</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell colSpan={5} className="text-sm text-muted-foreground py-8 text-center">
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!isLoading && items.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-sm text-muted-foreground py-8 text-center">
              Empty folder.
            </TableCell>
          </TableRow>
        )}
        {items.map((item) => (
          <TableRow
            key={item.id}
            className="cursor-pointer hover:bg-muted/40"
            onClick={() => onOpen(item)}
            data-testid={`documents-row-${item.id}`}
          >
            <TableCell>
              <div className="flex items-center gap-2">
                {item.isFolder ? (
                  <Folder className="h-4 w-4 text-emerald-600" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{item.name}</span>
                {item.checkedOutBy && (
                  <Badge variant="outline" className="text-[10px]">
                    <Lock className="h-3 w-3 mr-1" />
                    Checked out
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(item.lastModifiedDateTime)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {item.lastModifiedBy?.displayName ?? "—"}
            </TableCell>
            <TableCell className="text-right text-xs text-muted-foreground">
              {item.isFolder ? "—" : formatSize(item.size)}
            </TableCell>
            <TableCell className="text-right">
              {!item.isFolder && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload(item);
                  }}
                  data-testid={`documents-download-${item.id}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
