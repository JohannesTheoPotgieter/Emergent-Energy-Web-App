// Task #107 — Left rail picker for /admin/roles.
//
// One control switches between People (users list) and Roles (roles list).
// A search input filters the active list. Selected row is highlighted and
// notifies the parent via onSelect(key).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Users, Shield, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import * as api from "../admin-settings/settings-api";
import type { RoleSummary, UserSummary } from "../admin-settings/settings-types";

export type PickerMode = "people" | "roles";

interface PickerRailProps {
  mode: PickerMode;
  onModeChange: (m: PickerMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selectedKey: string | null; // userId stringified or role key
  onSelect: (key: string) => void;
}

export function PickerRail({ mode, onModeChange, query, onQueryChange, selectedKey, onSelect }: PickerRailProps) {
  const usersQ = useQuery<UserSummary[]>({
    queryKey: ["/api/admin/users"],
    queryFn: api.fetchUsers,
  });
  const rolesQ = useQuery<{ roles: RoleSummary[]; ok: boolean }>({
    queryKey: ["/api/roles/control-center"],
    queryFn: api.fetchRolesControlCenter,
  });

  const users = usersQ.data ?? [];
  const roles = rolesQ.data?.roles ?? [];

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      `${u.name} ${u.email} ${u.role} ${u.department ?? ""}`.toLowerCase().includes(q),
    );
  }, [users, query]);

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) =>
      `${r.role} ${r.label} ${r.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [roles, query]);

  const isLoading = mode === "people" ? usersQ.isLoading : rolesQ.isLoading;
  const totalCount = mode === "people" ? users.length : roles.length;
  const visibleCount = mode === "people" ? filteredUsers.length : filteredRoles.length;

  return (
    <aside
      className="flex w-[320px] shrink-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm"
      style={{ maxHeight: "calc(100vh - 8rem)" }}
      data-testid="picker-rail"
    >
      {/* Mode toggle */}
      <div className="flex gap-1 border-b border-gray-100 p-2">
        <Button
          size="sm"
          variant={mode === "people" ? "default" : "ghost"}
          className={cn("flex-1 gap-1.5", mode === "people" ? "bg-emerald-600 hover:bg-emerald-700" : "")}
          onClick={() => onModeChange("people")}
          data-testid="rail-mode-people"
        >
          <Users className="h-3.5 w-3.5" /> People
          <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{users.length}</Badge>
        </Button>
        <Button
          size="sm"
          variant={mode === "roles" ? "default" : "ghost"}
          className={cn("flex-1 gap-1.5", mode === "roles" ? "bg-emerald-600 hover:bg-emerald-700" : "")}
          onClick={() => onModeChange("roles")}
          data-testid="rail-mode-roles"
        >
          <Shield className="h-3.5 w-3.5" /> Roles
          <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{roles.length}</Badge>
        </Button>
      </div>

      {/* Search */}
      <div className="relative border-b border-gray-100 p-2">
        <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder={mode === "people" ? "Search people…" : "Search roles…"}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-8 pl-7 text-sm"
          data-testid="rail-search"
          aria-label="Search"
        />
      </div>

      {/* Count strip */}
      <div className="border-b border-gray-100 px-3 py-1 text-[11px] text-muted-foreground" data-testid="rail-count">
        Showing {visibleCount} of {totalCount}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : mode === "people" ? (
          filteredUsers.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400">No people match.</div>
          ) : (
            filteredUsers.map((u) => {
              const key = String(u.id);
              const active = selectedKey === key;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSelect(key)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    active ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-gray-50",
                  )}
                  data-testid={`rail-item-user-${u.id}`}
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                    {(u.name || u.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">{u.name || u.email}</div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="h-4 truncate px-1 text-[10px]">{u.role}</Badge>
                      {u.department && (
                        <span className="truncate text-[10px] text-gray-500">{u.department}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )
        ) : filteredRoles.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-400">No roles match.</div>
        ) : (
          filteredRoles.map((r) => {
            const active = selectedKey === r.role;
            return (
              <button
                key={r.role}
                type="button"
                onClick={() => onSelect(r.role)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                  active ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-gray-50",
                )}
                data-testid={`rail-item-role-${r.role}`}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-emerald-100">
                  <Shield className="h-3.5 w-3.5 text-emerald-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{r.label}</div>
                  <div className="flex items-center gap-1">
                    <span className="truncate text-[10px] text-gray-500">{r.role}</span>
                    {(r.userCount ?? 0) > 0 && (
                      <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
                        {r.userCount} {r.userCount === 1 ? "user" : "users"}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
