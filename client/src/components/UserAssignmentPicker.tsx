import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { UserPlus, X, Check, Search, User, Building2 } from "lucide-react";
import {
  type AssignableDirectoryEntry,
  type AssigneeType,
  type CanonicalAssignment,
  fetchAssignables,
  getAssigneeBadgeLabel,
  getAuthHeaders,
  resolveLegacyExternalEntry,
} from "@/lib/assignables";

interface ResolvedUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
    "bg-orange-500", "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function nameMatchesAnyUser(textName: string, user: { name: string; username: string }): boolean {
  const n = textName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return false;
  const un = user.name.trim().toLowerCase().replace(/\s+/g, " ");
  if (un === n) return true;
  if (user.username.toLowerCase() === n) return true;
  if (un.split(" ")[0] === n) return true;
  const uParts = un.split(" ");
  if (uParts.length >= 2 && uParts[uParts.length - 1] === n) return true;
  if (n.includes(",")) {
    const flipped = n.split(",").map(s => s.trim()).reverse().join(" ");
    if (un === flipped) return true;
  }
  if (n.length >= 4 && (un.startsWith(n) || n.startsWith(un))) return true;
  if (n.length >= 4 && (un.includes(n) || n.includes(un))) return true;
  return false;
}

interface UserAssignmentPickerProps {
  taskId: number;
  taskSource: string;
  assignments?: CanonicalAssignment[] | null;
  resolvedUsers?: ResolvedUser[] | null;
  textNames?: string[] | null;
  mode?: "single" | "multi";
  size?: "sm" | "xs";
  onSuccess?: () => void;
  invalidateKeys?: string[];
  showUnassignedLabel?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export default function UserAssignmentPicker({
  taskId,
  taskSource,
  assignments,
  resolvedUsers,
  textNames,
  mode = "single",
  size = "sm",
  onSuccess,
  invalidateKeys = ["/api/my-work/all-tasks"],
  showUnassignedLabel = true,
  disabled = false,
  disabledReason,
}: UserAssignmentPickerProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [directoryMode, setDirectoryMode] = useState<"internal" | "external">("internal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [localAssignments, setLocalAssignments] = useState<CanonicalAssignment[] | null>(null);

  useEffect(() => {
    if (assignments) {
      setLocalAssignments(null);
    }
  }, [assignments]);

  const { data: assignables = [] } = useQuery<AssignableDirectoryEntry[]>({
    queryKey: ["/api/assignables", taskSource],
    queryFn: async () => fetchAssignables(taskSource),
    staleTime: 60000,
  });

  const safeTaskId = Number.isFinite(taskId) && taskId > 0 ? taskId : null;

  const { data: fetchedAssignments } = useQuery<CanonicalAssignment[]>({
    queryKey: ["/api/entity-assignments", taskSource, taskId],
    queryFn: async () => {
      const res = await fetch(`/api/entity-assignments/${encodeURIComponent(taskSource)}/${taskId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !assignments && !!safeTaskId,
    staleTime: 30000,
  });

  const effectiveAssignments = assignments ?? fetchedAssignments ?? null;

  const reassignMutation = useMutation({
    mutationFn: async (payload: { assigneeType: AssigneeType | null; assigneeId: number | null }) => {
      if (!safeTaskId) {
        throw new Error(`Invalid task ID: ${taskId}`);
      }
      const numericAssigneeId = payload.assigneeId != null ? Number(payload.assigneeId) : null;
      if (numericAssigneeId != null && (!Number.isFinite(numericAssigneeId) || numericAssigneeId <= 0)) {
        throw new Error(`Invalid assignee ID: ${payload.assigneeId}`);
      }
      const requestBody = { taskId: safeTaskId, taskSource, assigneeType: payload.assigneeType, assigneeId: numericAssigneeId };
      const res = await fetch("/api/tasks/reassign", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(requestBody),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[Assignment] Reassign failed:", res.status, body);
        throw new Error(body?.error || `Failed to reassign (${res.status})`);
      }
      return body;
    },
    onSuccess: (data) => {
      if (data?.assignments) {
        setLocalAssignments(data.assignments);
      } else if (data?.assignment) {
        setLocalAssignments([{
          id: 0,
          entityType: "work_item",
          entityId: taskId,
          assignmentRole: "ASSIGNEE",
          assigneeType: data.assignment.assigneeType,
          assigneeId: data.assignment.assigneeId,
          displayLabel: data.assignment.displayName,
          displayLabelSnapshot: data.assignment.displayName,
          secondaryLabel: data.assignment.email || "",
          active: true,
        }]);
      } else {
        setLocalAssignments([]);
      }
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/assignables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-assignments", taskSource, taskId] });
      onSuccess?.();
      toast({ title: "Assignment updated" });
      setOpen(false);
    },
    onError: (error: any) => {
      console.error("[Assignment] Mutation error:", error);
      toast({ title: error?.message || "Failed to update assignment", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const internalAssignables = assignables.filter((entry) => entry.assigneeType === "internal_user");
  const externalAssignables = assignables.filter((entry) => entry.assigneeType !== "internal_user");

  const effectiveAssignmentSource = localAssignments ?? assignments ?? [];
  const canonicalAssignments = effectiveAssignmentSource.filter((assignment) => assignment.active);
  const internalAssignments = canonicalAssignments.filter((assignment) => assignment.assigneeType === "internal_user");
  const externalAssignments = canonicalAssignments.filter((assignment) => assignment.assigneeType !== "internal_user");

  const effectiveResolved = internalAssignments.length > 0
    ? internalAssignments.map((assignment) => ({
      id: assignment.assigneeId,
      name: assignment.displayLabel,
      username: assignment.displayLabel,
      role: assignment.secondaryLabel || "",
    }))
    : localAssignments != null ? [] : [...(resolvedUsers || [])];

  if (effectiveResolved.length === 0 && localAssignments == null && textNames && internalAssignables.length > 0) {
    const resolvedIds = new Set(effectiveResolved.map((user) => user.id));
    for (const textName of textNames) {
      if (!textName?.trim() || textName.startsWith("counterparty:") || textName.startsWith("contact:")) continue;
      if (effectiveResolved.some((user) => nameMatchesAnyUser(textName, user))) continue;
      const match = internalAssignables.find((entry) =>
        nameMatchesAnyUser(textName, {
          name: entry.displayLabel,
          username: entry.displayLabel,
        }),
      );
      if (match && !resolvedIds.has(match.assigneeId)) {
        effectiveResolved.push({
          id: match.assigneeId,
          name: match.displayLabel,
          username: match.displayLabel,
          role: match.roleTags[0] || "",
        });
        resolvedIds.add(match.assigneeId);
      }
    }
  }

  const resolvedExternal = externalAssignments.length > 0
    ? externalAssignments.map((assignment) => {
      const matched = assignables.find((entry) =>
        entry.assigneeType === assignment.assigneeType && entry.assigneeId === assignment.assigneeId,
      );
      return {
        assigneeType: assignment.assigneeType,
        assigneeId: assignment.assigneeId,
        name: assignment.displayLabel,
        secondaryLabel: assignment.secondaryLabel,
        sourceLabel: matched?.sourceLabel || assignment.assigneeType,
      };
    })
    : (textNames || [])
      .map((name) => resolveLegacyExternalEntry(name, assignables))
      .filter((entry): entry is AssignableDirectoryEntry => Boolean(entry))
      .map((entry) => ({
        assigneeType: entry.assigneeType,
        assigneeId: entry.assigneeId,
        name: entry.displayLabel,
        secondaryLabel: entry.secondaryLabel,
        sourceLabel: entry.sourceLabel,
      }));

  const unmatchedNames = canonicalAssignments.length > 0
    ? []
    : (textNames || []).filter((name) => {
      if (!name?.trim() || name.startsWith("counterparty:") || name.startsWith("contact:")) return false;
      return !effectiveResolved.some((user) => nameMatchesAnyUser(name, user));
    });

  const assignedKeys = new Set<string>([
    ...effectiveResolved.map((user) => `internal_user:${user.id}`),
    ...resolvedExternal.map((entry) => `${entry.assigneeType}:${entry.assigneeId}`),
  ]);
  const hasAssignments = assignedKeys.size > 0 || unmatchedNames.length > 0;
  const isUnassigned = !hasAssignments;

  const matchesSearch = (entry: AssignableDirectoryEntry) => {
    if (!search) return true;
    const query = search.toLowerCase();
    return [entry.displayLabel, entry.secondaryLabel, entry.sourceLabel, ...entry.roleTags]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  };

  const filteredUsers = internalAssignables.filter(matchesSearch);
  const filteredExternalEntries = externalAssignables.filter(matchesSearch);

  const isXs = size === "xs";

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid={`user-assignment-${taskSource}-${taskId}`}>
      {effectiveResolved.length > 0 && effectiveResolved.map(u => (
        <span
          key={u.id}
          className={`inline-flex items-center gap-1.5 ${isXs ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'} rounded-md bg-slate-50 border border-slate-200 text-foreground font-medium shadow-sm`}
          title={`${u.name}${u.role ? ` — ${u.role}` : ''}`}
        >
          <span className={`inline-flex items-center justify-center ${isXs ? 'w-4 h-4 text-[7px]' : 'w-5 h-5 text-[9px]'} rounded-full text-white font-bold shadow-sm ${getAvatarColor(u.name)}`}>
            {getInitials(u.name)}
          </span>
          <span className="truncate max-w-[120px]">{u.name}</span>
        </span>
      ))}

      {resolvedExternal.map((entry, i) => (
        <span
          key={`cp-${entry.assigneeType}-${entry.assigneeId}-${i}`}
          className={`inline-flex items-center gap-1.5 ${isXs ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'} rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium shadow-sm`}
        >
          <Building2 className={isXs ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span className="truncate max-w-[120px]">{entry.name}</span>
        </span>
      ))}

      {unmatchedNames.map((name, i) => (
        <span
          key={`unmatched-${i}`}
          className={`inline-flex items-center gap-1.5 ${isXs ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'} rounded-md bg-orange-50 text-orange-700 border border-orange-200 font-medium shadow-sm`}
          title={`"${name}" — not matched to a system user`}
        >
          <User className={isXs ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span className="truncate max-w-[100px]">{name}</span>
        </span>
      ))}

      {isUnassigned && showUnassignedLabel && (
        <span className={`inline-flex items-center gap-1 ${isXs ? 'text-[10px]' : 'text-xs'} text-muted-foreground`}>
          <User className={isXs ? "w-3 h-3" : "w-3.5 h-3.5"} />
          Unassigned
        </span>
      )}

      <Popover open={open} onOpenChange={(next) => { if (!disabled && safeTaskId) setOpen(next); }}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`${isXs ? 'h-5 w-5' : 'h-6 w-6'} rounded-full border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition-colors`}
            data-testid={`btn-assign-${taskSource}-${taskId}`}
            title={!safeTaskId ? "Cannot assign — invalid task" : disabled ? (disabledReason || "You do not have permission to assign this task") : "Assign user"}
            disabled={disabled || !safeTaskId}
          >
            <UserPlus className={isXs ? "h-3 w-3" : "h-3.5 w-3.5"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start" side="bottom">
          <div className="px-3 pt-3 pb-2 border-b border-border/60">
            <p className="text-xs font-semibold text-foreground mb-2">Assign to</p>
            <div className="flex items-center gap-1 mb-2">
              <Button size="sm" variant={directoryMode === "internal" ? "default" : "outline"} className="h-7 text-xs flex-1" onClick={() => setDirectoryMode("internal")}>
                <User className="h-3 w-3 mr-1" />Team
              </Button>
              <Button size="sm" variant={directoryMode === "external" ? "default" : "outline"} className="h-7 text-xs flex-1" onClick={() => setDirectoryMode("external")}>
                <Building2 className="h-3 w-3 mr-1" />External
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                className="h-8 text-xs pl-8 bg-muted/40 border-border/60"
                placeholder={directoryMode === "internal" ? "Search team members..." : "Search external parties..."}
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-assignment-search"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {hasAssignments && mode === "single" && (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-red-600 hover:bg-red-50 transition-colors mb-0.5"
                onClick={() => reassignMutation.mutate({ assigneeType: null, assigneeId: null })}
                data-testid="btn-unassign"
              >
                <X className="h-3.5 w-3.5" />
                Remove assignment
              </button>
            )}

            {directoryMode === "internal" && filteredUsers.map((entry) => {
              const isAssigned = assignedKeys.has(`internal_user:${entry.assigneeId}`);
              return (
                <button
                  key={entry.assigneeId}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${isAssigned ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-muted/60 text-foreground'}`}
                  onClick={() => {
                    if (!isAssigned) reassignMutation.mutate({ assigneeType: "internal_user", assigneeId: entry.assigneeId });
                  }}
                  disabled={isAssigned}
                  data-testid={`btn-select-user-${entry.assigneeId}`}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shadow-sm ${getAvatarColor(entry.displayLabel)}`}>
                    {getInitials(entry.displayLabel)}
                  </span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="truncate font-medium">{entry.displayLabel}</div>
                    {entry.secondaryLabel && <div className="text-[10px] text-muted-foreground truncate">{entry.secondaryLabel}</div>}
                  </div>
                  {isAssigned && <Check className="h-4 w-4 text-blue-600" />}
                </button>
              );
            })}

            {directoryMode === "external" && filteredExternalEntries.map((entry) => {
              const isAssigned = assignedKeys.has(`${entry.assigneeType}:${entry.assigneeId}`);
              return (
                <button
                  key={`${entry.assigneeType}-${entry.assigneeId}`}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${isAssigned ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-muted/60 text-foreground'}`}
                  onClick={() => {
                    if (!isAssigned) reassignMutation.mutate({ assigneeType: entry.assigneeType, assigneeId: entry.assigneeId });
                  }}
                  disabled={isAssigned}
                  data-testid={`btn-select-${entry.assigneeType}-${entry.assigneeId}`}
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 shadow-sm">
                    <Building2 className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="truncate font-medium">{entry.displayLabel}</div>
                    {(entry.secondaryLabel || entry.sourceLabel) && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {[entry.secondaryLabel, entry.sourceLabel].filter(Boolean).join(" — ")}
                      </div>
                    )}
                  </div>
                  {isAssigned && <Check className="h-4 w-4 text-blue-600" />}
                </button>
              );
            })}

            {directoryMode === "internal" && filteredUsers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <User className="h-5 w-5 mb-1.5 opacity-40" />
                <p className="text-xs">No team members found</p>
              </div>
            )}
            {directoryMode === "external" && filteredExternalEntries.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <Building2 className="h-5 w-5 mb-1.5 opacity-40" />
                <p className="text-xs">No external parties found</p>
              </div>
            )}
          </div>
          {reassignMutation.isPending && (
            <div className="px-3 py-2 border-t border-border/60 text-[10px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Updating assignment...
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function UserAvatarGroup({
  resolvedUsers,
  textNames,
  maxDisplay = 3,
  size = "sm",
}: {
  resolvedUsers?: ResolvedUser[] | null;
  textNames?: string[] | null;
  maxDisplay?: number;
  size?: "sm" | "xs";
}) {
  const { data: allUsersFallback = [] } = useQuery<AssignableDirectoryEntry[]>({
    queryKey: ["/api/assignables", "avatar-fallback"],
    queryFn: async () => fetchAssignables(),
    staleTime: 60000,
  });

  const effectiveUsers = [...(resolvedUsers || [])];
  const internalFallback = allUsersFallback.filter((entry) => entry.assigneeType === "internal_user");
  if (textNames && textNames.length > 0 && internalFallback.length > 0) {
    const ids = new Set(effectiveUsers.map(u => u.id));
    for (const tn of textNames) {
      if (!tn?.trim() || tn.startsWith("counterparty:") || tn.startsWith("contact:")) continue;
      if (effectiveUsers.some(u => nameMatchesAnyUser(tn, u))) continue;
      const match = internalFallback.find((entry) => nameMatchesAnyUser(tn, { name: entry.displayLabel, username: entry.displayLabel }));
      if (match && !ids.has(match.assigneeId)) {
        effectiveUsers.push({ id: match.assigneeId, name: match.displayLabel, username: match.displayLabel, role: match.roleTags[0] || "" });
        ids.add(match.assigneeId);
      }
    }
  }

  const displayed = effectiveUsers.slice(0, maxDisplay);
  const remaining = effectiveUsers.length - maxDisplay;
  const isXs = size === "xs";

  const unmatchedNames = (textNames || []).filter(n => {
    if (!n || n.startsWith("counterparty:") || n.startsWith("contact:")) return false;
    return !effectiveUsers.some(u => nameMatchesAnyUser(n, u));
  });

  if (effectiveUsers.length === 0 && unmatchedNames.length === 0) {
    return <span className={`${isXs ? 'text-[10px]' : 'text-xs'} text-muted-foreground italic`}>Unassigned</span>;
  }

  return (
    <div className="flex items-center -space-x-1">
      {displayed.map(u => (
        <span
          key={u.id}
          className={`inline-flex items-center justify-center ${isXs ? 'w-5 h-5 text-[8px]' : 'w-6 h-6 text-[9px]'} rounded-full text-white font-bold border-2 border-white ${getAvatarColor(u.name)}`}
          title={u.name}
        >
          {getInitials(u.name)}
        </span>
      ))}
      {remaining > 0 && (
        <span className={`inline-flex items-center justify-center ${isXs ? 'w-5 h-5 text-[8px]' : 'w-6 h-6 text-[9px]'} rounded-full bg-slate-200 text-muted-foreground font-bold border-2 border-white`}>
          +{remaining}
        </span>
      )}
      {unmatchedNames.map((name, i) => (
        <span
          key={`um-${i}`}
          className={`inline-flex items-center justify-center ${isXs ? 'w-5 h-5 text-[8px]' : 'w-6 h-6 text-[9px]'} rounded-full bg-amber-100 text-amber-700 font-bold border-2 border-white`}
          title={`${name} (not in system)`}
        >
          ?
        </span>
      ))}
    </div>
  );
}
