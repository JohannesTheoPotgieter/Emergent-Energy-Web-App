import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  MessageSquare, Loader2, AlertTriangle,
  Link2, Users, ChevronRight as ChevronRightIcon, RefreshCw,
} from "lucide-react";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import {
  authHeaders, TagToProjectDialog, ConvertToTaskDialog, MsObjectActions,
} from "./collaboration";

function useTeamsSync() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "teams" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Sync failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      if (data.error === "ms_sso_required") {
        toast({ title: "Microsoft sign-in required", description: data.message || "Please sign in with Microsoft to sync Teams.", variant: "destructive" });
        return;
      }
      const total = (data.results || []).reduce((s: number, r: any) => s + (r.synced || 0), 0);
      if (total > 0) toast({ title: `Synced ${total} Teams chats from Microsoft 365` });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });
}

export default function CollabTeamsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);
  const [autoSyncDone, setAutoSyncDone] = useState(false);
  const syncMutation = useTeamsSync();

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

  const { data: myGroups = [] } = useQuery<any[]>({
    queryKey: ["chat-groups-mine"],
    queryFn: async () => {
      const res = await fetch("/api/chat-groups/mine", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });
  const actionRequiredCount = items.filter((item: any) => item.actionRequired).length;

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="collab-teams-page">
      <SectionHeader
        icon={<MessageSquare className="h-5 w-5" />}
        eyebrow="Microsoft Work"
        title="Teams Chat"
        description={`Teams activity, mentions, and dashboard channels stay connected to the same project and task operating model${user?.displayName ? ` for ${user.displayName}` : ""}.`}
        badges={[
          { label: `${items.length} synced items`, icon: <MessageSquare className="h-3.5 w-3.5" /> },
          { label: `${actionRequiredCount} mentions`, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
          { label: `${myGroups.length} dashboard channels`, icon: <Users className="h-3.5 w-3.5" /> },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="sync-teams-button"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
        }
      />
      <span className="sr-only" data-testid="text-teams-title">Teams Chat</span>

      <WorkspaceNotice
        title="Microsoft conversations stay role-aware and project-aware"
        description="Teams mentions, linked chats, and dashboard channels follow the same assignment and conversion patterns used everywhere else in the app."
        icon={<Link2 className="h-4 w-4" />}
        tone="microsoft"
      >
        <Badge variant="secondary">Mention visibility</Badge>
        <Badge variant="secondary">Project tag</Badge>
        <Badge variant="secondary">Dashboard channel routing</Badge>
      </WorkspaceNotice>

      {isLoading || syncMutation.isPending ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{syncMutation.isPending ? "Syncing Teams from Microsoft 365..." : "Loading..."}</span>
        </div>
      ) : (
        <div className="space-y-6">
          {items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Synced Activity</h3>
              <div className="flex items-center justify-end mb-2">
                <Badge variant="outline" className="text-xs">{items.length} items</Badge>
              </div>
              <div className="divide-y rounded-lg border bg-card">
                {items.map((item: any) => (
                  <div
                    key={item.id}
                    className={`group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${item.actionRequired ? "bg-purple-50/50" : ""}`}
                    data-testid={`teams-item-${item.id}`}
                  >
                    <div className="flex-shrink-0 mt-1">
                      {item.actionRequired ? (
                        <AlertTriangle className="h-4 w-4 text-purple-500" />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{item.subjectOrTitle || "Teams Activity"}</span>
                        {item.actionRequired && (
                          <Badge className="bg-purple-100 text-purple-700 text-[10px]">Mention</Badge>
                        )}
                        {item.linkedProjectId && (
                          <Badge variant="secondary" className="text-[10px]">
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
            </div>
          )}

          {items.length === 0 && myGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No Teams activity found</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Sync Now" to pull your Teams chats from Microsoft 365</p>
              <Button
                variant="default"
                size="sm"
                className="mt-3"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="sync-teams-empty-button"
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Sync Teams
              </Button>
            </div>
          )}

          {myGroups.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dashboard Channels</h3>
              <div className="divide-y rounded-lg border bg-card">
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
            </div>
          )}
        </div>
      )}

      <TagToProjectDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        msObjectId={tagTarget?.id || null}
        currentProjectId={tagTarget?.linkedProjectId}
      />

      {convertTarget && (
        <ConvertToTaskDialog
          open={convertDialogOpen}
          onOpenChange={setConvertDialogOpen}
          item={convertTarget}
        />
      )}
    </PageShell>
  );
}
