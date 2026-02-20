import { useState, useCallback, useEffect, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  ListTodo,
  Settings,
  Target,
  Plus,
  Search,
  Flag,
  HelpCircle,
  Focus,
  Keyboard,
  Command,
  Video,
} from "lucide-react";
import CommandStrip from "./CommandStrip";
import CommandPalette from "./CommandPalette";

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Priorities", path: "/company-priorities", icon: Flag },
  { label: "Meetings", path: "/my-tool/meetings", icon: Video },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
  { label: "Help", path: "/my-tool/help", icon: HelpCircle },
];

export default function MyToolLayout({
  children,
  onQuickAdd,
  onSearchChange,
  searchValue,
  onTaskSelect,
}: {
  children: ReactNode;
  onQuickAdd?: (text: string) => void;
  onSearchChange?: (text: string) => void;
  searchValue?: string;
  onTaskSelect?: (taskId: number) => void;
}) {
  const { user } = useAuth();
  const [location] = useLocation();
  const [quickAddText, setQuickAddText] = useState("");
  const [searchText, setSearchText] = useState(searchValue || "");
  const [showSearch, setShowSearch] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(() => {
    try { return localStorage.getItem("mytool_focus_mode") === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("mytool_focus_mode", String(focusMode)); } catch {}
  }, [focusMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
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

  const handlePaletteAction = useCallback((action: string, data?: any) => {
    if (action === "select_task" && data?.taskId) {
      onTaskSelect?.(data.taskId);
    } else if (action === "create_task") {
      const input = document.getElementById("mytool-quick-add") as HTMLInputElement;
      input?.focus();
    } else if (action === "select_priority" && data?.priorityId) {
      onTaskSelect?.(data.priorityId);
    }
  }, [onTaskSelect]);

  const handleCommandStripTaskClick = useCallback((taskId: number) => {
    onTaskSelect?.(taskId);
  }, [onTaskSelect]);

  return (
    <div className="h-full flex flex-col" data-testid="mytool-layout">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur-sm sticky top-0 z-30" data-testid="mytool-header">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-foreground" data-testid="text-page-title">
                My Tool
              </h1>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {format(new Date(), "EEEE, d MMMM")}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
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

              <div className="relative flex-1 max-w-xs hidden sm:block">
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
                onClick={() => setPaletteOpen(true)}
                title="Command Palette (⌘K)"
                data-testid="button-command-palette"
              >
                <Command className="h-4 w-4" />
              </Button>

              <Button
                variant={focusMode ? "default" : "ghost"}
                size="sm"
                className={`h-8 px-2.5 gap-1 text-xs ${focusMode ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                onClick={() => setFocusMode(!focusMode)}
                title="Focus Mode"
                data-testid="button-focus-mode"
              >
                <Focus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{focusMode ? "Focus" : "Focus"}</span>
              </Button>
            </div>
          </div>

          <nav className="flex gap-0.5 -mb-px overflow-x-auto" data-testid="nav-tabs">
            {navTabs.map((tab) => {
              const isActive =
                location === tab.path ||
                (tab.path === "/my-tool" && location === "/my-tool");
              return (
                <Link
                  key={tab.path}
                  href={tab.path}
                  data-testid={`nav-tab-${tab.label.toLowerCase()}`}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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

      <CommandStrip onTaskClick={handleCommandStripTaskClick} />

      <div className="flex-1 overflow-hidden">
        <div className="max-w-[1800px] mx-auto h-full">
          <main className="h-full overflow-y-auto p-4 sm:p-6" data-testid="mytool-main">
            {typeof children === "function"
              ? (children as any)({ focusMode })
              : children}
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAction={handlePaletteAction}
      />
    </div>
  );
}
