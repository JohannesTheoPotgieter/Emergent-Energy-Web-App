import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Video,
  CheckCircle2,
  ListTodo,
  Flag,
  FolderPlus,
  X,
  ExternalLink,
  Users,
  Clock,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Zap,
  MessageSquare,
  Lightbulb,
  Play,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface ActionItem {
  id: number;
  meetingId: number;
  text: string;
  owner: string | null;
  dueDate: string | null;
  status: "pending" | "converted" | "dismissed";
  convertedToType: string | null;
  convertedToId: number | null;
  createdAt: string;
}

interface Meeting {
  id: number;
  externalMeetingId: string | null;
  title: string;
  startTime: string | null;
  endTime: string | null;
  participants: string[] | null;
  summary: string | null;
  reportUrl: string | null;
  source: string;
  createdAt: string;
  keyTopics: string[];
  highlights: string[];
  actionItems: ActionItem[];
}

interface WebhookStatus {
  connected: boolean;
  totalMeetings: number;
  webhookMeetings: number;
  lastWebhookAt: string | null;
  totalActionItems: number;
  pendingItems: number;
  convertedItems: number;
}

type ConvertType = "task" | "priority" | "project";

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
];

export default function MyToolMeetingsPage() {
  const { allowed: canView } = usePermission('meetings', 'view');
  const { toast } = useToast();
  const [expandedMeetings, setExpandedMeetings] = useState<Set<number>>(new Set());
  const [convertDialog, setConvertDialog] = useState<{ item: ActionItem; meeting: Meeting; type: ConvertType } | null>(null);
  const [manualDialog, setManualDialog] = useState(false);
  const [webhookDialog, setWebhookDialog] = useState(false);
  const [convertForm, setConvertForm] = useState<Record<string, string>>({});
  const [manualForm, setManualForm] = useState({ title: "", summary: "", actionItems: [{ text: "", owner: "", dueDate: "" }] });

  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings"],
    refetchInterval: 30_000,
  });

  const { data: projects = [] } = useQuery<{ id: number; projectName: string }[]>({
    queryKey: ["/api/projects"],
    select: (data: any[]) => data.map((p: any) => ({ id: p.id, projectName: p.projectName })).sort((a: any, b: any) => a.projectName.localeCompare(b.projectName)),
  });

  const { data: pmUsers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/pm-assignable-users"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/pm-assignable-users", { credentials: "include", headers });
      return res.ok ? res.json() : [];
    },
  });

  const { data: webhookStatus } = useQuery<WebhookStatus>({
    queryKey: ["/api/meetings/webhook-status"],
    refetchInterval: 60_000,
  });

  const webhookUrl = `${window.location.origin}/api/webhooks/read-ai`;

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/meetings/action-items/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/webhook-status"] });
      toast({ title: "Dismissed" });
    },
  });

  const deleteMeetingMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/meetings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/webhook-status"] });
      toast({ title: "Meeting deleted" });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/meetings/test-webhook"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/webhook-status"] });
      toast({ title: "Test meeting created", description: "A test meeting has been added to verify webhook connectivity." });
    },
    onError: (err: any) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: async ({ itemId, type, body }: { itemId: number; type: ConvertType; body: Record<string, string> }) => {
      const endpoint = type === "task" ? "convert-to-task" : type === "priority" ? "convert-to-priority" : "convert-to-project";
      return apiRequest("POST", `/api/meetings/action-items/${itemId}/${endpoint}`, body);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/webhook-status"] });
      if (vars.type === "task") queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
      if (vars.type === "priority") queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      setConvertDialog(null);
      setConvertForm({});
      const label = vars.type === "task" ? "task" : vars.type === "priority" ? "company priority" : "project";
      toast({ title: `Converted to ${label}` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const manualMeetingMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/meetings/manual", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/webhook-status"] });
      setManualDialog(false);
      setManualForm({ title: "", summary: "", actionItems: [{ text: "", owner: "", dueDate: "" }] });
      toast({ title: "Meeting added" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toggleMeeting = (id: number) => {
    setExpandedMeetings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pendingCount = meetings.reduce((sum, m) => sum + m.actionItems.filter((ai) => ai.status === "pending").length, 0);

  const openConvert = (item: ActionItem, meeting: Meeting, type: ConvertType) => {
    setConvertForm({ title: item.text });
    setConvertDialog({ item, meeting, type });
  };

  const handleConvert = () => {
    if (!convertDialog) return;
    convertMutation.mutate({
      itemId: convertDialog.item.id,
      type: convertDialog.type,
      body: convertForm,
    });
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="space-y-6 pb-12" data-testid="meetings-page">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold" data-testid="text-meetings-title">Meeting Actions</h2>
            {pendingCount > 0 && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800" data-testid="badge-pending-count">
                {pendingCount} pending
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setWebhookDialog(true)} data-testid="button-webhook-setup">
              {webhookStatus?.connected ? (
                <Wifi className="w-4 h-4 mr-1 text-green-600" />
              ) : (
                <WifiOff className="w-4 h-4 mr-1 text-gray-400" />
              )}
              Webhook Setup
            </Button>
            <Button variant="outline" size="sm" onClick={() => setManualDialog(true)} data-testid="button-add-meeting">
              <Plus className="w-4 h-4 mr-1" />
              Add Meeting
            </Button>
          </div>
        </div>

        {/* Connection Status Banner */}
        {webhookStatus && (
          <Card className={`border ${webhookStatus.connected ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'}`} data-testid="card-webhook-status">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {webhookStatus.connected ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                        </span>
                        <span className="text-sm font-medium text-green-700" data-testid="text-webhook-connected">Webhook Connected</span>
                      </div>
                      {webhookStatus.lastWebhookAt && (
                        <span className="text-xs text-green-600">
                          Last received: {formatDistanceToNow(new Date(webhookStatus.lastWebhookAt), { addSuffix: true })}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
                        </span>
                        <span className="text-sm font-medium text-amber-700" data-testid="text-webhook-disconnected">Webhook Not Connected</span>
                      </div>
                      <span className="text-xs text-amber-600">
                        Set up Read.ai webhook or send a test to get started
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {webhookStatus.totalMeetings > 0 && (
                    <div className="flex gap-3">
                      <span className="text-muted-foreground"><strong className="text-foreground">{webhookStatus.totalMeetings}</strong> meetings</span>
                      <span className="text-muted-foreground"><strong className="text-foreground">{webhookStatus.totalActionItems}</strong> action items</span>
                      {webhookStatus.pendingItems > 0 && (
                        <span className="text-amber-600"><strong>{webhookStatus.pendingItems}</strong> pending</span>
                      )}
                      {webhookStatus.convertedItems > 0 && (
                        <span className="text-green-600"><strong>{webhookStatus.convertedItems}</strong> converted</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : meetings.length === 0 ? (
          <Card data-testid="card-empty-state">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Video className="w-12 h-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground mb-2">No meetings yet</h3>
              <p className="text-sm text-gray-400 max-w-md mb-4">
                Connect Read.ai via the Webhook Setup to automatically capture meeting action items, or add meetings manually.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setWebhookDialog(true)}>
                  <Link2 className="w-4 h-4 mr-1" />
                  Webhook Setup
                </Button>
                <Button size="sm" onClick={() => setManualDialog(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Meeting
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="meetings-list">
            {meetings.map((meeting) => {
              const isExpanded = expandedMeetings.has(meeting.id);
              const pendingItems = meeting.actionItems.filter((ai) => ai.status === "pending");
              const convertedItems = meeting.actionItems.filter((ai) => ai.status === "converted");

              return (
                <Card key={meeting.id} data-testid={`card-meeting-${meeting.id}`}>
                  <CardHeader
                    className="cursor-pointer py-3 px-4"
                    onClick={() => toggleMeeting(meeting.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-sm font-medium truncate" data-testid={`text-meeting-title-${meeting.id}`}>
                              {meeting.title}
                            </CardTitle>
                            <Badge variant="outline" className={`text-[10px] shrink-0 ${meeting.source === 'read_ai' ? 'bg-blue-50 text-blue-700 border-blue-200' : meeting.source === 'test' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-muted text-muted-foreground'}`} data-testid={`badge-source-${meeting.id}`}>
                              {meeting.source === "read_ai" ? "Read.ai" : meeting.source === "test" ? "Test" : "Manual"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            {meeting.startTime && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(meeting.startTime), "MMM d, yyyy h:mm a")}
                              </span>
                            )}
                            {meeting.participants && meeting.participants.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {meeting.participants.length} participants
                              </span>
                            )}
                            {meeting.actionItems.length > 0 && (
                              <span className="flex items-center gap-1">
                                <ListTodo className="w-3 h-3" />
                                {meeting.actionItems.length} items
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                        {pendingItems.length > 0 && (
                          <Badge className="bg-amber-100 text-amber-800 text-[10px]" data-testid={`badge-pending-${meeting.id}`}>
                            {pendingItems.length} pending
                          </Badge>
                        )}
                        {convertedItems.length > 0 && (
                          <Badge className="bg-green-100 text-green-800 text-[10px]">
                            {convertedItems.length} converted
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                          onClick={() => deleteMeetingMutation.mutate(meeting.id)}
                          data-testid={`button-delete-meeting-${meeting.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {isExpanded && (
                    <CardContent className="pt-0 px-4 pb-4">
                      {/* Summary */}
                      {meeting.summary && (
                        <div className="mb-4 p-3 bg-muted rounded-md text-sm text-muted-foreground" data-testid={`text-summary-${meeting.id}`}>
                          <p className="font-medium text-foreground mb-1 text-xs uppercase tracking-wide flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            Summary
                          </p>
                          <p className="whitespace-pre-line">{meeting.summary}</p>
                        </div>
                      )}

                      {/* Key Topics */}
                      {meeting.keyTopics && meeting.keyTopics.length > 0 && (
                        <div className="mb-4" data-testid={`topics-${meeting.id}`}>
                          <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide flex items-center gap-1">
                            <Lightbulb className="w-3 h-3" />
                            Key Topics
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {meeting.keyTopics.map((topic, i) => (
                              <Badge key={i} variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Highlights / Important Points */}
                      {meeting.highlights && meeting.highlights.length > 0 && (
                        <div className="mb-4 p-3 bg-yellow-50 rounded-md border border-yellow-100" data-testid={`highlights-${meeting.id}`}>
                          <p className="text-xs font-medium text-yellow-700 mb-1.5 uppercase tracking-wide flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            Important Points
                          </p>
                          <ul className="space-y-1">
                            {meeting.highlights.map((h, i) => (
                              <li key={i} className="text-sm text-yellow-800 flex items-start gap-2">
                                <span className="text-yellow-500 mt-0.5 shrink-0">•</span>
                                <span>{h}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {meeting.reportUrl && (
                        <a
                          href={meeting.reportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mb-3"
                          data-testid={`link-report-${meeting.id}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                          View full report on Read.ai
                        </a>
                      )}

                      {meeting.participants && meeting.participants.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Participants</p>
                          <div className="flex flex-wrap gap-1">
                            {meeting.participants.map((p, i) => (
                              <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {meeting.actionItems.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No action items recorded</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Action Items ({meeting.actionItems.length})</p>
                          {meeting.actionItems.map((item) => (
                            <div
                              key={item.id}
                              className={`flex items-start gap-3 p-3 rounded-lg border ${
                                item.status === "converted" ? "bg-green-50 border-green-200" :
                                item.status === "dismissed" ? "bg-muted border-border opacity-60" :
                                "bg-card border-border"
                              }`}
                              data-testid={`action-item-${item.id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm ${item.status === "dismissed" ? "line-through text-gray-400" : ""}`}>
                                  {item.text}
                                </p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                  {item.owner && <span>Owner: {item.owner}</span>}
                                  {item.dueDate && <span>Due: {item.dueDate}</span>}
                                  {item.status === "converted" && item.convertedToType && (
                                    <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700">
                                      <CheckCircle2 className="w-3 h-3 mr-0.5" />
                                      {item.convertedToType === "mytool_task" ? "Task" :
                                       item.convertedToType === "company_priority" ? "Priority" : "Project"}
                                      {item.convertedToId ? ` #${item.convertedToId}` : ""}
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {item.status === "pending" && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => openConvert(item, meeting, "task")}
                                    data-testid={`button-to-task-${item.id}`}
                                  >
                                    <ListTodo className="w-3 h-3" />
                                    Task
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => openConvert(item, meeting, "priority")}
                                    data-testid={`button-to-priority-${item.id}`}
                                  >
                                    <Flag className="w-3 h-3" />
                                    Priority
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => openConvert(item, meeting, "project")}
                                    data-testid={`button-to-project-${item.id}`}
                                  >
                                    <FolderPlus className="w-3 h-3" />
                                    Project
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-gray-400 hover:text-muted-foreground"
                                    onClick={() => dismissMutation.mutate(item.id)}
                                    data-testid={`button-dismiss-${item.id}`}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* Convert Dialog */}
        <Dialog open={!!convertDialog} onOpenChange={(open) => !open && setConvertDialog(null)}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-convert">
            <DialogHeader>
              <DialogTitle>
                Convert to {convertDialog?.type === "task" ? "Task" : convertDialog?.type === "priority" ? "Company Priority" : "Project"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input
                  value={convertForm.title || ""}
                  onChange={(e) => setConvertForm((p) => ({ ...p, title: e.target.value }))}
                  data-testid="input-convert-title"
                />
              </div>

              {convertDialog?.type === "task" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Priority</label>
                      <SearchableSelect
                        value={convertForm.priority || "normal"}
                        onValueChange={(v) => setConvertForm((p) => ({ ...p, priority: v }))}
                        options={[
                          { value: "low", label: "Low" },
                          { value: "normal", label: "Normal" },
                          { value: "high", label: "High" },
                          { value: "critical", label: "Critical" },
                        ]}
                        data-testid="select-priority"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Department</label>
                      <SearchableSelect
                        value={convertForm.department || ""}
                        onValueChange={(v) => setConvertForm((p) => ({ ...p, department: v }))}
                        placeholder="Select..."
                        options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                        data-testid="select-department"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Planned For Date</label>
                    <Input
                      type="date"
                      value={convertForm.plannedForDate || ""}
                      onChange={(e) => setConvertForm((p) => ({ ...p, plannedForDate: e.target.value }))}
                      data-testid="input-planned-date"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Link to Project</label>
                    <SearchableSelect
                      value={convertForm.projectName || ""}
                      onValueChange={(v) => setConvertForm((p) => ({ ...p, projectName: v }))}
                      placeholder="None (optional)"
                      options={projects.map((p) => ({ value: p.projectName, label: p.projectName }))}
                      data-testid="select-project-link"
                    />
                  </div>
                </>
              )}

              {convertDialog?.type === "priority" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Severity</label>
                      <SearchableSelect
                        value={convertForm.severity || "normal"}
                        onValueChange={(v) => setConvertForm((p) => ({ ...p, severity: v }))}
                        options={[
                          { value: "normal", label: "Normal" },
                          { value: "important", label: "Important" },
                          { value: "critical", label: "Critical" },
                        ]}
                        data-testid="select-severity"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Horizon</label>
                      <SearchableSelect
                        value={convertForm.horizon || "week"}
                        onValueChange={(v) => setConvertForm((p) => ({ ...p, horizon: v }))}
                        options={[
                          { value: "today", label: "Today" },
                          { value: "week", label: "This Week" },
                          { value: "month", label: "This Month" },
                          { value: "quarter", label: "This Quarter" },
                        ]}
                        data-testid="select-horizon"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Department</label>
                    <SearchableSelect
                      value={convertForm.department || ""}
                      onValueChange={(v) => setConvertForm((p) => ({ ...p, department: v }))}
                      placeholder="Select..."
                      options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                      data-testid="select-priority-department"
                    />
                  </div>
                </>
              )}

              {convertDialog?.type === "project" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Project Name</label>
                    <Input
                      value={convertForm.projectName || convertForm.title || ""}
                      onChange={(e) => setConvertForm((p) => ({ ...p, projectName: e.target.value }))}
                      data-testid="input-project-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Size (kWp)</label>
                      <Input
                        type="number"
                        value={convertForm.sizeKwp || ""}
                        onChange={(e) => setConvertForm((p) => ({ ...p, sizeKwp: e.target.value }))}
                        data-testid="input-size-kwp"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">PM</label>
                      <SearchableSelect
                        value={convertForm.pm || ""}
                        onValueChange={(v) => setConvertForm((p) => ({ ...p, pm: v }))}
                        placeholder="Select PM..."
                        options={pmUsers.sort((a: any, b: any) => a.name.localeCompare(b.name)).map((u: any) => ({
                          value: u.name,
                          label: u.name,
                        }))}
                        data-testid="select-pm"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="p-2 bg-muted rounded text-xs text-muted-foreground">
                From meeting: <strong>{convertDialog?.meeting.title}</strong>
                {convertDialog?.item.owner && <> | Owner: {convertDialog.item.owner}</>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConvertDialog(null)} data-testid="button-cancel-convert">Cancel</Button>
              <Button onClick={handleConvert} disabled={convertMutation.isPending} data-testid="button-confirm-convert">
                {convertMutation.isPending ? "Converting..." : "Convert"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manual Meeting Dialog */}
        <Dialog open={manualDialog} onOpenChange={setManualDialog}>
          <DialogContent className="sm:max-w-lg" data-testid="dialog-manual-meeting">
            <DialogHeader>
              <DialogTitle>Add Meeting Manually</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Meeting Title</label>
                <Input
                  value={manualForm.title}
                  onChange={(e) => setManualForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Weekly Project Sync"
                  data-testid="input-manual-title"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Summary (optional)</label>
                <Textarea
                  value={manualForm.summary}
                  onChange={(e) => setManualForm((p) => ({ ...p, summary: e.target.value }))}
                  placeholder="Key discussion points..."
                  rows={3}
                  data-testid="input-manual-summary"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">Action Items</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setManualForm((p) => ({ ...p, actionItems: [...p.actionItems, { text: "", owner: "", dueDate: "" }] }))}
                    data-testid="button-add-action-item"
                  >
                    <Plus className="w-3 h-3 mr-1" />Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {manualForm.actionItems.map((ai, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <Input
                        value={ai.text}
                        onChange={(e) => {
                          const items = [...manualForm.actionItems];
                          items[idx] = { ...items[idx], text: e.target.value };
                          setManualForm((p) => ({ ...p, actionItems: items }));
                        }}
                        placeholder="Action item..."
                        className="flex-1"
                        data-testid={`input-action-text-${idx}`}
                      />
                      <Input
                        value={ai.owner}
                        onChange={(e) => {
                          const items = [...manualForm.actionItems];
                          items[idx] = { ...items[idx], owner: e.target.value };
                          setManualForm((p) => ({ ...p, actionItems: items }));
                        }}
                        placeholder="Owner"
                        className="w-28"
                        data-testid={`input-action-owner-${idx}`}
                      />
                      {manualForm.actionItems.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-gray-400"
                          onClick={() => {
                            const items = manualForm.actionItems.filter((_, i) => i !== idx);
                            setManualForm((p) => ({ ...p, actionItems: items }));
                          }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManualDialog(false)} data-testid="button-cancel-manual">Cancel</Button>
              <Button
                onClick={() => {
                  const items = manualForm.actionItems.filter((ai) => ai.text.trim());
                  manualMeetingMutation.mutate({
                    title: manualForm.title,
                    summary: manualForm.summary || undefined,
                    actionItems: items.length > 0 ? items : undefined,
                  });
                }}
                disabled={!manualForm.title.trim() || manualMeetingMutation.isPending}
                data-testid="button-save-manual"
              >
                {manualMeetingMutation.isPending ? "Saving..." : "Save Meeting"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Webhook Setup Dialog */}
        <Dialog open={webhookDialog} onOpenChange={setWebhookDialog}>
          <DialogContent className="sm:max-w-lg" data-testid="dialog-webhook">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Read.ai Webhook Setup
                {webhookStatus?.connected ? (
                  <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">
                    <Wifi className="w-3 h-3 mr-0.5" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    <WifiOff className="w-3 h-3 mr-0.5" />
                    Not Connected
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Connection Stats */}
              {webhookStatus && webhookStatus.connected && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-green-50 rounded-lg text-center border border-green-100">
                    <p className="text-lg font-bold text-green-700">{webhookStatus.webhookMeetings}</p>
                    <p className="text-[10px] text-green-600">Meetings Received</p>
                  </div>
                  <div className="p-2 bg-blue-50 rounded-lg text-center border border-blue-100">
                    <p className="text-lg font-bold text-blue-700">{webhookStatus.totalActionItems}</p>
                    <p className="text-[10px] text-blue-600">Action Items</p>
                  </div>
                  <div className="p-2 bg-amber-50 rounded-lg text-center border border-amber-100">
                    <p className="text-lg font-bold text-amber-700">{webhookStatus.pendingItems}</p>
                    <p className="text-[10px] text-amber-600">Pending</p>
                  </div>
                </div>
              )}

              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-2">Your Webhook URL</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="font-mono text-xs bg-card"
                    data-testid="input-webhook-url"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast({ title: "Copied to clipboard" });
                    }}
                    data-testid="button-copy-webhook"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Setup Instructions:</p>
                <ol className="list-decimal list-inside space-y-2">
                  <li>Log in to your <a href="https://app.read.ai/analytics/integrations/webhooks" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Read.ai dashboard</a></li>
                  <li>Go to Integrations &rarr; Webhooks</li>
                  <li>Click "Add Webhook"</li>
                  <li>Paste the webhook URL above</li>
                  <li>Give it a name (e.g. "EE Dashboard")</li>
                  <li>Save - meetings will now automatically sync</li>
                </ol>
                <div className="p-3 bg-amber-50 rounded border border-amber-200 text-xs text-amber-700">
                  <strong>Note:</strong> Webhooks require a Read.ai Pro or Enterprise plan. After setup, action items from your meetings will appear here automatically.
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-2">Verify your connection by sending a test meeting:</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testWebhookMutation.mutate()}
                  disabled={testWebhookMutation.isPending}
                  className="w-full"
                  data-testid="button-test-webhook"
                >
                  <Play className="w-4 h-4 mr-1" />
                  {testWebhookMutation.isPending ? "Sending test..." : "Send Test Meeting"}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWebhookDialog(false)} data-testid="button-close-webhook">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
