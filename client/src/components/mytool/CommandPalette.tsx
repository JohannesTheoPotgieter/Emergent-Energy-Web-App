import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Search,
  FolderOpen,
  ListTodo,
  Flag,
  Mail,
  Navigation,
  Plus,
  ArrowRight,
} from "lucide-react";

interface SearchResult {
  type: "task" | "project" | "priority" | "email" | "route" | "action";
  id: string;
  title: string;
  subtitle?: string;
  icon: typeof Search;
}

const NAV_ROUTES: SearchResult[] = [
  { type: "route", id: "/my-tool", title: "My Tool — Today", icon: Navigation },
  { type: "route", id: "/my-tool/week", title: "My Tool — Week", icon: Navigation },
  { type: "route", id: "/my-tool/backlog", title: "My Tool — Backlog", icon: Navigation },
  { type: "route", id: "/company-priorities", title: "Company Priorities", icon: Navigation },
  { type: "route", id: "/my-tool/cockpit", title: "My Tool — Cockpit", icon: Navigation },
  { type: "route", id: "/my-tool/settings", title: "My Tool — Settings", icon: Navigation },
  { type: "route", id: "/projects", title: "Projects Summary", icon: Navigation },
  { type: "route", id: "/lifecycle-board", title: "Lifecycle Board", icon: Navigation },
  { type: "route", id: "/engineering", title: "Engineering Dashboard", icon: Navigation },
  { type: "route", id: "/engineering/tasks", title: "Engineering Tasks", icon: Navigation },
  { type: "route", id: "/quality", title: "Quality Dashboard", icon: Navigation },
];

const ACTIONS: SearchResult[] = [
  { type: "action", id: "create_task", title: "Create task", subtitle: "Add a new task", icon: Plus },
  { type: "action", id: "create_priority", title: "Create priority", subtitle: "Add a new company priority", icon: Plus },
];

function CommandPalette({
  open,
  onClose,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  onAction?: (action: string, data?: any) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ["/api/mytool/tasks"],
    enabled: open,
    staleTime: 30_000,
  });

  const { data: priorities = [] } = useQuery<any[]>({
    queryKey: ["/api/mytool/company-priorities"],
    enabled: open,
    staleTime: 30_000,
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["/api/projects-summary"],
    enabled: open,
    staleTime: 60_000,
  });

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [...ACTIONS.slice(0, 2), ...NAV_ROUTES.slice(0, 5)];

    const out: SearchResult[] = [];

    for (const a of ACTIONS) {
      if (a.title.toLowerCase().includes(q)) out.push(a);
    }

    for (const r of NAV_ROUTES) {
      if (r.title.toLowerCase().includes(q)) out.push(r);
    }

    for (const t of tasks) {
      const title = t.title || "";
      if (title.toLowerCase().includes(q)) {
        out.push({
          type: "task",
          id: String(t.id),
          title: title,
          subtitle: t.status,
          icon: ListTodo,
        });
      }
      if (out.length >= 20) break;
    }

    for (const p of priorities) {
      const title = p.title || "";
      if (title.toLowerCase().includes(q)) {
        out.push({
          type: "priority",
          id: String(p.id),
          title: title,
          subtitle: p.severity,
          icon: Flag,
        });
      }
      if (out.length >= 25) break;
    }

    for (const p of projects) {
      const name = p.project_name || p.projectName || "";
      if (name.toLowerCase().includes(q)) {
        out.push({
          type: "project",
          id: name,
          title: name.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          subtitle: "Project",
          icon: FolderOpen,
        });
      }
      if (out.length >= 30) break;
    }

    return out.slice(0, 15);
  }, [query, tasks, priorities, projects]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback((result: SearchResult) => {
    onClose();
    switch (result.type) {
      case "route":
        setLocation(result.id);
        break;
      case "task":
        onAction?.("select_task", { taskId: Number(result.id) });
        break;
      case "priority":
        onAction?.("select_priority", { priorityId: Number(result.id) });
        break;
      case "project":
        setLocation(`/project/${encodeURIComponent(result.id)}`);
        break;
      case "action":
        onAction?.(result.id);
        break;
    }
  }, [onClose, setLocation, onAction]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      e.preventDefault();
      handleSelect(results[selectedIdx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }, [results, selectedIdx, handleSelect, onClose]);

  if (!open) return null;

  const typeIcons: Record<string, typeof Search> = {
    task: ListTodo,
    project: FolderOpen,
    priority: Flag,
    email: Mail,
    route: Navigation,
    action: Plus,
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" data-testid="command-palette-overlay">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden" data-testid="command-palette">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, priorities, or type a command..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            data-testid="input-command-search"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground border border-border/50">
            ESC
          </kbd>
        </div>

        <div className="max-h-[400px] overflow-y-auto py-2" data-testid="command-results">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            results.map((r, i) => {
              const Icon = r.icon || typeIcons[r.type] || Search;
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIdx ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                  }`}
                  onClick={() => handleSelect(r)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  data-testid={`command-result-${r.type}-${r.id}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{r.title}</p>
                    {r.subtitle && (
                      <p className="text-[11px] text-muted-foreground truncate">{r.subtitle}</p>
                    )}
                  </div>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
                    {r.type}
                  </span>
                  {i === selectedIdx && <ArrowRight className="h-3 w-3 text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground">
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border/50 font-mono">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border/50 font-mono">↵</kbd> Select</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border/50 font-mono">esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

export default memo(CommandPalette);
