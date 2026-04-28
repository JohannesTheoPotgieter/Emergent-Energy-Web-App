// Task #107 — Roles & Permissions, ONE single screen.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ Header: title · "Change history" · "Visibility settings →"       │
//   ├──────────────────────────────────────────────────────────────────┤
//   │  PickerRail (320px)  │  Right detail panel (flex-1, scrolls)     │
//   │  – mode toggle       │  – user OR role view                      │
//   │  – search            │                                           │
//   │  – list              │                                           │
//   └──────────────────────────────────────────────────────────────────┘
//
// All CRUD is folded into per-context drawers (Manage account from People,
// audit from header). Visibility is delegated to /admin/settings.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ShieldCheck, History, Eye, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import * as api from "../admin-settings/settings-api";
import type { UserSummary } from "../admin-settings/settings-types";
import { PickerRail, type PickerMode } from "./picker-rail";
import { RightPanelUser } from "./right-panel-user";
import { RightPanelRole } from "./right-panel-role";
import { AuditLogDrawer } from "./audit-log-drawer";
import { ManageAccountDrawer } from "./manage-account-drawer";

const PARAM_MODE = "mode";
const PARAM_SELECTED = "selected";

function readInitial(): { mode: PickerMode; selected: string | null } {
  if (typeof window === "undefined") return { mode: "people", selected: null };
  const url = new URL(window.location.href);
  const mode = url.searchParams.get(PARAM_MODE);
  const selected = url.searchParams.get(PARAM_SELECTED);
  return {
    mode: mode === "roles" ? "roles" : "people",
    selected: selected || null,
  };
}

function writeUrl(mode: PickerMode, selected: string | null, replace: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM_MODE, mode);
  if (selected) url.searchParams.set(PARAM_SELECTED, selected);
  else url.searchParams.delete(PARAM_SELECTED);
  const next = url.toString();
  if (next === window.location.href) return;
  if (replace) window.history.replaceState({}, "", next);
  else window.history.pushState({}, "", next);
}

export default function AdminRolesPage() {
  const initial = useMemo(readInitial, []);
  const [mode, setMode] = useState<PickerMode>(initial.mode);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [search, setSearch] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  // Track whether the next URL update should replace (initial / popstate) or push (user nav).
  const [shouldReplace, setShouldReplace] = useState(true);

  // Keep the URL in sync so deep-links work and back-button is preserved.
  useEffect(() => {
    writeUrl(mode, selected, shouldReplace);
    if (shouldReplace) setShouldReplace(false);
  }, [mode, selected, shouldReplace]);

  // Honour browser back/forward by re-hydrating selection from the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const next = readInitial();
      setShouldReplace(true);
      setMode(next.mode);
      setSelected(next.selected);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Reset selection when switching modes (a userId is meaningless in roles mode).
  function handleModeChange(next: PickerMode) {
    setMode(next);
    setSelected(null);
    setSearch("");
  }

  // The right panel needs the selected user object, so we fetch the users list
  // once at the page level and look up by id.
  const usersQ = useQuery<UserSummary[]>({
    queryKey: ["/api/admin/users"],
    queryFn: api.fetchUsers,
    enabled: mode === "people",
  });

  const selectedUser = useMemo<UserSummary | null>(() => {
    if (mode !== "people" || !selected) return null;
    const id = Number(selected);
    if (!Number.isFinite(id)) return null;
    return usersQ.data?.find((u) => u.id === id) ?? null;
  }, [mode, selected, usersQ.data]);

  return (
    <div className="space-y-4 p-6" data-testid="admin-roles-page">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-7 w-7 shrink-0 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Roles &amp; Permissions</h1>
            <p className="text-sm text-slate-600">
              Pick a person or a role on the left, edit on the right. Need to change who sees which workspaces or tickets? Use{" "}
              <Link
                href="/admin/settings?section=visibility"
                className="text-emerald-700 underline-offset-2 hover:underline"
                data-testid="link-visibility-settings"
              >
                Visibility settings
              </Link>
              .{" "}
              <a
                href="/docs/permissions"
                className="text-emerald-700 underline-offset-2 hover:underline"
                data-testid="link-docs-permissions"
              >
                Read the COO/CEO guide
              </a>
              .
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/settings?section=visibility"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="button-visibility-settings"
          >
            <Eye className="h-3.5 w-3.5" /> Visibility settings
            <ExternalLink className="h-3 w-3 text-gray-400" />
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setAuditOpen(true)}
            data-testid="button-change-history"
          >
            <History className="h-3.5 w-3.5" /> Change history
          </Button>
        </div>
      </header>

      {/* ── Two-column body ─────────────────────────────────────────── */}
      <div className="flex gap-4">
        <PickerRail
          mode={mode}
          onModeChange={handleModeChange}
          query={search}
          onQueryChange={setSearch}
          selectedKey={selected}
          onSelect={setSelected}
        />

        <div className="min-w-0 flex-1">
          {!selected ? (
            <Card className="border-dashed border-gray-200 shadow-none">
              <CardContent className="py-16 text-center">
                <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-base font-medium text-gray-700">
                  Pick a {mode === "people" ? "person" : "role"} from the list
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "people"
                    ? "Edit their role, apply a template, or open Manage account for password resets and deletes."
                    : "Edit the permission matrix, navigation access, and authority scope for the selected role."}
                </p>
              </CardContent>
            </Card>
          ) : mode === "people" ? (
            selectedUser ? (
              <RightPanelUser
                user={selectedUser}
                onOpenManageAccount={() => setAccountDrawerOpen(true)}
              />
            ) : (
              <Card className="border-gray-200 shadow-sm">
                <CardContent className="py-12 text-center text-sm text-gray-500">
                  Loading person…
                </CardContent>
              </Card>
            )
          ) : (
            <RightPanelRole
              roleKey={selected}
              onRoleDeleted={() => setSelected(null)}
            />
          )}
        </div>
      </div>

      {/* ── Drawers ─────────────────────────────────────────────────── */}
      <AuditLogDrawer open={auditOpen} onOpenChange={setAuditOpen} />
      <ManageAccountDrawer
        user={selectedUser}
        open={accountDrawerOpen}
        onOpenChange={setAccountDrawerOpen}
        onDeleted={() => setSelected(null)}
      />
    </div>
  );
}
