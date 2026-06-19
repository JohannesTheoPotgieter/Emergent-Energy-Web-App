import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import type {
  ExecutionReviewItem,
  ExecItemSeverity,
  ExecItemStatus,
  PlanTaskView,
  AssignableUser,
  SupplierListRow,
  InstallerRow,
} from "@/lib/execution-types";

const SEVERITIES: ExecItemSeverity[] = ["low", "medium", "high", "critical"];
const STATUSES: ExecItemStatus[] = ["open", "flagged", "actioned", "closed"];

// ─────────────────────────── D1: Add / edit flag (+ D4 link) ──────────────────
export function FlagDialog({
  projectId,
  item,
  planTasks,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: number;
  item?: ExecutionReviewItem | null;
  planTasks: PlanTaskView[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(item);
  const [category, setCategory] = useState("schedule");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<ExecItemSeverity>("medium");
  const [status, setStatus] = useState<ExecItemStatus>("open");
  const [tags, setTags] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [planTaskNo, setPlanTaskNo] = useState<string>("");
  const [taskFilter, setTaskFilter] = useState("");

  const owners = useQuery<AssignableUser[]>({ queryKey: ["/api/pm-assignable-users"], enabled: open });
  const [ownerUserId, setOwnerUserId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setCategory(item?.category ?? "schedule");
    setTitle(item?.title ?? "");
    setDetail(item?.detail ?? "");
    setSeverity(item?.severity ?? "medium");
    setStatus(item?.status ?? "open");
    setTags((item?.tags ?? []).join(", "));
    setDueDate(item?.dueDate ?? "");
    setPlanTaskNo(item?.planTaskNo ?? "");
    setOwnerUserId(item?.ownerUserId != null ? String(item.ownerUserId) : "");
    setTaskFilter("");
  }, [open, item]);

  const filteredTasks = useMemo(() => {
    const f = taskFilter.trim().toLowerCase();
    const leaves = planTasks.filter((t) => t.taskNo);
    if (!f) return leaves.slice(0, 50);
    return leaves.filter((t) => `${t.taskNo} ${t.taskName}`.toLowerCase().includes(f)).slice(0, 50);
  }, [planTasks, taskFilter]);

  const save = useMutation({
    mutationFn: async () => {
      const linked = planTasks.find((t) => t.taskNo === planTaskNo);
      const body = {
        category: category.trim() || "general",
        title: title.trim(),
        detail: detail.trim() || null,
        severity,
        status,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        ownerUserId: ownerUserId ? Number(ownerUserId) : null,
        dueDate: dueDate || null,
        planTaskNo: planTaskNo || null,
        planWorkItemId: linked && planTaskNo ? null : null,
      };
      if (isEdit && item) {
        await apiRequest("PATCH", `/api/execution-review/items/${item.id}`, body);
      } else {
        await apiRequest("POST", "/api/execution-review/items", { ...body, projectId });
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Flag updated" : "Flag added" });
      onSaved();
      onOpenChange(false);
    },
    onError: () => toast({ title: "Could not save flag", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit flag" : "Add flag"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Category</span>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="schedule" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Severity</span>
              <Select value={severity} onValueChange={(v) => setSeverity(v as ExecItemSeverity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="text-sm block">
            <span className="text-muted-foreground">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs attention?" />
          </label>
          <label className="text-sm block">
            <span className="text-muted-foreground">Detail</span>
            <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Status</span>
              <Select value={status} onValueChange={(v) => setStatus(v as ExecItemStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Owner</span>
              <Select value={ownerUserId} onValueChange={setOwnerUserId}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {(owners.data ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Due date</span>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Tags (comma-separated)</span>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="council, mv" />
            </label>
          </div>
          {/* D4 — link to a plan task */}
          <div className="text-sm">
            <span className="text-muted-foreground">Link to plan task (optional)</span>
            <Input className="mb-1" value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} placeholder="search WBS…" />
            <Select value={planTaskNo} onValueChange={setPlanTaskNo}>
              <SelectTrigger><SelectValue placeholder="No linked task" /></SelectTrigger>
              <SelectContent>
                {filteredTasks.map((t) => (
                  <SelectItem key={t.taskNo} value={t.taskNo as string}>
                    {t.taskNo} · {t.taskName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
            {isEdit ? "Save" : "Add flag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── D2: Allocate subcontractor / supplier ────────────
export function AllocateDialog({
  projectId,
  assignment,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: number;
  assignment?: InstallerRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(assignment);
  const [type, setType] = useState<"INSTALLER" | "SUPPLIER">("INSTALLER");
  const [counterpartyId, setCounterpartyId] = useState<string>("");
  const [workPackage, setWorkPackage] = useState("");
  const [scope, setScope] = useState("");
  const [status, setStatus] = useState("active");

  const suppliers = useQuery<SupplierListRow[]>({ queryKey: ["/api/subcontractor-dashboard/supplier-list"], enabled: open });

  useEffect(() => {
    if (!open) return;
    setType("INSTALLER");
    setCounterpartyId(assignment ? String(assignment.counterpartyId) : "");
    setWorkPackage(assignment?.workPackage ?? "");
    setScope(assignment?.scopeDescription ?? "");
    setStatus(assignment?.status ?? "active");
  }, [open, assignment]);

  const filteredSuppliers = useMemo(() => {
    const rows = suppliers.data ?? [];
    return rows.filter((r) => (r.type_default ?? "").toUpperCase() === type || type === "INSTALLER");
  }, [suppliers.data, type]);

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit && assignment) {
        await apiRequest("PATCH", `/api/subcontractor-assignments/${assignment.id}`, {
          workPackage: workPackage || null,
          scopeDescription: scope || null,
          status,
        });
      } else {
        await apiRequest("POST", "/api/subcontractor-assignments", {
          projectId,
          counterpartyId: Number(counterpartyId),
          workPackage: workPackage || null,
          scopeDescription: scope || null,
        });
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Allocation updated" : "Allocated" });
      onSaved();
      onOpenChange(false);
    },
    onError: () => toast({ title: "Could not save allocation", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit allocation" : "Allocate subcontractor / supplier"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!isEdit && (
            <>
              <div className="flex gap-2">
                {(["INSTALLER", "SUPPLIER"] as const).map((t) => (
                  <Button key={t} size="sm" variant={type === t ? "default" : "outline"} onClick={() => setType(t)}>
                    {t === "INSTALLER" ? "Subcontractor" : "Supplier"}
                  </Button>
                ))}
              </div>
              <label className="text-sm block">
                <span className="text-muted-foreground">Counterparty</span>
                <Select value={counterpartyId} onValueChange={setCounterpartyId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {filteredSuppliers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name_canonical}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </>
          )}
          <label className="text-sm block">
            <span className="text-muted-foreground">Work package</span>
            <Input value={workPackage} onChange={(e) => setWorkPackage(e.target.value)} placeholder="e.g. AC installation" />
          </label>
          <label className="text-sm block">
            <span className="text-muted-foreground">Scope</span>
            <Textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={2} />
          </label>
          {isEdit && (
            <label className="text-sm block">
              <span className="text-muted-foreground">Status</span>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["active", "completed", "suspended", "terminated"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || (!isEdit && !counterpartyId)}
          >
            {isEdit ? "Save" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── D3: Assign PM ────────────────────────────────────
export function AssignPmDialog({
  projectId,
  currentPmName,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: number;
  currentPmName: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string>("");
  const pms = useQuery<AssignableUser[]>({ queryKey: ["/api/pm-assignable-users"], enabled: open });

  useEffect(() => {
    if (open) setUserId("");
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      const user = (pms.data ?? []).find((u) => String(u.id) === userId);
      if (!user) return;
      await apiRequest("PATCH", `/api/project-info/${projectId}/assign-pm`, {
        pm: user.name,
        pmUserId: user.id,
      });
    },
    onSuccess: () => {
      toast({ title: "PM assigned" });
      onSaved();
      onOpenChange(false);
    },
    onError: () => toast({ title: "Could not assign PM", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign PM</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Current: {currentPmName ?? "Unassigned"}</p>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Select PM…" /></SelectTrigger>
            <SelectContent>
              {(pms.data ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!userId || save.isPending}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
