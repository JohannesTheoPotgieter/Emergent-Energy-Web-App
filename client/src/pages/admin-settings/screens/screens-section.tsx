import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, MonitorOff, Search } from "lucide-react";
import { PAGE_REGISTRY } from "@/config/page-registry";
import type { PageRegistryEntry } from "@/config/page-registry";
import { ENTITY_DESCRIPTIONS } from "../settings-types";
import * as api from "../settings-api";
import type { ScreenSetting } from "../settings-types";

/**
 * Functionality Control — Phase-1 COO spec rework (2026-05-12).
 *
 * The six-tab nav (Home · Project Delivery · Finance · Engineering · Quality
 * Management · Settings) is the canonical user-facing surface. This page lets
 * COO / CEO toggle individual screens on/off. Disabled screens 404 for every
 * role (the gate runs in client/src/App.tsx using
 * client/src/hooks/use-screen-availability.ts).
 *
 * Display rule: group every screenable entry by which top-tab it belongs to
 * (`TOP_NAV_BUCKETS` below) so admins see the new taxonomy. Anything not in
 * the six-tab spec lands under "Hidden by default" — toggle on to bring it
 * back into the nav.
 */
const TOP_NAV_BUCKETS: Array<{
  key: string;
  label: string;
  description: string;
  navGroups: string[];
}> = [
  {
    key: "HOME",
    label: "Home",
    description: "Personal workspace + the three-tier priorities chain.",
    navGroups: ["MY_WORK", "PRIORITIES"],
  },
  {
    key: "PROJECT_DELIVERY",
    label: "Project Delivery",
    description: "Execution Dashboard, All Projects, Milestone Tracker.",
    navGroups: ["PROJECTS", "PROJECT_MANAGEMENT"],
  },
  {
    key: "FINANCE",
    label: "Finance",
    description: "Cashflow, Cost of Sales, Revenue, Gross Profit, FYE Tracking Report.",
    navGroups: ["FINANCE"],
  },
  {
    key: "ENGINEERING",
    label: "Engineering",
    description: "Engineering Dashboard, Task Board, Document Management, Standup.",
    navGroups: ["ENGINEERING"],
  },
  {
    key: "QUALITY",
    label: "Quality Management",
    description: "Quality Dashboard, Task Board, Document Management.",
    navGroups: ["QUALITY"],
  },
  {
    key: "SETTINGS",
    label: "Settings",
    description: "Roles & Permissions, Functionality Control, Integration Statuses, Audit Log.",
    navGroups: ["SYSTEM"],
  },
];

const HIDDEN_BUCKET = {
  key: "HIDDEN",
  label: "Hidden by default",
  description:
    "Surfaces not part of the six-tab COO spec. Routes still resolve when toggled on; toggle off to 404 them.",
  navGroups: ["PORTFOLIO", "GATES", "PROJECT_DEVELOPMENT", "HSE", "REPORTS", "KNOWLEDGE"],
};

// Screens to exclude from admin control (auth/system pages that must always work).
const EXCLUDED_IDS = new Set([
  "login", "msCallback", "notFound", "settingsHome",
  "adminControlCenter", "adminSettings",
]);

function getScreenableEntries(): PageRegistryEntry[] {
  return PAGE_REGISTRY.filter(
    (p) => p.routeComponentKey && p.navGroup && !EXCLUDED_IDS.has(p.id),
  );
}

function bucketForEntry(entry: PageRegistryEntry): string {
  const group = entry.navGroup ?? "";
  for (const bucket of TOP_NAV_BUCKETS) {
    if (bucket.navGroups.includes(group)) return bucket.key;
  }
  return HIDDEN_BUCKET.key;
}

export function ScreensSection() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ScreenSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const data = await api.fetchScreenSettings();
    setSettings(data);
    setLoading(false);
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const settingsMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of settings) m.set(s.screenId, s.isEnabled);
    return m;
  }, [settings]);

  const isEnabled = (id: string) => settingsMap.get(id) ?? true;

  const handleToggle = async (entry: PageRegistryEntry, value: boolean) => {
    setSaving(entry.id);
    const result = await api.saveScreenSetting(entry.id, value);
    if (result.ok) {
      setSettings((prev) => {
        const existing = prev.find((s) => s.screenId === entry.id);
        if (existing) return prev.map((s) => s.screenId === entry.id ? { ...s, isEnabled: value } : s);
        return [...prev, { screenId: entry.id, isEnabled: value }];
      });
      toast({
        title: value ? "Screen enabled" : "Screen disabled",
        description: `"${entry.label}" is now ${value ? "available" : "hidden"} in the app.`,
      });
    } else {
      toast({ title: "Error", description: result.error ?? "Could not save setting.", variant: "destructive" });
    }
    setSaving(null);
  };

  const allEntries = useMemo(getScreenableEntries, []);

  const filteredAndBucketed = useMemo(() => {
    const q = search.toLowerCase().trim();
    const buckets = new Map<string, PageRegistryEntry[]>();
    for (const entry of allEntries) {
      const matches =
        !q
        || entry.label.toLowerCase().includes(q)
        || entry.path.toLowerCase().includes(q)
        || (entry.permissionEntity ?? "").toLowerCase().includes(q);
      if (!matches) continue;
      const key = bucketForEntry(entry);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(entry);
    }
    return buckets;
  }, [allEntries, search]);

  const disabledCount = useMemo(
    () => allEntries.filter((e) => !isEnabled(e.id)).length,
    [allEntries, settingsMap],
  );

  if (loading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading screen settings…</div>;

  const renderBucket = (
    key: string,
    label: string,
    description: string,
    entries: PageRegistryEntry[] | undefined,
    isHidden: boolean,
  ) => {
    if (!entries || entries.length === 0) return null;
    const sortedEntries = [...entries].sort((a, b) => {
      // Currently-sidebar-visible first, then alphabetic.
      const aShown = a.showInSidebar ? 0 : 1;
      const bShown = b.showInSidebar ? 0 : 1;
      if (aShown !== bShown) return aShown - bShown;
      return a.label.localeCompare(b.label);
    });
    return (
      <div key={key} data-testid={`fc-bucket-${key.toLowerCase()}`}>
        <div className="mb-2 flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold uppercase tracking-wider text-foreground">{label}</span>
          <Badge variant="outline" className="text-[10px]">{entries.length}</Badge>
          {isHidden && (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
              hidden by default
            </Badge>
          )}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">{description}</p>
        <div className="rounded-lg border divide-y">
          {sortedEntries.map((entry) => {
            const enabled = isEnabled(entry.id);
            const isSavingThis = saving === entry.id;
            const inNav = entry.showInSidebar;
            const description = entry.permissionEntity
              ? ENTITY_DESCRIPTIONS[entry.permissionEntity]
              : undefined;
            return (
              <div
                key={entry.id}
                className={`flex items-center justify-between px-4 py-3 gap-4 transition-colors ${!enabled ? "bg-slate-50/60" : "hover:bg-muted/30"}`}
                data-testid={`fc-screen-${entry.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {enabled
                      ? <Eye className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      : <EyeOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    }
                    <span className={`text-sm font-medium ${!enabled ? "text-slate-400 line-through" : ""}`}>
                      {entry.label}
                    </span>
                    {inNav && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        in nav
                      </Badge>
                    )}
                    <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded hidden sm:inline">
                      {entry.path}
                    </code>
                  </div>
                  {description && (
                    <p className="mt-0.5 text-xs text-muted-foreground pl-5 truncate">{description}</p>
                  )}
                </div>
                <Switch
                  checked={enabled}
                  disabled={isSavingThis}
                  onCheckedChange={(val) => handleToggle(entry, val)}
                  aria-label={`Toggle ${entry.label}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MonitorOff className="h-5 w-5 text-slate-500" />
                Screen Availability
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Toggle individual screens on or off for every user in the company. Disabled
                screens are hidden from navigation AND return Not Found if visited directly.
                Roles &amp; Permissions still apply to enabled screens.
              </p>
            </div>
            {disabledCount > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 shrink-0">
                {disabledCount} disabled
              </Badge>
            )}
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-8 text-sm"
              placeholder="Filter by name, path, or permission entity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="fc-search"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {TOP_NAV_BUCKETS.map((bucket) =>
            renderBucket(
              bucket.key,
              bucket.label,
              bucket.description,
              filteredAndBucketed.get(bucket.key),
              false,
            ),
          )}
          {renderBucket(
            HIDDEN_BUCKET.key,
            HIDDEN_BUCKET.label,
            HIDDEN_BUCKET.description,
            filteredAndBucketed.get(HIDDEN_BUCKET.key),
            true,
          )}
          {filteredAndBucketed.size === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No screens match your search.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
