import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Bug,
  Lightbulb,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MessageSquare,
  Filter,
  Send,
} from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-800", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-800", icon: Loader2 },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-800", icon: CheckCircle2 },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-600", icon: AlertCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-700" },
  medium: { label: "Medium", color: "bg-blue-100 text-blue-700" },
  high: { label: "High", color: "bg-orange-100 text-orange-700" },
  critical: { label: "Critical", color: "bg-red-100 text-red-700" },
};

const TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  bug: { label: "Bug Report", icon: Bug, color: "text-red-600" },
  feature: { label: "Feature Request", icon: Lightbulb, color: "text-amber-600" },
};

async function apiFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function FeedbackPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formType, setFormType] = useState<string>("bug");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState<string>("medium");

  const [adminDialog, setAdminDialog] = useState<any>(null);
  const [adminStatus, setAdminStatus] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [adminPriority, setAdminPriority] = useState("");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["/api/feedback"],
    queryFn: () => apiFetch("/api/feedback"),
  });

  const submitMutation = useMutation({
    mutationFn: (body: any) => apiFetch("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      setShowForm(false);
      setFormTitle("");
      setFormDescription("");
      setFormPriority("medium");
      setFormType("bug");
      toast({ title: "Submitted", description: "Your feedback has been submitted successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: any) => apiFetch(`/api/feedback/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      setAdminDialog(null);
      toast({ title: "Updated", description: "Ticket updated successfully." });
    },
  });

  const handleSubmit = () => {
    if (!formTitle.trim() || !formDescription.trim()) {
      toast({ title: "Missing fields", description: "Please fill in both title and description.", variant: "destructive" });
      return;
    }
    submitMutation.mutate({ type: formType, title: formTitle, description: formDescription, priority: formPriority });
  };

  const openAdminDialog = (ticket: any) => {
    setAdminDialog(ticket);
    setAdminStatus(ticket.status);
    setAdminNotes(ticket.adminNotes || "");
    setAdminPriority(ticket.priority);
  };

  const filteredTickets = tickets.filter((t: any) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    return true;
  });

  const stats = {
    total: tickets.length,
    open: tickets.filter((t: any) => t.status === "open").length,
    inProgress: tickets.filter((t: any) => t.status === "in_progress").length,
    resolved: tickets.filter((t: any) => t.status === "resolved" || t.status === "closed").length,
  };

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto" data-testid="feedback-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-feedback-title">Feedback & Support</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Report bugs or request new features. Your feedback helps us improve.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2" data-testid="button-new-ticket">
          <Plus className="h-4 w-4" /> New Report
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold" data-testid="text-total-tickets">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-blue-600">Open</div>
          <div className="text-2xl font-bold text-blue-600" data-testid="text-open-tickets">{stats.open}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-yellow-600">In Progress</div>
          <div className="text-2xl font-bold text-yellow-600" data-testid="text-progress-tickets">{stats.inProgress}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-green-600">Resolved</div>
          <div className="text-2xl font-bold text-green-600" data-testid="text-resolved-tickets">{stats.resolved}</div>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="select-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="bug">Bug Reports</SelectItem>
            <SelectItem value="feature">Feature Requests</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTickets.length === 0 ? (
        <Card className="p-12 border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground gap-3">
          <MessageSquare className="h-10 w-10" />
          <p className="text-sm">No tickets yet. Submit a bug report or feature request to get started.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket: any) => {
            const typeConf = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.bug;
            const statusConf = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
            const priorityConf = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;
            const TypeIcon = typeConf.icon;
            const StatusIcon = statusConf.icon;
            return (
              <Card key={ticket.id} className="p-4 hover:shadow-md transition-shadow" data-testid={`card-ticket-${ticket.id}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-1 ${typeConf.color}`}>
                    <TypeIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" data-testid={`text-ticket-title-${ticket.id}`}>{ticket.title}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusConf.color}`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusConf.label}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityConf.color}`}>
                        {priorityConf.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span>By {ticket.submittedByName}</span>
                      <span>{format(new Date(ticket.createdAt), "dd MMM yyyy HH:mm")}</span>
                    </div>
                    {ticket.adminNotes && (
                      <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                        <span className="font-medium">Admin response: </span>{ticket.adminNotes}
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => openAdminDialog(ticket)} data-testid={`button-manage-${ticket.id}`}>
                      Manage
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Feedback</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex gap-2">
                <Button
                  variant={formType === "bug" ? "default" : "outline"}
                  size="sm"
                  className="gap-2 flex-1"
                  onClick={() => setFormType("bug")}
                  data-testid="button-type-bug"
                >
                  <Bug className="h-4 w-4" /> Bug Report
                </Button>
                <Button
                  variant={formType === "feature" ? "default" : "outline"}
                  size="sm"
                  className="gap-2 flex-1"
                  onClick={() => setFormType("feature")}
                  data-testid="button-type-feature"
                >
                  <Lightbulb className="h-4 w-4" /> Feature Request
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fb-title">Title</Label>
              <Input
                id="fb-title"
                placeholder={formType === "bug" ? "What isn't working?" : "What would you like to see?"}
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                data-testid="input-ticket-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fb-desc">Description</Label>
              <Textarea
                id="fb-desc"
                placeholder={formType === "bug" ? "Describe what happened and what you expected..." : "Describe the feature and why it would be useful..."}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={4}
                data-testid="input-ticket-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={formPriority} onValueChange={setFormPriority}>
                <SelectTrigger data-testid="select-ticket-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} data-testid="button-cancel-ticket">Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitMutation.isPending} className="gap-2" data-testid="button-submit-ticket">
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {adminDialog && (
        <Dialog open={!!adminDialog} onOpenChange={() => setAdminDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Manage Ticket #{adminDialog.id}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Title</Label>
                <p className="text-sm font-medium">{adminDialog.title}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm">{adminDialog.description}</p>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={adminStatus} onValueChange={setAdminStatus}>
                  <SelectTrigger data-testid="select-admin-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={adminPriority} onValueChange={setAdminPriority}>
                  <SelectTrigger data-testid="select-admin-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Admin Notes / Response</Label>
                <Textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Add a response or internal notes..."
                  rows={3}
                  data-testid="input-admin-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdminDialog(null)}>Cancel</Button>
              <Button
                onClick={() => updateMutation.mutate({ id: adminDialog.id, status: adminStatus, adminNotes, priority: adminPriority })}
                disabled={updateMutation.isPending}
                data-testid="button-save-admin"
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
