/**
 * DocumentGrid — card-grid alternative to FileListTable for the discipline
 * workspace. Same data + callbacks; List/Grid is a per-user preference. Folders
 * and files share the tile shape; files carry a status chip when tracked.
 */

import { Folder, FileText } from "lucide-react";
import type { GraphItem } from "./types";
import { DocumentStatusChip, FileTypeIcon, type ManagedDocState } from "./document-display";

interface Props {
  items: GraphItem[];
  isLoading: boolean;
  onOpen: (item: GraphItem) => void;
  statusByItemId?: Record<string, ManagedDocState | null | undefined>;
  selectedItemId?: string | null;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export function DocumentGrid({ items, isLoading, onOpen, statusByItemId, selectedItemId }: Props) {
  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (items.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">This folder is empty.</div>;
  }
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-4"
      data-testid="documents-grid"
    >
      {items.map((item) => {
        const state = statusByItemId?.[item.id] ?? null;
        const selected = selectedItemId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item)}
            className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 ${
              selected ? "border-emerald-300 bg-emerald-50/70" : "border-border"
            }`}
            data-testid={`documents-grid-tile-${item.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <FileTypeIcon name={item.name} isFolder={item.isFolder} size="lg" />
              {!item.isFolder && state ? <DocumentStatusChip state={state} /> : null}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium" title={item.name}>
                {item.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                {item.isFolder ? (
                  <Folder className="h-3 w-3" />
                ) : (
                  <FileText className="h-3 w-3" />
                )}
                <span>{formatDate(item.lastModifiedDateTime)}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
