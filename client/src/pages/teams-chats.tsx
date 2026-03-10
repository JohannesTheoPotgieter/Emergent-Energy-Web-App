import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare, Users, Hash, Search, RefreshCw, AlertTriangle,
  ChevronDown, ChevronRight, Send, Building2, MessagesSquare,
  User, Clock, Globe, Lock, Loader2, Paperclip,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

type SelectedItem = 
  | { type: "chat"; chatId: string; title: string }
  | { type: "channel"; teamId: string; channelId: string; teamName: string; channelName: string };

function stripHtml(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function MessageBubble({ msg, isCurrentUser }: { msg: any; isCurrentUser: boolean }) {
  const time = msg.createdDateTime
    ? new Date(msg.createdDateTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "";

  const bodyText = msg.bodyType === "html" ? stripHtml(msg.body) : msg.body;

  return (
    <div className={`flex gap-2.5 px-4 py-1.5 hover:bg-slate-50/80 transition-colors group ${isCurrentUser ? "" : ""}`} data-testid={`message-${msg.id}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0 mt-0.5 ${getAvatarColor(msg.from)}`}>
        {getInitials(msg.from)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">{msg.from}</span>
          <span className="text-[10px] text-slate-400">{time}</span>
        </div>
        <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{bodyText}</p>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {msg.attachments.map((a: any, i: number) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-600 border border-slate-200">
                <Paperclip className="h-3 w-3" />
                {a.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessagePanel({ selected, currentUserName }: { selected: SelectedItem | null; currentUserName: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [messageText, setMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const queryKey = selected
    ? selected.type === "chat"
      ? ["teams-chat-messages", selected.chatId]
      : ["teams-channel-messages", selected.teamId, selected.channelId]
    : ["teams-messages-none"];

  const apiUrl = selected
    ? selected.type === "chat"
      ? `/api/ms-teams/chats/${encodeURIComponent(selected.chatId)}/messages`
      : `/api/ms-teams/channels/${encodeURIComponent(selected.teamId)}/${encodeURIComponent(selected.channelId)}/messages`
    : null;

  const { data, isLoading, refetch } = useQuery<{ messages: any[]; ssoRequired?: boolean }>({
    queryKey,
    queryFn: async () => {
      if (!apiUrl) return { messages: [] };
      const res = await fetch(apiUrl, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!selected,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const messages = useMemo(() => {
    const msgs = data?.messages || [];
    return [...msgs].reverse();
  }, [data]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (selected && inputRef.current) {
      inputRef.current.focus();
    }
    setMessageText("");
  }, [selected]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!apiUrl) throw new Error("No conversation selected");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send");
      }
      return res.json();
    },
    onSuccess: () => {
      setMessageText("");
      qc.invalidateQueries({ queryKey });
      setTimeout(() => refetch(), 500);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const handleSend = () => {
    if (!messageText.trim() || sendMutation.isPending) return;
    sendMutation.mutate(messageText.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!selected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-b from-white to-slate-50/50 text-center px-8" data-testid="no-chat-selected">
        <div className="w-20 h-20 rounded-2xl bg-emerald-50 flex items-center justify-center mb-5">
          <MessagesSquare className="h-10 w-10 text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Teams Chat</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Select a team channel or chat from the sidebar to view and send messages.
        </p>
      </div>
    );
  }

  const title = selected.type === "chat"
    ? selected.title
    : `${selected.teamName} › ${selected.channelName}`;

  return (
    <div className="flex-1 flex flex-col bg-white min-w-0" data-testid="message-panel">
      <div className="px-5 py-3 border-b bg-gradient-to-r from-white to-slate-50/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold shrink-0 ${
            selected.type === "channel" ? getAvatarColor(selected.teamName) : "bg-emerald-600"
          }`}>
            {selected.type === "channel" ? <Hash className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-slate-900 truncate" data-testid="text-conversation-title">{title}</h3>
            <p className="text-[10px] text-slate-400">
              {selected.type === "channel" ? "Channel" : "Chat"} · {messages.length} messages loaded
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-slate-500" onClick={() => refetch()} data-testid="button-refresh-messages">
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : data?.ssoRequired ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
            <p className="text-sm font-medium text-slate-700">Microsoft 365 sign-in required</p>
            <p className="text-xs text-slate-500 mt-1">Sign in with your Microsoft account to view messages.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageSquare className="h-8 w-8 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">No messages yet</p>
          </div>
        ) : (
          <div className="py-3">
            {messages.map((msg: any) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isCurrentUser={msg.from === currentUserName}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t bg-white shrink-0">
        <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3 py-1.5 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
          <Input
            ref={inputRef}
            placeholder="Type a message..."
            value={messageText}
            onChange={e => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-9 text-sm px-0"
            disabled={sendMutation.isPending}
            data-testid="input-message"
          />
          <Button
            size="sm"
            className="h-8 w-8 p-0 bg-emerald-600 hover:bg-emerald-700 rounded-lg shrink-0"
            onClick={handleSend}
            disabled={!messageText.trim() || sendMutation.isPending}
            data-testid="button-send-message"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Send className="h-4 w-4 text-white" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ selected, onSelect }: { selected: SelectedItem | null; onSelect: (item: SelectedItem) => void }) {
  const [search, setSearch] = useState("");
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState({ teams: true, chats: true });
  const qc = useQueryClient();

  const { data: teamsData, isLoading: teamsLoading } = useQuery<any>({
    queryKey: ["ms-teams-joined"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/joined", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: chatsData, isLoading: chatsLoading } = useQuery<any>({
    queryKey: ["ms-teams-chats"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/chats", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load chats");
      return res.json();
    },
    staleTime: 60_000,
  });

  const teams = Array.isArray(teamsData) ? teamsData : (teamsData?.data || []);
  const chats = Array.isArray(chatsData) ? chatsData : (chatsData?.data || []);
  const ssoRequired = teamsData?.ssoRequired === true || chatsData?.ssoRequired === true;

  useEffect(() => {
    if (teams.length > 0 && Object.keys(expandedTeams).length === 0) {
      const initial: Record<string, boolean> = {};
      teams.forEach((t: any) => { initial[t.id] = true; });
      setExpandedTeams(initial);
    }
  }, [teams]);

  function getChatDisplayName(chat: any) {
    if (chat.topic) return chat.topic;
    const names = (chat.members || []).map((m: any) => m.displayName).filter(Boolean);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }

  const filteredTeams = teams.filter((t: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    if (t.displayName?.toLowerCase().includes(s)) return true;
    return (t.channels || []).some((ch: any) => ch.displayName?.toLowerCase().includes(s));
  });

  const filteredChats = chats.filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const memberNames = (c.members || []).map((m: any) => m.displayName || "").join(" ").toLowerCase();
    return memberNames.includes(s) || (c.topic || "").toLowerCase().includes(s);
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
      qc.invalidateQueries({ queryKey: ["ms-teams-joined"] });
      qc.invalidateQueries({ queryKey: ["ms-teams-chats"] });
    },
  });

  const isSelectedChat = (chatId: string) =>
    selected?.type === "chat" && selected.chatId === chatId;

  const isSelectedChannel = (teamId: string, channelId: string) =>
    selected?.type === "channel" && selected.teamId === teamId && selected.channelId === channelId;

  if (ssoRequired) {
    return (
      <div className="w-72 border-r bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
        <p className="text-sm font-medium text-slate-700">Microsoft 365 sign-in required</p>
        <p className="text-xs text-slate-500 mt-1">Sign in with Microsoft to see your Teams.</p>
      </div>
    );
  }

  return (
    <div className="w-72 border-r bg-slate-50/80 flex flex-col shrink-0" data-testid="teams-sidebar">
      <div className="px-3 pt-3 pb-2 border-b bg-white shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-800">Teams Chat</h2>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-sidebar">
            <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs bg-slate-50 border-slate-200"
            data-testid="input-sidebar-search"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          <button
            onClick={() => setExpandedSections(s => ({ ...s, teams: !s.teams }))}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-100 transition-colors"
            data-testid="toggle-teams-section"
          >
            {expandedSections.teams ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Teams and channels
          </button>

          {expandedSections.teams && (
            <div>
              {teamsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                </div>
              ) : filteredTeams.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-400">No teams found</p>
              ) : (
                filteredTeams.map((team: any) => {
                  const isExpanded = expandedTeams[team.id] !== false;
                  const channels = team.channels || [];
                  const matchingChannels = search
                    ? channels.filter((ch: any) => ch.displayName?.toLowerCase().includes(search.toLowerCase()))
                    : channels;

                  return (
                    <div key={team.id}>
                      <button
                        onClick={() => setExpandedTeams(prev => ({ ...prev, [team.id]: !isExpanded }))}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100 transition-colors text-left"
                        data-testid={`sidebar-team-${team.id}`}
                      >
                        <div className={`w-6 h-6 rounded flex items-center justify-center text-white text-[9px] font-bold shrink-0 ${getAvatarColor(team.displayName)}`}>
                          {getInitials(team.displayName)}
                        </div>
                        <span className="text-xs font-medium text-slate-700 truncate flex-1">{team.displayName}</span>
                        {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" /> : <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />}
                      </button>
                      {isExpanded && matchingChannels.map((ch: any) => {
                        const active = isSelectedChannel(team.id, ch.id);
                        return (
                          <button
                            key={ch.id}
                            onClick={() => onSelect({ type: "channel", teamId: team.id, channelId: ch.id, teamName: team.displayName, channelName: ch.displayName })}
                            className={`w-full flex items-center gap-2 pl-9 pr-3 py-1.5 text-left transition-colors ${
                              active ? "bg-emerald-50 text-emerald-700 border-l-2 border-emerald-500" : "hover:bg-slate-100 text-slate-600"
                            }`}
                            data-testid={`sidebar-channel-${ch.id}`}
                          >
                            <Hash className="h-3 w-3 shrink-0" />
                            <span className="text-xs truncate flex-1">{ch.displayName}</span>
                            {ch.membershipType === "private" && <Lock className="h-2.5 w-2.5 text-slate-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}

          <button
            onClick={() => setExpandedSections(s => ({ ...s, chats: !s.chats }))}
            className="w-full flex items-center gap-2 px-3 py-2 mt-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-100 transition-colors"
            data-testid="toggle-chats-section"
          >
            {expandedSections.chats ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Chats
          </button>

          {expandedSections.chats && (
            <div>
              {chatsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                </div>
              ) : filteredChats.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-400">No chats found</p>
              ) : (
                filteredChats.map((chat: any) => {
                  const displayName = getChatDisplayName(chat);
                  const active = isSelectedChat(chat.id);
                  const isGroup = chat.chatType === "group" || chat.chatType === "meeting";

                  return (
                    <button
                      key={chat.id}
                      onClick={() => onSelect({ type: "chat", chatId: chat.id, title: displayName })}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        active ? "bg-emerald-50 text-emerald-700 border-l-2 border-emerald-500" : "hover:bg-slate-100"
                      }`}
                      data-testid={`sidebar-chat-${chat.id}`}
                    >
                      <div className={`w-7 h-7 ${isGroup ? "rounded-lg" : "rounded-full"} flex items-center justify-center text-white text-[9px] font-semibold shrink-0 ${getAvatarColor(displayName)}`}>
                        {isGroup ? <Users className="h-3 w-3" /> : getInitials(displayName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${active ? "font-semibold" : "font-medium text-slate-700"}`}>{displayName}</p>
                        {chat.lastUpdatedDateTime && (
                          <p className="text-[9px] text-slate-400 truncate">
                            {formatDistanceToNow(new Date(chat.lastUpdatedDateTime), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function TeamsChatsPage() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const currentUserName = user?.name || user?.username || "";
  const isMyWorkRoute = location.startsWith("/my-work/");

  const { data: rolloutFlags } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });
  const contextualMsSurfacesEnabled = rolloutFlags?.find((flag) => flag.key === "contextual_ms_surfaces")?.value === true;

  return (
    <div className="flex h-[calc(100vh-56px)] bg-white overflow-hidden page-enter" data-testid="teams-chats-page">
      {contextualMsSurfacesEnabled && !isMyWorkRoute && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] text-blue-700">
          This route is retained for compatibility. Use <strong>My Work → Personal Teams Chat</strong> for personal chats.
        </div>
      )}
      <Sidebar selected={selected} onSelect={setSelected} />
      <MessagePanel selected={selected} currentUserName={currentUserName} />
    </div>
  );
}
