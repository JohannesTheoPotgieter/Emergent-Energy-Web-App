import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ListTodo,
  Plus,
  RefreshCw,
  AlertTriangle,
  FileText,
  Link2,
  Trash2,
  ArrowRightLeft,
} from "lucide-react";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ENGINEERING_DELIVERY_TASK_TYPE_TAGS,
  ENGINEERING_SEAM_TASK_TYPE_TAGS,
  ENGINEERING_TASK_TYPE_LABELS,
  requiresDocumentLink,
  type EngineeringDeliveryTaskTypeTag,
  type EngineeringSeamTaskTypeTag,
} from "@shared/engineering/delivery-task-catalog";
import { TASK_STATUSES, getTaskStatusLabel, getUniversalStatusBadgeClass } from "@shared/task-status";

/**
 * Engineering Task Manager (delivery-scope rebuild, Phase 2D).
 * Consumes the spine /api/engineering/tasks surface. Surfaces the doc-link
 * column + Done-gate, and seam handoffs. Replaces the legacy engineering-tasks.
 */

interface TaskListItem {
  id: number;
  title: string;
  projectId: number | null;
  projectName: string | null;
  taskTypeTag: string | null;
  status: string;
  priority: string | null;
  endDate: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  documentCount: number;
}

interface DocLink {
  id: number;
  managedDocumentId: number | null;
  projectDocumentLinkId: number | null;
  linkRole: string;
  createdAt: string;
}

interface Options {
  projects: { id: number; name: string }[];
  users: { id: number; name: string }[];
}

const NONE = "__none__";

function typeLabel(tag: string | null): string {
  if (!tag) return "—";
  return ENGINEERING_TASK_TYPE_LABELS[tag as keyof typeof ENGINEERING_TASK_TYPE_LABELS] ?? tag;
}

export default function EngineeringTaskManagerPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(NONE);
  const [typeFilter, setTypeFilter] = useState<string>(NONE);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const tasksQuery = useQuery<{ tasks: TaskListItem[] }>({ queryKey: ["/api/engineering/tasks"] });
  const optionsQuery = useQuery<Options>({ queryKey: ["/api/engineering/options"] });

  const tasks = tasksQuery.data?.tasks ?? [];
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== NONE && t.status !== statusFilter) return false;
      if (typeFilter !== NONE && t.taskTypeTag !== typeFilter) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [tasks, statusFilter, typeFilter, search]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks"] });
  }

  return (
    <PageShell>
      <SectionHeader
        icon={<ListTodo className="h-5 w-5" />}
        eyebrow="Engineering"
        title="Task Manager"
        description="Delivery tasks across the engineering discipline — from financial close to handover."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={tasksQuery.isFetching}>
              <RefreshCw className={cn("h-4 w-4", tasksQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="new-task">
              <Plus className="h-4 w-4" />
              New task
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="border-border bg-card">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Input
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-56"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{getTaskStatusLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>All types</SelectItem>
              {ENGINEERING_DELIVERY_TASK_TYPE_TAGS.map((t) => (
                <SelectItem key={t} value={t}>{ENGINEERING_TASK_TYPE_LABELS[t]}</SelectItem>
              ))}
              {ENGINEERING_SEAM_TASK_TYPE_TAGS.map((t) => (
                <SelectItem key={t} value={t}>{ENGINEERING_TASK_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {tasks.length}</span>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="mt-4 border-border bg-card">
        <CardContent className="p-0">
          {tasksQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}
            </div>
          ) : tasksQuery.isError ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <p className="text-sm text-muted-foreground">Couldn't load tasks.</p>
              <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" />Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {tasks.length === 0 ? "No engineering tasks yet. Create one to get started." : "No tasks match your filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Task</th>
                    <th className="px-4 py-2 font-medium">Project</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 text-center font-medium">Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr
                      key={t.id}
                      className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
                      onClick={() => setSelectedId(t.id)}
                      data-testid={`task-row-${t.id}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{t.title}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{t.projectName ?? "—"}</td>
                      <td className="px-4 py-2.5"><Badge variant="outline" className="font-normal">{typeLabel(t.taskTypeTag)}</Badge></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{t.ownerName ?? "Unassigned"}</td>
                      <td className="px-4 py-2.5"><Badge variant="secondary" className={cn("font-normal", getUniversalStatusBadgeClass(t.status))}>{getTaskStatusLabel(t.status)}</Badge></td>
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{t.endDate ?? "—"}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn("inline-flex items-center gap-1 text-xs", t.documentCount > 0 ? "text-emerald-600" : "text-muted-foreground")}>
                          <FileText className="h-3.5 w-3.5" />{t.documentCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        options={optionsQuery.data}
        onCreated={() => { refresh(); setCreateOpen(false); }}
      />

      <TaskDrawer
        task={selected}
        options={optionsQuery.data}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
        toast={toast}
        qc={qc}
      />
    </PageShell>
  );
}

// ── Create dialog ───────────────────────────────────────────────────────────

function CreateTaskDialog({
  open,
  onOpenChange,
  options,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  options?: Options;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [types, setTypes] = useState<Set<EngineeringDeliveryTaskTypeTag>>(new Set());
  const [projectId, setProjectId] = useState<string>(NONE);
  const [ownerId, setOwnerId] = useState<string>(NONE);
  const [due, setDue] = useState("");

  function reset() {
    setTitle(""); setTypes(new Set()); setProjectId(NONE); setOwnerId(NONE); setDue("");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const tagList = Array.from(types);
      const projectIdNum = projectId !== NONE ? Number(projectId) : undefined;
      const ownerIdNum = ownerId !== NONE ? Number(ownerId) : undefined;
      if (tagList.length > 1) {
        await apiRequest("POST", "/api/engineering/tasks/bulk", {
          taskTypeTags: tagList,
          projectId: projectIdNum,
          ownerUserId: ownerIdNum,
          dueDate: due || undefined,
        });
      } else {
        const tag = tagList[0];
        await apiRequest("POST", "/api/engineering/tasks", {
          title: title.trim() || ENGINEERING_TASK_TYPE_LABELS[tag],
          taskTypeTag: tag,
          projectId: projectIdNum,
          ownerUserId: ownerIdNum,
          endDate: due || undefined,
        });
      }
    },
    onSuccess: () => { toast({ title: "Task created" }); reset(); onCreated(); },
    onError: (e: unknown) => toast({ title: "Couldn't create task", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  function toggleType(tag: EngineeringDeliveryTaskTypeTag) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  const canSubmit = types.size > 0 && (types.size > 1 || title.trim().length > 0 || types.size === 1);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New engineering task</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Type(s)</Label>
            <div className="flex flex-wrap gap-1.5">
              {ENGINEERING_DELIVERY_TASK_TYPE_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    types.has(t) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  data-testid={`type-${t}`}
                >
                  {ENGINEERING_TASK_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {types.size > 1 ? <p className="text-xs text-muted-foreground">Creates one task per selected type.</p> : null}
          </div>
          {types.size <= 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the type name" />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {options?.projects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {options?.users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-due">Due date</Label>
            <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} data-testid="create-submit">
            {mutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task drawer ─────────────────────────────────────────────────────────────

type ToastFn = ReturnType<typeof useToast>["toast"];

function TaskDrawer({
  task,
  options,
  onClose,
  onChanged,
  toast,
  qc,
}: {
  task: TaskListItem | null;
  options?: Options;
  onClose: () => void;
  onChanged: () => void;
  toast: ToastFn;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const open = task != null;
  const taskId = task?.id ?? 0;
  const docsQuery = useQuery<{ links: DocLink[] }>({
    queryKey: ["/api/engineering/tasks", taskId, "documents"],
    enabled: open,
  });
  const links = docsQuery.data?.links ?? [];
  const docGated = task != null && requiresDocumentLink(task.taskTypeTag) && links.length === 0;

  const [docId, setDocId] = useState("");
  const [seamType, setSeamType] = useState<EngineeringSeamTaskTypeTag>(ENGINEERING_SEAM_TASK_TYPE_TAGS[0]);
  const [seamOwner, setSeamOwner] = useState<string>(NONE);
  const [seamNote, setSeamNote] = useState("");

  function invalidateDocs() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "documents"] });
    onChanged();
  }

  const statusMutation = useMutation({
    mutationFn: async (status: string) => apiRequest("PATCH", `/api/engineering/tasks/${taskId}/status`, { status }),
    onSuccess: () => { toast({ title: "Status updated" }); onChanged(); },
    onError: (e: unknown) => toast({ title: "Couldn't update status", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  const linkMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/engineering/tasks/${taskId}/documents`, { managedDocumentId: Number(docId) }),
    onSuccess: () => { toast({ title: "Document linked" }); setDocId(""); invalidateDocs(); },
    onError: (e: unknown) => toast({ title: "Couldn't link document", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => apiRequest("DELETE", `/api/engineering/tasks/${taskId}/documents/${linkId}`),
    onSuccess: () => { toast({ title: "Document unlinked" }); invalidateDocs(); },
  });

  const seamMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/engineering/tasks/seam", {
        seamType,
        toOwnerUserId: Number(seamOwner),
        title: `${task?.title ?? "Handoff"} — ${seamType === "compliance_input" ? "compliance input" : "construction snag"}`,
        note: seamNote || undefined,
        fromTaskId: taskId,
        projectId: task?.projectId ?? undefined,
      }),
    onSuccess: () => { toast({ title: "Seam handoff created" }); setSeamNote(""); setSeamOwner(NONE); onChanged(); },
    onError: (e: unknown) => toast({ title: "Couldn't create handoff", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {task ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{task.title}</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 py-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{typeLabel(task.taskTypeTag)}</Badge>
                {task.projectName ? <Badge variant="outline">{task.projectName}</Badge> : null}
                <Badge variant="outline">{task.ownerName ?? "Unassigned"}</Badge>
              </div>

              {/* Status + Done-gate */}
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={task.status} onValueChange={(s) => statusMutation.mutate(s)}>
                  <SelectTrigger data-testid="status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} disabled={s === "complete" && docGated}>
                        {getTaskStatusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {docGated ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" data-testid="done-gate-banner">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>This task produces a document — link one below before it can be marked done.</span>
                  </div>
                ) : null}
              </div>

              {/* Documents */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Linked documents</Label>
                  <span className="text-xs text-muted-foreground">{links.length}</span>
                </div>
                {links.length > 0 ? (
                  <ul className="space-y-1">
                    {links.map((l) => (
                      <li key={l.id} className="flex items-center justify-between rounded border border-border/60 px-2 py-1 text-xs">
                        <span className="text-muted-foreground">
                          {l.managedDocumentId ? `Doc #${l.managedDocumentId}` : `Project doc #${l.projectDocumentLinkId}`} · {l.linkRole}
                        </span>
                        <button onClick={() => unlinkMutation.mutate(l.id)} className="text-muted-foreground hover:text-red-600" aria-label="Unlink">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No documents linked.</p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={docId}
                    onChange={(e) => setDocId(e.target.value)}
                    placeholder="Managed document ID"
                    className="h-8"
                    inputMode="numeric"
                  />
                  <Button size="sm" variant="outline" disabled={!docId || linkMutation.isPending} onClick={() => linkMutation.mutate()}>
                    <Link2 className="h-3.5 w-3.5" />Link
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">A document picker arrives with the Document Manager (Phase 3).</p>
              </div>

              {/* Seam handoff */}
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <Label className="flex items-center gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5" />Seam handoff</Label>
                <Select value={seamType} onValueChange={(v) => setSeamType(v as EngineeringSeamTaskTypeTag)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENGINEERING_SEAM_TASK_TYPE_TAGS.map((t) => <SelectItem key={t} value={t}>{ENGINEERING_TASK_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={seamOwner} onValueChange={setSeamOwner}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Hand to…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Hand to…</SelectItem>
                    {options?.users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Textarea value={seamNote} onChange={(e) => setSeamNote(e.target.value)} placeholder="Note (optional)" className="min-h-[60px] text-sm" />
                <Button size="sm" variant="outline" className="w-full" disabled={seamOwner === NONE || seamMutation.isPending} onClick={() => seamMutation.mutate()}>
                  Create handoff
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
