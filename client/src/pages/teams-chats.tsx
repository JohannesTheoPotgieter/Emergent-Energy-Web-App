import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare,
  Users,
  Hash,
  Search,
  RefreshCw,
  AlertTriangle,
  Zap,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Building2,
  MessagesSquare,
  User,
  Clock,
  Shield,
  Globe,
  Lock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { MsObjectActions, TagToProjectDialog, ConvertToTaskDialog } from "./collaboration";

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

function SsoRequiredBanner() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800" data-testid="sso-required-banner">
      <AlertTriangle className="h-5 w-5 shrink-0 text-blue-600" />
      <div className="flex-1">
        <p className="text-sm font-medium">Microsoft 365 sign-in required</p>
        <p className="text-xs text-blue-600 mt-0.5">
          Sign in with your Microsoft account to view your Teams groups, channels, and chats.
        </p>
      </div>
    </div>
  );
}

function TeamsAndChannelsTab() {
  const [search, setSearch] = useState("");
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

  const { data: teamsData, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["ms-teams-joined"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/joined", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
    staleTime: 60_000,
  });

  const teams = Array.isArray(teamsData) ? teamsData : (teamsData?.data || []);
  const ssoRequired = teamsData?.ssoRequired === true;

  useEffect(() => {
    if (teams.length > 0 && Object.keys(expandedTeams).length === 0) {
      const initial: Record<string, boolean> = {};
      teams.forEach((t: any) => { initial[t.id] = true; });
      setExpandedTeams(initial);
    }
  }, [teams]);

  const filteredTeams = teams.filter((t: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    if (t.displayName?.toLowerCase().includes(s)) return true;
    return (t.channels || []).some((ch: any) => ch.displayName?.toLowerCase().includes(s));
  });

  const totalChannels = teams.reduce((sum: number, t: any) => sum + (t.channels?.length || 0), 0);

  if (isLoading) {
    return <EnergyLoader size="md" label="Loading your Teams..." className="py-16" />;
  }

  if (ssoRequired) {
    return (
      <div className="space-y-4 p-4">
        <SsoRequiredBanner />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="teams-channels-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs" data-testid="teams-count">
            {teams.length} Teams
          </Badge>
          <Badge variant="outline" className="text-xs" data-testid="channels-count">
            {totalChannels} Channels
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="refresh-teams-button">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search teams and channels..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="search-teams-input"
        />
      </div>

      {filteredTeams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <Building2 className="h-7 w-7 text-green-600" />
          </div>
          <p className="text-sm font-medium text-foreground">{search ? "No matching teams found" : "No Teams found"}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {search ? "Try a different search term" : "You're not a member of any Microsoft Teams. Join a team in Microsoft Teams to see it here."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTeams.map((team: any) => {
            const isExpanded = expandedTeams[team.id] !== false;
            const channels = team.channels || [];
            const matchingChannels = search
              ? channels.filter((ch: any) => ch.displayName?.toLowerCase().includes(search.toLowerCase()))
              : channels;

            return (
              <Card key={team.id} className="overflow-hidden energy-card" data-testid={`team-card-${team.id}`}>
                <button
                  onClick={() => setExpandedTeams(prev => ({ ...prev, [team.id]: !isExpanded }))}
                  className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                  data-testid={`team-toggle-${team.id}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold ${getAvatarColor(team.displayName)}`}>
                    {getInitials(team.displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{team.displayName}</p>
                    {team.description && <p className="text-xs text-muted-foreground truncate">{team.description}</p>}
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{channels.length} channels</Badge>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
                {isExpanded && matchingChannels.length > 0 && (
                  <div className="border-t bg-muted/20">
                    {matchingChannels.map((ch: any) => (
                      <div
                        key={ch.id}
                        className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/40 transition-colors group"
                        data-testid={`channel-item-${ch.id}`}
                      >
                        <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate flex-1">{ch.displayName}</span>
                        {ch.membershipType === "private" ? (
                          <Lock className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Globe className="h-3 w-3 text-muted-foreground" />
                        )}
                        {ch.description && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[200px] hidden sm:inline">{ch.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChatsTab() {
  const [search, setSearch] = useState("");

  const { data: chatsData, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["ms-teams-chats"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/chats", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load chats");
      return res.json();
    },
    staleTime: 60_000,
  });

  const chats = Array.isArray(chatsData) ? chatsData : (chatsData?.data || []);
  const ssoRequired = chatsData?.ssoRequired === true;

  const oneOnOneChats = chats.filter((c: any) => c.chatType === "oneOnOne");
  const groupChats = chats.filter((c: any) => c.chatType === "group" || c.chatType === "meeting");

  const filteredOneOnOne = oneOnOneChats.filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const memberNames = (c.members || []).map((m: any) => m.displayName || "").join(" ").toLowerCase();
    return memberNames.includes(s) || (c.topic || "").toLowerCase().includes(s);
  });

  const filteredGroup = groupChats.filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const memberNames = (c.members || []).map((m: any) => m.displayName || "").join(" ").toLowerCase();
    return memberNames.includes(s) || (c.topic || "").toLowerCase().includes(s);
  });

  function getChatDisplayName(chat: any) {
    if (chat.topic) return chat.topic;
    const names = (chat.members || []).map((m: any) => m.displayName).filter(Boolean);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }

  if (isLoading) {
    return <EnergyLoader size="md" label="Loading your chats..." className="py-16" />;
  }

  if (ssoRequired) {
    return (
      <div className="space-y-4 p-4">
        <SsoRequiredBanner />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="chats-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs" data-testid="chat-count">
            {chats.length} Conversations
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="refresh-chats-button">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search chats..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="search-chats-input"
        />
      </div>

      {chats.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <MessagesSquare className="h-7 w-7 text-green-600" />
          </div>
          <p className="text-sm font-medium text-foreground">No chats found</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">Start a conversation in Microsoft Teams to see your chats here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOneOnOne.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Direct Messages ({filteredOneOnOne.length})
              </h3>
              <div className="rounded-xl border bg-card shadow-sm divide-y">
                {filteredOneOnOne.map((chat: any) => {
                  const displayName = getChatDisplayName(chat);
                  return (
                    <div
                      key={chat.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                      data-testid={`chat-item-${chat.id}`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold ${getAvatarColor(displayName)}`}>
                        {getInitials(displayName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                        {chat.lastUpdatedDateTime && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDistanceToNow(new Date(chat.lastUpdatedDateTime), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">1:1</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filteredGroup.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Group Chats ({filteredGroup.length})
              </h3>
              <div className="rounded-xl border bg-card shadow-sm divide-y">
                {filteredGroup.map((chat: any) => {
                  const displayName = getChatDisplayName(chat);
                  const memberCount = (chat.members || []).length;
                  return (
                    <div
                      key={chat.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                      data-testid={`group-chat-item-${chat.id}`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-semibold ${getAvatarColor(displayName)}`}>
                        {getInitials(displayName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5"><Users className="h-2.5 w-2.5" /> {memberCount} members</span>
                          {chat.lastUpdatedDateTime && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {formatDistanceToNow(new Date(chat.lastUpdatedDateTime), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {chat.chatType === "meeting" ? "Meeting" : "Group"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityTab() {
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);
  const [autoSyncDone, setAutoSyncDone] = useState(false);
  const [ssoUnavailable, setSsoUnavailable] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    qc.removeQueries({ queryKey: ["ms-objects-mine", "teams"] });
    setAutoSyncDone(false);
    setSsoUnavailable(false);
  }, []);

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
      if (data.error === "ms_sso_required") {
        setSsoUnavailable(true);
        return;
      }
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
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (isFetched && items.length === 0 && !autoSyncDone && !syncMutation.isPending) {
      setAutoSyncDone(true);
      syncMutation.mutate();
    }
  }, [isFetched, items.length, autoSyncDone]);

  return (
    <div className="space-y-4" data-testid="activity-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Mentions, chats, and activity synced from Microsoft Teams</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="sync-teams-button">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
          <Badge variant="outline" className="text-xs" data-testid="synced-count">{items.length} items</Badge>
        </div>
      </div>

      {ssoUnavailable && <SsoRequiredBanner />}

      {isLoading || syncMutation.isPending ? (
        <EnergyLoader size="md" label={syncMutation.isPending ? "Syncing from Microsoft 365..." : "Loading..."} className="py-16" />
      ) : ssoUnavailable && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-blue-600" />
          </div>
          <p className="text-sm font-medium text-foreground">Microsoft 365 sign-in required</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">Sign in with Microsoft SSO to sync your Teams activity.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <Zap className="h-7 w-7 text-green-600" />
          </div>
          <p className="text-muted-foreground text-sm font-medium">No Teams activity synced</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Sync Now" to pull your Teams chats from Microsoft 365</p>
          <Button variant="default" size="sm" className="mt-4" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="sync-empty-button">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Sync Teams
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card shadow-sm">
          {items.map((item: any) => (
            <div
              key={item.id}
              className={`group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/50 transition-colors ${item.actionRequired ? "bg-green-50/40" : ""}`}
              data-testid={`synced-item-${item.id}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {item.actionRequired ? (
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <AlertTriangle className="h-4 w-4 text-green-600" />
                  </div>
                ) : (
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-semibold ${getAvatarColor(item.senderOrOrganizer || "")}`}>
                    {getInitials(item.senderOrOrganizer || "Teams")}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.subjectOrTitle || "Untitled"}</p>
                    {item.preview && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.preview}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {item.senderOrOrganizer && <span className="text-[10px] text-muted-foreground">{item.senderOrOrganizer}</span>}
                      {item.receivedOrStartDatetime && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(item.receivedOrStartDatetime), { addSuffix: true })}
                        </span>
                      )}
                      {item.linkedProjectName && <Badge variant="secondary" className="text-[9px] h-4">{item.linkedProjectName}</Badge>}
                    </div>
                  </div>
                  <MsObjectActions
                    item={item}
                    onTagClick={() => { setTagTarget(item); setTagDialogOpen(true); }}
                    onConvertClick={() => { setConvertTarget(item); setConvertDialogOpen(true); }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TagToProjectDialog open={tagDialogOpen} onOpenChange={setTagDialogOpen} msObjectId={tagTarget?.id || null} currentProjectId={tagTarget?.linkedProjectId || null} />
      <ConvertToTaskDialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen} item={convertTarget} />
    </div>
  );
}

export default function TeamsChatsPage() {
  return (
    <div className="space-y-4 p-4 md:p-6 page-enter" data-testid="teams-chats-page">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
          <MessagesSquare className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Teams Chat</h1>
          <p className="text-sm text-muted-foreground">Your Microsoft Teams groups, channels, and conversations</p>
        </div>
      </div>

      <Tabs defaultValue="teams" className="w-full">
        <TabsList data-testid="teams-tabs">
          <TabsTrigger value="teams" data-testid="tab-teams">
            <Building2 className="h-4 w-4 mr-1.5" />
            Teams & Channels
          </TabsTrigger>
          <TabsTrigger value="chats" data-testid="tab-chats">
            <MessageSquare className="h-4 w-4 mr-1.5" />
            Chats
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            <Zap className="h-4 w-4 mr-1.5" />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="teams" className="mt-4">
          <TeamsAndChannelsTab />
        </TabsContent>
        <TabsContent value="chats" className="mt-4">
          <ChatsTab />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
