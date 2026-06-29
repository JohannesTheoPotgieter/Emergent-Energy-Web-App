/**
 * LinkDocumentDialog — browse the project's bound Engineering folder and link
 * file(s) to a task (mockup dialog #1). Reuses the discipline folder browser
 * (`useDocumentChildren` on a `{ kind: "discipline" }` target) plus the shared
 * file-type icon + status chip helpers.
 *
 * Linking flow per picked file:
 *   1. resolve (and server-side ensure-track) its managedDocumentId via the
 *      discipline item-detail endpoint (`fetchDisciplineItemDetail`),
 *   2. POST /api/engineering/tasks/:id/documents { managedDocumentId }.
 *
 * Already-linked files are surfaced as "Linked" and cannot be re-picked.
 */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Search, Loader2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import {
  FileTypeIcon,
  DocumentStatusChip,
  type ManagedDocState,
} from "@/components/documents/document-display";
import { useDocumentChildren } from "@/components/documents/use-documents";
import type { GraphItem } from "@/components/documents/types";
import { ENGINEERING_DISCIPLINE, fetchDisciplineItemDetail } from "./task-doc-shared";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskId: number;
  taskTitle: string;
  projectId: number | null;
  /** Already-linked managed-document ids (shown as "Linked", non-pickable). */
  linkedDocIds: Set<number>;
  /** Bubble up the toast + invalidation; resolves after links are written. */
  onLinked: (count: number) => void;
  onError: (message: string) => void;
}

interface Crumb {
  itemId: string | null;
  name: string;
}

export function LinkDocumentDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  projectId,
  linkedDocIds,
  onLinked,
  onError,
}: Props) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ itemId: null, name: "Engineering" }]);
  const [search, setSearch] = useState("");
  // Files selected for linking, keyed by drive itemId → display name.
  const [picked, setPicked] = useState<Record<string, string>>({});

  const target = projectId != null ? ({ kind: "discipline", projectId, discipline: ENGINEERING_DISCIPLINE } as const) : null;
  const parentItemId = crumbs[crumbs.length - 1]?.itemId ?? null;
  const childrenQuery = useDocumentChildren(target, parentItemId);

  const items = useMemo(() => {
    const raw = childrenQuery.data?.items ?? [];
    const q = search.trim().toLowerCase();
    const list = q ? raw.filter((i) => i.name.toLowerCase().includes(q)) : raw;
    // Folders first, then files; each alphabetical (mirrors the doc workspace).
    return [...list].sort((a, b) =>
      a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1,
    );
  }, [childrenQuery.data, search]);

  function reset() {
    setCrumbs([{ itemId: null, name: "Engineering" }]);
    setSearch("");
    setPicked({});
  }

  function openFolder(item: GraphItem) {
    setCrumbs((c) => [...c, { itemId: item.id, name: item.name }]);
    setSearch("");
  }

  function navigateTo(index: number) {
    setCrumbs((c) => c.slice(0, index + 1));
    setSearch("");
  }

  function togglePick(item: GraphItem) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item.name;
      return next;
    });
  }

  const pickedIds = Object.keys(picked);

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("This task has no project, so it has no document folder to browse.");
      let linked = 0;
      for (const itemId of pickedIds) {
        // Resolve (ensure-track) the managed document for this browsed file …
        const detail = await fetchDisciplineItemDetail(projectId, ENGINEERING_DISCIPLINE, itemId);
        const managedDocumentId = detail.managedDocument?.id;
        if (managedDocumentId == null) continue;
        if (linkedDocIds.has(managedDocumentId)) continue;
        // … then link it to the task.
        await apiRequest("POST", `/api/engineering/tasks/${taskId}/documents`, { managedDocumentId });
        linked += 1;
      }
      return linked;
    },
    onSuccess: (linked) => {
      onLinked(linked);
      reset();
      onOpenChange(false);
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Couldn't link the document."),
  });

  const pickedCount = pickedIds.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg" data-testid="task-link-doc-dialog">
        <DialogHeader>
          <DialogTitle>Link a document to “{taskTitle}”</DialogTitle>
          <DialogDescription>Browse this project's SharePoint folders and pick the file(s).</DialogDescription>
        </DialogHeader>

        {projectId == null ? (
          <p className="py-6 text-sm text-muted-foreground">
            This task has no project, so there is no document folder to browse.
          </p>
        ) : (
          <div className="space-y-2">
            {/* Breadcrumb */}
            <nav className="flex flex-wrap items-center gap-0.5 px-0.5 text-xs text-muted-foreground" aria-label="Folder path">
              {crumbs.map((c, idx) => (
                <span key={`${c.itemId ?? "root"}-${idx}`} className="flex items-center gap-0.5">
                  {idx > 0 ? <ChevronRight className="h-3 w-3" aria-hidden /> : null}
                  <button
                    type="button"
                    onClick={() => navigateTo(idx)}
                    className={cn(
                      "rounded px-1 py-0.5 hover:text-foreground",
                      idx === crumbs.length - 1 && "font-semibold text-foreground",
                    )}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search this project's documents…"
                className="h-9 pl-9"
                aria-label="Search documents"
                data-testid="task-link-doc-search"
              />
            </div>

            {/* File / folder list */}
            <div className="max-h-72 space-y-0.5 overflow-y-auto" role="listbox" aria-label="Documents">
              {childrenQuery.isLoading ? (
                <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : childrenQuery.isError ? (
                <p className="px-2 py-6 text-sm text-muted-foreground">Couldn't load this folder.</p>
              ) : items.length === 0 ? (
                <p className="px-2 py-6 text-sm text-muted-foreground">This folder is empty.</p>
              ) : (
                items.map((item) =>
                  item.isFolder ? (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openFolder(item)}
                      className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left text-sm hover:bg-muted/50"
                      data-testid={`task-link-folder-${item.id}`}
                    >
                      <FileTypeIcon name={item.name} isFolder />
                      <span className="flex-1 font-medium">{item.name}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </button>
                  ) : (
                    <FilePickRow
                      key={item.id}
                      item={item}
                      checked={!!picked[item.id]}
                      onToggle={() => togglePick(item)}
                    />
                  ),
                )
              )}
            </div>
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground" data-testid="task-link-doc-count">
            {pickedCount} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => linkMutation.mutate()}
              disabled={pickedCount === 0 || linkMutation.isPending || projectId == null}
              data-testid="task-link-doc-submit"
            >
              {linkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Linking…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Link {pickedCount || ""} document{pickedCount === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilePickRow({
  item,
  checked,
  onToggle,
}: {
  item: GraphItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md border px-2 py-2 text-sm",
        checked ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50",
      )}
      data-testid={`task-link-file-${item.id}`}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select ${item.name}`} />
      <FileTypeIcon name={item.name} isFolder={false} />
      <span className="flex-1 font-medium">{item.name}</span>
      {item.checkedOutBy ? (
        <DocumentStatusChip state={"in_review" as ManagedDocState} />
      ) : null}
    </label>
  );
}
