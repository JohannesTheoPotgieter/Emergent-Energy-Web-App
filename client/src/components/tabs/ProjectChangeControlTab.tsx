import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  AlertCircle,
  FileText,
  DollarSign,
  CalendarDays,
  User,
} from "lucide-react";

interface ProjectChangeControlTabProps {
  projectId: number;
  projectName: string;
}

interface ChangeRequest {
  id: number;
  project_id: number;
  title: string;
  description: string;
  change_type: string;
  requested_by_name: string;
  owner_name: string;
  impact_summary: string;
  cost_impact: number;
  schedule_impact_days: number;
  status: string;
  approval_id: number | null;
  created_at: string;
}

const STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "implemented", "closed"] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  submitted: "bg-blue-100 text-blue-700 border-blue-200",
  under_review: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  implemented: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_PIPELINE_COLORS: Record<string, string> = {
  draft: "bg-gray-200",
  submitted: "bg-blue-400",
  under_review: "bg-amber-400",
  approved: "bg-green-500",
  rejected: "bg-red-400",
  implemented: "bg-emerald-500",
  closed: "bg-slate-400",
};

const TYPE_COLORS: Record<string, string> = {
  scope: "bg-blue-100 text-blue-700 border-blue-200",
  cost: "bg-green-100 text-green-700 border-green-200",
  schedule: "bg-orange-100 text-orange-700 border-orange-200",
  technical: "bg-purple-100 text-purple-700 border-purple-200",
  commercial: "bg-teal-100 text-teal-700 border-teal-200",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["implemented", "closed"],
  rejected: ["draft", "closed"],
  implemented: ["closed"],
  closed: [],
};

const CHANGE_TYPES = [
  { value: "scope", label: "Scope" },
  { value: "cost", label: "Cost" },
  { value: "schedule", label: "Schedule" },
  { value: "technical", label: "Technical" },
  { value: "commercial", label: "Commercial" },
];

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

function formatCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "R0";
  return "R" + Math.round(n).toLocaleString("en-ZA");
}

function statusLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProjectChangeControlTab({ projectId, projectName }: ProjectChangeControlTabProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: changeRequests = [], isLoading, error } = useQuery<ChangeRequest[]>({
    queryKey: ["change-requests", projectId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/change-requests/project/${projectId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load change requests");
      return res.json();
    },
    enabled: !!projectId,
  });

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = changeRequests.filter((cr) => cr.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500" data-testid="change-control-loading">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading change requests...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500" data-testid="change-control-error">
        <AlertCircle className="w-5 h-5 mr-2" />
        Failed to load change requests
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="change-control-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800" data-testid="change-control-title">Change Control</h3>
        <CreateChangeRequestDialog
          projectId={projectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      </div>

      <div className="flex items-center gap-1 p-2 bg-white rounded-lg border" data-testid="status-pipeline">
        {STATUSES.map((s) => (
          <div key={s} className="flex-1 text-center" data-testid={`pipeline-status-${s}`}>
            <div className={`h-2 rounded-full mx-0.5 mb-1 ${STATUS_PIPELINE_COLORS[s]}`} />
            <p className="text-[10px] font-medium text-slate-600 uppercase leading-tight">{statusLabel(s)}</p>
            <p className="text-lg font-bold text-slate-800">{statusCounts[s]}</p>
          </div>
        ))}
      </div>

      {changeRequests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="empty-message">No change requests for this project yet.</p>
            <p className="text-xs text-slate-500 mt-1">Click "New Change Request" to create one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {changeRequests.map((cr) => (
            <ChangeRequestCard
              key={cr.id}
              cr={cr}
              isExpanded={expanded === cr.id}
              onToggle={() => setExpanded(expanded === cr.id ? null : cr.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRequestCard({
  cr,
  isExpanded,
  onToggle,
}: {
  cr: ChangeRequest;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card
      className={`transition-all bg-white ${isExpanded ? "ring-1 ring-emerald-200" : "hover:shadow-sm"}`}
      data-testid={`change-request-card-${cr.id}`}
    >
      <CardContent className="p-0">
        <button
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
          onClick={onToggle}
          data-testid={`btn-expand-cr-${cr.id}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-medium text-sm text-slate-800 truncate" data-testid={`cr-title-${cr.id}`}>
                {cr.title}
              </span>
              <Badge variant="outline" className={`text-[9px] shrink-0 ${TYPE_COLORS[cr.change_type] || ""}`} data-testid={`cr-type-${cr.id}`}>
                {cr.change_type}
              </Badge>
              <Badge variant="outline" className={`text-[9px] shrink-0 ${STATUS_COLORS[cr.status] || ""}`} data-testid={`cr-status-${cr.id}`}>
                {statusLabel(cr.status)}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                <span className="font-mono" data-testid={`cr-cost-${cr.id}`}>{formatCurrency(cr.cost_impact)}</span>
              </span>
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                <span data-testid={`cr-days-${cr.id}`}>{cr.schedule_impact_days ?? 0}d</span>
              </span>
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                <span data-testid={`cr-owner-${cr.id}`}>{cr.owner_name || "Unassigned"}</span>
              </span>
              <span data-testid={`cr-date-${cr.id}`}>{formatDate(cr.created_at)}</span>
            </div>
          </div>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>
        {isExpanded && <ExpandedChangeRequest cr={cr} />}
      </CardContent>
    </Card>
  );
}

function ExpandedChangeRequest({ cr }: { cr: ChangeRequest }) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(cr.title);
  const [editDescription, setEditDescription] = useState(cr.description || "");
  const [editImpact, setEditImpact] = useState(cr.impact_summary || "");
  const [editCost, setEditCost] = useState(String(cr.cost_impact ?? 0));
  const [editDays, setEditDays] = useState(String(cr.schedule_impact_days ?? 0));

  const transitions = VALID_TRANSITIONS[cr.status] || [];

  const transitionMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await fetch(`/api/change-requests/${cr.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-requests", cr.project_id] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/change-requests/${cr.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          impactSummary: editImpact,
          costImpact: parseFloat(editCost) || 0,
          scheduleImpactDays: parseInt(editDays) || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["change-requests", cr.project_id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/change-requests/${cr.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-requests", cr.project_id] });
    },
  });

  return (
    <div className="px-4 pb-4 border-t border-slate-100 space-y-3 mt-0 pt-3" data-testid={`cr-detail-${cr.id}`}>
      {editing ? (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="h-8 text-sm"
              data-testid={`input-edit-title-${cr.id}`}
            />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid={`input-edit-description-${cr.id}`}
            />
          </div>
          <div>
            <Label className="text-xs">Impact Summary</Label>
            <Textarea
              value={editImpact}
              onChange={(e) => setEditImpact(e.target.value)}
              className="text-sm min-h-[40px]"
              data-testid={`input-edit-impact-${cr.id}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cost Impact (R)</Label>
              <Input
                type="number"
                value={editCost}
                onChange={(e) => setEditCost(e.target.value)}
                className="h-8 text-sm"
                data-testid={`input-edit-cost-${cr.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">Schedule Impact (days)</Label>
              <Input
                type="number"
                value={editDays}
                onChange={(e) => setEditDays(e.target.value)}
                className="h-8 text-sm"
                data-testid={`input-edit-days-${cr.id}`}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className="bg-[#16A34A] hover:bg-[#15803d] text-white"
              data-testid={`btn-save-edit-${cr.id}`}
            >
              {updateMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} data-testid={`btn-cancel-edit-${cr.id}`}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500 block mb-0.5">Description</span>
              <p className="text-slate-700" data-testid={`cr-description-${cr.id}`}>{cr.description || "—"}</p>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">Impact Summary</span>
              <p className="text-slate-700" data-testid={`cr-impact-${cr.id}`}>{cr.impact_summary || "—"}</p>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">Requested By</span>
              <p className="text-slate-700" data-testid={`cr-requested-by-${cr.id}`}>{cr.requested_by_name || "—"}</p>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">Approval ID</span>
              <p className="text-slate-700" data-testid={`cr-approval-${cr.id}`}>{cr.approval_id ?? "—"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditing(true)}
              data-testid={`btn-edit-cr-${cr.id}`}
            >
              Edit
            </Button>
            {transitions.map((t) => (
              <Button
                key={t}
                size="sm"
                className="h-7 text-xs bg-[#16A34A] hover:bg-[#15803d] text-white"
                onClick={() => transitionMutation.mutate(t)}
                disabled={transitionMutation.isPending}
                data-testid={`btn-transition-${t}-${cr.id}`}
              >
                {transitionMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                → {statusLabel(t)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto"
              onClick={() => {
                if (confirm("Delete this change request?")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid={`btn-delete-cr-${cr.id}`}
            >
              {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function CreateChangeRequestDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [changeType, setChangeType] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [impactSummary, setImpactSummary] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");

  const { data: users = [] } = useQuery<{ id: number; username: string; fullName?: string }[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/users", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    enabled: open,
  });

  const userOptions = users.map((u) => ({
    value: String(u.id),
    label: u.fullName || u.username,
  }));

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          projectId,
          title,
          description,
          changeType,
          ownerUserId: ownerUserId ? parseInt(ownerUserId) : undefined,
          impactSummary,
          costImpact: parseFloat(costImpact) || 0,
          scheduleImpactDays: parseInt(scheduleImpactDays) || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed to create change request");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-requests", projectId] });
      onOpenChange(false);
      resetForm();
    },
  });

  function resetForm() {
    setTitle("");
    setDescription("");
    setChangeType("");
    setOwnerUserId("");
    setImpactSummary("");
    setCostImpact("");
    setScheduleImpactDays("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="h-8 text-xs gap-1 bg-[#16A34A] hover:bg-[#15803d] text-white"
          data-testid="btn-new-change-request"
        >
          <Plus className="w-3 h-3" />
          New Change Request
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg bg-white" data-testid="dialog-create-cr">
        <DialogHeader>
          <DialogTitle className="text-slate-800">New Change Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Change request title"
              className="h-8 text-sm"
              data-testid="input-cr-title"
            />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the change..."
              className="text-sm min-h-[60px]"
              data-testid="input-cr-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Change Type *</Label>
              <SearchableSelect
                options={CHANGE_TYPES}
                value={changeType}
                onValueChange={setChangeType}
                placeholder="Select type..."
                triggerClassName="w-full h-8 text-sm"
                data-testid="select-cr-type"
              />
            </div>
            <div>
              <Label className="text-xs">Owner</Label>
              <SearchableSelect
                options={userOptions}
                value={ownerUserId}
                onValueChange={setOwnerUserId}
                placeholder="Select owner..."
                searchPlaceholder="Search users..."
                triggerClassName="w-full h-8 text-sm"
                data-testid="select-cr-owner"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Impact Summary</Label>
            <Textarea
              value={impactSummary}
              onChange={(e) => setImpactSummary(e.target.value)}
              placeholder="Summarize the impact..."
              className="text-sm min-h-[40px]"
              data-testid="input-cr-impact"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cost Impact (R)</Label>
              <Input
                type="number"
                value={costImpact}
                onChange={(e) => setCostImpact(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
                data-testid="input-cr-cost"
              />
            </div>
            <div>
              <Label className="text-xs">Schedule Impact (days)</Label>
              <Input
                type="number"
                value={scheduleImpactDays}
                onChange={(e) => setScheduleImpactDays(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
                data-testid="input-cr-days"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-cancel-create-cr">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title || !changeType || createMutation.isPending}
            className="bg-[#16A34A] hover:bg-[#15803d] text-white"
            data-testid="btn-submit-create-cr"
          >
            {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
