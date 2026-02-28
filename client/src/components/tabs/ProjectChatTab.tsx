import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Send,
  Loader2,
  Users,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
  UserPlus,
  X,
  MessageSquare,
} from "lucide-react";

const AVATAR_COLORS = [
  "#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#6366F1",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function isImageFile(type: string | null) {
  return type?.startsWith("image/") ?? false;
}

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export function ProjectChatTab({ projectName }: { projectName: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["project-chat-group", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/teams/project-group/${encodeURIComponent(projectName)}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load project chat");
      return res.json();
    },
  });

  const groupId = group?.id;
  const userRole = user?.role || "";
  const isGroupAdmin = (group?.members || []).some((m: any) => m.userId === user?.id && m.role === "admin");
  const canManageMembers = isGroupAdmin || ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(userRole);

  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ["project-chat-messages", groupId],
    queryFn: async () => {
      const res = await fetch(`/api/teams/groups/${groupId}/messages`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!groupId,
    refetchInterval: 5000,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-users-for-chat"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: addMemberOpen,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/teams/groups/${groupId}/messages`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-chat-messages", groupId] });
      setMessage("");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/teams/groups/${groupId}/files`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-chat-messages", groupId] });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/teams/groups/${groupId}/members`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userIds: [userId] }),
      });
      if (!res.ok) throw new Error("Failed to add member");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-chat-group", projectName] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!message.trim() || !groupId) return;
    sendMutation.mutate(message.trim());
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  };

  if (groupLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const memberIds = new Set((group?.members || []).map((m: any) => m.userId));
  const availableUsers = allUsers.filter((u: any) => !memberIds.has(u.id));
  const filteredAvailable = memberSearch
    ? availableUsers.filter((u: any) => u.name?.toLowerCase().includes(memberSearch.toLowerCase()))
    : availableUsers;

  let lastDate = "";

  return (
    <div className="flex flex-col h-[500px] border rounded-lg overflow-hidden bg-white" data-testid="project-chat-tab">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#292929] text-white">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-blue-400" />
          <span className="font-medium text-sm">{group?.name || "Project Chat"}</span>
          <Badge variant="outline" className="text-[10px] border-gray-500 text-gray-300">
            {group?.memberCount || 0} members
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {canManageMembers && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-gray-300 hover:text-white hover:bg-gray-700"
            onClick={() => setAddMemberOpen(true)}
            data-testid="button-add-chat-member"
          >
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-gray-300 hover:text-white hover:bg-gray-700"
            onClick={() => setShowMembers(!showMembers)}
            data-testid="button-toggle-members"
          >
            <Users className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-gray-50/50">
            {msgsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No messages yet. Start the conversation!</p>
              </div>
            ) : (
              messages.map((msg: any) => {
                const msgDate = formatDate(msg.sentAt || msg.createdAt);
                const showDate = msgDate !== lastDate;
                lastDate = msgDate;
                const isMe = msg.senderUserId === user?.id;
                const senderName = msg.senderName || "Unknown";
                const avatarColor = getAvatarColor(senderName);

                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="flex items-center gap-2 my-3">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-[10px] text-muted-foreground font-medium px-2">{msgDate}</span>
                        <div className="flex-1 h-px bg-gray-200" />
                      </div>
                    )}
                    <div className={`flex gap-2 mb-2 ${isMe ? "flex-row-reverse" : ""}`} data-testid={`chat-message-${msg.id}`}>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                        style={{ backgroundColor: avatarColor }}
                      >
                        {senderName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className={`max-w-[70%] ${isMe ? "text-right" : ""}`}>
                        <p className="text-[10px] text-muted-foreground mb-0.5">
                          {senderName} · {formatTime(msg.sentAt || msg.createdAt)}
                        </p>
                        <div className={`rounded-lg px-3 py-2 text-sm ${isMe ? "bg-blue-600 text-white" : "bg-white border shadow-sm"}`}>
                          {msg.content}
                        </div>
                        {msg.fileName && (
                          <div className="mt-1">
                            {isImageFile(msg.fileType) ? (
                              <img
                                src={msg.filePath}
                                alt={msg.fileName}
                                className="max-w-[200px] rounded-lg border cursor-pointer"
                                onClick={() => window.open(msg.filePath, "_blank")}
                              />
                            ) : (
                              <a
                                href={msg.filePath}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline bg-blue-50 rounded px-2 py-1"
                              >
                                <FileText className="h-3 w-3" />
                                {msg.fileName}
                                <Download className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t p-2 flex items-center gap-2 bg-white">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-chat-file"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              data-testid="button-attach-file"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              data-testid="input-chat-message"
            />
            <Button
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleSend}
              disabled={!message.trim() || sendMutation.isPending}
              data-testid="button-send-message"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {showMembers && (
          <div className="w-48 border-l bg-gray-50 p-3 overflow-y-auto">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Members</p>
            {(group?.members || []).map((m: any) => (
              <div key={m.id} className="flex items-center gap-2 py-1.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                  style={{ backgroundColor: getAvatarColor(m.userName || "?") }}
                >
                  {(m.userName || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs truncate">{m.userName}</p>
                  {m.role === "admin" && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0">Admin</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <UserPlus className="h-4 w-4" />
              Add Member
            </DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search users..."
            className="h-8 text-xs"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            data-testid="input-search-add-member"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredAvailable.map((u: any) => (
              <div
                key={u.id}
                className="flex items-center justify-between p-2 hover:bg-muted/50 rounded cursor-pointer"
                onClick={() => addMemberMutation.mutate(u.id)}
                data-testid={`button-add-user-${u.id}`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold"
                    style={{ backgroundColor: getAvatarColor(u.name || "?") }}
                  >
                    {(u.name || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs">{u.name}</span>
                </div>
                <Badge variant="outline" className="text-[9px]">{u.role}</Badge>
              </div>
            ))}
            {filteredAvailable.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No users to add</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
