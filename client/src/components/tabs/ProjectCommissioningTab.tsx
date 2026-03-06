import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Plus,
  Circle,
  Clock,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Trash2,
  RotateCcw,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return d;
  }
}

type ItemStatus = "not_started" | "in_progress" | "ready_for_review" | "approved" | "closed";

interface CommissioningItem {
  id: number;
  title: string;
  description: string | null;
  item_type: "commissioning" | "closeout";
  owner_name: string | null;
  owner_user_id: number | null;
  due_date: string | null;
  status: ItemStatus;
  evidence_notes: string | null;
  gate_id: number | null;
  category: string | null;
  sort_order: number | null;
  completed_at: string | null;
}

interface ProgressRow {
  category: string;
  item_type: string;
  total: number;
  completed: number;
  in_progress: number;
  review: number;
}

const STATUS_CONFIG: Record<ItemStatus, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  not_started: { icon: <Circle className="w-4 h-4 text-gray-400" />, label: "Not Started", color: "text-gray-500", bg: "bg-gray-100" },
  in_progress: { icon: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />, label: "In Progress", color: "text-blue-600", bg: "bg-blue-50" },
  ready_for_review: { icon: <Clock className="w-4 h-4 text-amber-500" />, label: "Ready for Review", color: "text-amber-600", bg: "bg-amber-50" },
  approved: { icon: <CheckCircle2 className="w-4 h-4 text-green-600" />, label: "Approved", color: "text-green-600", bg: "bg-green-50" },
  closed: { icon: <CheckCheck className="w-4 h-4 text-slate-600" />, label: "Closed", color: "text-slate-600", bg: "bg-slate-100" },
};

const VALID_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  not_started: ["in_progress"],
  in_progress: ["ready_for_review", "not_started"],
  ready_for_review: ["approved", "in_progress"],
  approved: ["closed"],
  closed: [],
};

interface ProjectCommissioningTabProps {
  projectId: number;
  projectName: string;
}

export function ProjectCommissioningTab({ projectId, projectName }: ProjectCommissioningTabProps) {
  const queryClient = useQueryClient();
  const [itemType, setItemType] = useState<"commissioning" | "closeout">("commissioning");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: items = [], isLoading } = useQuery<CommissioningItem[]>({
    queryKey: ["commissioning-items", projectId, itemType],
    queryFn: async () => {
      const res = await fetch(`/api/commissioning/project/${projectId}?itemType=${itemType}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load items");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: progress = [] } = useQuery<ProgressRow[]>({
    queryKey: ["commissioning-progress", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/commissioning/progress/${projectId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load progress");
      return res.json();
    },
    enabled: !!projectId,
  });

  const filteredProgress = useMemo(() => progress.filter((p) => p.item_type === itemType), [progress, itemType]);

  const overallTotal = filteredProgress.reduce((s, p) => s + p.total, 0);
  const overallCompleted = filteredProgress.reduce((s, p) => s + p.completed, 0);
  const overallPct = overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0;

  const grouped = useMemo(() => {
    const map: Record<string, CommissioningItem[]> = {};
    items.forEach((item) => {
      const cat = item.category || "Uncategorized";
      if (!map[cat]) map[cat] = [];
      map[cat].push(item);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999)));
    return map;
  }, [items]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["commissioning-items", projectId] });
    queryClient.invalidateQueries({ queryKey: ["commissioning-progress", projectId] });
  };

  const patchMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/commissioning/${id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/commissioning/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      setExpandedId(null);
      invalidateAll();
    },
  });

  return (
    <div className="space-y-4" data-testid="project-commissioning-tab">
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 rounded-lg p-0.5" data-testid="toggle-item-type">
          <button
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${itemType === "commissioning" ? "bg-white shadow text-[#16A34A]" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setItemType("commissioning")}
            data-testid="btn-toggle-commissioning"
          >
            Commissioning
          </button>
          <button
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${itemType === "closeout" ? "bg-white shadow text-[#16A34A]" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setItemType("closeout")}
            data-testid="btn-toggle-closeout"
          >
            Closeout
          </button>
        </div>
        <Button
          size="sm"
          className="bg-[#16A34A] hover:bg-[#15803d] text-white gap-1"
          onClick={() => setShowCreate(true)}
          data-testid="btn-create-item"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </Button>
      </div>

      <Card className="bg-white">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800" data-testid="text-overall-progress-label">
              Overall Progress
            </span>
            <span className="text-sm font-bold text-[#16A34A]" data-testid="text-overall-progress-pct">
              {overallPct}%
            </span>
          </div>
          <Progress value={overallPct} className="h-2.5 [&>div]:bg-[#16A34A]" data-testid="progress-overall" />

          {filteredProgress.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {filteredProgress.map((p) => {
                const pct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;
                return (
                  <div key={p.category} className="flex items-center gap-2" data-testid={`progress-category-${p.category}`}>
                    <span className="text-xs text-gray-600 min-w-[80px] truncate">{p.category}</span>
                    <Progress value={pct} className="h-1.5 flex-1 [&>div]:bg-[#16A34A]" />
                    <span className="text-[10px] text-gray-500 tabular-nums w-10 text-right">{p.completed}/{p.total}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading checklist...
        </div>
      ) : items.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No {itemType} items yet.</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add Item" to create your first checklist item.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, catItems]) => (
            <div key={category} data-testid={`category-group-${category}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{category}</span>
                <span className="text-[10px] text-gray-400">
                  ({catItems.filter((i) => i.status === "approved" || i.status === "closed").length}/{catItems.length})
                </span>
              </div>
              <div className="space-y-1">
                {catItems.map((item) => (
                  <ChecklistItem
                    key={item.id}
                    item={item}
                    isExpanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    onStatusChange={(status) => patchMutation.mutate({ id: item.id, data: { status } })}
                    onUpdateNotes={(notes) => patchMutation.mutate({ id: item.id, data: { evidenceNotes: notes } })}
                    onReassign={(userId) => patchMutation.mutate({ id: item.id, data: { ownerUserId: userId } })}
                    onDelete={() => deleteMutation.mutate(item.id)}
                    isPending={patchMutation.isPending || deleteMutation.isPending}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateItemDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        projectId={projectId}
        defaultType={itemType}
        onCreated={invalidateAll}
      />
    </div>
  );
}

function ChecklistItem({
  item,
  isExpanded,
  onToggle,
  onStatusChange,
  onUpdateNotes,
  onReassign,
  onDelete,
  isPending,
}: {
  item: CommissioningItem;
  isExpanded: boolean;
  onToggle: () => void;
  onStatusChange: (s: ItemStatus) => void;
  onUpdateNotes: (n: string) => void;
  onReassign: (userId: number) => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const cfg = STATUS_CONFIG[item.status];
  const transitions = VALID_TRANSITIONS[item.status];
  const [notes, setNotes] = useState(item.evidence_notes || "");
  const isOverdue = item.due_date && new Date(item.due_date) < new Date() && item.status !== "closed" && item.status !== "approved";

  const { data: users = [] } = useQuery<{ id: number; fullName: string }[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isExpanded,
    staleTime: 60000,
  });

  const userOptions = useMemo(
    () => users.map((u) => ({ value: String(u.id), label: u.fullName || `User ${u.id}` })),
    [users]
  );

  return (
    <Card className={`bg-white transition-all ${isExpanded ? "ring-1 ring-[#16A34A]/30 shadow-sm" : "hover:shadow-sm"}`} data-testid={`checklist-item-${item.id}`}>
      <CardContent className="p-0">
        <button
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
          onClick={onToggle}
          data-testid={`btn-expand-item-${item.id}`}
        >
          <div className="shrink-0" data-testid={`status-icon-${item.id}`}>
            {cfg.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium truncate ${item.status === "closed" ? "line-through text-gray-400" : "text-gray-800"}`} data-testid={`text-item-title-${item.id}`}>
                {item.title}
              </span>
              <Badge className={`text-[9px] ${cfg.bg} ${cfg.color} border-0`} data-testid={`badge-status-${item.id}`}>
                {cfg.label}
              </Badge>
              {isOverdue && (
                <Badge className="text-[9px] bg-red-50 text-red-600 border-0" data-testid={`badge-overdue-${item.id}`}>
                  Overdue
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
              {item.owner_name && <span data-testid={`text-owner-${item.id}`}>{item.owner_name}</span>}
              {item.due_date && (
                <span className={isOverdue ? "text-red-500 font-medium" : ""} data-testid={`text-due-${item.id}`}>
                  Due {formatDate(item.due_date)}
                </span>
              )}
            </div>
          </div>
          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3" data-testid={`expanded-panel-${item.id}`}>
            {item.description && (
              <p className="text-xs text-gray-600" data-testid={`text-description-${item.id}`}>{item.description}</p>
            )}

            <div>
              <Label className="text-xs text-gray-500 mb-1">Evidence / Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => { if (notes !== (item.evidence_notes || "")) onUpdateNotes(notes); }}
                placeholder="Add evidence notes, observations, or references..."
                className="text-xs min-h-[60px] bg-white"
                data-testid={`textarea-evidence-${item.id}`}
              />
            </div>

            <div>
              <Label className="text-xs text-gray-500 mb-1">Reassign Owner</Label>
              <SearchableSelect
                options={userOptions}
                value={item.owner_user_id ? String(item.owner_user_id) : ""}
                onValueChange={(v) => { if (v) onReassign(Number(v)); }}
                placeholder="Select owner..."
                searchPlaceholder="Search users..."
                triggerClassName="h-8 text-xs w-full"
                data-testid={`select-reassign-owner-${item.id}`}
              />
            </div>

            {transitions.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Move to:</span>
                {transitions.map((t) => {
                  const tCfg = STATUS_CONFIG[t];
                  return (
                    <Button
                      key={t}
                      size="sm"
                      variant="outline"
                      className={`h-7 text-xs gap-1 ${tCfg.color} hover:${tCfg.bg}`}
                      onClick={() => onStatusChange(t)}
                      disabled={isPending}
                      data-testid={`btn-transition-${item.id}-${t}`}
                    >
                      {tCfg.icon}
                      {tCfg.label}
                    </Button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t border-gray-50">
              <div className="flex items-center gap-2 text-[10px] text-gray-400">
                {item.completed_at && <span>Completed {formatDate(item.completed_at)}</span>}
                {item.gate_id && <span>Gate #{item.gate_id}</span>}
                {item.sort_order != null && <span>Order: {item.sort_order}</span>}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 gap-1"
                onClick={() => { if (confirm("Delete this item?")) onDelete(); }}
                disabled={isPending}
                data-testid={`btn-delete-item-${item.id}`}
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateItemDialog({
  open,
  onOpenChange,
  projectId,
  defaultType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  defaultType: "commissioning" | "closeout";
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState(defaultType);
  const [category, setCategory] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [sortOrder, setSortOrder] = useState("");

  const { data: users = [] } = useQuery<{ id: number; fullName: string }[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
    staleTime: 60000,
  });

  const userOptions = useMemo(
    () => users.map((u) => ({ value: String(u.id), label: u.fullName || `User ${u.id}` })),
    [users]
  );

  const typeOptions = [
    { value: "commissioning", label: "Commissioning" },
    { value: "closeout", label: "Closeout" },
  ];

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        projectId,
        itemType: type,
        title,
        description: description || null,
        ownerUserId: ownerUserId ? Number(ownerUserId) : null,
        dueDate: dueDate || null,
        category: category || null,
        sortOrder: sortOrder ? Number(sortOrder) : null,
      };
      const res = await fetch("/api/commissioning", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Create failed");
      return res.json();
    },
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setCategory("");
      setOwnerUserId("");
      setDueDate("");
      setSortOrder("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white max-w-md" data-testid="dialog-create-item">
        <DialogHeader>
          <DialogTitle className="text-gray-800">Add Checklist Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-600">Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inverter commissioning test"
              className="mt-1 text-sm bg-white"
              data-testid="input-create-title"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              className="mt-1 text-sm min-h-[60px] bg-white"
              data-testid="input-create-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-600">Type</Label>
              <div className="mt-1">
                <SearchableSelect
                  options={typeOptions}
                  value={type}
                  onValueChange={(v) => setType(v as "commissioning" | "closeout")}
                  placeholder="Select type"
                  triggerClassName="h-8 text-xs w-full"
                  data-testid="select-create-type"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Category</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electrical"
                className="mt-1 text-sm bg-white h-8"
                data-testid="input-create-category"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-600">Owner</Label>
            <div className="mt-1">
              <SearchableSelect
                options={userOptions}
                value={ownerUserId}
                onValueChange={setOwnerUserId}
                placeholder="Select owner..."
                searchPlaceholder="Search users..."
                triggerClassName="h-8 text-xs w-full"
                data-testid="select-create-owner"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-600">Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 text-sm bg-white h-8"
                data-testid="input-create-due-date"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Sort Order</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder="0"
                className="mt-1 text-sm bg-white h-8"
                data-testid="input-create-sort-order"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-xs"
            data-testid="btn-cancel-create"
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending}
            className="bg-[#16A34A] hover:bg-[#15803d] text-white text-xs gap-1"
            data-testid="btn-confirm-create"
          >
            {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            Create Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
