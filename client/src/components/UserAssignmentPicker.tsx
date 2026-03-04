import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { UserPlus, X, Check, Search, User } from "lucide-react";

interface AssignableUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

interface ResolvedUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
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

interface UserAssignmentPickerProps {
  taskId: number;
  taskSource: string;
  resolvedUsers?: ResolvedUser[] | null;
  textNames?: string[] | null;
  mode?: "single" | "multi";
  size?: "sm" | "xs";
  onSuccess?: () => void;
  invalidateKeys?: string[];
  showUnassignedLabel?: boolean;
}

export default function UserAssignmentPicker({
  taskId,
  taskSource,
  resolvedUsers,
  textNames,
  mode = "single",
  size = "sm",
  onSuccess,
  invalidateKeys = ["/api/my-work/all-tasks"],
  showUnassignedLabel = true,
}: UserAssignmentPickerProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: allUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ["/api/users/assignable"],
    queryFn: async () => {
      const res = await fetch("/api/users/assignable", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    staleTime: 60000,
  });

  const reassignMutation = useMutation({
    mutationFn: async (userId: number | null) => {
      const res = await fetch("/api/tasks/reassign", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ taskId, taskSource, userId }),
      });
      if (!res.ok) throw new Error("Failed to reassign");
      return res.json();
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onSuccess?.();
      toast({ title: "Assignment updated" });
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to update assignment", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const resolvedSet = new Set((resolvedUsers || []).map(u => u.id));

  const hasResolvedUsers = resolvedUsers && resolvedUsers.length > 0;
  const hasTextNames = textNames && textNames.filter(Boolean).length > 0;
  const hasUnmatchedNames = hasTextNames && textNames.filter(n => {
    if (!n) return false;
    return !(resolvedUsers || []).some(u => u.name.toLowerCase() === n.toLowerCase());
  }).length > 0;

  const unmatchedNames = hasTextNames ? textNames.filter(n => {
    if (!n) return false;
    return !(resolvedUsers || []).some(u => u.name.toLowerCase() === n.toLowerCase());
  }) : [];

  const isUnassigned = !hasResolvedUsers && !hasTextNames;

  const filteredUsers = allUsers.filter(u => {
    if (search) {
      const s = search.toLowerCase();
      return u.name.toLowerCase().includes(s) || u.username.toLowerCase().includes(s);
    }
    return true;
  });

  const isXs = size === "xs";

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid={`user-assignment-${taskSource}-${taskId}`}>
      {hasResolvedUsers && resolvedUsers!.map(u => (
        <span
          key={u.id}
          className={`inline-flex items-center gap-1 ${isXs ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs'} rounded-full bg-muted text-foreground font-medium`}
          title={`${u.name} (${u.role})`}
        >
          <span className={`inline-flex items-center justify-center ${isXs ? 'w-3.5 h-3.5 text-[7px]' : 'w-4 h-4 text-[8px]'} rounded-full text-white font-bold ${getAvatarColor(u.name)}`}>
            {getInitials(u.name)}
          </span>
          {u.name}
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
          <span className="text-amber-400">(unmatched)</span>
        </span>
      ))}

      {isUnassigned && showUnassignedLabel && (
        <span className={`${isXs ? 'text-[10px]' : 'text-xs'} text-muted-foreground italic`}>Unassigned</span>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`${isXs ? 'h-5 w-5' : 'h-6 w-6'} rounded-full hover:bg-blue-50 text-muted-foreground hover:text-blue-600`}
            data-testid={`btn-assign-${taskSource}-${taskId}`}
            title="Assign user"
          >
            <UserPlus className={isXs ? "h-3 w-3" : "h-3.5 w-3.5"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start" side="bottom">
          <div className="flex items-center gap-1.5 mb-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              className="h-7 text-xs border-0 shadow-none focus-visible:ring-0"
              placeholder="Search users..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-user-search"
            />
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {mode === "single" && (hasResolvedUsers || hasTextNames) && (
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-red-600 hover:bg-red-50 transition-colors"
                onClick={() => reassignMutation.mutate(null)}
                data-testid="btn-unassign"
              >
                <X className="h-3.5 w-3.5" />
                Remove assignment
              </button>
            )}
            {filteredUsers.map(u => {
              const isAssigned = resolvedSet.has(u.id);
              return (
                <button
                  key={u.id}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${isAssigned ? 'bg-blue-50 text-blue-700' : 'hover:bg-muted text-foreground'}`}
                  onClick={() => {
                    if (!isAssigned) reassignMutation.mutate(u.id);
                  }}
                  disabled={isAssigned}
                  data-testid={`btn-select-user-${u.id}`}
                >
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[9px] font-bold ${getAvatarColor(u.name)}`}>
                    {getInitials(u.name)}
                  </span>
                  <span className="flex-1 text-left truncate">{u.name}</span>
                  {isAssigned && <Check className="h-3.5 w-3.5 text-blue-600" />}
                </button>
              );
            })}
            {filteredUsers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No users found</p>
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
  const users = resolvedUsers || [];
  const displayed = users.slice(0, maxDisplay);
  const remaining = users.length - maxDisplay;
  const isXs = size === "xs";

  const unmatchedNames = (textNames || []).filter(n => {
    if (!n) return false;
    return !users.some(u => u.name.toLowerCase() === n.toLowerCase());
  });

  if (users.length === 0 && unmatchedNames.length === 0) {
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
