import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
const CreateTaskFromSourceDialog = lazy(() => import("@/components/CreateTaskFromSourceDialog"));
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
  FileCheck, Plus, Users, Tag, Link2, Unlink,
} from "lucide-react";

function useUnifiedWorkFlag() {
  const { data: flag } = useQuery<boolean>({
    queryKey: ["feature-flag-unified-work"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/settings?key=unified_work_v1", { credentials: "include" });
        if (!res.ok) return false;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data[0].value === true || data[0].value === "true" || data[0].value === "1";
        if (data && typeof data === "object" && "value" in data) return data.value === true || data.value === "true" || data.value === "1";
        return false;
      } catch { return false; }
    },
    staleTime: 60_000,
  });
  return flag === true;
}

export function useProjectsList() {
  return useQuery<{ id: number; name: string }[]>({
    queryKey: ["projects-list-for-tagging"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { credentials: "include", headers: authHeaders() });
      if (!res.ok) return [];
      const rows = await res.json();
      return rows
        .map((p: any) => ({ id: p.id, name: (p.projectName || p.project_name || "").replace(/_Tracker.*$/i, "").replace(/_/g, " ") }))
        .filter((p: any) => p.name)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
    },
    staleTime: 120_000,
  });
}

export function TagToProjectDialog({
  open,
  onOpenChange,
  msObjectId,
  currentProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  msObjectId: number | null;
  currentProjectId?: number | null;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: projects = [] } = useProjectsList();

  const tagMutation = useMutation({
    mutationFn: async () => {
      if (!msObjectId || !selectedProjectId) return;
      const res = await fetch(`/api/ms-objects/${msObjectId}/tag-project`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: selectedProjectId, note: note || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to tag");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Tagged to project" });
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      onOpenChange(false);
      setSelectedProjectId(null);
      setNote("");
    },
    onError: (err: any) => {
      toast({ title: "Tag failed", description: err.message, variant: "destructive" });
    },
  });

  const untagMutation = useMutation({
    mutationFn: async () => {
      if (!msObjectId) return;
      const res = await fetch(`/api/ms-objects/${msObjectId}/tag-project`, {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to untag");
    },
    onSuccess: () => {
      toast({ title: "Untagged from project" });
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Untag failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-tag-project">
        <DialogHeader>
          <DialogTitle>{currentProjectId ? "Change Project Tag" : "Tag to Project"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Project</label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value ? parseInt(e.target.value) : null)}
              data-testid="select-tag-project"
            >
              <option value="">Select a project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Note (optional)</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this relevant?"
              data-testid="input-tag-note"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {currentProjectId && (
            <Button variant="outline" size="sm" onClick={() => untagMutation.mutate()} disabled={untagMutation.isPending} data-testid="button-untag">
              <Unlink className="h-4 w-4 mr-1" /> Untag
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => tagMutation.mutate()}
            disabled={!selectedProjectId || tagMutation.isPending}
            data-testid="button-tag-confirm"
          >
            <Tag className="h-4 w-4 mr-1" /> {tagMutation.isPending ? "Tagging..." : "Tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvertToTaskDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (open: boolean) => void; item: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(item?.linkedProjectId || null);

  useEffect(() => {
    if (open) {
      setSelectedProjectId(item?.linkedProjectId || null);
    }
  }, [open, item?.id]);

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["projects-list-for-convert"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      const rows = await res.json();
      return rows
        .map((p: any) => ({ id: p.id, name: (p.projectName || p.project_name || "").replace(/_Tracker.*$/i, "").replace(/_/g, " "), phase: p.executionPhase || p.phase || null }))
        .filter((p: any) => p.name)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
    },
    staleTime: 120_000,
    enabled: open,
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ms-objects/${item.id}/convert-to-task`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: selectedProjectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to convert");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.type === "operational" ? "Project task created" : "Personal task created" });
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Convert failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="convert-to-task-dialog">
        <DialogHeader>
          <DialogTitle>Convert Email to Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email Subject</label>
            <p className="text-sm font-medium mt-1">{item?.subjectOrTitle || "(No Subject)"}</p>
            {item?.preview && <p className="text-xs text-muted-foreground mt-1 truncate">{item.preview}</p>}
          </div>
          <Separator />
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Link to Project (optional)</label>
            <p className="text-xs text-muted-foreground mb-2">Choose a project to create a project task, or leave empty for a personal task.</p>
            <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
              <button
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${selectedProjectId === null ? "bg-primary/10 font-medium" : ""}`}
                onClick={() => setSelectedProjectId(null)}
                data-testid="convert-no-project"
              >
                No project (personal task)
              </button>
              {projects.map((p: any) => (
                <button
                  key={p.id}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${selectedProjectId === p.id ? "bg-primary/10 font-medium" : ""}`}
                  onClick={() => setSelectedProjectId(p.id)}
                  data-testid={`convert-project-${p.id}`}
                >
                  {p.name}
                  {p.phase && <span className="text-xs text-muted-foreground ml-2">({p.phase})</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="convert-cancel">Cancel</Button>
          <Button
            onClick={() => convertMutation.mutate()}
            disabled={convertMutation.isPending}
            data-testid="convert-confirm"
          >
            {convertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ClipboardCheck className="h-4 w-4 mr-1" />}
            {selectedProjectId ? "Create Project Task" : "Create Personal Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useMsSync() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const syncMutation = useMutation({
    mutationFn: async (type?: string) => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Sync failed" }));
        throw new Error(err.error || "Sync failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ms-objects-mine"] });
      qc.invalidateQueries({ queryKey: ["ms-sync-status"] });
      const total = (data.results || []).reduce((s: number, r: any) => s + (r.synced || 0), 0);
      const errors = (data.results || []).flatMap((r: any) => r.errors || []);
      if (errors.length > 0) {
        toast({ title: `Synced ${total} items`, description: errors[0], variant: "destructive" });
      } else if (total > 0) {
        toast({ title: `Synced ${total} items from Microsoft 365` });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  return syncMutation;
}

export function MsObjectActions({ item, onTagClick, onConvertClick }: { item: any; onTagClick: (item: any) => void; onConvertClick?: (item: any) => void }) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {item.webLink && (
        <a href={item.webLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Open in Microsoft 365" data-testid={`ms-open-${item.id}`}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={item.linkedProjectId ? "Change project tag" : "Tag to project"}
        onClick={(e) => { e.stopPropagation(); onTagClick(item); }}
        data-testid={`ms-tag-${item.id}`}
      >
        <Tag className={`h-3.5 w-3.5 ${item.linkedProjectId ? "text-blue-500" : ""}`} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Convert to task"
        onClick={(e) => { e.stopPropagation(); if (onConvertClick) onConvertClick(item); }}
        disabled={!!item.linkedTaskId}
        data-testid={`ms-convert-${item.id}`}
      >
        <ClipboardCheck className={`h-3.5 w-3.5 ${item.linkedTaskId ? "text-green-500" : ""}`} />
      </Button>
    </div>
  );
}

function SyncedEmailTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);
  const [autoSyncDone, setAutoSyncDone] = useState(false);
  const syncMutation = useMsSync();

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
      syncMutation.mutate("email");
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
    <div className="space-y-4" data-testid="synced-email-tab">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search synced emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="synced-email-search"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate("email")}
          disabled={syncMutation.isPending}
          data-testid="sync-email-button"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync Now"}
        </Button>
        <Badge variant="outline" className="text-xs" data-testid="synced-email-count">
          {filtered.length} emails
        </Badge>
      </div>

      {isLoading || syncMutation.isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{syncMutation.isPending ? "Syncing emails from Microsoft 365..." : "Loading..."}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No synced emails found</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Sync Now" to pull your latest emails from Microsoft 365</p>
          <Button
            variant="default"
            size="sm"
            className="mt-3"
            onClick={() => syncMutation.mutate("email")}
            disabled={syncMutation.isPending}
            data-testid="sync-email-empty-button"
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Sync Emails
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((item: any) => (
            <div
              key={item.id}
              className={`group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${item.actionRequired ? "bg-amber-50/50" : ""}`}
              data-testid={`synced-email-item-${item.id}`}
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
                    <Badge variant="secondary" className="text-[10px]" data-testid={`email-project-badge-${item.id}`}>
                      <Link2 className="h-3 w-3 mr-0.5" /> Tagged
                    </Badge>
                  )}
                  {item.linkedTaskId && (
                    <Badge variant="outline" className="text-[10px] text-green-600" data-testid={`email-task-badge-${item.id}`}>
                      <CheckCheck className="h-3 w-3 mr-0.5" /> Task
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

function SyncedTeamsTab() {
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);
  const [autoSyncDone, setAutoSyncDone] = useState(false);
  const syncMutation = useMsSync();

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
      syncMutation.mutate("teams");
    }
  }, [isFetched, items.length, autoSyncDone]);

  return (
    <div className="space-y-4" data-testid="synced-teams-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Teams chats and activity synced from Microsoft</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate("teams")}
            disabled={syncMutation.isPending}
            data-testid="sync-teams-button"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
          <Badge variant="outline" className="text-xs" data-testid="synced-teams-count">
            {items.length} items
          </Badge>
        </div>
      </div>

      {isLoading || syncMutation.isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{syncMutation.isPending ? "Syncing Teams from Microsoft 365..." : "Loading..."}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No Teams activity synced</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Sync Now" to pull your Teams chats from Microsoft 365</p>
          <Button
            variant="default"
            size="sm"
            className="mt-3"
            onClick={() => syncMutation.mutate("teams")}
            disabled={syncMutation.isPending}
            data-testid="sync-teams-empty-button"
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Sync Teams
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.map((item: any) => (
            <div
              key={item.id}
              className={`group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${item.actionRequired ? "bg-purple-50/50" : ""}`}
              data-testid={`synced-teams-item-${item.id}`}
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

function SyncedNotificationsTab() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<"all" | "unread" | "action_required">("all");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const { data: msActionItems = [], isLoading: loadingMs } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "action-required"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?action_required=true", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: notificationsData, isLoading: loadingNotifs } = useQuery<any>({
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
  const isLoading = loadingMs || loadingNotifs;

  return (
    <div className="space-y-4" data-testid="synced-notifications-tab">
      {msActionItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Action Required from Microsoft ({msActionItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border bg-background">
              {msActionItems.slice(0, 5).map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-3 py-2"
                  data-testid={`ms-action-item-${item.id}`}
                >
                  <div className="flex-shrink-0">
                    {item.type === "email" ? <Mail className="h-4 w-4 text-amber-600" /> :
                     item.type === "teams" ? <MessageSquare className="h-4 w-4 text-purple-600" /> :
                     <Bell className="h-4 w-4 text-blue-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.subjectOrTitle || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.type} · {item.receivedOrStartDatetime ? format(parseISO(item.receivedOrStartDatetime), "MMM d") : ""}
                    </p>
                  </div>
                  {item.webLink && (
                    <a href={item.webLink} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="text-xs h-7" data-testid={`ms-action-open-${item.id}`}>
                        Open <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </a>
                  )}
                </div>
              ))}
              {msActionItems.length > 5 && (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{msActionItems.length - 5} more items requiring action
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={filterStatus === "all" ? "default" : "outline"} size="sm"
            onClick={() => { setFilterStatus("all"); setPage(0); }}
            data-testid="synced-notif-filter-all"
          >All</Button>
          <Button
            variant={filterStatus === "unread" ? "default" : "outline"} size="sm"
            onClick={() => { setFilterStatus("unread"); setPage(0); }}
            data-testid="synced-notif-filter-unread"
          >Unread</Button>
          <Button
            variant={filterStatus === "action_required" ? "default" : "outline"} size="sm"
            onClick={() => { setFilterStatus("action_required"); setPage(0); }}
            data-testid="synced-notif-filter-action"
          >Action Required</Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => markAllReadMutation.mutate()} data-testid="synced-notif-mark-all-read">
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
                  data-testid={`synced-notif-item-${n.id}`}
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
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => markReadMutation.mutate([n.id])} data-testid={`synced-notif-read-${n.id}`}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {n.eventType === "plan.change_confirmation" && !n.confirmedAt && (
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => confirmMutation.mutate(n.id)} data-testid={`synced-notif-confirm-${n.id}`}>
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
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="synced-notif-prev">
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)} data-testid="synced-notif-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SyncedSharePointTab() {
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);

  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "sharepoint_file"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?type=sharepoint_file", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4" data-testid="synced-sharepoint-extra">
      {items.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Synced SharePoint Files ({items.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border">
              {items.map((item: any) => (
                <div
                  key={item.id}
                  className="group flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                  data-testid={`synced-sp-item-${item.id}`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.subjectOrTitle || "File"}</p>
                    {item.linkedProjectId && (
                      <Badge variant="secondary" className="text-[10px] mt-0.5">
                        <Link2 className="h-3 w-3 mr-0.5" /> Tagged
                      </Badge>
                    )}
                  </div>
                  <MsObjectActions
                    item={item}
                    onTagClick={(i) => { setTagTarget(i); setTagDialogOpen(true); }}
                    onConvertClick={(i) => { setConvertTarget(i); setConvertDialogOpen(true); }}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <SharePointTab />

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

export function authHeaders() {
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
        const startVal = typeof ev.start === "string" ? ev.start : ev.start?.dateTime;
        const evDate = startVal ? format(parseISO(startVal), "yyyy-MM-dd") : null;
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
                        {(typeof ev.start === "string" ? ev.start : ev.start?.dateTime) && (
                          <div className="text-blue-700 text-[10px]">
                            {format(parseISO(typeof ev.start === "string" ? ev.start : ev.start?.dateTime), "h:mm a")}
                            {(typeof ev.end === "string" ? ev.end : ev.end?.dateTime) && ` – ${format(parseISO(typeof ev.end === "string" ? ev.end : ev.end?.dateTime), "h:mm a")}`}
                          </div>
                        )}
                        {(ev.location || ev.locationName) && (
                          <div className="text-blue-600 text-[10px] truncate">{typeof ev.location === "string" ? ev.location : ev.location?.displayName || ev.locationName}</div>
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
  const [taskSource, setTaskSource] = useState<any>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

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
    const senderName = selectedMessage.sender || selectedMessage.from?.emailAddress?.name || selectedMessage.from?.emailAddress?.address || "Unknown";
    const senderEmail = selectedMessage.senderEmail || selectedMessage.from?.emailAddress?.address || "";
    const receivedDate = selectedMessage.receivedAt || selectedMessage.receivedDateTime;
    const toList = selectedMessage.to || selectedMessage.toRecipients || [];
    const bodyContent = selectedMessage.body || selectedMessage.bodyContent;
    const bodyType = selectedMessage.bodyType || selectedMessage.body?.contentType || "text";
    return (
      <div className="space-y-4" data-testid="email-detail">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setSelectedMessageId(null)} data-testid="email-back">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Inbox
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTaskSource({
                sourceType: "email",
                outlookMessageId: selectedMessage.id,
                subject: selectedMessage.subject || "(No Subject)",
                sender: senderName,
                receivedAt: receivedDate,
                snippet: selectedMessage.snippet || selectedMessage.bodyPreview || "",
                webLink: selectedMessage.webLink,
              });
              setTaskDialogOpen(true);
            }}
            data-testid="email-create-task"
          >
            <ClipboardCheck className="h-4 w-4 mr-1" /> Create Task
          </Button>
        </div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{selectedMessage.subject || "(No Subject)"}</CardTitle>
            <div className="text-sm text-muted-foreground space-y-1 mt-2">
              <div><span className="font-medium">From:</span> {senderName} {senderEmail && senderEmail !== senderName && <span className="text-xs">({senderEmail})</span>}</div>
              <div><span className="font-medium">To:</span> {toList.map((r: any) => r.name || r.emailAddress?.name || r.email || r.emailAddress?.address).join(", ")}</div>
              {receivedDate && (
                <div><span className="font-medium">Date:</span> {format(parseISO(receivedDate), "PPpp")}</div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {(bodyType === "html" || bodyType === "HTML") ? (
              <div
                className="prose prose-sm max-w-none email-body"
                dangerouslySetInnerHTML={{ __html: typeof bodyContent === "string" ? bodyContent : bodyContent?.content || "" }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm">{typeof bodyContent === "string" ? bodyContent : bodyContent?.content || ""}</pre>
            )}
          </CardContent>
        </Card>
        <Suspense fallback={null}>
          <CreateTaskFromSourceDialog
            open={taskDialogOpen}
            onOpenChange={setTaskDialogOpen}
            source={taskSource}
          />
        </Suspense>
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
                className={`group flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${msg.isRead === false ? "bg-blue-50/50 font-medium" : ""}`}
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
                      {typeof msg.sender === "string" ? msg.sender : (msg.sender?.emailAddress?.name || msg.sender?.emailAddress?.address || msg.senderEmail || "Unknown")}
                    </span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {(msg.receivedAt || msg.receivedDateTime) ? format(parseISO(msg.receivedAt || msg.receivedDateTime), "MMM d, h:mm a") : ""}
                    </span>
                  </div>
                  <div className="text-sm truncate">{msg.subject || "(No Subject)"}</div>
                  {(msg.snippet || msg.bodyPreview) && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.snippet || msg.bodyPreview}</p>
                  )}
                </div>
                {msg.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-2" />}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0 opacity-0 group-hover:opacity-100"
                  title="Create task from this email"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTaskSource({
                      sourceType: "email" as const,
                      outlookMessageId: msg.id,
                      subject: msg.subject || "(No Subject)",
                      sender: typeof msg.sender === "string" ? msg.sender : msg.senderEmail || "Unknown",
                      receivedAt: msg.receivedAt || msg.receivedDateTime,
                      snippet: msg.snippet || msg.bodyPreview || "",
                      webLink: msg.webLink,
                    });
                    setTaskDialogOpen(true);
                  }}
                  data-testid={`email-task-${msg.id}`}
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                </Button>
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
      <Suspense fallback={null}>
        <CreateTaskFromSourceDialog
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
          source={taskSource}
        />
      </Suspense>
    </div>
  );
}

function SharePointTab() {
  const [driveId, setDriveId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([]);
  const [setupMode, setSetupMode] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: config, isLoading: loadingConfig, refetch: refetchConfig } = useQuery<any>({
    queryKey: ["sp-config"],
    queryFn: async () => {
      const res = await fetch("/api/sp-config", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 120_000,
  });

  const { data: sites, isLoading: loadingSites } = useQuery<any[]>({
    queryKey: ["sp-discover-sites"],
    queryFn: async () => {
      const res = await fetch("/api/sharepoint/discover-sites", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: setupMode || !config?.driveId,
    staleTime: 300_000,
  });

  const { data: siteDrives } = useQuery<any[]>({
    queryKey: ["sp-site-drives", selectedSiteId],
    queryFn: async () => {
      const res = await fetch(`/api/sharepoint/site-drives/${encodeURIComponent(selectedSiteId!)}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedSiteId,
    staleTime: 300_000,
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

  async function saveSPConfig(siteId: string, driveIdToSave: string) {
    try {
      const res = await fetch("/api/admin/sp-settings", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ siteId, driveId: driveIdToSave, enabled: true }),
      });
      if (res.ok) {
        toast({ title: "SharePoint configured successfully" });
        setSetupMode(false);
        refetchConfig();
      } else {
        toast({ title: "Failed to save settings", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    }
  }

  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config?.driveId || setupMode) {
    return (
      <div className="space-y-4" data-testid="sharepoint-setup">
        <div className="flex flex-col items-center text-center py-6">
          <FolderOpen className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">{setupMode ? "Change SharePoint Site" : "Connect SharePoint"}</h3>
          <p className="text-muted-foreground text-sm max-w-md mb-4">
            Select a SharePoint site and document library to browse files directly from the dashboard.
          </p>
        </div>

        {loadingSites ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Discovering SharePoint sites...</span>
          </div>
        ) : !sites || sites.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground text-sm">No SharePoint sites found.</p>
            <p className="text-xs text-muted-foreground mt-1">Sites.Read.All permission may be needed in Azure.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Available Sites</h4>
            <div className="divide-y rounded-lg border">
              {sites.map((site: any) => (
                <div key={site.id}>
                  <div
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${selectedSiteId === site.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
                    onClick={() => setSelectedSiteId(selectedSiteId === site.id ? null : site.id)}
                    data-testid={`sp-site-${site.id}`}
                  >
                    <HardDrive className="h-5 w-5 text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{site.displayName}</div>
                      <div className="text-xs text-muted-foreground truncate">{site.webUrl}</div>
                    </div>
                    <ChevronRightIcon className={`h-4 w-4 text-muted-foreground transition-transform ${selectedSiteId === site.id ? "rotate-90" : ""}`} />
                  </div>
                  {selectedSiteId === site.id && siteDrives && (
                    <div className="bg-muted/20 pl-12 pr-4 pb-2 space-y-1">
                      {siteDrives.map((drive: any) => (
                        <div
                          key={drive.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-background cursor-pointer transition-colors"
                          onClick={() => saveSPConfig(site.id, drive.id)}
                          data-testid={`sp-drive-${drive.id}`}
                        >
                          <Folder className="h-4 w-4 text-amber-500" />
                          <span className="text-sm">{drive.name}</span>
                          <Badge variant="secondary" className="text-[10px] ml-auto">{drive.driveType}</Badge>
                          <span className="text-xs text-blue-600 font-medium">Select</span>
                        </div>
                      ))}
                      {siteDrives.length === 0 && (
                        <p className="text-xs text-muted-foreground py-2">No document libraries found</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {setupMode && (
              <Button variant="ghost" size="sm" onClick={() => setSetupMode(false)} data-testid="sp-cancel-setup">
                Cancel
              </Button>
            )}
          </div>
        )}
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
        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-1">
          <HardDrive className="h-4 w-4" />
          <span>SharePoint Documents</span>
          {folderId && <ChevronRightIcon className="h-3 w-3" />}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSetupMode(true)} data-testid="sp-change-site">
          Change Site
        </Button>
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

function TeamsChatSection() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const { data: groups, isLoading: loadingGroups } = useQuery<any[]>({
    queryKey: ["teams-chat-groups-collab"],
    queryFn: async () => {
      const res = await fetch("/api/teams/groups", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: msTeams, isLoading: loadingMsTeams } = useQuery<any[]>({
    queryKey: ["ms-teams-joined"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/joined", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120_000,
  });

  const { data: msChats } = useQuery<any[]>({
    queryKey: ["ms-teams-chats"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/chats", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120_000,
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

  const isLoading = loadingGroups || loadingMsTeams;
  const hasContent = myGroups.length > 0 || (msTeams && msTeams.length > 0) || (msChats && msChats.length > 0);

  return (
    <div className="space-y-3" data-testid="teams-chat-section">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Your MS Teams channels and dashboard chats</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/teams/chats")} data-testid="teams-open-full">
          <ExternalLink className="h-4 w-4 mr-1" /> Open Full Chat
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasContent ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">No chat channels found</p>
          <p className="text-xs text-muted-foreground mt-1">Teams permissions may need to be granted in Azure</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/teams/chats")} data-testid="teams-go-create">
            Go to Teams Chat
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {msTeams && msTeams.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Microsoft Teams</h4>
              <div className="divide-y rounded-lg border">
                {msTeams.map((team: any) => (
                  <div key={team.id}>
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                      <div className="flex-shrink-0 rounded-lg p-1.5 bg-purple-100 text-purple-600">
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{team.displayName}</div>
                        {team.description && <div className="text-xs text-muted-foreground truncate">{team.description}</div>}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{(team.channels || []).length} channels</Badge>
                    </div>
                    {(team.channels || []).map((ch: any) => (
                      <a
                        key={ch.id}
                        href={`https://teams.microsoft.com/l/channel/${encodeURIComponent(ch.id)}/${encodeURIComponent(ch.displayName)}?groupId=${team.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-2 pl-12 hover:bg-muted/50 transition-colors cursor-pointer"
                        data-testid={`ms-channel-${ch.id}`}
                      >
                        <span className="text-muted-foreground">#</span>
                        <span className="text-sm truncate">{ch.displayName}</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto flex-shrink-0" />
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {msChats && msChats.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Recent Chats</h4>
              <div className="divide-y rounded-lg border">
                {msChats.slice(0, 10).map((chat: any) => {
                  const chatMembers = (chat.members || []).filter((m: any) => m.displayName).map((m: any) => m.displayName);
                  const chatTitle = chat.topic || chatMembers.join(", ") || "Chat";
                  return (
                    <a
                      key={chat.id}
                      href={`https://teams.microsoft.com/l/chat/${encodeURIComponent(chat.id)}/0`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                      data-testid={`ms-chat-${chat.id}`}
                    >
                      <div className="flex-shrink-0 rounded-lg p-1.5 bg-blue-100 text-blue-600">
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{chatTitle}</div>
                        <div className="text-xs text-muted-foreground">
                          {chat.chatType === "oneOnOne" ? "1:1 chat" : "Group chat"}
                          {chat.lastUpdatedDateTime && ` · ${format(parseISO(chat.lastUpdatedDateTime), "MMM d")}`}
                        </div>
                      </div>
                      <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {myGroups.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Dashboard Channels</h4>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CombinedTeamsTab() {
  const [activeSection, setActiveSection] = useState<"activity" | "chat">("activity");

  return (
    <div className="space-y-4" data-testid="combined-teams-tab">
      <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1" data-testid="teams-section-toggle">
        <button
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === "activity"
              ? "bg-white text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveSection("activity")}
          data-testid="teams-section-activity"
        >
          <Zap className="h-4 w-4" />
          Activity
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeSection === "chat"
              ? "bg-white text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveSection("chat")}
          data-testid="teams-section-chat"
        >
          <MessageSquare className="h-4 w-4" />
          Chat
        </button>
      </div>

      {activeSection === "activity" ? (
        <SyncedTeamsTab />
      ) : (
        <TeamsChatSection />
      )}
    </div>
  );
}

export default function CollaborationPage() {
  const { user } = useAuth();
  const { allowed, loading: permLoading } = usePermission("pd_collaboration", "view");
  const urlTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  const validTabs = ["calendar", "email", "teams", "sharepoint", "notifications"];
  const [activeTab, setActiveTab] = useState(urlTab && validTabs.includes(urlTab) ? urlTab : "email");
  const unifiedFlag = useUnifiedWorkFlag();

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

  if (unifiedFlag) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="collaboration-page">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-collaboration-title">Collaboration</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Microsoft 365 communications — tag to projects or convert to tasks
              {user?.displayName && <span> — signed in as <strong>{user.displayName}</strong></span>}
            </p>
          </div>
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
              <SyncedEmailTab />
            </TabsContent>
            <TabsContent value="teams">
              <CombinedTeamsTab />
            </TabsContent>
            <TabsContent value="sharepoint">
              <SyncedSharePointTab />
            </TabsContent>
            <TabsContent value="notifications">
              <SyncedNotificationsTab />
            </TabsContent>
          </div>
        </Tabs>
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
            <CombinedTeamsTab />
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
