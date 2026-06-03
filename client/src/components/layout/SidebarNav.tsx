import { useMemo, useState } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/lib/nav-icons";
import { ChevronDown, Search, Star, Clock, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { findActiveNavItem, type NavGroup, type NavItem } from "@/config/nav-tree";
import type { RecentEntry } from "@/hooks/use-nav-favorites";

const OPEN_KEY = "ee_nav_open_groups";

function readOpenState(): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}");
  } catch {
    return {};
  }
}

export interface SidebarNavProps {
  groups: NavGroup[];
  location: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  pinned: string[];
  recents: RecentEntry[];
  isPinned: (path: string) => boolean;
  onTogglePin: (path: string) => void;
  onOpenSearch: () => void;
  onNavigate: (item: { path: string; label: string }) => void;
}

export function SidebarNav({
  groups, location, collapsed, onToggleCollapsed,
  pinned, recents, isPinned, onTogglePin, onOpenSearch, onNavigate,
}: SidebarNavProps) {
  const [openState, setOpenState] = useState<Record<string, boolean>>(readOpenState);

  const active = useMemo(() => findActiveNavItem(location, groups), [location, groups]);
  const activeGroupKey = active?.group.key;
  const activePath = active?.item.path;

  const itemByPath = useMemo(() => {
    const m = new Map<string, NavItem>();
    for (const g of groups) for (const it of g.items) m.set(it.path, it);
    return m;
  }, [groups]);

  const pinnedItems = pinned.map((p) => itemByPath.get(p)).filter(Boolean) as NavItem[];

  const toggleGroup = (key: string) => {
    setOpenState((prev) => {
      const next = { ...prev, [key]: prev[key] === false ? true : false };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const isGroupOpen = (key: string) => key === activeGroupKey || openState[key] !== false;

  const renderItem = (item: NavItem, opts?: { showStar?: boolean }) => {
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
            "relative flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors",
            collapsed ? "justify-center px-0 mx-1.5" : "px-3 mx-2",
            isActive
              ? "bg-sidebar-accent text-sidebar-primary font-medium"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          {isActive && !collapsed && (
            <span className="pointer-events-none absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-sidebar-primary" />
          )}
          <NavIcon iconKey={item.iconKey} className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </Link>
        {!collapsed && opts?.showStar !== false && (
          <button
            type="button"
            onClick={() => onTogglePin(item.path)}
            aria-label={isPinned(item.path) ? `Unpin ${item.label}` : `Pin ${item.label}`}
            className={cn(
              "absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 transition-opacity",
              isPinned(item.path)
                ? "text-amber-500 opacity-100"
                : "text-muted-foreground/50 opacity-0 group-hover/navitem:opacity-100 hover:text-amber-500",
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
      {/* Search trigger */}
      <div className="p-2">
        <button
          type="button"
          onClick={onOpenSearch}
          data-testid="sidebar-search-trigger"
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent",
            collapsed ? "justify-center px-0 py-2" : "px-3 py-2",
          )}
          title="Search — ⌘K"
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-border/60 bg-background/60 px-1 text-[10px]">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto pb-3">
        {/* Pinned */}
        {pinnedItems.length > 0 && (
          <Section heading="Pinned" icon={<Star className="h-3.5 w-3.5" />} collapsed={collapsed}>
            <ul className="space-y-0.5">{pinnedItems.map((it) => renderItem(it))}</ul>
          </Section>
        )}

        {/* Recent */}
        {!collapsed && recents.length > 0 && (
          <Section heading="Recent" icon={<Clock className="h-3.5 w-3.5" />} collapsed={collapsed}>
            <ul className="space-y-0.5">
              {recents.map((r) => {
                const it = itemByPath.get(r.path) ?? { id: `recent-${r.path}`, path: r.path, label: r.label };
                return renderItem(it as NavItem, { showStar: false });
              })}
            </ul>
          </Section>
        )}

        {/* Domain groups */}
        {groups.map((group) => {
          const open = isGroupOpen(group.key);
          return (
            <div key={group.key} className="mb-1" data-testid={`sidebar-group-${group.key}`}>
              {collapsed ? (
                <div className="my-2 flex justify-center text-muted-foreground/60" title={group.heading}>
                  <NavIcon iconKey={group.iconKey} className="h-4 w-4" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
                  {group.heading}
                </button>
              )}
              {(open || collapsed) && (
                <ul className="space-y-0.5">{group.items.map((it) => renderItem(it))}</ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
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

function Section({
  heading, icon, collapsed, children,
}: { heading: string; icon: React.ReactNode; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-2" data-testid={`sidebar-section-${heading.toLowerCase()}`}>
      {!collapsed && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {icon}
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}
