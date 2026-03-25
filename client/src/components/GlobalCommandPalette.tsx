import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { getAvailableQuickCreateActions } from "@/lib/action-access";
import { Navigation, Search, Plus, ArrowRight, Zap } from "lucide-react";

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
  const [, setLocation] = useLocation();
  const { canViewPath, canAccessEntityAction } = useAccessMatrix();

  const quickActions = useMemo(() => {
    return getAvailableQuickCreateActions({ canAccessEntityAction, canViewPath });
  }, [canAccessEntityAction, canViewPath]);

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

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search or take action... (Ctrl+K)" />
      <CommandList>
        <CommandEmpty>No pages or actions found.</CommandEmpty>

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
        {Object.entries(groups).map(([group, items]) => (
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
