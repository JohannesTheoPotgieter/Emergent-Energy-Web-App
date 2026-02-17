import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Wallet,
  TrendingUp,
  Target,
  BarChart3,
  Kanban,
  AlertTriangle,
  Settings,
  ArrowRight,
  Flag,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuickLink {
  label: string;
  description: string;
  icon: any;
  path: string;
  color: string;
  bg: string;
}

interface CompanyPriority {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  horizon: string;
  ownerRole: string | null;
  linkedProjectName: string | null;
  severity: string;
  status: string;
}

const currentLinks: QuickLink[] = [
  {
    label: "Dashboard",
    description: "High-priority actions, milestones, and PM summary",
    icon: LayoutDashboard,
    path: "/dashboard",
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 hover:border-blue-400",
  },
  {
    label: "Project Summary",
    description: "All projects with progress, financials, and status",
    icon: FileSpreadsheet,
    path: "/projects",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400",
  },
  {
    label: "Cashflow",
    description: "Weekly cashflow with inflow/outflow detail and forecast",
    icon: Wallet,
    path: "/cashflow",
    color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 hover:border-violet-400",
  },
  {
    label: "COS Tracker",
    description: "Monthly cost of sales: planned vs realised vs budget",
    icon: TrendingUp,
    path: "/cos",
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:border-amber-400",
  },
];

const wipLinks: QuickLink[] = [
  {
    label: "COS Control",
    description: "What-if scenario analysis for invoice date shifting",
    icon: Target,
    path: "/cos-control",
    color: "text-rose-600",
    bg: "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 hover:border-rose-400",
  },
  {
    label: "Forecast",
    description: "Line-item driven weekly cashflow forecast",
    icon: BarChart3,
    path: "/cashflow-forecast",
    color: "text-cyan-600",
    bg: "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 hover:border-cyan-400",
  },
  {
    label: "Planning",
    description: "Resource capacity, scheduling, and clash detection",
    icon: Kanban,
    path: "/planning",
    color: "text-indigo-600",
    bg: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400",
  },
  {
    label: "Risks & Flags",
    description: "Data quality issues and actionable risk flags",
    icon: AlertTriangle,
    path: "/risks-flags",
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 hover:border-orange-400",
  },
];

const severityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  important: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  normal: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
};

const severityDots: Record<string, string> = {
  critical: "bg-red-500",
  important: "bg-amber-500",
  normal: "bg-blue-500",
};

function NavTile({ link }: { link: QuickLink }) {
  return (
    <Link href={link.path} data-testid={`tile-${link.label.toLowerCase().replace(/\s+/g, '-')}`}>
      <Card className={`${link.bg} border transition-all duration-200 cursor-pointer hover:shadow-md group h-full`}>
        <CardContent className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className={`p-2.5 rounded-lg bg-white/60 dark:bg-white/10 ${link.color}`}>
              <link.icon className="h-6 w-6" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div>
            <h3 className="font-semibold text-base">{link.label}</h3>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{link.description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CompanyPrioritiesSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSeverity, setEditSeverity] = useState("normal");
  const [editDepartment, setEditDepartment] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSeverity, setNewSeverity] = useState("normal");
  const [newDepartment, setNewDepartment] = useState("");

  const { data: priorities = [], isLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
  });

  const activePriorities = priorities.filter(p => p.status === "active");

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/mytool/company-priorities", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      setShowAdd(false);
      setNewTitle("");
      setNewSeverity("normal");
      setNewDepartment("");
      toast({ title: "Priority Added" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      setEditingId(null);
      toast({ title: "Priority Updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/mytool/company-priorities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      toast({ title: "Priority Removed" });
    },
  });

  const startEdit = (p: CompanyPriority) => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditSeverity(p.severity);
    setEditDepartment(p.department || "");
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (activePriorities.length === 0 && !isAdmin) return null;

  return (
    <Card className="border-red-200 dark:border-red-900/50 bg-gradient-to-br from-red-50/50 to-orange-50/30 dark:from-red-950/20 dark:to-orange-950/10" data-testid="company-priorities-section">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/40">
              <Flag className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <CardTitle className="text-base">Company Priorities</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activePriorities.length} active {activePriorities.length === 1 ? "priority" : "priorities"}
              </p>
            </div>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowAdd(!showAdd)}
              data-testid="button-add-priority"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Priority
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isAdmin && showAdd && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-background" data-testid="priority-add-form">
            <Input
              placeholder="Priority title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) {
                  createMutation.mutate({ title: newTitle.trim(), severity: newSeverity, department: newDepartment || undefined });
                }
                if (e.key === "Escape") setShowAdd(false);
              }}
              data-testid="input-new-priority-title"
            />
            <Input
              placeholder="Dept"
              value={newDepartment}
              onChange={(e) => setNewDepartment(e.target.value)}
              className="h-8 text-sm w-24"
              data-testid="input-new-priority-dept"
            />
            <Select value={newSeverity} onValueChange={setNewSeverity}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-new-priority-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="important">Important</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 w-8 p-0"
              disabled={!newTitle.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ title: newTitle.trim(), severity: newSeverity, department: newDepartment || undefined })}
              data-testid="button-save-new-priority"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowAdd(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {activePriorities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No active company priorities. {isAdmin ? "Click \"Add Priority\" to create one." : ""}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activePriorities.map((p) => (
              <div
                key={p.id}
                className="flex items-start gap-3 p-3 rounded-lg border bg-background hover:shadow-sm transition-shadow"
                data-testid={`priority-card-${p.id}`}
              >
                {editingId === p.id && isAdmin ? (
                  <div className="flex-1 space-y-2">
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editTitle.trim()) {
                          updateMutation.mutate({ id: p.id, data: { title: editTitle.trim(), severity: editSeverity, department: editDepartment || null } });
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      data-testid="input-edit-priority-title"
                    />
                    <div className="flex gap-1.5">
                      <Input
                        value={editDepartment}
                        onChange={(e) => setEditDepartment(e.target.value)}
                        placeholder="Dept"
                        className="h-7 text-xs w-20"
                        data-testid="input-edit-priority-dept"
                      />
                      <Select value={editSeverity} onValueChange={setEditSeverity}>
                        <SelectTrigger className="h-7 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="critical">Critical</SelectItem>
                          <SelectItem value="important">Important</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={!editTitle.trim() || updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: p.id, data: { title: editTitle.trim(), severity: editSeverity, department: editDepartment || null } })}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingId(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${severityDots[p.severity] || "bg-blue-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-priority-title-${p.id}`}>{p.title}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge variant="secondary" className={`text-[10px] h-4 px-1.5 ${severityColors[p.severity] || ""}`}>
                          {p.severity}
                        </Badge>
                        {p.department && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5">{p.department}</Badge>
                        )}
                        {p.linkedProjectName && (
                          <Link
                            href={`/project/${encodeURIComponent(p.linkedProjectName)}`}
                            className="text-[10px] text-primary hover:underline truncate"
                          >
                            {p.linkedProjectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                          </Link>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={() => startEdit(p)} data-testid={`button-edit-priority-${p.id}`}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(p.id)} data-testid={`button-delete-priority-${p.id}`}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { isAdmin } = useAuth();
  return (
    <div className="space-y-8" data-testid="home-page">
      <div>
        <h1 className="text-3xl font-bold">Emergent Energy Dashboard</h1>
        <p className="text-muted-foreground mt-1">Navigate to the section you need below.</p>
      </div>

      <CompanyPrioritiesSection isAdmin={isAdmin} />

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Current</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {currentLinks.map((link) => (
            <NavTile key={link.path} link={link} />
          ))}
        </div>
      </div>

      {isAdmin && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Work in Progress</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {wipLinks.map((link) => (
              <NavTile key={link.path} link={link} />
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Admin</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NavTile link={{
              label: "Admin",
              description: "Upload trackers, manage users, and system settings",
              icon: Settings,
              path: "/admin",
              color: "text-slate-600",
              bg: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800 hover:border-slate-400",
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
