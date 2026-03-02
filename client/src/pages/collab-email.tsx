import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import {
  Mail, Loader2, Search, Inbox, AlertTriangle,
  CheckCheck, Link2, RefreshCw,
} from "lucide-react";
import {
  authHeaders, TagToProjectDialog, ConvertToTaskDialog, MsObjectActions,
} from "./collaboration";

function useEmailSync() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "email" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Sync failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      const total = (data.results || []).reduce((s: number, r: any) => s + (r.synced || 0), 0);
      if (total > 0) toast({ title: `Synced ${total} emails from Microsoft 365` });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });
}

export default function CollabEmailPage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);
  const [autoSyncDone, setAutoSyncDone] = useState(false);
  const syncMutation = useEmailSync();

  const { data: items = [], isLoading, isFetched } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "email"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?type=email", { headers: authHeaders(), credentials: "include" });
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

  const filtered = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item: any) =>
      (item.subjectOrTitle || "").toLowerCase().includes(q) ||
      (item.preview || "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="collab-email-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-email-title">
            <Mail className="h-6 w-6 text-blue-600" />
            Outlook Email
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Synced emails — tag to projects or convert to tasks
            {user?.displayName && <span> — {user.displayName}</span>}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          data-testid="sync-email-button"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync Now"}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="email-search"
          />
        </div>
        <Badge variant="outline" className="text-xs" data-testid="email-count">
          {filtered.length} emails
        </Badge>
      </div>

      {isLoading || syncMutation.isPending ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{syncMutation.isPending ? "Syncing emails from Microsoft 365..." : "Loading..."}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No synced emails found</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Sync Now" to pull your latest emails from Microsoft 365</p>
          <Button
            variant="default"
            size="sm"
            className="mt-3"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="sync-email-empty-button"
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Sync Emails
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {filtered.map((item: any) => (
            <div
              key={item.id}
              className={`group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${item.actionRequired ? "bg-amber-50/50" : ""}`}
              data-testid={`email-item-${item.id}`}
            >
              <div className="flex-shrink-0 mt-1">
                {item.actionRequired ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : (
                  <Mail className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{item.subjectOrTitle || "(No Subject)"}</span>
                  {item.linkedProjectId && (
                    <Badge variant="secondary" className="text-[10px]">
                      <Link2 className="h-3 w-3 mr-0.5" /> Tagged
                    </Badge>
                  )}
                  {item.linkedTaskId && (
                    <Badge variant="outline" className="text-[10px] text-green-600">
                      <CheckCheck className="h-3 w-3 mr-0.5" /> Task
                    </Badge>
                  )}
                </div>
                {item.preview && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{item.preview}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {item.senderOrOrganizer && <span className="font-medium">{item.senderOrOrganizer} · </span>}
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
