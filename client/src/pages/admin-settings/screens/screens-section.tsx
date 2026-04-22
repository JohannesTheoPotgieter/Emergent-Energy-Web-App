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

const NAV_GROUP_LABELS: Record<string, string> = {
  MY_WORK: "My Work",
  PRIORITIES: "Priorities",
  PORTFOLIO: "Portfolio",
  GATES: "Gates",
  PROJECTS: "Projects",
  PROJECT_MANAGEMENT: "Project Delivery",
  PROJECT_DEVELOPMENT: "Development",
  ENGINEERING: "Engineering",
  QUALITY: "Quality",
  HSE: "HSE",
  FINANCE: "Finance",
  REPORTS: "Reports",
  KNOWLEDGE: "Knowledge",
  SYSTEM: "System",
};

const NAV_GROUP_ORDER = [
  "MY_WORK", "PRIORITIES", "PORTFOLIO", "GATES", "PROJECTS",
  "PROJECT_MANAGEMENT", "PROJECT_DEVELOPMENT", "ENGINEERING",
  "QUALITY", "HSE", "FINANCE", "REPORTS", "KNOWLEDGE", "SYSTEM",
];

// Screens to exclude from admin control (auth/system pages)
const EXCLUDED_IDS = new Set([
  "login", "msCallback", "notFound", "settingsHome",
  "adminControlCenter", "adminSettings",
]);

function getScreenableEntries(): PageRegistryEntry[] {
  return PAGE_REGISTRY.filter(
    (p) => p.routeComponentKey && p.navGroup && !EXCLUDED_IDS.has(p.id),
  );
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

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const byGroup = new Map<string, PageRegistryEntry[]>();
    for (const entry of allEntries) {
      const matches = !q || entry.label.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q);
      if (!matches) continue;
      const group = entry.navGroup!;
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(entry);
    }
    return byGroup;
  }, [allEntries, search]);

  const disabledCount = useMemo(
    () => allEntries.filter((e) => !isEnabled(e.id)).length,
    [allEntries, settingsMap],
  );

  if (loading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading screen settings…</div>;

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
                Control which screens are accessible in the app. Disabled screens are hidden from navigation
                and their permissions are removed from the Roles matrix.
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
              placeholder="Filter screens…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {NAV_GROUP_ORDER.map((groupKey) => {
            const entries = grouped.get(groupKey);
            if (!entries || entries.length === 0) return null;
            return (
              <div key={groupKey}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {NAV_GROUP_LABELS[groupKey] ?? groupKey}
                </div>
                <div className="rounded-lg border divide-y">
                  {entries.map((entry) => {
                    const enabled = isEnabled(entry.id);
                    const isSavingThis = saving === entry.id;
                    const description = entry.permissionEntity
                      ? ENTITY_DESCRIPTIONS[entry.permissionEntity]
                      : undefined;
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between px-4 py-3 gap-4 transition-colors ${!enabled ? "bg-slate-50/60" : "hover:bg-muted/30"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {enabled
                              ? <Eye className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              : <EyeOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            }
                            <span className={`text-sm font-medium ${!enabled ? "text-slate-400 line-through" : ""}`}>
                              {entry.label}
                            </span>
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
          })}
          {grouped.size === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">No screens match your search.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
