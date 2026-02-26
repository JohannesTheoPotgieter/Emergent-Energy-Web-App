import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wrench,
  ShieldCheck,
  FileCheck,
  Clock,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Filter,
  User,
  FolderOpen,
} from "lucide-react";

type ApprovalType = "all" | "engineering" | "quality" | "deliverable";

interface ApprovalItem {
  id: string;
  type: "engineering" | "quality" | "deliverable";
  title: string;
  projectName: string;
  projectId: number | null;
  status: string;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  meta: Record<string, any>;
}

interface ApprovalsResponse {
  items: ApprovalItem[];
  counts: {
    engineering: number;
    quality: number;
    deliverable: number;
    total: number;
  };
}

const typeConfig = {
  engineering: {
    label: "Engineering Gate",
    icon: Wrench,
    color: "text-purple-600",
    bg: "bg-purple-50",
    badgeVariant: "outline" as const,
    badgeClass: "border-purple-300 text-purple-700 bg-purple-50",
  },
  quality: {
    label: "Quality Review",
    icon: ShieldCheck,
    color: "text-teal-600",
    bg: "bg-teal-50",
    badgeVariant: "outline" as const,
    badgeClass: "border-teal-300 text-teal-700 bg-teal-50",
  },
  deliverable: {
    label: "Deliverable",
    icon: FileCheck,
    color: "text-blue-600",
    bg: "bg-blue-50",
    badgeVariant: "outline" as const,
    badgeClass: "border-blue-300 text-blue-700 bg-blue-50",
  },
};

export default function AdminApprovalsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<ApprovalType>("all");

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const { data, isLoading, error } = useQuery<ApprovalsResponse>({
    queryKey: ["/api/approvals/pending"],
    queryFn: async () => {
      const res = await fetch("/api/approvals/pending", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch approvals");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const items = data?.items || [];
  const counts = data?.counts || { engineering: 0, quality: 0, deliverable: 0, total: 0 };
  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);

  function navigateToItem(item: ApprovalItem) {
    if (item.type === "engineering") {
      navigate(`/engineering/tasks?project=${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "quality") {
      navigate(`/quality?project=${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "deliverable") {
      navigate(`/project/${encodeURIComponent(item.projectName)}`);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-approvals-title">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pending approvals across all projects
          </p>
        </div>
        {counts.total > 0 && (
          <Badge variant="destructive" className="text-sm px-3 py-1" data-testid="badge-total-count">
            {counts.total} pending
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card
          className={`cursor-pointer transition-colors ${filter === "engineering" ? "ring-2 ring-purple-400" : ""}`}
          onClick={() => setFilter(filter === "engineering" ? "all" : "engineering")}
          data-testid="card-eng-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-50">
              <Wrench className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.engineering}</div>
              <div className="text-xs text-muted-foreground">Engineering Gates</div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${filter === "quality" ? "ring-2 ring-teal-400" : ""}`}
          onClick={() => setFilter(filter === "quality" ? "all" : "quality")}
          data-testid="card-qc-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-teal-50">
              <ShieldCheck className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.quality}</div>
              <div className="text-xs text-muted-foreground">Quality Reviews</div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${filter === "deliverable" ? "ring-2 ring-blue-400" : ""}`}
          onClick={() => setFilter(filter === "deliverable" ? "all" : "deliverable")}
          data-testid="card-del-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <FileCheck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.deliverable}</div>
              <div className="text-xs text-muted-foreground">Deliverables</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {filter !== "all" && (
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Showing: {typeConfig[filter].label}</span>
          <Button variant="ghost" size="sm" onClick={() => setFilter("all")} data-testid="button-clear-filter">
            Clear
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-loading">
          Loading approvals...
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-destructive" data-testid="text-error">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          Failed to load approvals
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center" data-testid="text-empty">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <h3 className="text-lg font-medium">All caught up</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {filter === "all"
                ? "No pending approvals across any category"
                : `No pending ${typeConfig[filter].label.toLowerCase()} approvals`}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(item => {
            const config = typeConfig[item.type];
            const Icon = config.icon;

            return (
              <Card
                key={item.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigateToItem(item)}
                data-testid={`card-approval-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${config.bg} mt-0.5`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate" data-testid={`text-title-${item.id}`}>
                          {item.title}
                        </span>
                        <Badge className={`text-[10px] ${config.badgeClass}`}>
                          {config.label}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {item.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FolderOpen className="w-3 h-3" />
                          {item.projectName}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {item.assignee}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(item.createdAt), "dd MMM yyyy")}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
