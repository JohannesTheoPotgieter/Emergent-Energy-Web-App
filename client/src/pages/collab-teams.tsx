import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  MessageSquare, Loader2, AlertTriangle,
  Link2, Users, ChevronRight as ChevronRightIcon,
} from "lucide-react";
import {
  authHeaders, TagToProjectDialog, ConvertToTaskDialog, MsObjectActions,
} from "./collaboration";

export default function CollabTeamsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);

  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "teams"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?type=teams", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: myGroups = [] } = useQuery<any[]>({
    queryKey: ["chat-groups-mine"],
    queryFn: async () => {
      const res = await fetch("/api/chat-groups/mine", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="collab-teams-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-teams-title">
          <MessageSquare className="h-6 w-6 text-purple-600" />
          Teams Chat
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Teams mentions, activity, and dashboard channels
          {user?.displayName && <span> — {user.displayName}</span>}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
              <p className="text-xs text-muted-foreground mt-1">Mentions and activity sync automatically</p>
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
    </div>
  );
}
