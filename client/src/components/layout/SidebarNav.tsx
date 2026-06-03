import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/lib/nav-icons";
import { ChevronDown, Search, Star, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { findActiveNavItem, type NavGroup, type NavItem } from "@/config/nav-tree";

export interface SidebarNavProps {
  groups: NavGroup[];
  location: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  pinned: string[];
  isPinned: (path: string) => boolean;
  onTogglePin: (path: string) => void;
  onOpenSearch: () => void;
  onNavigate: (item: { path: string; label: string }) => void;
}

export function SidebarNav({
  groups, location, collapsed, onToggleCollapsed,
  pinned, isPinned, onTogglePin, onOpenSearch, onNavigate,
}: SidebarNavProps) {
  const active = useMemo(() => findActiveNavItem(location, groups), [location, groups]);
  const activeGroupKey = active?.group.key ?? null;
  const activePath = active?.item.path ?? null;

  // Accordion: one section open at a time. It follows the active section on
  // navigation; the user can open another or collapse the current one.
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupKey);
  useEffect(() => { if (activeGroupKey) setOpenGroup(activeGroupKey); }, [activeGroupKey]);

  const itemByPath = useMemo(() => {
    const m = new Map<string, NavItem>();
    for (const g of groups) for (const it of g.items) m.set(it.path, it);
    return m;
  }, [groups]);
  const pinnedItems = pinned.map((p) => itemByPath.get(p)).filter(Boolean) as NavItem[];

  const renderItem = (item: NavItem) => {
    const isActive = item.path === activePath;
    return (
      <li key={item.id} className="group/navitem relative">
        <Link
          href={item.path}
          aria-current={isActive ? "page" : undefined}
          data-testid={`sidebar-nav-item-${item.id}`}
          title={collapsed ? item.label : undefined}
          onClick={() => onNavigate(item)}
          className={cn(
            "flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors",
            collapsed ? "mx-1.5 justify-center px-0" : "mx-2 pl-9 pr-7",
            isActive
              ? "bg-sidebar-accent font-medium text-sidebar-primary"
              : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <NavIcon iconKey={item.iconKey} className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={() => onTogglePin(item.path)}
            aria-label={isPinned(item.path) ? `Unpin ${item.label}` : `Pin ${item.label}`}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 transition-opacity",
              isPinned(item.path)
                ? "text-amber-500 opacity-100"
                : "text-muted-foreground/40 opacity-0 hover:text-amber-500 group-hover/navitem:opacity-100",
            )}
          >
            <Star className="h-3.5 w-3.5" fill={isPinned(item.path) ? "currentColor" : "none"} />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground" data-testid="sidebar-nav">
      {/* Search */}
      <div className="p-2">
        <button
          type="button"
          onClick={onOpenSearch}
          data-testid="sidebar-search-trigger"
          title="Search — ⌘K"
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent",
            collapsed ? "justify-center px-0 py-2" : "px-3 py-2",
          )}
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded border border-border/60 bg-background/60 px-1 text-[10px]">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto pb-3">
        {/* Pinned (only when the user has pinned something) */}
        {pinnedItems.length > 0 && (
          <div className="mb-2">
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">Pinned</div>
            )}
            <ul className="space-y-0.5">{pinnedItems.map(renderItem)}</ul>
          </div>
        )}

        {groups.map((group) => {
          const open = !collapsed && openGroup === group.key;
          if (collapsed) {
            // Icon rail: one icon per section, linking to its first screen.
            const first = group.items[0];
            const isActiveGroup = activeGroupKey === group.key;
            return (
              <Link
                key={group.key}
                href={first.path}
                title={group.heading}
                data-testid={`sidebar-group-${group.key}`}
                onClick={() => onNavigate(first)}
                className={cn(
                  "mx-1.5 my-0.5 flex justify-center rounded-md py-2 transition-colors",
                  isActiveGroup ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60",
                )}
              >
                <NavIcon iconKey={group.iconKey} className="h-4 w-4" />
              </Link>
            );
          }
          return (
            <div key={group.key} data-testid={`sidebar-group-${group.key}`}>
              <button
                type="button"
                onClick={() => setOpenGroup((prev) => (prev === group.key ? null : group.key))}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors mx-0",
                  open ? "text-sidebar-foreground font-medium" : "text-sidebar-foreground/75 hover:text-sidebar-foreground",
                )}
              >
                <NavIcon iconKey={group.iconKey} className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{group.heading}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/60 transition-transform", !open && "-rotate-90")} />
              </button>
              {open && <ul className="space-y-0.5 pb-1">{group.items.map(renderItem)}</ul>}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-collapse-toggle"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );
}
