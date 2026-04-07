import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import {
  Mail, Loader2, Search, Inbox, AlertTriangle,
  CheckCheck, Link2, RefreshCw, ShieldAlert, Tag, ListTodo, MoreHorizontal,
} from "lucide-react";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function MsObjectActions({ item, onTagClick, onConvertClick }: {
  item: any;
  onTagClick: (item: any) => void;
  onConvertClick: (item: any) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`email-actions-${item.id}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onTagClick(item)} data-testid={`tag-project-${item.id}`}>
          <Tag className="h-4 w-4 mr-2" />
          {item.linkedProjectId ? "Change project tag" : "Tag to project"}
        </DropdownMenuItem>
        {!item.linkedTaskId && (
          <DropdownMenuItem onClick={() => onConvertClick(item)} data-testid={`convert-task-${item.id}`}>
            <ListTodo className="h-4 w-4 mr-2" />
            Convert to task
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagToProjectDialog({ open, onOpenChange, msObjectId, currentProjectId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  msObjectId: number | null;
  currentProjectId?: number | null;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (open && currentProjectId) setSelectedProjectId(String(currentProjectId));
    else if (!open) setSelectedProjectId("");
  }, [open, currentProjectId]);

  const tagMutation = useMutation({
    mutationFn: async () => {
      if (!msObjectId || !selectedProjectId) return;
      const res = await fetch(`/api/ms-objects/${msObjectId}/tag-project`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: parseInt(selectedProjectId) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Tag failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      toast({ title: "Email tagged to project" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to tag", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="tag-project-dialog">
        <DialogHeader>
          <DialogTitle>Tag to Project</DialogTitle>
        </DialogHeader>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger data-testid="select-project">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p: any) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.projectName || p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => tagMutation.mutate()} disabled={!selectedProjectId || tagMutation.isPending} data-testid="confirm-tag-button">
            {tagMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Tag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertToTaskDialog({ open, onOpenChange, item }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ms-objects/${item.id}/convert-to-task`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: item.linkedProjectId || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Conversion failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      toast({ title: "Email converted to task" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="convert-task-dialog">
        <DialogHeader>
          <DialogTitle>Convert to Task</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will create a work item from the email: <strong className="text-foreground">{item.subjectOrTitle || "(No Subject)"}</strong>
        </p>
        {item.linkedProjectId && (
          <p className="text-xs text-muted-foreground">The task will be linked to the currently tagged project.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending} data-testid="confirm-convert-button">
            {convertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useEmailSync(onSsoUnavailable: () => void) {
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
      if (data.error === "ms_sso_required") {
        onSsoUnavailable();
        return;
      }
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
  const [ssoUnavailable, setSsoUnavailable] = useState(false);
  const qc = useQueryClient();
  const syncMutation = useEmailSync(() => setSsoUnavailable(true));

  useEffect(() => {
    qc.removeQueries({ queryKey: ["ms-objects-mine", "email"] });
    setAutoSyncDone(false);
    setSsoUnavailable(false);
  }, []);

  const { data: items = [], isLoading, isFetched, isError, error, refetch } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "email"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?type=email", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch data (" + res.status + ")");
      return res.json();
    },
    staleTime: 10_000,
    gcTime: 60_000,
  });

  if (isError) return <PageShell className="max-w-5xl p-4 md:p-6"><PageError title="Unable to load Outlook Email" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

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
  const actionRequiredCount = filtered.filter((item: any) => item.actionRequired).length;

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="collab-email-page">
      <SectionHeader
        icon={<Mail className="h-5 w-5" />}
        eyebrow="Microsoft Work"
        title="Outlook Email"
        description={`Synced email stays inside the operating model so you can tag messages to projects or convert them into tasks${user?.displayName ? ` for ${user.displayName}` : ""}.`}
        badges={[
          { label: `${filtered.length} visible`, icon: <Mail className="h-3.5 w-3.5" /> },
          { label: `${actionRequiredCount} action required`, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
          { label: "Project-aware conversion", icon: <Link2 className="h-3.5 w-3.5" /> },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="sync-email-button"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
        }
      />
      <span className="sr-only" data-testid="text-email-title">Outlook Email</span>

      <WorkspaceNotice
        title="Microsoft-linked items behave like app work, not a separate inbox"
        description="Use the same project tagging, task conversion, and action-required cues that appear across My Work and collaboration surfaces."
        icon={<Link2 className="h-4 w-4" />}
        tone="microsoft"
      >
        <Badge variant="secondary">Project tag</Badge>
        <Badge variant="secondary">Convert to task</Badge>
        <Badge variant="secondary">Action-required visibility</Badge>
      </WorkspaceNotice>

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

      {ssoUnavailable && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800" data-testid="sso-unavailable-banner">
          <ShieldAlert className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="flex-1">
            <p className="text-sm font-medium">Microsoft 365 integration is not available</p>
            <p className="text-xs text-blue-600 mt-0.5">Please sign in with your Microsoft account to view and sync your Outlook emails. Contact your administrator if you need access.</p>
          </div>
        </div>
      )}

      {isLoading || syncMutation.isPending ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{syncMutation.isPending ? "Syncing emails from Microsoft 365..." : "Loading..."}</span>
        </div>
      ) : ssoUnavailable && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldAlert className="h-12 w-12 text-blue-600 mb-3" />
          <p className="text-sm font-medium text-foreground">Microsoft 365 integration not available</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">Your Microsoft account is not connected. Sign in with Microsoft SSO to sync your Outlook emails, calendar, and Teams data.</p>
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
    </PageShell>
  );
}
