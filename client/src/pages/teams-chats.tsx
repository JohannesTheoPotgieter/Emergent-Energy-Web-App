import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Users,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Send,
  Loader2,
  Hash,
  Paperclip,
  FileText,
  Image,
  File,
  Download,
  Search,
  Settings,
  MoreVertical,
  X,
  ChevronDown,
  Building2,
  FolderKanban,
  ExternalLink,
  Zap,
  RefreshCw,
  AlertTriangle,
  Link2,
  Tag,
  ClipboardCheck,
} from "lucide-react";
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";
import { MsObjectActions, TagToProjectDialog, ConvertToTaskDialog } from "./collaboration";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ChatMember {
  id: number;
  groupId: number;
  userId: number;
  role: string;
  userName: string;
  userRole: string;
  userEmail: string;
  addedAt: string;
}

interface ChatGroup {
  id: number;
  name: string;
  groupType: string;
  department: string | null;
  projectName: string | null;
  description: string | null;
  teamsChatId: string | null;
  members: ChatMember[];
  memberCount: number;
  isMember: boolean;
  isGroupAdmin: boolean;
  canManage: boolean;
  createdAt: string;
}

interface ChatMessage {
  id: number;
  groupId: number;
  content: string;
  senderName: string | null;
  senderUserId: number | null;
  userName: string | null;
  isFromTeams: boolean;
  fileName: string | null;
  filePath: string | null;
  fileSize: number | null;
  fileType: string | null;
  createdAt: string;
}

const DEPARTMENTS = [
  "Executive", "Project Management", "Engineering", "Finance",
  "Quality", "Project Development", "Construction", "Operations",
];

const AVATAR_COLORS = [
  "bg-indigo-600", "bg-violet-600", "bg-blue-600", "bg-teal-600",
  "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600",
  "bg-fuchsia-600", "bg-lime-600", "bg-orange-600", "bg-sky-600",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string | null) {
  if (!type) return File;
  if (type.startsWith("image/")) return Image;
  if (type.includes("pdf") || type.includes("document") || type.includes("text")) return FileText;
  return File;
}

function formatMessageTime(dateStr: string) {
  const d = new Date(dateStr);
  return format(d, "h:mm a");
}

function formatDateHeader(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d, yyyy");
}

function ActivitySection() {
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);
  const [autoSyncDone, setAutoSyncDone] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "teams" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Sync failed" }));
        throw new Error(err.error || "Sync failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      const total = (data.results || []).reduce((s: number, r: any) => s + (r.synced || 0), 0);
      if (total > 0) {
        toast({ title: `Synced ${total} Teams items` });
      } else {
        toast({ title: "Teams sync complete", description: "No new items" });
      }
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const { data: items = [], isLoading, isFetched } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "teams"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?type=teams", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isFetched && items.length === 0 && !autoSyncDone && !syncMutation.isPending) {
      setAutoSyncDone(true);
      syncMutation.mutate();
    }
  }, [isFetched, items.length, autoSyncDone]);

  return (
    <div className="flex-1 overflow-y-auto" data-testid="activity-section">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900" data-testid="text-activity-title">Teams Activity</h2>
            <p className="text-sm text-muted-foreground">Mentions, chats, and activity synced from Microsoft Teams</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="sync-teams-button"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </Button>
            <Badge variant="outline" className="text-xs" data-testid="synced-teams-count">
              {items.length} items
            </Badge>
          </div>
        </div>

        {isLoading || syncMutation.isPending ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">{syncMutation.isPending ? "Syncing Teams from Microsoft 365..." : "Loading..."}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center mb-4">
              <Zap className="h-8 w-8 text-purple-400" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">No Teams activity synced</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Sync Now" to pull your Teams chats from Microsoft 365</p>
            <Button
              variant="default"
              size="sm"
              className="mt-4"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="sync-teams-empty-button"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> Sync Teams
            </Button>
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-white shadow-sm">
            {items.map((item: any) => (
              <div
                key={item.id}
                className={`group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/50 transition-colors ${item.actionRequired ? "bg-purple-50/40" : ""}`}
                data-testid={`synced-teams-item-${item.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {item.actionRequired ? (
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <AlertTriangle className="h-4 w-4 text-purple-600" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                      <MessageSquare className="h-4 w-4 text-gray-500" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{item.subjectOrTitle || "Teams Activity"}</span>
                    {item.actionRequired && (
                      <Badge className="bg-purple-100 text-purple-700 text-[10px]">Mention</Badge>
                    )}
                    {item.linkedProjectId && (
                      <Badge variant="secondary" className="text-[10px]" data-testid={`teams-project-badge-${item.id}`}>
                        <Link2 className="h-3 w-3 mr-0.5" /> Tagged
                      </Badge>
                    )}
                  </div>
                  {item.preview && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{item.preview}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {item.receivedOrStartDatetime ? format(parseISO(item.receivedOrStartDatetime), "MMM d, h:mm a") : ""}
                  </p>
                </div>
                <MsObjectActions
                  item={item}
                  onTagClick={(i) => { setTagTarget(i); setTagDialogOpen(true); }}
                  onConvertClick={(i) => { setConvertTarget(i); setConvertDialogOpen(true); }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <TagToProjectDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        msObjectId={tagTarget?.id || null}
        currentProjectId={tagTarget?.linkedProjectId}
      />
      {convertTarget && (
        <Suspense fallback={null}>
          <ConvertToTaskDialog
            open={convertDialogOpen}
            onOpenChange={setConvertDialogOpen}
            item={convertTarget}
          />
        </Suspense>
      )}
    </div>
  );
}

export default function TeamsChatsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"activity" | "chat">("activity");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarSection, setSidebarSection] = useState<"all" | "department" | "project">("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupType, setNewGroupType] = useState("department");
  const [newGroupDept, setNewGroupDept] = useState("");
  const [newGroupProject, setNewGroupProject] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);

  const { data: groups = [], isLoading } = useQuery<ChatGroup[]>({
    queryKey: ["/api/teams/groups"],
  });

  const { data: allUsers = [] } = useQuery<Array<{ id: number; name: string; username: string; role: string }>>({
    queryKey: ["/api/eng/users"],
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) =>
      data
        .filter((p: any) => p.is_active !== false)
        .map((p: any) => ({ project_name: p.project_name }))
        .sort((a, b) => a.project_name.localeCompare(b.project_name)),
  });

  const selectedGroup = useMemo(
    () => groups.find(g => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  const { data: messages = [], isLoading: messagesLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/teams/groups", selectedGroupId, "messages"],
    queryFn: async () => {
      if (!selectedGroupId) return [];
      const res = await fetch(`/api/teams/groups/${selectedGroupId}/messages`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedGroupId,
    refetchInterval: selectedGroupId ? 8000 : false,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createGroupMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/teams/groups", data),
    onSuccess: () => {
      toast({ title: "Channel created" });
      setShowCreateDialog(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed to create channel", description: err.message, variant: "destructive" }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/teams/groups/${id}`),
    onSuccess: () => {
      toast({ title: "Channel deleted" });
      setSelectedGroupId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const addMembersMutation = useMutation({
    mutationFn: ({ groupId, userIds }: { groupId: number; userIds: number[] }) =>
      apiRequest("POST", `/api/teams/groups/${groupId}/members`, { userIds }),
    onSuccess: () => {
      toast({ title: "Members added" });
      setShowAddMemberDialog(false);
      setSelectedMembers([]);
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
    onError: (err: any) =>
      toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      apiRequest("DELETE", `/api/teams/groups/${groupId}/members/${userId}`),
    onSuccess: () => {
      toast({ title: "Member removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups"] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ groupId, content }: { groupId: number; content: string }) =>
      apiRequest("POST", `/api/teams/groups/${groupId}/messages`, { content }),
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups", selectedGroupId, "messages"] });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ groupId, file, content }: { groupId: number; file: globalThis.File; content?: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (content) formData.append("content", content);
      const res = await fetch(`/api/teams/groups/${groupId}/files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams/groups", selectedGroupId, "messages"] });
    },
    onError: () => toast({ title: "File upload failed", variant: "destructive" }),
  });

  const resetCreateForm = () => {
    setNewGroupName("");
    setNewGroupType("department");
    setNewGroupDept("");
    setNewGroupProject("");
    setNewGroupDesc("");
  };

  const handleSend = () => {
    if (!selectedGroupId || !messageText.trim()) return;
    sendMessageMutation.mutate({ groupId: selectedGroupId, content: messageText });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedGroupId) return;
    uploadFileMutation.mutate({ groupId: selectedGroupId, file });
    e.target.value = "";
  };

  const filteredGroups = useMemo(() => {
    let result = groups;
    if (sidebarSection === "department") result = result.filter(g => g.groupType === "department");
    else if (sidebarSection === "project") result = result.filter(g => g.groupType === "project");
    if (sidebarSearch.trim()) {
      const q = sidebarSearch.toLowerCase();
      result = result.filter(g =>
        g.name.toLowerCase().includes(q) ||
        (g.department || "").toLowerCase().includes(q) ||
        (g.projectName || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [groups, sidebarSection, sidebarSearch]);

  const messagesByDate = useMemo(() => {
    const groups: { date: string; msgs: ChatMessage[] }[] = [];
    let currentDate = "";
    for (const msg of messages) {
      const d = new Date(msg.createdAt).toDateString();
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: msg.createdAt, msgs: [msg] });
      } else {
        groups[groups.length - 1].msgs.push(msg);
      }
    }
    return groups;
  }, [messages]);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-white overflow-hidden" data-testid="teams-chats-page">
      <div className="flex items-center gap-4 px-4 py-2 bg-white border-b shrink-0" data-testid="teams-section-toggle">
        <h1 className="text-base font-semibold text-gray-900 mr-2">Teams Chat</h1>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              viewMode === "activity"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setViewMode("activity")}
            data-testid="teams-view-activity"
          >
            <Zap className="h-3.5 w-3.5" />
            Activity
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              viewMode === "chat"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setViewMode("chat")}
            data-testid="teams-view-chat"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </button>
        </div>
      </div>

      {viewMode === "activity" ? (
        <ActivitySection />
      ) : (
      <div className="flex flex-1 overflow-hidden">
      <div className="w-72 bg-[#292929] flex flex-col shrink-0 border-r border-[#3b3b3b]" data-testid="teams-sidebar">
        <div className="p-3 border-b border-[#3b3b3b]">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-white font-semibold text-sm tracking-wide">Teams & Channels</h2>
            <button
              className="p-1.5 rounded hover:bg-[#3b3b3b] text-[#c8c8c8] transition-colors"
              onClick={() => setShowCreateDialog(true)}
              title="New channel"
              data-testid="button-create-group"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#808080]" />
            <input
              className="w-full bg-[#3b3b3b] border-none rounded text-[#e0e0e0] text-xs pl-8 pr-3 py-1.5 placeholder-[#808080] focus:outline-none focus:ring-1 focus:ring-[#6264a7]"
              placeholder="Search channels..."
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              data-testid="input-sidebar-search"
            />
          </div>
          <div className="flex gap-0.5 mt-2">
            {(["all", "department", "project"] as const).map(sec => (
              <button
                key={sec}
                className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
                  sidebarSection === sec
                    ? "bg-[#6264a7] text-white"
                    : "text-[#a0a0a0] hover:bg-[#3b3b3b] hover:text-white"
                }`}
                onClick={() => setSidebarSection(sec)}
                data-testid={`tab-${sec}`}
              >
                {sec === "all" ? "All" : sec === "department" ? "Depts" : "Projects"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1" data-testid="channel-list">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[#808080]" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Hash className="h-8 w-8 text-[#555] mx-auto mb-2" />
              <p className="text-[#808080] text-xs">No channels found</p>
              <button
                className="text-[#6264a7] text-xs mt-2 hover:underline"
                onClick={() => setShowCreateDialog(true)}
              >
                Create a channel
              </button>
            </div>
          ) : (
            filteredGroups.map(g => (
              <button
                key={g.id}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors group ${
                  selectedGroupId === g.id
                    ? "bg-[#3b3b3b]"
                    : "hover:bg-[#333333]"
                }`}
                onClick={() => { setSelectedGroupId(g.id); setShowMembersPanel(false); }}
                data-testid={`channel-${g.id}`}
              >
                <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${
                  g.groupType === "department" ? "bg-[#6264a7]" : "bg-[#4a7ea7]"
                }`}>
                  {g.groupType === "department"
                    ? <Building2 className="h-4 w-4 text-white" />
                    : <FolderKanban className="h-4 w-4 text-white" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm truncate ${
                    selectedGroupId === g.id ? "text-white font-semibold" : "text-[#d0d0d0] group-hover:text-white"
                  }`}>
                    {g.name}
                  </p>
                  <p className="text-[10px] text-[#808080] truncate">
                    {g.groupType === "department" ? g.department : g.projectName}
                    {g.memberCount > 0 && ` · ${g.memberCount}`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!selectedGroup ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-[#f5f5f5]">
            <div className="w-24 h-24 rounded-2xl bg-[#6264a7]/10 flex items-center justify-center mb-4">
              <MessageSquare className="h-12 w-12 text-[#6264a7]" />
            </div>
            <h2 className="text-xl font-semibold text-gray-700 mb-1">Welcome to Teams</h2>
            <p className="text-sm text-gray-500 mb-4">Select a channel to start chatting</p>
            <Button
              variant="outline"
              className="border-[#6264a7] text-[#6264a7] hover:bg-[#6264a7]/5"
              onClick={() => setShowCreateDialog(true)}
              data-testid="button-create-cta"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Create a new channel
            </Button>
          </div>
        ) : (
          <>
            <div className="h-12 bg-white border-b flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="h-4 w-4 text-[#6264a7] shrink-0" />
                <h3 className="font-semibold text-sm truncate" data-testid="text-channel-name">{selectedGroup.name}</h3>
                <Badge variant="outline" className="text-[10px] shrink-0 hidden sm:inline-flex">
                  {selectedGroup.groupType === "department" ? selectedGroup.department : selectedGroup.projectName}
                </Badge>
                {selectedGroup.groupType === "project" && selectedGroup.projectName && (
                  <Link href={`/project/${encodeURIComponent(selectedGroup.projectName)}`}>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2 text-blue-600 hover:text-blue-700" data-testid="button-goto-project-detail">
                      <ExternalLink className="h-3 w-3" />
                      View Project
                    </Button>
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  className={`p-1.5 rounded transition-colors ${showMembersPanel ? "bg-[#6264a7]/10 text-[#6264a7]" : "hover:bg-gray-100 text-gray-500"}`}
                  onClick={() => setShowMembersPanel(!showMembersPanel)}
                  title="Members"
                  data-testid="button-toggle-members"
                >
                  <Users className="h-4 w-4" />
                </button>
                {selectedGroup.canManage && (
                  <>
                    <button
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                      onClick={() => setShowAddMemberDialog(true)}
                      title="Add people"
                      data-testid="button-add-members"
                    >
                      <UserPlus className="h-4 w-4" />
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors"
                      onClick={() => {
                        if (confirm("Delete this channel? All messages will be lost.")) {
                          deleteGroupMutation.mutate(selectedGroup.id);
                        }
                      }}
                      title="Delete channel"
                      data-testid="button-delete-group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 bg-[#f5f5f5]">
                <div className="flex-1 overflow-y-auto px-4 py-2" data-testid="messages-container">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <div className="w-16 h-16 rounded-full bg-[#6264a7]/10 flex items-center justify-center mb-3">
                        <MessageSquare className="h-8 w-8 text-[#6264a7]" />
                      </div>
                      <p className="text-sm font-medium text-gray-600">No messages yet</p>
                      <p className="text-xs text-gray-400 mt-1">Start the conversation!</p>
                    </div>
                  ) : (
                    messagesByDate.map((group, gi) => (
                      <div key={gi}>
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 h-px bg-gray-300" />
                          <span className="text-[11px] font-medium text-gray-500 shrink-0">
                            {formatDateHeader(group.date)}
                          </span>
                          <div className="flex-1 h-px bg-gray-300" />
                        </div>
                        {group.msgs.map((msg, mi) => {
                          const isMe = msg.senderUserId === user?.id;
                          const showAvatar = mi === 0 || group.msgs[mi - 1].senderUserId !== msg.senderUserId;
                          const displayName = msg.userName || msg.senderName || "Unknown";
                          const FileIcon = getFileIcon(msg.fileType);

                          return (
                            <div
                              key={msg.id}
                              className={`flex gap-3 px-2 py-1 rounded-md hover:bg-white/80 transition-colors group ${showAvatar ? "mt-3" : "mt-0.5"}`}
                              data-testid={`message-${msg.id}`}
                            >
                              <div className="w-8 shrink-0">
                                {showAvatar && (
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${getAvatarColor(displayName)}`}>
                                    {getInitials(displayName)}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                {showAvatar && (
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-sm font-semibold text-gray-900">{isMe ? "You" : displayName}</span>
                                    <span className="text-[11px] text-gray-400">{formatMessageTime(msg.createdAt)}</span>
                                    {msg.isFromTeams && (
                                      <Badge className="text-[9px] h-4 px-1 bg-[#6264a7] text-white">Teams</Badge>
                                    )}
                                  </div>
                                )}
                                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
                                  {msg.content}
                                </p>
                                {msg.fileName && msg.filePath && (
                                  <div className="mt-1.5 inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-2.5 max-w-xs shadow-sm hover:shadow transition-shadow">
                                    <div className="w-9 h-9 rounded bg-[#6264a7]/10 flex items-center justify-center shrink-0">
                                      <FileIcon className="h-5 w-5 text-[#6264a7]" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-medium text-gray-800 truncate">{msg.fileName}</p>
                                      <p className="text-[10px] text-gray-400">{formatFileSize(msg.fileSize)}</p>
                                    </div>
                                    <a
                                      href={msg.filePath}
                                      download={msg.fileName}
                                      target="_blank"
                                      rel="noopener"
                                      className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-[#6264a7] transition-colors"
                                      onClick={e => e.stopPropagation()}
                                      data-testid={`download-file-${msg.id}`}
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </a>
                                  </div>
                                )}
                                {msg.fileType?.startsWith("image/") && msg.filePath && (
                                  <div className="mt-1.5">
                                    <img
                                      src={msg.filePath}
                                      alt={msg.fileName || "Image"}
                                      className="max-w-xs max-h-48 rounded-lg border border-gray-200 shadow-sm"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-3 bg-white border-t">
                  <div className="bg-[#f5f5f5] rounded-lg border border-gray-200 focus-within:border-[#6264a7] focus-within:ring-1 focus-within:ring-[#6264a7]/20 transition-all">
                    <input
                      className="w-full bg-transparent border-none px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
                      placeholder={`Type a message in ${selectedGroup.name}...`}
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey && messageText.trim()) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      disabled={sendMessageMutation.isPending}
                      data-testid="input-message"
                    />
                    <div className="flex items-center justify-between px-2 pb-1.5">
                      <div className="flex items-center gap-0.5">
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          onChange={handleFileSelect}
                          data-testid="input-file-upload"
                        />
                        <button
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                          onClick={() => fileInputRef.current?.click()}
                          title="Attach a file"
                          data-testid="button-attach-file"
                        >
                          <Paperclip className="h-4 w-4" />
                        </button>
                      </div>
                      <Button
                        size="sm"
                        className="h-7 px-3 bg-[#6264a7] hover:bg-[#4f5192] text-white"
                        onClick={handleSend}
                        disabled={!messageText.trim() || sendMessageMutation.isPending}
                        data-testid="button-send-message"
                      >
                        {sendMessageMutation.isPending || uploadFileMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {showMembersPanel && selectedGroup && (
                <div className="w-64 bg-white border-l overflow-y-auto shrink-0" data-testid="members-panel">
                  <div className="p-3 border-b">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Members ({selectedGroup.memberCount})</h4>
                      <button
                        className="p-1 rounded hover:bg-gray-100 text-gray-400"
                        onClick={() => setShowMembersPanel(false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-2 space-y-0.5" data-testid="members-list">
                    {selectedGroup.members.map(m => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-gray-50 group"
                        data-testid={`member-${m.userId}`}
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0 ${getAvatarColor(m.userName)}`}>
                          {getInitials(m.userName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-medium truncate">{m.userName}</span>
                            {m.role === "admin" && (
                              <span className="text-[9px] text-[#6264a7] font-semibold">Owner</span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 truncate">{m.userRole}</p>
                        </div>
                        {selectedGroup.canManage && m.userId !== user?.id && (
                          <button
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all"
                            onClick={() => removeMemberMutation.mutate({ groupId: selectedGroup.id, userId: m.userId })}
                            title="Remove member"
                            data-testid={`button-remove-member-${m.userId}`}
                          >
                            <UserMinus className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {selectedGroup.canManage && (
                    <div className="p-2 border-t">
                      <button
                        className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-[#6264a7] hover:bg-[#6264a7]/5 text-xs font-medium transition-colors"
                        onClick={() => setShowAddMemberDialog(true)}
                        data-testid="button-add-member-panel"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Add people
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={showCreateDialog} onOpenChange={v => { setShowCreateDialog(v); if (!v) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-create-group">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-[#6264a7] flex items-center justify-center">
                <Hash className="h-4 w-4 text-white" />
              </div>
              Create a channel
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Channel type</Label>
              <Select value={newGroupType} onValueChange={setNewGroupType}>
                <SelectTrigger data-testid="select-group-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="department">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-[#6264a7]" />
                      Department Channel
                    </div>
                  </SelectItem>
                  <SelectItem value="project">
                    <div className="flex items-center gap-2">
                      <FolderKanban className="h-3.5 w-3.5 text-[#4a7ea7]" />
                      Project Channel
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Channel name</Label>
              <Input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder={newGroupType === "department" ? "e.g. Engineering" : "e.g. Coega Steels"}
                data-testid="input-group-name"
              />
            </div>

            {newGroupType === "department" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Department</Label>
                <Select value={newGroupDept} onValueChange={setNewGroupDept}>
                  <SelectTrigger data-testid="select-department">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {newGroupType === "project" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Project</Label>
                <Select value={newGroupProject} onValueChange={setNewGroupProject}>
                  <SelectTrigger data-testid="select-project">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProjects.map(p => <SelectItem key={p.project_name} value={p.project_name}>{p.project_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Description (optional)</Label>
              <Textarea
                value={newGroupDesc}
                onChange={e => setNewGroupDesc(e.target.value)}
                rows={2}
                placeholder="What's this channel about?"
                className="resize-none"
                data-testid="input-group-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetCreateForm(); }}>Cancel</Button>
            <Button
              className="bg-[#6264a7] hover:bg-[#4f5192]"
              onClick={() => {
                createGroupMutation.mutate({
                  name: newGroupName,
                  groupType: newGroupType,
                  department: newGroupType === "department" ? newGroupDept : null,
                  projectName: newGroupType === "project" ? newGroupProject : null,
                  description: newGroupDesc || null,
                });
              }}
              disabled={!newGroupName.trim() || createGroupMutation.isPending}
              data-testid="button-confirm-create-group"
            >
              {createGroupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddMemberDialog} onOpenChange={v => { setShowAddMemberDialog(v); if (!v) setSelectedMembers([]); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-members">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-[#6264a7]" />
              Add people to {selectedGroup?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-h-[300px] overflow-y-auto space-y-0.5 border rounded-lg p-2">
              {allUsers
                .filter(u => selectedGroup && !selectedGroup.members.some(m => m.userId === u.id))
                .map(u => (
                  <label
                    key={u.id}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
                    data-testid={`checkbox-user-${u.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(u.id)}
                      onChange={e =>
                        setSelectedMembers(prev =>
                          e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id)
                        )
                      }
                      className="rounded border-gray-300 text-[#6264a7] focus:ring-[#6264a7]"
                    />
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold ${getAvatarColor(u.name)}`}>
                      {getInitials(u.name)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-[10px] text-gray-400">{u.role}</p>
                    </div>
                  </label>
                ))}
            </div>
            {selectedMembers.length > 0 && (
              <p className="text-xs text-gray-500">{selectedMembers.length} people selected</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddMemberDialog(false); setSelectedMembers([]); }}>Cancel</Button>
            <Button
              className="bg-[#6264a7] hover:bg-[#4f5192]"
              onClick={() => {
                if (selectedGroup) addMembersMutation.mutate({ groupId: selectedGroup.id, userIds: selectedMembers });
              }}
              disabled={selectedMembers.length === 0 || addMembersMutation.isPending}
              data-testid="button-confirm-add-members"
            >
              {addMembersMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Add ({selectedMembers.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      )}
    </div>
  );
}
