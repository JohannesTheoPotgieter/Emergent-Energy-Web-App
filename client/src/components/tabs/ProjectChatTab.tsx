import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Users,
  ExternalLink,
  MessageSquare,
  Search,
  LinkIcon,
  Unlink,
  AlertTriangle,
  RefreshCw,
  Clock,
  Hash,
} from "lucide-react";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

interface TeamsChat {
  id: number;
  msId?: string;
  title: string;
  webLink: string | null;
  memberCount: number | null;
  lastUpdated: string | null;
  chatType: string;
  preview: string | null;
}

interface ProjectChatData {
  found: boolean;
  autoMatched?: boolean;
  ssoRequired?: boolean;
  message?: string;
  chat?: TeamsChat;
  allChats?: TeamsChat[];
}

function formatRelativeDate(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function ProjectChatTab({ projectName, projectInfoId }: { projectName: string; projectInfoId: number | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [chatSearch, setChatSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const userRole = user?.role || "";
  const isAdmin = ["admin", "COO_ADMIN", "CEO_ADMIN"].includes(userRole);

  const { data: chatData, isLoading } = useQuery<ProjectChatData>({
    queryKey: ["ms-teams-project-chat", projectInfoId],
    queryFn: async () => {
      const res = await fetch(`/api/ms-teams/project-chat/${projectInfoId}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load Teams chat data");
      return res.json();
    },
    enabled: !!projectInfoId,
  });

  const linkMutation = useMutation({
    mutationFn: async (msObjectId: number) => {
      const res = await fetch(`/api/ms-objects/${msObjectId}/tag-project`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: projectInfoId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to link chat");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ms-teams-project-chat", projectInfoId] });
      toast({ title: "Teams chat linked", description: "This project is now linked to the selected Teams chat." });
      setShowPicker(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to link chat", description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ms-teams/project-chat/${projectInfoId}/unlink`, {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to unlink");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ms-teams-project-chat", projectInfoId] });
      toast({ title: "Chat unlinked", description: "You can now link a different Teams chat." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to unlink", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "teams" }),
      });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ms-teams-project-chat", projectInfoId] });
      toast({ title: "Teams data refreshed", description: "Your Teams chats have been synced." });
    },
  });

  const filteredChats = useMemo(() => {
    const chats = chatData?.allChats || [];
    if (!chatSearch.trim()) return chats;
    const q = chatSearch.toLowerCase();
    return chats.filter(c =>
      (c.title || "").toLowerCase().includes(q) ||
      (c.preview || "").toLowerCase().includes(q)
    );
  }, [chatData?.allChats, chatSearch]);

  if (!projectInfoId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="project-chat-tab">
        <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
        <p className="text-sm text-muted-foreground">Project information not available</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="project-chat-tab">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (chatData?.ssoRequired) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="project-chat-tab">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
          <MessageSquare className="h-8 w-8 text-indigo-500" />
        </div>
        <h3 className="text-base font-semibold mb-1">Microsoft 365 Sign-In Required</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          Sign in with your Microsoft account to link this project to your MS Teams group chat.
        </p>
        <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
          <AlertTriangle className="h-3 w-3 mr-1" />
          SSO not connected
        </Badge>
      </div>
    );
  }

  if (chatData?.found && chatData.chat) {
    const chat = chatData.chat;
    return (
      <div className="flex flex-col items-center py-8" data-testid="project-chat-tab">
        <Card className="w-full max-w-lg border-emerald-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                  <MessageSquare className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-base" data-testid="text-teams-chat-title">{chat.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    {chat.memberCount && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {chat.memberCount} members
                      </span>
                    )}
                    {chat.chatType && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        <Hash className="h-2.5 w-2.5 mr-0.5" />
                        {chat.chatType}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {chatData.autoMatched && (
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[9px]">
                  Auto-matched
                </Badge>
              )}
            </div>

            {chat.preview && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 mb-4">
                <span className="font-medium">Members:</span> {chat.preview}
              </div>
            )}

            {chat.lastUpdated && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
                <Clock className="h-3 w-3" />
                Last activity: {formatRelativeDate(chat.lastUpdated)}
              </div>
            )}

            <div className="flex items-center gap-2">
              {chat.webLink ? (
                <a
                  href={chat.webLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                  data-testid="link-open-teams"
                >
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2" data-testid="button-open-teams">
                    <ExternalLink className="h-4 w-4" />
                    Open in MS Teams
                  </Button>
                </a>
              ) : (
                <Button className="flex-1" disabled>
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  No Teams link available
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-red-600 gap-1"
                    onClick={() => unlinkMutation.mutate()}
                    disabled={unlinkMutation.isPending}
                    data-testid="button-unlink-chat"
                  >
                    {unlinkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                    Change Chat
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground gap-1"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-sync-teams"
              >
                <RefreshCw className={`h-3 w-3 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {chatData.autoMatched && (
          <p className="text-xs text-muted-foreground mt-3 text-center max-w-sm">
            This chat was auto-matched by project name. Click "Change Chat" to link a different one.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-8" data-testid="project-chat-tab">
      {!showPicker ? (
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-base font-semibold mb-1">No Teams Chat Linked</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            Link this project to an MS Teams group chat to open conversations directly from here.
          </p>
          <div className="flex items-center gap-2 justify-center">
            <Button
              onClick={() => setShowPicker(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
              data-testid="button-link-teams-chat"
            >
              <LinkIcon className="h-4 w-4" />
              Link a Teams Chat
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="gap-1"
              data-testid="button-sync-teams-empty"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sync Teams
            </Button>
          </div>
        </div>
      ) : (
        <Card className="w-full max-w-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-indigo-600" />
                Select a Teams Chat
              </h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowPicker(false)}
                data-testid="button-cancel-link"
              >
                Cancel
              </Button>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search your Teams chats..."
                className="h-8 pl-8 text-sm"
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                data-testid="input-search-teams-chats"
              />
            </div>

            <ScrollArea className="max-h-[350px]">
              <div className="space-y-1">
                {filteredChats.length === 0 ? (
                  <div className="text-center py-8">
                    <MessageSquare className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      {(chatData?.allChats || []).length === 0
                        ? "No Teams chats synced yet. Click \"Sync Teams\" to pull your chats."
                        : "No chats match your search."}
                    </p>
                    {(chatData?.allChats || []).length === 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 gap-1 text-xs"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                        data-testid="button-sync-teams-picker"
                      >
                        <RefreshCw className={`h-3 w-3 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                        Sync Teams Data
                      </Button>
                    )}
                  </div>
                ) : (
                  filteredChats.map((chat) => (
                    <div
                      key={chat.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50 hover:border-indigo-200 hover:bg-indigo-50/30 cursor-pointer transition-colors group"
                      onClick={() => linkMutation.mutate(chat.id)}
                      data-testid={`chat-option-${chat.id}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <MessageSquare className="h-4 w-4 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{chat.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {chat.memberCount && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Users className="h-2.5 w-2.5" />
                              {chat.memberCount}
                            </span>
                          )}
                          {chat.lastUpdated && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatRelativeDate(chat.lastUpdated)}
                            </span>
                          )}
                          <Badge variant="outline" className="text-[8px] px-1 py-0">
                            {chat.chatType}
                          </Badge>
                        </div>
                      </div>
                      <LinkIcon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {linkMutation.isPending && (
              <div className="flex items-center justify-center gap-2 mt-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Linking chat...
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
