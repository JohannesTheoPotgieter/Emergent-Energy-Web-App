import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Loader2,
  Plus,
  ShieldAlert,
  HelpCircle,
  AlertTriangle,
  Gavel,
  ChevronDown,
  ChevronRight,
  Trash2,
  Calendar,
  User,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return d;
  }
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof ShieldAlert; bg: string; border: string }> = {
  risk: { label: "Risk", color: "text-red-700", icon: ShieldAlert, bg: "bg-red-50", border: "border-red-200" },
  assumption: { label: "Assumption", color: "text-blue-700", icon: HelpCircle, bg: "bg-blue-50", border: "border-blue-200" },
  issue: { label: "Issue", color: "text-amber-700", icon: AlertTriangle, bg: "bg-amber-50", border: "border-amber-200" },
  decision: { label: "Decision", color: "text-purple-700", icon: Gavel, bg: "bg-purple-50", border: "border-purple-200" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: "Critical", color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  high: { label: "High", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
  medium: { label: "Medium", color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-200" },
  low: { label: "Low", color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "text-blue-700", bg: "bg-blue-50" },
  mitigating: { label: "Mitigating", color: "text-amber-700", bg: "bg-amber-50" },
  resolved: { label: "Resolved", color: "text-green-700", bg: "bg-green-50" },
  closed: { label: "Closed", color: "text-gray-600", bg: "bg-gray-100" },
  accepted: { label: "Accepted", color: "text-purple-700", bg: "bg-purple-50" },
};

const TYPE_TABS = [
  { value: "", label: "All" },
  { value: "risk", label: "Risk" },
  { value: "assumption", label: "Assumption" },
  { value: "issue", label: "Issue" },
  { value: "decision", label: "Decision" },
];

interface RaidItem {
  id: number;
  project_id: number;
  type: string;
  title: string;
  description: string | null;
  owner_user_id: number | null;
  owner_name: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  mitigation_response: string | null;
  linked_task_id: number | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface ProjectRaidTabProps {
  projectId: number;
  projectName: string;
}

export function ProjectRaidTab({ projectId, projectName }: ProjectRaidTabProps) {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const queryParams = new URLSearchParams();
  if (typeFilter) queryParams.set("type", typeFilter);
  if (statusFilter) queryParams.set("status", statusFilter);
  if (priorityFilter) queryParams.set("priority", priorityFilter);

  const { data: items = [], isLoading, error } = useQuery<RaidItem[]>({
    queryKey: ["raid-items", projectId, typeFilter, statusFilter, priorityFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/raid/project/${projectId}?${queryParams.toString()}`,
        { headers: getAuthHeaders(), credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load RAID items");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: users = [] } = useQuery<{ id: number; fullName: string; username: string }[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/raid/${id}`, { method: "DELETE", headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raid-items", projectId] });
      setExpandedId(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/raid/${id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raid-items", projectId] });
    },
  });

  const totalCount = items.length;
  const riskCount = items.filter(i => i.type === "risk").length;
  const issueCount = items.filter(i => i.type === "issue").length;
  const assumptionCount = items.filter(i => i.type === "assumption").length;
  const decisionCount = items.filter(i => i.type === "decision").length;
  const openCount = items.filter(i => i.status === "open" || i.status === "mitigating").length;
  const closedCount = items.filter(i => i.status === "closed" || i.status === "resolved").length;

  const userOptions = users.map((u: any) => ({
    value: String(u.id),
    label: u.fullName || u.full_name || u.username || `User ${u.id}`,
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500" data-testid="raid-loading">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading RAID items...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500" data-testid="raid-error">
        <AlertTriangle className="w-5 h-5 mr-2" />
        Failed to load RAID data
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="project-raid-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <SummaryCard label="Total" count={totalCount} color="text-slate-800" testId="raid-summary-total" />
        <SummaryCard label="Risks" count={riskCount} color="text-red-600" testId="raid-summary-risks" />
        <SummaryCard label="Issues" count={issueCount} color="text-amber-600" testId="raid-summary-issues" />
        <SummaryCard label="Assumptions" count={assumptionCount} color="text-blue-600" testId="raid-summary-assumptions" />
        <SummaryCard label="Decisions" count={decisionCount} color="text-purple-600" testId="raid-summary-decisions" />
        <SummaryCard label="Open" count={openCount} color="text-emerald-600" testId="raid-summary-open" />
        <SummaryCard label="Closed" count={closedCount} color="text-gray-500" testId="raid-summary-closed" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-white border rounded-md overflow-hidden" data-testid="raid-type-tabs">
          {TYPE_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setTypeFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                typeFilter === tab.value
                  ? "bg-[#16A34A] text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`raid-type-tab-${tab.value || "all"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <SearchableSelect
          options={[
            { value: "", label: "All Statuses" },
            { value: "open", label: "Open" },
            { value: "mitigating", label: "Mitigating" },
            { value: "resolved", label: "Resolved" },
            { value: "closed", label: "Closed" },
            { value: "accepted", label: "Accepted" },
          ]}
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Status"
          triggerClassName="h-8 text-xs w-[130px]"
          data-testid="raid-filter-status"
        />

        <SearchableSelect
          options={[
            { value: "", label: "All Priorities" },
            { value: "critical", label: "Critical" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
          ]}
          value={priorityFilter}
          onValueChange={setPriorityFilter}
          placeholder="Priority"
          triggerClassName="h-8 text-xs w-[130px]"
          data-testid="raid-filter-priority"
        />

        <div className="flex-1" />

        <Button
          size="sm"
          className="h-8 text-xs gap-1 bg-[#16A34A] hover:bg-[#15803D] text-white"
          onClick={() => setCreateOpen(true)}
          data-testid="raid-btn-create"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center" data-testid="raid-empty">
            <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No RAID items found.</p>
            <p className="text-xs text-slate-400 mt-1">Create a new risk, assumption, issue, or decision to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const tc = TYPE_CONFIG[item.type] || TYPE_CONFIG.risk;
            const pc = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
            const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;
            const TypeIcon = tc.icon;

            return (
              <Card
                key={item.id}
                className={`bg-white transition-all ${isExpanded ? "ring-1 ring-[#16A34A]/30" : "hover:shadow-sm"}`}
                data-testid={`raid-card-${item.id}`}
              >
                <CardContent className="p-0">
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    data-testid={`raid-btn-expand-${item.id}`}
                  >
                    <TypeIcon className={`w-4 h-4 shrink-0 ${tc.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-medium text-sm text-slate-800 truncate" data-testid={`raid-title-${item.id}`}>
                          {item.title}
                        </span>
                        <Badge className={`text-[9px] ${tc.bg} ${tc.color} ${tc.border} border`} variant="outline" data-testid={`raid-type-badge-${item.id}`}>
                          {tc.label}
                        </Badge>
                        <Badge className={`text-[9px] ${pc.bg} ${pc.color} ${pc.border} border`} variant="outline" data-testid={`raid-priority-badge-${item.id}`}>
                          {pc.label}
                        </Badge>
                        <Badge className={`text-[9px] ${sc.bg} ${sc.color}`} variant="outline" data-testid={`raid-status-badge-${item.id}`}>
                          {sc.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {item.owner_name && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {item.owner_name}
                          </span>
                        )}
                        {item.due_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(item.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    }
                  </button>

                  {isExpanded && (
                    <ExpandedRaidItem
                      item={item}
                      userOptions={userOptions}
                      onUpdate={(data) => updateMutation.mutate({ id: item.id, data })}
                      onDelete={() => deleteMutation.mutate(item.id)}
                      isUpdating={updateMutation.isPending}
                      isDeleting={deleteMutation.isPending}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateRaidDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        userOptions={userOptions}
      />
    </div>
  );
}

function SummaryCard({ label, count, color, testId }: { label: string; count: number; color: string; testId: string }) {
  return (
    <Card className="bg-white">
      <CardContent className="p-2.5 text-center">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-xl font-bold ${color}`} data-testid={testId}>{count}</p>
      </CardContent>
    </Card>
  );
}

function ExpandedRaidItem({
  item,
  userOptions,
  onUpdate,
  onDelete,
  isUpdating,
  isDeleting,
}: {
  item: RaidItem;
  userOptions: { value: string; label: string }[];
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const [editStatus, setEditStatus] = useState(item.status);
  const [editPriority, setEditPriority] = useState(item.priority);
  const [editMitigation, setEditMitigation] = useState(item.mitigation_response || "");
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    onUpdate({
      status: editStatus,
      priority: editPriority,
      mitigationResponse: editMitigation || null,
    });
    setDirty(false);
  };

  return (
    <div className="px-4 pb-4 border-t border-slate-100 space-y-3 pt-3" data-testid={`raid-expanded-${item.id}`}>
      {item.description && (
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
          <p className="text-xs text-slate-700 mt-0.5" data-testid={`raid-description-${item.id}`}>{item.description}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground mb-1 block">Status</Label>
          <SearchableSelect
            options={[
              { value: "open", label: "Open" },
              { value: "mitigating", label: "Mitigating" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
              { value: "accepted", label: "Accepted" },
            ]}
            value={editStatus}
            onValueChange={(v) => { setEditStatus(v); setDirty(true); }}
            triggerClassName="h-8 text-xs w-full"
            data-testid={`raid-edit-status-${item.id}`}
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground mb-1 block">Priority</Label>
          <SearchableSelect
            options={[
              { value: "critical", label: "Critical" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
            value={editPriority}
            onValueChange={(v) => { setEditPriority(v); setDirty(true); }}
            triggerClassName="h-8 text-xs w-full"
            data-testid={`raid-edit-priority-${item.id}`}
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground mb-1 block">Owner</Label>
          <p className="text-xs text-slate-700 py-1.5">{item.owner_name || "Unassigned"}</p>
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase text-muted-foreground mb-1 block">Mitigation / Response</Label>
        <Textarea
          value={editMitigation}
          onChange={(e) => { setEditMitigation(e.target.value); setDirty(true); }}
          className="text-xs min-h-[60px] bg-white"
          placeholder="Enter mitigation plan or response..."
          data-testid={`raid-edit-mitigation-${item.id}`}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        {dirty && (
          <Button
            size="sm"
            className="h-7 text-xs bg-[#16A34A] hover:bg-[#15803D] text-white"
            onClick={handleSave}
            disabled={isUpdating}
            data-testid={`raid-btn-save-${item.id}`}
          >
            {isUpdating && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            Save Changes
          </Button>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          Created {formatDate(item.created_at)}
          {item.updated_at !== item.created_at && ` · Updated ${formatDate(item.updated_at)}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
          onClick={onDelete}
          disabled={isDeleting}
          data-testid={`raid-btn-delete-${item.id}`}
        >
          {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        </Button>
      </div>
    </div>
  );
}

function CreateRaidDialog({
  open,
  onClose,
  projectId,
  userOptions,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  userOptions: { value: string; label: string }[];
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState("risk");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [mitigation, setMitigation] = useState("");

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/raid", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create RAID item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raid-items", projectId] });
      resetForm();
      onClose();
    },
  });

  const resetForm = () => {
    setType("risk");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setOwnerUserId("");
    setDueDate("");
    setMitigation("");
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    createMutation.mutate({
      projectId,
      type,
      title: title.trim(),
      description: description.trim() || null,
      ownerUserId: ownerUserId ? Number(ownerUserId) : null,
      priority,
      dueDate: dueDate || null,
      mitigationResponse: mitigation.trim() || null,
      linkedTaskId: null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg bg-white" data-testid="raid-create-dialog">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-800">New RAID Item</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
              <SearchableSelect
                options={[
                  { value: "risk", label: "Risk" },
                  { value: "assumption", label: "Assumption" },
                  { value: "issue", label: "Issue" },
                  { value: "decision", label: "Decision" },
                ]}
                value={type}
                onValueChange={setType}
                triggerClassName="h-8 text-xs w-full"
                data-testid="raid-create-type"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Priority</Label>
              <SearchableSelect
                options={[
                  { value: "critical", label: "Critical" },
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                ]}
                value={priority}
                onValueChange={setPriority}
                triggerClassName="h-8 text-xs w-full"
                data-testid="raid-create-priority"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter title..."
              className="h-8 text-xs bg-white"
              data-testid="raid-create-title"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the item..."
              className="text-xs min-h-[60px] bg-white"
              data-testid="raid-create-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Owner</Label>
              <SearchableSelect
                options={userOptions}
                value={ownerUserId}
                onValueChange={setOwnerUserId}
                placeholder="Select owner..."
                searchPlaceholder="Search users..."
                triggerClassName="h-8 text-xs w-full"
                data-testid="raid-create-owner"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-8 text-xs bg-white"
                data-testid="raid-create-due-date"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Mitigation / Response</Label>
            <Textarea
              value={mitigation}
              onChange={(e) => setMitigation(e.target.value)}
              placeholder="Enter mitigation plan or response..."
              className="text-xs min-h-[50px] bg-white"
              data-testid="raid-create-mitigation"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onClose}
            data-testid="raid-create-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs bg-[#16A34A] hover:bg-[#15803D] text-white"
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
            data-testid="raid-create-submit"
          >
            {createMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            Create Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
