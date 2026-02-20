import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import MyToolLayout from "@/components/mytool/MyToolLayout";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "lucide-react";
import { format } from "date-fns";

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
  actionItems: ActionItem[];
}

type ConvertType = "task" | "priority" | "project";

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
];

export default function MyToolMeetingsPage() {
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

  const { data: webhookInfo } = useQuery<{ webhookUrl: string }>({
    queryKey: ["/api/meetings/webhook-info"],
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/meetings/action-items/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      toast({ title: "Dismissed" });
    },
  });

  const deleteMeetingMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/meetings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      toast({ title: "Meeting deleted" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async ({ itemId, type, body }: { itemId: number; type: ConvertType; body: Record<string, string> }) => {
      const endpoint = type === "task" ? "convert-to-task" : type === "priority" ? "convert-to-priority" : "convert-to-project";
      return apiRequest("POST", `/api/meetings/action-items/${itemId}/${endpoint}`, body);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
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

  return (
    <MyToolLayout>
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
              <Link2 className="w-4 h-4 mr-1" />
              Webhook Setup
            </Button>
            <Button variant="outline" size="sm" onClick={() => setManualDialog(true)} data-testid="button-add-meeting">
              <Plus className="w-4 h-4 mr-1" />
              Add Meeting
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : meetings.length === 0 ? (
          <Card data-testid="card-empty-state">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Video className="w-12 h-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">No meetings yet</h3>
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
              const dismissedItems = meeting.actionItems.filter((ai) => ai.status === "dismissed");

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
                            <Badge variant="outline" className="text-[10px] shrink-0" data-testid={`badge-source-${meeting.id}`}>
                              {meeting.source === "read_ai" ? "Read.ai" : "Manual"}
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
                      {meeting.summary && (
                        <div className="mb-4 p-3 bg-gray-50 rounded-md text-sm text-gray-600" data-testid={`text-summary-${meeting.id}`}>
                          <p className="font-medium text-gray-700 mb-1 text-xs uppercase tracking-wide">Summary</p>
                          {meeting.summary}
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
                          <p className="text-xs font-medium text-gray-500 mb-1">Participants</p>
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
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Action Items</p>
                          {meeting.actionItems.map((item) => (
                            <div
                              key={item.id}
                              className={`flex items-start gap-3 p-3 rounded-lg border ${
                                item.status === "converted" ? "bg-green-50 border-green-200" :
                                item.status === "dismissed" ? "bg-gray-50 border-gray-200 opacity-60" :
                                "bg-white border-gray-200"
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
                                    className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
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
                <label className="text-xs font-medium text-gray-500">Title</label>
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
                      <label className="text-xs font-medium text-gray-500">Priority</label>
                      <Select value={convertForm.priority || "normal"} onValueChange={(v) => setConvertForm((p) => ({ ...p, priority: v }))}>
                        <SelectTrigger data-testid="select-priority"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Department</label>
                      <Select value={convertForm.department || ""} onValueChange={(v) => setConvertForm((p) => ({ ...p, department: v }))}>
                        <SelectTrigger data-testid="select-department"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Planned For Date</label>
                    <Input
                      type="date"
                      value={convertForm.plannedForDate || ""}
                      onChange={(e) => setConvertForm((p) => ({ ...p, plannedForDate: e.target.value }))}
                      data-testid="input-planned-date"
                    />
                  </div>
                </>
              )}

              {convertDialog?.type === "priority" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500">Severity</label>
                      <Select value={convertForm.severity || "normal"} onValueChange={(v) => setConvertForm((p) => ({ ...p, severity: v }))}>
                        <SelectTrigger data-testid="select-severity"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="important">Important</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Horizon</label>
                      <Select value={convertForm.horizon || "week"} onValueChange={(v) => setConvertForm((p) => ({ ...p, horizon: v }))}>
                        <SelectTrigger data-testid="select-horizon"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="today">Today</SelectItem>
                          <SelectItem value="week">This Week</SelectItem>
                          <SelectItem value="month">This Month</SelectItem>
                          <SelectItem value="quarter">This Quarter</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Department</label>
                    <Select value={convertForm.department || ""} onValueChange={(v) => setConvertForm((p) => ({ ...p, department: v }))}>
                      <SelectTrigger data-testid="select-priority-department"><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {convertDialog?.type === "project" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Project Name</label>
                    <Input
                      value={convertForm.projectName || convertForm.title || ""}
                      onChange={(e) => setConvertForm((p) => ({ ...p, projectName: e.target.value }))}
                      data-testid="input-project-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500">Size (kWp)</label>
                      <Input
                        type="number"
                        value={convertForm.sizeKwp || ""}
                        onChange={(e) => setConvertForm((p) => ({ ...p, sizeKwp: e.target.value }))}
                        data-testid="input-size-kwp"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">PM</label>
                      <Input
                        value={convertForm.pm || ""}
                        onChange={(e) => setConvertForm((p) => ({ ...p, pm: e.target.value }))}
                        data-testid="input-pm"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="p-2 bg-gray-50 rounded text-xs text-gray-500">
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
                <label className="text-xs font-medium text-gray-500">Meeting Title</label>
                <Input
                  value={manualForm.title}
                  onChange={(e) => setManualForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Weekly Project Sync"
                  data-testid="input-manual-title"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Summary (optional)</label>
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
                  <label className="text-xs font-medium text-gray-500">Action Items</label>
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
              <DialogTitle>Read.ai Webhook Setup</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-2">Your Webhook URL</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookInfo?.webhookUrl || "Loading..."}
                    className="font-mono text-xs bg-white"
                    data-testid="input-webhook-url"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookInfo?.webhookUrl || "");
                      toast({ title: "Copied to clipboard" });
                    }}
                    data-testid="button-copy-webhook"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3 text-sm text-gray-600">
                <p className="font-medium text-gray-800">Setup Instructions:</p>
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWebhookDialog(false)} data-testid="button-close-webhook">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MyToolLayout>
  );
}
