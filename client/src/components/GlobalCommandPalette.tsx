import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { getAvailableQuickCreateActions } from "@/lib/action-access";
import {
  Navigation, Search, Plus, ArrowRight, Zap,
  FileText, FolderOpen, Receipt, User, Briefcase, Hash,
} from "lucide-react";
import { useRolloutFlag } from "@/hooks/use-rollout-flag";

interface ServerSearchResult {
  id: string;
  title: string;
  subtitle?: string;
  type: string;
  url?: string | null;
}

// Icon for each server-search result type — consistent iconography across
// entity kinds so users learn the visual language fast.
function iconFor(type: string) {
  switch (type) {
    case "project": return FolderOpen;
    case "client": return User;
    case "invoice":
    case "po": return Receipt;
    case "task":
    case "engineering":
    case "quality": return Briefcase;
    case "document":
    case "file": return FileText;
    case "cost":
    case "revenue": return Hash;
    default: return Search;
  }
}

// Group header for each result type.
function groupFor(type: string): string {
  if (type === "project") return "Projects";
  if (type === "client") return "Clients / Installers";
  if (["invoice", "po"].includes(type)) return "Invoices & POs";
  if (["task", "engineering", "quality"].includes(type)) return "Work Items";
  if (["cost", "revenue"].includes(type)) return "Finance lines";
  if (["document", "file"].includes(type)) return "Documents";
  return "People";
}

const NAV_ITEMS = PAGE_REGISTRY.filter(
  (p) => p.showInSidebar && p.routeComponentKey && !p.redirectTo
).map((p) => ({
  path: p.path,
  label: p.label,
  group: p.navGroup || "Other",
}));

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Array<{ path: string; label: string }>>([]);
  const [query, setQuery] = useState("");
  const [serverResults, setServerResults] = useState<ServerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [, setLocation] = useLocation();
  const { canViewPath, canAccessEntityAction } = useAccessMatrix();
  const { enabled: actionLaunchpadEnabled } = useRolloutFlag("action_launchpad");

  // Debounced server-side search. Covers projects, clients, invoices,
  // POs, work items, documents, people — federated via /api/search.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setServerResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=20`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setServerResults(Array.isArray(data?.results) ? data.results : []);
        } else {
          setServerResults([]);
        }
      } catch {
        setServerResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const groupedServerResults = useMemo(() => {
    const groups = new Map<string, ServerSearchResult[]>();
    for (const r of serverResults) {
      const g = groupFor(r.type);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    return groups;
  }, [serverResults]);

  const quickActions = useMemo(() => {
    if (!actionLaunchpadEnabled) return [];
    return getAvailableQuickCreateActions({ canAccessEntityAction, canViewPath });
  }, [actionLaunchpadEnabled, canAccessEntityAction, canViewPath]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("recent-command-searches");
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      setRecent([]);
    }
  }, []);

  const handleSelect = useCallback(
    (path: string, label?: string) => {
      setOpen(false);
      if (label) {
        setRecent((prev) => {
          const next = [{ path, label }, ...prev.filter((r) => r.path !== path)].slice(0, 5);
          localStorage.setItem("recent-command-searches", JSON.stringify(next));
          return next;
        });
      }
      setLocation(path);
    },
    [setLocation],
  );

  const visibleItems = NAV_ITEMS.filter((item) => canViewPath(item.path));

  const groups = visibleItems.reduce<Record<string, typeof visibleItems>>(
    (acc, item) => {
      const group = item.group;
      if (!acc[group]) acc[group] = [];
      acc[group].push(item);
      return acc;
    },
    {},
  );

  // Manual filter for nav items — so they stay visible when the user
  // types (cmdk's default shouldFilter would hide anything not matching
  // the query, including the "Pages" group the user wants always
  // reachable). Server results are fetched separately and already
  // filtered server-side; they always render.
  const q = query.trim().toLowerCase();
  const filteredVisibleItems = q.length === 0
    ? visibleItems
    : visibleItems.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.group.toLowerCase().includes(q),
    );
  const filteredGroups = filteredVisibleItems.reduce<Record<string, typeof visibleItems>>(
    (acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    },
    {},
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput
        placeholder="Search projects, invoices, installers, pages, actions... (⌘K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? "Searching…" : "No matches. Try a project name, invoice number, or installer."}
        </CommandEmpty>

        {/* Server-side search results: projects, invoices, installers, etc. */}
        {Array.from(groupedServerResults.entries()).map(([group, items]) => (
          <CommandGroup key={`server-${group}`} heading={group}>
            {items.map((item) => {
              const Icon = iconFor(item.type);
              const href = item.url && (item.url.startsWith("/") || item.url.startsWith("http")) ? item.url : null;
              return (
                <CommandItem
                  key={`server-${item.type}-${item.id}`}
                  value={`${item.title} ${item.subtitle ?? ""} ${item.type}`}
                  onSelect={() => {
                    if (href) handleSelect(href, item.title);
                  }}
                  disabled={!href}
                >
                  <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate">{item.title}</span>
                    {item.subtitle && (
                      <span className="text-xs text-muted-foreground truncate">{item.subtitle}</span>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        {groupedServerResults.size > 0 && <CommandSeparator />}

        {/* Quick Actions — create, launch */}
        {quickActions.length > 0 && (
          <CommandGroup heading="Quick Actions">
            {quickActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`action ${action.label}`}
                onSelect={() => handleSelect(action.path, action.label)}
              >
                <Plus className="h-4 w-4 mr-2 text-emerald-600" />
                {action.label}
              </CommandItem>
            ))}
            <CommandItem
              value="action go to my work"
              onSelect={() => handleSelect("/my-work", "My Work")}
            >
              <Zap className="h-4 w-4 mr-2 text-orange-600" />
              Go to My Work
            </CommandItem>
            <CommandItem
              value="action view notifications inbox"
              onSelect={() => handleSelect("/inbox", "Inbox")}
            >
              <ArrowRight className="h-4 w-4 mr-2 text-blue-600" />
              View Inbox
            </CommandItem>
          </CommandGroup>
        )}

        {quickActions.length > 0 && <CommandSeparator />}

        {recent.length > 0 && (
          <CommandGroup heading="Recent">
            {recent.map((item) => (
              <CommandItem key={`recent-${item.path}`} value={`recent ${item.label}`} onSelect={() => handleSelect(item.path, item.label)}>
                <Search className="h-4 w-4 mr-2 text-muted-foreground" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {Object.entries(filteredGroups).map(([group, items]) => (
          <CommandGroup key={group} heading={group.replace(/_/g, " ")}>
            {items.map((item) => (
              <CommandItem
                key={item.path}
                value={`${item.label} ${item.group}`}
                onSelect={() => handleSelect(item.path, item.label)}
              >
                <Navigation className="h-4 w-4 mr-2 text-muted-foreground" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground">
        <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border/50 font-mono">↑↓</kbd> Navigate</span>
        <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border/50 font-mono">↵</kbd> Go</span>
        <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border/50 font-mono">esc</kbd> Close</span>
      </div>
    </CommandDialog>
  );
}
