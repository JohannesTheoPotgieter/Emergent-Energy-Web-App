import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, isToday, isSameDay, parseISO } from "date-fns";
import {
  Calendar, Mail, MessageSquare, FolderOpen, Bell,
  ChevronLeft, ChevronRight, Clock, Loader2, Search,
  Inbox, Send, Reply, Forward, Paperclip, ExternalLink,
  RefreshCw, AlertTriangle, Check, CheckCheck, Filter,
  Folder, FileText, FileSpreadsheet, Image as ImageIcon,
  Film, File, ArrowLeft, Download, HardDrive, ChevronRight as ChevronRightIcon,
  MailOpen, Star, Trash2, Archive,
  BellOff, Zap, ClipboardCheck, ArrowRight,
  FileCheck, Plus, Users,
} from "lucide-react";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function CalendarTab() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "day">("week");

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });

  const startStr = format(viewMode === "week" ? weekStart : currentDate, "yyyy-MM-dd");
  const endStr = format(viewMode === "week" ? weekEnd : currentDate, "yyyy-MM-dd");

  const { data: connectionStatus } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: ["outlook-status"],
    queryFn: async () => {
      const res = await fetch("/api/outlook/status", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: events, isLoading } = useQuery<any[]>({
    queryKey: ["outlook-events", startStr, endStr],
    queryFn: async () => {
      const res = await fetch(`/api/outlook/events?start=${startStr}&end=${endStr}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: connectionStatus?.connected === true,
    staleTime: 30_000,
  });

  if (connectionStatus && !connectionStatus.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="calendar-not-connected">
        <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Outlook Not Connected</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          Connect your Microsoft account to view your calendar events here.
          Contact your administrator to set up the Outlook integration.
        </p>
      </div>
    );
  }

  const days = viewMode === "week"
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [currentDate];

  const eventsByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      map[key] = (events || []).filter((ev: any) => {
        const evDate = ev.start?.dateTime ? format(parseISO(ev.start.dateTime), "yyyy-MM-dd") : null;
        return evDate === key;
      });
    }
    return map;
  }, [events, days]);

  return (
    <div className="space-y-4" data-testid="calendar-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => {
            if (viewMode === "week") setCurrentDate(subWeeks(currentDate, 1));
            else setCurrentDate(addDays(currentDate, -1));
          }} data-testid="calendar-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold min-w-[200px] text-center">
            {viewMode === "week"
              ? `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`
              : format(currentDate, "EEEE, MMMM d, yyyy")}
          </h3>
          <Button variant="outline" size="icon" onClick={() => {
            if (viewMode === "week") setCurrentDate(addWeeks(currentDate, 1));
            else setCurrentDate(addDays(currentDate, 1));
          }} data-testid="calendar-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setCurrentDate(new Date())}
            data-testid="calendar-today"
          >
            Today
          </Button>
          <Button
            variant={viewMode === "day" ? "default" : "outline"} size="sm"
            onClick={() => setViewMode("day")}
            data-testid="calendar-day-view"
          >
            Day
          </Button>
          <Button
            variant={viewMode === "week" ? "default" : "outline"} size="sm"
            onClick={() => setViewMode("week")}
            data-testid="calendar-week-view"
          >
            Week
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className={viewMode === "week" ? "grid grid-cols-7 gap-2" : ""}>
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay[key] || [];
            const today = isToday(day);
            return (
              <div
                key={key}
                className={`${viewMode === "week" ? "min-h-[200px]" : "min-h-[300px]"} rounded-lg border p-2 ${today ? "border-blue-500 bg-blue-50/50" : "border-border"}`}
                data-testid={`calendar-day-${key}`}
              >
                <div className={`text-xs font-medium mb-2 ${today ? "text-blue-600" : "text-muted-foreground"}`}>
                  {format(day, viewMode === "week" ? "EEE d" : "EEEE, MMM d")}
                </div>
                {dayEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 italic">No events</p>
                ) : (
                  <div className="space-y-1">
                    {dayEvents.map((ev: any, i: number) => (
                      <div
                        key={ev.id || i}
                        className="rounded bg-blue-100 border border-blue-200 px-2 py-1 text-xs cursor-pointer hover:bg-blue-200 transition-colors"
                        title={ev.subject}
                        data-testid={`calendar-event-${ev.id || i}`}
                      >
                        <div className="font-medium text-blue-900 truncate">{ev.subject || "No Subject"}</div>
                        {ev.start?.dateTime && (
                          <div className="text-blue-700 text-[10px]">
                            {format(parseISO(ev.start.dateTime), "h:mm a")}
                            {ev.end?.dateTime && ` – ${format(parseISO(ev.end.dateTime), "h:mm a")}`}
                          </div>
                        )}
                        {ev.location?.displayName && (
                          <div className="text-blue-600 text-[10px] truncate">{ev.location.displayName}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmailTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("inbox");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data: connectionStatus } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: ["outlook-status"],
    queryFn: async () => {
      const res = await fetch("/api/outlook/status", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: folders } = useQuery<any[]>({
    queryKey: ["outlook-folders"],
    queryFn: async () => {
      const res = await fetch("/api/outlook/folders", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: connectionStatus?.connected === true,
    staleTime: 120_000,
  });

  const { data: messages, isLoading: loadingMessages } = useQuery<any[]>({
    queryKey: ["outlook-messages", selectedFolder, searchQuery, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        folder: selectedFolder,
        top: String(pageSize),
        skip: String(page * pageSize),
      });
      if (searchQuery) params.set("search", searchQuery);
      const res = await fetch(`/api/outlook/messages?${params}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: connectionStatus?.connected === true,
    staleTime: 30_000,
  });

  const { data: selectedMessage, isLoading: loadingDetail } = useQuery<any>({
    queryKey: ["outlook-message", selectedMessageId],
    queryFn: async () => {
      const res = await fetch(`/api/outlook/messages/${selectedMessageId}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedMessageId,
  });

  if (connectionStatus && !connectionStatus.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="email-not-connected">
        <Mail className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Outlook Not Connected</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          Connect your Microsoft account to view your emails here.
          Contact your administrator to set up the Outlook integration.
        </p>
      </div>
    );
  }

  if (selectedMessageId && selectedMessage) {
    return (
      <div className="space-y-4" data-testid="email-detail">
        <Button variant="ghost" size="sm" onClick={() => setSelectedMessageId(null)} data-testid="email-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Inbox
        </Button>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{selectedMessage.subject || "(No Subject)"}</CardTitle>
            <div className="text-sm text-muted-foreground space-y-1 mt-2">
              <div><span className="font-medium">From:</span> {selectedMessage.from?.emailAddress?.name || selectedMessage.from?.emailAddress?.address || "Unknown"}</div>
              <div><span className="font-medium">To:</span> {(selectedMessage.toRecipients || []).map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", ")}</div>
              {selectedMessage.receivedDateTime && (
                <div><span className="font-medium">Date:</span> {format(parseISO(selectedMessage.receivedDateTime), "PPpp")}</div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selectedMessage.body?.contentType === "html" ? (
              <div
                className="prose prose-sm max-w-none email-body"
                dangerouslySetInnerHTML={{ __html: selectedMessage.body.content }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm">{selectedMessage.body?.content || ""}</pre>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="email-tab">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            className="pl-9"
            data-testid="email-search"
          />
        </div>
        {folders && folders.length > 0 && (
          <select
            className="border rounded-md px-3 py-2 text-sm bg-background"
            value={selectedFolder}
            onChange={(e) => { setSelectedFolder(e.target.value); setPage(0); }}
            data-testid="email-folder-select"
          >
            {folders.map((f: any) => (
              <option key={f.id} value={f.id}>{f.displayName}</option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" onClick={() => setPage(0)} data-testid="email-refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loadingMessages ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !messages || messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No emails found</p>
        </div>
      ) : (
        <>
          <div className="divide-y rounded-lg border">
            {messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${msg.isRead === false ? "bg-blue-50/50 font-medium" : ""}`}
                onClick={() => setSelectedMessageId(msg.id)}
                data-testid={`email-item-${msg.id}`}
              >
                <div className="flex-shrink-0 mt-1">
                  {msg.isRead === false ? (
                    <Mail className="h-4 w-4 text-blue-500" />
                  ) : (
                    <MailOpen className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm truncate">
                      {msg.sender?.emailAddress?.name || msg.sender?.emailAddress?.address || "Unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {msg.receivedDateTime ? format(parseISO(msg.receivedDateTime), "MMM d, h:mm a") : ""}
                    </span>
                  </div>
                  <div className="text-sm truncate">{msg.subject || "(No Subject)"}</div>
                  {msg.bodyPreview && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.bodyPreview}</p>
                  )}
                </div>
                {msg.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-2" />}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="email-prev-page">
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button variant="outline" size="sm" disabled={(messages?.length || 0) < pageSize} onClick={() => setPage(p => p + 1)} data-testid="email-next-page">
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SharePointTab() {
  const [driveId, setDriveId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([]);

  const { data: config, isLoading: loadingConfig } = useQuery<any>({
    queryKey: ["sp-config"],
    queryFn: async () => {
      const res = await fetch("/api/sp-config", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 120_000,
  });

  const effectiveDriveId = driveId || config?.driveId;

  const { data: items, isLoading: loadingItems } = useQuery<any[]>({
    queryKey: ["sp-browse", effectiveDriveId, folderId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveDriveId) params.set("driveId", effectiveDriveId);
      if (folderId) params.set("folderId", folderId);
      const res = await fetch(`/api/sp-project-browse?${params}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.value || [];
    },
    enabled: !!effectiveDriveId,
    staleTime: 30_000,
  });

  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config?.driveId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="sharepoint-not-configured">
        <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">SharePoint Not Configured</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          SharePoint document library has not been configured yet.
          Contact your administrator to set up SharePoint integration.
        </p>
      </div>
    );
  }

  function getFileIcon(name: string, isFolder: boolean) {
    if (isFolder) return <Folder className="h-5 w-5 text-amber-500" />;
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
    if (["jpg", "jpeg", "png", "gif", "svg"].includes(ext)) return <ImageIcon className="h-5 w-5 text-purple-500" />;
    if (["mp4", "mov", "avi"].includes(ext)) return <Film className="h-5 w-5 text-red-500" />;
    if (["pdf", "doc", "docx", "txt"].includes(ext)) return <FileText className="h-5 w-5 text-blue-500" />;
    return <File className="h-5 w-5 text-gray-500" />;
  }

  function formatSize(bytes: number) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function navigateToFolder(id: string, name: string) {
    setBreadcrumbs(prev => [...prev, { id: folderId, name: folderId ? breadcrumbs[breadcrumbs.length - 1]?.name || "Root" : "Root" }]);
    setFolderId(id);
  }

  function navigateBack() {
    const prev = breadcrumbs[breadcrumbs.length - 1];
    setBreadcrumbs(b => b.slice(0, -1));
    setFolderId(prev?.id || null);
  }

  return (
    <div className="space-y-4" data-testid="sharepoint-tab">
      <div className="flex items-center gap-2">
        {folderId && (
          <Button variant="ghost" size="sm" onClick={navigateBack} data-testid="sp-back">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        )}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <HardDrive className="h-4 w-4" />
          <span>SharePoint Documents</span>
          {folderId && <ChevronRightIcon className="h-3 w-3" />}
        </div>
      </div>

      {loadingItems ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Folder className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">This folder is empty</p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.filter((it: any) => it.folder).map((item: any) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigateToFolder(item.id, item.name)}
              data-testid={`sp-folder-${item.id}`}
            >
              {getFileIcon(item.name, true)}
              <span className="flex-1 text-sm font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.folder?.childCount || 0} items</span>
              <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          ))}
          {items.filter((it: any) => !it.folder).map((item: any) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              data-testid={`sp-file-${item.id}`}
            >
              {getFileIcon(item.name, false)}
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{item.name}</div>
                <div className="text-xs text-muted-foreground">
                  {item.size ? formatSize(item.size) : ""}
                  {item.lastModifiedDateTime && ` · ${format(parseISO(item.lastModifiedDateTime), "MMM d, yyyy")}`}
                </div>
              </div>
              {item.webUrl && (
                <a href={item.webUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`sp-open-${item.id}`}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </a>
              )}
              {item["@microsoft.graph.downloadUrl"] && (
                <a href={item["@microsoft.graph.downloadUrl"]} download onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`sp-download-${item.id}`}>
                    <Download className="h-4 w-4" />
                  </Button>
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EVENT_TYPE_LABELS: Record<string, { label: string; icon: typeof Bell; color: string }> = {
  "plan.change_confirmation": { label: "Plan Change", icon: FileSpreadsheet, color: "text-amber-600 bg-amber-50" },
  "task.assigned": { label: "Task Assigned", icon: ClipboardCheck, color: "text-blue-600 bg-blue-50" },
  "task.status_changed": { label: "Status Update", icon: ArrowRight, color: "text-indigo-600 bg-indigo-50" },
  "task.approaching_deadline": { label: "Deadline Approaching", icon: Clock, color: "text-orange-600 bg-orange-50" },
  "deliverable.submitted_for_approval": { label: "Needs Approval", icon: AlertTriangle, color: "text-purple-600 bg-purple-50" },
  "deliverable.qc_approved": { label: "QC Approved", icon: Check, color: "text-green-600 bg-green-50" },
  "deliverable.feedback_requested": { label: "Feedback Requested", icon: Zap, color: "text-rose-600 bg-rose-50" },
  "deliverable.sent_for_acknowledgment": { label: "Deliverable Received", icon: Inbox, color: "text-orange-600 bg-orange-50" },
  "deliverable.acknowledged": { label: "Deliverable Acknowledged", icon: Check, color: "text-emerald-600 bg-emerald-50" },
  "milestone.approaching": { label: "Milestone Approaching", icon: Clock, color: "text-orange-600 bg-orange-50" },
  "milestone.commissioning_soon": { label: "Commissioning Soon", icon: Zap, color: "text-amber-600 bg-amber-50" },
  "project.phase_changed": { label: "Phase Changed", icon: ArrowRight, color: "text-teal-600 bg-teal-50" },
  "project.behind_schedule": { label: "Behind Schedule", icon: AlertTriangle, color: "text-red-600 bg-red-50" },
};

function getEventTypeInfo(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] || { label: eventType, icon: Bell, color: "text-gray-600 bg-gray-50" };
}

function NotificationsTab() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<"all" | "unread" | "action_required">("all");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const { data: notificationsData, isLoading } = useQuery<any>({
    queryKey: ["collab-notifications", filterStatus, page],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
      if (filterStatus === "unread") params.set("unreadOnly", "true");
      if (filterStatus === "action_required") params.set("eventType", "plan.change_confirmation");
      const res = await fetch(`/api/notifications?${params}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return { notifications: [], total: 0 };
      return res.json();
    },
    staleTime: 15_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab-notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab-notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/confirm`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab-notifications"] });
      toast({ title: "Confirmed" });
    },
  });

  const notifications = notificationsData?.notifications || [];
  const total = notificationsData?.total || 0;

  return (
    <div className="space-y-4" data-testid="notifications-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={filterStatus === "all" ? "default" : "outline"} size="sm"
            onClick={() => { setFilterStatus("all"); setPage(0); }}
            data-testid="notif-filter-all"
          >All</Button>
          <Button
            variant={filterStatus === "unread" ? "default" : "outline"} size="sm"
            onClick={() => { setFilterStatus("unread"); setPage(0); }}
            data-testid="notif-filter-unread"
          >Unread</Button>
          <Button
            variant={filterStatus === "action_required" ? "default" : "outline"} size="sm"
            onClick={() => { setFilterStatus("action_required"); setPage(0); }}
            data-testid="notif-filter-action"
          >Action Required</Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => markAllReadMutation.mutate()} data-testid="notif-mark-all-read">
          <CheckCheck className="h-4 w-4 mr-1" /> Mark All Read
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BellOff className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No notifications</p>
        </div>
      ) : (
        <>
          <div className="divide-y rounded-lg border">
            {notifications.map((n: any) => {
              const info = getEventTypeInfo(n.eventType || "");
              const Icon = info.icon;
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 ${n.readAt ? "" : "bg-blue-50/30"}`}
                  data-testid={`notif-item-${n.id}`}
                >
                  <div className={`flex-shrink-0 rounded-full p-1.5 mt-0.5 ${info.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${info.color}`}>{info.label}</Badge>
                      {!n.readAt && <div className="h-2 w-2 rounded-full bg-blue-500" />}
                    </div>
                    <p className="text-sm mt-1">{n.message || n.title || "Notification"}</p>
                    {n.projectName && <p className="text-xs text-muted-foreground mt-0.5">{n.projectName}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {n.createdAt ? format(parseISO(n.createdAt), "MMM d, h:mm a") : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!n.readAt && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => markReadMutation.mutate([n.id])} data-testid={`notif-read-${n.id}`}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {n.eventType === "plan.change_confirmation" && !n.confirmedAt && (
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => confirmMutation.mutate(n.id)} data-testid={`notif-confirm-${n.id}`}>
                        Confirm
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {total > pageSize && (
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="notif-prev">
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)} data-testid="notif-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamsChatTab() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const { data: groups, isLoading } = useQuery<any[]>({
    queryKey: ["teams-chat-groups-collab"],
    queryFn: async () => {
      const res = await fetch("/api/teams/groups", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const myGroups = useMemo(() => {
    if (!groups || !user) return [];
    return groups.filter((g: any) => {
      if (g.members && Array.isArray(g.members)) {
        return g.members.some((m: any) => m.userId === user.id || m.user_id === user.id);
      }
      return true;
    });
  }, [groups, user]);

  return (
    <div className="space-y-4" data-testid="teams-chat-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Your channels and group chats</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/teams/chats")} data-testid="teams-open-full">
          <ExternalLink className="h-4 w-4 mr-1" /> Open Full Chat
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !myGroups || myGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No chat channels found</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/teams/chats")} data-testid="teams-go-create">
            Go to Teams Chat
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {myGroups.map((group: any) => (
            <div
              key={group.id}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate("/teams/chats")}
              data-testid={`teams-group-${group.id}`}
            >
              <div className={`flex-shrink-0 rounded-lg p-2 ${group.type === "department" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`}>
                {group.type === "department" ? <Users className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{group.name}</div>
                <div className="text-xs text-muted-foreground">
                  {group.type === "department" ? "Department" : "Project"} channel
                  {group.memberCount ? ` · ${group.memberCount} members` : ""}
                </div>
              </div>
              {group.unreadCount > 0 && (
                <Badge className="bg-blue-500 text-white text-xs">{group.unreadCount}</Badge>
              )}
              <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CollaborationPage() {
  const { user } = useAuth();
  const { allowed, loading: permLoading } = usePermission("pd_collaboration", "view");
  const [activeTab, setActiveTab] = useState("calendar");

  const { data: unreadCount } = useQuery<{ count: number }>({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (permLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500 mb-3" />
        <h3 className="text-lg font-semibold">Access Restricted</h3>
        <p className="text-muted-foreground text-sm">You don't have permission to access the Collaboration hub.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="collaboration-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-collaboration-title">Collaboration Hub</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Your Microsoft 365 tools and notifications in one place
          {user?.displayName && <span> — signed in as <strong>{user.displayName}</strong></span>}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="calendar" className="flex items-center gap-1.5" data-testid="tab-calendar">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Calendar</span>
          </TabsTrigger>
          <TabsTrigger value="email" className="flex items-center gap-1.5" data-testid="tab-email">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Email</span>
          </TabsTrigger>
          <TabsTrigger value="teams" className="flex items-center gap-1.5" data-testid="tab-teams">
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Teams Chat</span>
          </TabsTrigger>
          <TabsTrigger value="sharepoint" className="flex items-center gap-1.5" data-testid="tab-sharepoint">
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">SharePoint</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="relative flex items-center gap-1.5" data-testid="tab-notifications">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Notifications</span>
            {(unreadCount?.count || 0) > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                {unreadCount!.count > 99 ? "99+" : unreadCount!.count}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="calendar">
            <CalendarTab />
          </TabsContent>
          <TabsContent value="email">
            <EmailTab />
          </TabsContent>
          <TabsContent value="teams">
            <TeamsChatTab />
          </TabsContent>
          <TabsContent value="sharepoint">
            <SharePointTab />
          </TabsContent>
          <TabsContent value="notifications">
            <NotificationsTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
