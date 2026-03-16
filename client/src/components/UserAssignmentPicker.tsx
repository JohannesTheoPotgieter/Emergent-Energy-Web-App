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

  const { data: assignables = [] } = useQuery<AssignableDirectoryEntry[]>({
    queryKey: ["/api/assignables", taskSource],
    queryFn: async () => fetchAssignables(taskSource),
    staleTime: 60000,
  });

  const reassignMutation = useMutation({
    mutationFn: async (payload: { assigneeType: AssigneeType | null; assigneeId: number | null }) => {
      const res = await fetch("/api/tasks/reassign", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ taskId, taskSource, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to reassign");
      return body;
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onSuccess?.();
      toast({ title: "Assignment updated" });
      setOpen(false);
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to update assignment", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const internalAssignables = assignables.filter((entry) => entry.assigneeType === "internal_user");
  const externalAssignables = assignables.filter((entry) => entry.assigneeType !== "internal_user");

  const canonicalAssignments = (assignments || []).filter((assignment) => assignment.active);
  const internalAssignments = canonicalAssignments.filter((assignment) => assignment.assigneeType === "internal_user");
  const externalAssignments = canonicalAssignments.filter((assignment) => assignment.assigneeType !== "internal_user");

  const effectiveResolved = internalAssignments.length > 0
    ? internalAssignments.map((assignment) => ({
      id: assignment.assigneeId,
      name: assignment.displayLabel,
      username: assignment.displayLabel,
      role: assignment.secondaryLabel || "",
    }))
    : [...(resolvedUsers || [])];

  if (effectiveResolved.length === 0 && textNames && internalAssignables.length > 0) {
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
    <div className="flex items-center gap-1 flex-wrap" data-testid={`user-assignment-${taskSource}-${taskId}`}>
      {effectiveResolved.length > 0 && effectiveResolved.map(u => (
        <span
          key={u.id}
          className={`inline-flex items-center gap-1 ${isXs ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs'} rounded-full bg-muted text-foreground font-medium`}
          title={`${u.name} (${u.role})`}
        >
          <span className={`inline-flex items-center justify-center ${isXs ? 'w-3.5 h-3.5 text-[7px]' : 'w-4 h-4 text-[8px]'} rounded-full text-white font-bold ${getAvatarColor(u.name)}`}>
            {getInitials(u.name)}
          </span>
          {u.name}
          <span className="text-[9px] text-blue-600">Internal</span>
        </span>
      ))}

      {resolvedExternal.map((entry, i) => (
        <span
          key={`cp-${entry.assigneeType}-${entry.assigneeId}-${i}`}
          className={`inline-flex items-center gap-1 ${isXs ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs'} rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium`}
        >
          <Building2 className={isXs ? "w-2.5 h-2.5" : "w-3 h-3"} />
          {entry.name}
          <span className="text-[9px]">{getAssigneeBadgeLabel(entry.assigneeType)}</span>
        </span>
      ))}

      {unmatchedNames.map((name, i) => (
        <span
          key={`unmatched-${i}`}
          className={`inline-flex items-center gap-1 ${isXs ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs'} rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium`}
          title={`"${name}" not found in system`}
        >
          <User className={isXs ? "w-2.5 h-2.5" : "w-3 h-3"} />
          {name}
          <span className="text-amber-600">(unmatched)</span>
        </span>
      ))}

      {isUnassigned && showUnassignedLabel && (
        <span className={`${isXs ? 'text-[10px]' : 'text-xs'} text-muted-foreground italic`}>Unassigned</span>
      )}

      <Popover open={open} onOpenChange={(next) => { if (!disabled) setOpen(next); }}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`${isXs ? 'h-5 w-5' : 'h-6 w-6'} rounded-full hover:bg-blue-50 text-muted-foreground hover:text-blue-600`}
            data-testid={`btn-assign-${taskSource}-${taskId}`}
            title={disabled ? (disabledReason || "You do not have permission to assign this task") : "Assign"}
            disabled={disabled}
          >
            <UserPlus className={isXs ? "h-3 w-3" : "h-3.5 w-3.5"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start" side="bottom">
          <div className="flex items-center gap-1 mb-2">
            <Button size="sm" variant={directoryMode === "internal" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setDirectoryMode("internal")}>Internal</Button>
            <Button size="sm" variant={directoryMode === "external" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setDirectoryMode("external")}>External</Button>
          </div>
          <div className="flex items-center gap-1.5 mb-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              className="h-7 text-xs border-0 shadow-none focus-visible:ring-0"
              placeholder={directoryMode === "internal" ? "Search users..." : "Search counterparties or contacts..."}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-assignment-search"
            />
          </div>
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {hasAssignments && mode === "single" && (
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-red-600 hover:bg-red-50 transition-colors"
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
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${isAssigned ? 'bg-blue-50 text-blue-700' : 'hover:bg-muted text-foreground'}`}
                  onClick={() => {
                    if (!isAssigned) reassignMutation.mutate({ assigneeType: "internal_user", assigneeId: entry.assigneeId });
                  }}
                  disabled={isAssigned}
                  data-testid={`btn-select-user-${entry.assigneeId}`}
                >
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[9px] font-bold ${getAvatarColor(entry.displayLabel)}`}>
                    {getInitials(entry.displayLabel)}
                  </span>
                  <span className="flex-1 text-left truncate">{entry.displayLabel}</span>
                  {isAssigned && <Check className="h-3.5 w-3.5 text-blue-600" />}
                </button>
              );
            })}

            {directoryMode === "external" && filteredExternalEntries.map((entry) => {
              const isAssigned = assignedKeys.has(`${entry.assigneeType}:${entry.assigneeId}`);
              return (
                <button
                  key={`${entry.assigneeType}-${entry.assigneeId}`}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${isAssigned ? 'bg-blue-50 text-blue-700' : 'hover:bg-muted text-foreground'}`}
                  onClick={() => {
                    if (!isAssigned) reassignMutation.mutate({ assigneeType: entry.assigneeType, assigneeId: entry.assigneeId });
                  }}
                  disabled={isAssigned}
                  data-testid={`btn-select-${entry.assigneeType}-${entry.assigneeId}`}
                >
                  <Building2 className="h-4 w-4 text-amber-700" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="truncate">{entry.displayLabel}</div>
                    {(entry.secondaryLabel || entry.sourceLabel) && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {[entry.secondaryLabel, entry.sourceLabel].filter(Boolean).join(" | ")}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-amber-700">{getAssigneeBadgeLabel(entry.assigneeType)}</span>
                  {isAssigned && <Check className="h-3.5 w-3.5 text-blue-600" />}
                </button>
              );
            })}

            {directoryMode === "internal" && filteredUsers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No users found</p>
            )}
            {directoryMode === "external" && filteredExternalEntries.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No counterparties or contacts found</p>
            )}
          </div>
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
