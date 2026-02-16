import { useState, useCallback, useEffect, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  ListTodo,
  Settings,
  Target,
  Plus,
  Search,
  PanelRightClose,
  PanelRightOpen,
  Flag,
  Zap,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  X,
  Keyboard,
} from "lucide-react";

type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";

interface SidebarTask {
  id: number;
  title: string;
  nextStep: string | null;
  priority: string;
  status: TaskStatus;
  dueAt: string | null;
  projectName: string | null;
  blockedReason: string | null;
  pinnedToday: boolean;
}

interface CompanyPriority {
  id: number;
  title: string;
  severity: string;
  status: string;
  linkedProjectName: string | null;
  department: string | null;
}

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
];

const priorityLabels: Record<string, string> = {
  critical: "P1",
  high: "P2",
  normal: "P3",
  low: "P4",
};

const priorityDotColors: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-slate-400",
};

export default function MyToolLayout({
  children,
  onQuickAdd,
  onSearchChange,
  searchValue,
}: {
  children: ReactNode;
  onQuickAdd?: (text: string) => void;
  onSearchChange?: (text: string) => void;
  searchValue?: string;
}) {
  const { user } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quickAddText, setQuickAddText] = useState("");
  const [searchText, setSearchText] = useState(searchValue || "");
  const [showSearch, setShowSearch] = useState(false);

  const { data: allTasks = [] } = useQuery<SidebarTask[]>({
    queryKey: ["/api/mytool/tasks"],
    select: (data: any[]) => data.map((t: any) => ({
      id: t.id,
      title: t.title,
      nextStep: t.nextStep || t.next_step || null,
      priority: t.priority,
      status: t.status,
      dueAt: t.dueAt || t.due_at || null,
      projectName: t.projectName || t.project_name || null,
      blockedReason: t.blockedReason || t.blocked_reason || null,
      pinnedToday: t.pinnedToday || t.pinned_today || false,
    })),
  });

  const { data: priorities = [] } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
    select: (data: any[]) => data.filter((p: any) => p.status === "active"),
  });

  const nextActions = allTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled" && t.nextStep && t.nextStep.trim()
  ).sort((a, b) => {
    const po: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    return (po[a.priority] ?? 2) - (po[b.priority] ?? 2);
  }).slice(0, 7);

  const blockedTasks = allTasks.filter(
    (t) => t.status === "blocked" || t.status === "waiting"
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const input = document.getElementById("mytool-quick-add") as HTMLInputElement;
        input?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleQuickAdd = useCallback(() => {
    const text = quickAddText.trim();
    if (!text) return;
    onQuickAdd?.(text);
    setQuickAddText("");
  }, [quickAddText, onQuickAdd]);

  return (
    <div className="h-full flex flex-col" data-testid="mytool-layout">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur-sm sticky top-0 z-30" data-testid="mytool-header">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-foreground" data-testid="text-page-title">
                My Tool
              </h1>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {format(new Date(), "EEEE, d MMMM")}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {showSearch ? (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tasks..."
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      onSearchChange?.(e.target.value);
                    }}
                    className="pl-8 h-8 w-48 text-sm"
                    autoFocus
                    onBlur={() => { if (!searchText) setShowSearch(false); }}
                    onKeyDown={(e) => { if (e.key === "Escape") { setShowSearch(false); setSearchText(""); onSearchChange?.(""); } }}
                    data-testid="input-global-search"
                  />
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowSearch(true)} data-testid="button-search-toggle">
                  <Search className="h-4 w-4" />
                </Button>
              )}

              <div className="relative flex-1 max-w-sm hidden sm:block">
                <Input
                  id="mytool-quick-add"
                  placeholder="Quick add... (⌘K)"
                  value={quickAddText}
                  onChange={(e) => setQuickAddText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && quickAddText.trim()) handleQuickAdd(); }}
                  className="h-8 text-sm pr-8"
                  data-testid="input-quick-add-global"
                />
                {quickAddText && (
                  <Button
                    variant="ghost" size="sm"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={handleQuickAdd}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <Button
                variant="ghost" size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                data-testid="button-toggle-sidebar"
              >
                {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <nav className="flex gap-1 -mb-px" data-testid="nav-tabs">
            {navTabs.map((tab) => {
              const isActive =
                location === tab.path ||
                (tab.path === "/my-tool" && location === "/my-tool");
              return (
                <Link
                  key={tab.path}
                  href={tab.path}
                  data-testid={`nav-tab-${tab.label.toLowerCase()}`}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="max-w-[1600px] mx-auto h-full flex">
          <main className={`flex-1 overflow-y-auto p-4 sm:p-6 transition-all ${sidebarOpen ? "pr-0 sm:pr-0" : ""}`}>
            {children}
          </main>

          {sidebarOpen && (
            <aside
              className="w-72 border-l border-border/40 overflow-y-auto p-4 space-y-5 hidden lg:block shrink-0 bg-muted/20"
              data-testid="mytool-sidebar"
            >
              {priorities.length > 0 && (
                <section data-testid="sidebar-priorities">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Flag className="h-3.5 w-3.5 text-red-500" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priorities</h3>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">{priorities.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {priorities.slice(0, 7).map((p) => (
                      <div
                        key={p.id}
                        className="px-2.5 py-1.5 rounded-md bg-background border border-border/50 hover:border-border transition-colors"
                        data-testid={`sidebar-priority-${p.id}`}
                      >
                        <p className="text-xs font-medium text-foreground truncate">{p.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                            p.severity === "critical" ? "bg-red-500" : p.severity === "important" ? "bg-amber-500" : "bg-blue-500"
                          }`} />
                          <span className="text-[10px] text-muted-foreground capitalize">{p.severity}</span>
                          {p.linkedProjectName && (
                            <Link
                              href={`/project/${encodeURIComponent(p.linkedProjectName)}`}
                              className="text-[10px] text-primary hover:underline truncate ml-auto"
                            >
                              {p.linkedProjectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {nextActions.length > 0 && (
                <section data-testid="sidebar-next-actions">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next Actions</h3>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">{nextActions.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {nextActions.map((t) => (
                      <div
                        key={t.id}
                        className="px-2.5 py-1.5 rounded-md bg-background border border-border/50"
                        data-testid={`sidebar-next-action-${t.id}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${priorityDotColors[t.priority] || "bg-blue-500"}`} />
                          <p className="text-xs text-foreground truncate flex-1">{t.title}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{priorityLabels[t.priority] || "P3"}</span>
                        </div>
                        <p className="text-[10px] text-primary mt-0.5 truncate pl-3">→ {t.nextStep}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {blockedTasks.length > 0 && (
                <section data-testid="sidebar-blocked">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Blocked</h3>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">{blockedTasks.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {blockedTasks.map((t) => (
                      <div
                        key={t.id}
                        className="px-2.5 py-1.5 rounded-md bg-destructive/5 border border-destructive/20"
                        data-testid={`sidebar-blocked-${t.id}`}
                      >
                        <p className="text-xs font-medium text-foreground truncate">{t.title}</p>
                        {t.blockedReason && (
                          <p className="text-[10px] text-destructive mt-0.5 truncate">{t.blockedReason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {priorities.length === 0 && nextActions.length === 0 && blockedTasks.length === 0 && (
                <div className="text-center py-8" data-testid="sidebar-empty">
                  <Target className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No priorities or actions yet.</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Add tasks and set next steps to see them here.</p>
                </div>
              )}

              <div className="pt-3 border-t border-border/40">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Keyboard className="h-3 w-3" />
                  <span>⌘K Quick Add · ⌘⏎ Save · 1/2/3 Priority</span>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
