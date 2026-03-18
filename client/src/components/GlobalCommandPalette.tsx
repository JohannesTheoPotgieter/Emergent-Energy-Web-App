import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { Navigation, Search } from "lucide-react";

const NAV_ITEMS = PAGE_REGISTRY.filter(
  (p) => p.showInSidebar && p.routeComponentKey && !p.redirectTo
).map((p) => ({
  path: p.path,
  label: p.label,
  group: p.navGroup || "Other",
}));

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { canViewPath } = useAccessMatrix();

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

  const handleSelect = useCallback(
    (path: string) => {
      setOpen(false);
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
      <CommandInput placeholder="Search pages... (Ctrl+K)" />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        {Object.entries(groups).map(([group, items]) => (
          <CommandGroup key={group} heading={group.replace(/_/g, " ")}>
            {items.map((item) => (
              <CommandItem
                key={item.path}
                value={`${item.label} ${item.group}`}
                onSelect={() => handleSelect(item.path)}
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
