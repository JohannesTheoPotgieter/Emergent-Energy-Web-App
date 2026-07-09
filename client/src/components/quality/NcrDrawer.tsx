import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { qFetch } from "@/lib/quality-ui-helpers";
import { Loader2, Send, Ban, ArrowRight } from "lucide-react";

// NCR status machine (mirrors server/lib/quality-ncr-state-machine.ts).
const STATUS_ORDER = ["open", "investigating", "corrective_action", "verification", "closed"] as const;
const TERMINAL = new Set(["closed", "waived"]);
const SEVERITIES = ["minor", "major", "critical"] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  investigating: "Investigating",
  corrective_action: "Corrective Action",
  verification: "Verification",
  closed: "Closed",
  waived: "Waived",
};

function nextStatus(from: string): string | null {
  if (TERMINAL.has(from)) return null;
  const idx = STATUS_ORDER.indexOf(from as (typeof STATUS_ORDER)[number]);
  return idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
}

interface NcrDetail {
  ncr: {
    id: number;
    projectId: number;
    title: string;
    description: string | null;
    severity: string;
    status: string;
    rootCause: string | null;
    correctiveAction: string | null;
    preventiveAction: string | null;
    assignedTo: number | null;
    dueDate: string | null;
    waiverReason: string | null;
  };
  comments: Array<{ id: number; comment: string; userName: string | null; createdAt: string }>;
  attachments: Array<{ id: number; fileName: string; filePath: string }>;
}

interface EditState {
  title: string;
  description: string;
  severity: string;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  assignedTo: string;
  dueDate: string;
}

export function NcrDrawer({ ncrId, open, onOpenChange }: { ncrId: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { allowed: canEdit } = usePermission("pd_quality", "edit");

  const [edit, setEdit] = useState<EditState | null>(null);
  const [comment, setComment] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [showWaive, setShowWaive] = useState(false);

  const { data, isLoading, isError } = useQuery<NcrDetail>({
    queryKey: ["quality-ncr-detail", ncrId],
    queryFn: () => qFetch(`/api/quality/ncrs/${ncrId}`),
    enabled: open && ncrId !== null,
  });

  // Seed the edit form when the record loads / changes.
  useEffect(() => {
    if (data?.ncr) {
      setEdit({
        title: data.ncr.title ?? "",
        description: data.ncr.description ?? "",
        severity: data.ncr.severity ?? "major",
        rootCause: data.ncr.rootCause ?? "",
        correctiveAction: data.ncr.correctiveAction ?? "",
        preventiveAction: data.ncr.preventiveAction ?? "",
        assignedTo: data.ncr.assignedTo != null ? String(data.ncr.assignedTo) : "",
        dueDate: data.ncr.dueDate ?? "",
      });
      setShowWaive(false);
      setWaiveReason("");
    }
  }, [data?.ncr?.id]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["quality-ncr-detail", ncrId] });
    queryClient.invalidateQueries({ queryKey: ["quality-ncrs"] });
  };

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      qFetch(`/api/quality/ncrs/${ncrId}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); toast({ title: "NCR updated" }); },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) =>
      qFetch(`/api/quality/ncrs/${ncrId}/comments`, { method: "POST", body: JSON.stringify({ comment: text }) }),
    onSuccess: () => { setComment(""); invalidate(); },
    onError: (err: Error) => toast({ title: "Comment failed", description: err.message, variant: "destructive" }),
  });

  const waiveMutation = useMutation({
    mutationFn: (reason: string) =>
      qFetch(`/api/quality/ncrs/${ncrId}/waive`, { method: "POST", body: JSON.stringify({ override_reason: reason }) }),
    onSuccess: () => { setShowWaive(false); setWaiveReason(""); invalidate(); toast({ title: "NCR waived" }); },
    onError: (err: Error) => toast({ title: "Waive failed", description: err.message, variant: "destructive" }),
  });

  const ncr = data?.ncr;
  const advanceTo = ncr ? nextStatus(ncr.status) : null;

  const saveEdits = () => {
    if (!edit) return;
    // null clears the field (Task 0.2); empty strings for text fields → null.
    updateMutation.mutate({
      title: edit.title.trim(),
      description: edit.description.trim() || null,
      severity: edit.severity,
      root_cause: edit.rootCause.trim() || null,
      corrective_action: edit.correctiveAction.trim() || null,
      preventive_action: edit.preventiveAction.trim() || null,
      assigned_to: edit.assignedTo.trim() === "" ? null : Number(edit.assignedTo),
      due_date: edit.dueDate.trim() || null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="ncr-drawer">
        <SheetHeader>
          <SheetTitle>{ncr ? `NCR #${ncr.id}` : "NCR"}</SheetTitle>
          <SheetDescription>Non-conformance report — raise, edit, comment, transition, waive or close.</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : isError || !ncr || !edit ? (
          <div className="py-16 text-center text-sm text-muted-foreground" data-testid="ncr-drawer-error">Couldn't load this NCR. It may have been deleted.</div>
        ) : (
          <div className="space-y-5 py-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" data-testid="ncr-status">{STATUS_LABEL[ncr.status] ?? ncr.status}</Badge>
              <Badge variant="outline" className={ncr.severity === "critical" ? "text-red-600" : ncr.severity === "major" ? "text-amber-600" : ""}>{ncr.severity}</Badge>
            </div>

            {ncr.status === "waived" && ncr.waiverReason && (
              <div className="text-xs rounded-md border bg-muted px-3 py-2"><span className="font-medium">Waiver reason:</span> {ncr.waiverReason}</div>
            )}

            {/* Transition + waive/close actions */}
            {canEdit && !TERMINAL.has(ncr.status) && (
              <div className="flex flex-wrap gap-2">
                {advanceTo && (
                  <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ status: advanceTo })} disabled={updateMutation.isPending} data-testid="ncr-advance">
                    <ArrowRight className="w-3.5 h-3.5 mr-1" /> Move to {STATUS_LABEL[advanceTo]}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="text-amber-700" onClick={() => setShowWaive((v) => !v)} data-testid="ncr-waive-toggle">
                  <Ban className="w-3.5 h-3.5 mr-1" /> Waive
                </Button>
              </div>
            )}

            {showWaive && (
              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-xs">Waiver reason (authorised override)</Label>
                <Textarea value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} rows={2} data-testid="ncr-waive-reason" />
                <Button size="sm" onClick={() => waiveMutation.mutate(waiveReason.trim())} disabled={!waiveReason.trim() || waiveMutation.isPending} data-testid="ncr-waive-submit">Confirm waiver</Button>
              </div>
            )}

            {/* Editable fields */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Title</Label>
                <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} disabled={!canEdit} data-testid="ncr-edit-title" />
              </div>
              <div>
                <Label className="text-xs">Severity</Label>
                <Select value={edit.severity} onValueChange={(v) => setEdit({ ...edit, severity: v })} disabled={!canEdit}>
                  <SelectTrigger data-testid="ncr-edit-severity"><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Assignee (user id)</Label>
                  <Input value={edit.assignedTo} onChange={(e) => setEdit({ ...edit, assignedTo: e.target.value })} placeholder="unassigned" disabled={!canEdit} data-testid="ncr-edit-assignee" />
                </div>
                <div>
                  <Label className="text-xs">Due date</Label>
                  <Input type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} disabled={!canEdit} data-testid="ncr-edit-due" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={2} disabled={!canEdit} data-testid="ncr-edit-description" />
              </div>
              <div>
                <Label className="text-xs">Root cause</Label>
                <Textarea value={edit.rootCause} onChange={(e) => setEdit({ ...edit, rootCause: e.target.value })} rows={2} disabled={!canEdit} />
              </div>
              <div>
                <Label className="text-xs">Corrective action</Label>
                <Textarea value={edit.correctiveAction} onChange={(e) => setEdit({ ...edit, correctiveAction: e.target.value })} rows={2} disabled={!canEdit} />
              </div>
              <div>
                <Label className="text-xs">Preventive action</Label>
                <Textarea value={edit.preventiveAction} onChange={(e) => setEdit({ ...edit, preventiveAction: e.target.value })} rows={2} disabled={!canEdit} />
              </div>
              {canEdit && (
                <Button size="sm" onClick={saveEdits} disabled={updateMutation.isPending} data-testid="ncr-save">
                  {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Save changes
                </Button>
              )}
            </div>

            {/* Comments */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments</Label>
              <div className="space-y-2" data-testid="ncr-comments">
                {(data?.comments ?? []).length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
                {(data?.comments ?? []).map((c) => (
                  <div key={c.id} className="text-xs rounded-md border bg-muted px-2.5 py-1.5">
                    <div className="text-muted-foreground">{c.userName ?? "User"}</div>
                    <div>{c.comment}</div>
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={1} placeholder="Add a comment…" data-testid="ncr-comment-input" />
                  <Button size="sm" variant="outline" onClick={() => commentMutation.mutate(comment.trim())} disabled={!comment.trim() || commentMutation.isPending} data-testid="ncr-comment-submit">
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Raise a new NCR (Task 1.1). Compact dialog: pick a project, title, severity.
// ---------------------------------------------------------------------------
export function NcrCreateDialog({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Array<{ projectId: number; projectName: string }>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<string>("major");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) { setProjectId(""); setTitle(""); setSeverity("major"); setDescription(""); }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      qFetch(`/api/quality/ncrs`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-ncrs"] });
      toast({ title: "NCR raised" });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Couldn't raise NCR", description: err.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!projectId || !title.trim()) return;
    createMutation.mutate({
      project_id: Number(projectId),
      title: title.trim(),
      severity,
      description: description.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="ncr-create-dialog">
        <DialogHeader><DialogTitle>Raise NCR</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="ncr-create-project"><SelectValue placeholder="Select a project…" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.projectId} value={String(p.projectId)}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="ncr-create-title" />
          </div>
          <div>
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger data-testid="ncr-create-severity"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!projectId || !title.trim() || createMutation.isPending} data-testid="ncr-create-submit">
            {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Raise NCR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
