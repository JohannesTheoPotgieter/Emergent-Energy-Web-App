import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Edit2,
  Flame,
  FolderKanban,
  GripVertical,
  Layers3,
  Link2,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Users,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import {
  buildMicrosoftBreakdownItems,
  filterProjectLifecycleClients,
  filterProjectLifecycleProjects,
  getProjectGateVariant,
  sortProjectsByLatestUpdate,
  type ProjectLifecycleWorkspaceClient,
  type ProjectLifecycleWorkspacePayload,
  type ProjectLifecycleWorkspaceProject,
} from "@/lib/project-lifecycle-workspace";

type WorkspaceSection = "overview" | "stage-gates" | "latest-updates" | "client-overview";

const SECTION_LINKS: Array<{ key: string; label: string; path: string }> = [
  { key: "overview", label: "Overview", path: "/project-lifecycle" },
  { key: "lifecycle", label: "Lifecycle", path: "/lifecycle-board" },
  { key: "project-list", label: "Project List", path: "/projects" },
  { key: "stage-gates", label: "Stage Gates", path: "/project-lifecycle/stage-gates" },
  { key: "latest-updates", label: "Latest Updates", path: "/project-lifecycle/latest-updates" },
  { key: "clients", label: "Clients", path: "/clients" },
  { key: "client-overview", label: "Client Overview", path: "/project-lifecycle/client-overview" },
];

const GATE_VARIANT_ORDER: Record<ReturnType<typeof getProjectGateVariant>, number> = {
  blocked: 0,
  pending: 1,
  eligible: 2,
  enabled: 3,
};

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDateTime(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExecutionGateStatus(status: string | null) {
  if (!status) return "Unknown";
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function gateVariantClasses(variant: ReturnType<typeof getProjectGateVariant>) {
  if (variant === "enabled") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (variant === "eligible") return "bg-cyan-50 text-cyan-700 border-cyan-200";
  if (variant === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function stageBarWidth(count: number, maxCount: number) {
  if (maxCount <= 0) return "0%";
  return `${Math.max((count / maxCount) * 100, 8)}%`;
}

function MetricCard({
  title,
  value,
  helper,
  icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{helper}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceSubnav({ activeSection }: { activeSection: WorkspaceSection }) {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-wrap gap-2" data-testid="project-lifecycle-subnav">
      {SECTION_LINKS.map((item) => {
        const isActive =
          (item.key === "overview" && activeSection === "overview") ||
          (item.key === "stage-gates" && activeSection === "stage-gates") ||
          (item.key === "latest-updates" && activeSection === "latest-updates") ||
          (item.key === "client-overview" && activeSection === "client-overview");
        return (
          <Button
            key={item.path}
            variant={isActive ? "default" : "outline"}
            size="sm"
            className={isActive ? "bg-cyan-700 hover:bg-cyan-800" : ""}
            onClick={() => setLocation(item.path)}
            data-testid={`project-lifecycle-link-${item.key}`}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}

function ProjectLifecycleRow({
  project,
  compact = false,
}: {
  project: ProjectLifecycleWorkspaceProject;
  compact?: boolean;
}) {
  const [, setLocation] = useLocation();
  const gateVariant = getProjectGateVariant(project);

  return (
    <button
      type="button"
      onClick={() => setLocation(`/project/${encodeURIComponent(project.projectName)}`)}
      className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-cyan-200 hover:bg-cyan-50/40"
      data-testid={`project-lifecycle-row-${project.projectInfoId}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-semibold text-foreground">{project.projectName}</span>
            <Badge variant="outline" className={gateVariantClasses(gateVariant)}>
              {project.stageGate.executionEnabled ? "Execution Enabled" : formatExecutionGateStatus(project.stageGate.executionGateStatus)}
            </Badge>
            {project.clientName ? (
              <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                {project.clientName}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Stage: <span className="font-medium text-foreground">{project.lifecycleStageLabel || "Unassigned"}</span></span>
            <span>PM: <span className="font-medium text-foreground">{project.pmName || "Unassigned"}</span></span>
            <span>PD: <span className="font-medium text-foreground">{project.pdName || "Unassigned"}</span></span>
            <span>History: <span className="font-medium text-foreground">{project.stageHistory.count}</span></span>
            <span>MS linked: <span className="font-medium text-foreground">{project.microsoft.totalLinkedItems}</span></span>
          </div>
          {!compact ? (
            <p className="text-sm text-muted-foreground">
              {project.latestUpdate.text || "No canonical latest update captured yet."}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap gap-1">
            {project.departments.length > 0 ? project.departments.map((department) => (
              <Badge key={department} variant="outline" className="border-cyan-100 bg-cyan-50 text-cyan-700">
                {department.replace(/_/g, " ")}
              </Badge>
            )) : (
              <Badge variant="outline">No department coverage</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Latest update: {formatDateTime(project.latestUpdate.updatedAt)}
          </div>
        </div>
      </div>
    </button>
  );
}

function ClientOverviewRow({ client }: { client: ProjectLifecycleWorkspaceClient }) {
  const [, setLocation] = useLocation();

  return (
    <button
      type="button"
      onClick={() => setLocation("/project-lifecycle/client-overview")}
      className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-cyan-200 hover:bg-cyan-50/40"
      data-testid={`project-lifecycle-client-${client.clientId}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">{client.clientName}</span>
            <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
              {client.clientCode}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Projects: <span className="font-medium text-foreground">{client.projectCount}</span></span>
            <span>Active: <span className="font-medium text-foreground">{client.activeProjectCount}</span></span>
            <span>MS linked: <span className="font-medium text-foreground">{client.microsoftLinkedItems}</span></span>
          </div>
          <p className="text-sm text-muted-foreground">
            Latest project activity: {client.latestUpdateProjectName || "No linked project yet"}
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap gap-1">
            {client.lifecycleStages.length > 0 ? client.lifecycleStages.map((stage) => (
              <Badge key={stage} variant="outline" className="border-emerald-100 bg-emerald-50 text-emerald-700">
                {stage}
              </Badge>
            )) : (
              <Badge variant="outline">No lifecycle spread yet</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {client.departmentCoverage.length > 0 ? client.departmentCoverage.map((department) => (
              <Badge key={department} variant="outline" className="border-cyan-100 bg-cyan-50 text-cyan-700">
                {department.replace(/_/g, " ")}
              </Badge>
            )) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function normalizeClientName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function signalToneClasses(tone: "slate" | "emerald" | "amber" | "rose" | "cyan") {
  if (tone === "emerald") return "border-emerald-100 bg-emerald-50 text-emerald-900";
  if (tone === "amber") return "border-amber-100 bg-amber-50 text-amber-900";
  if (tone === "rose") return "border-rose-100 bg-rose-50 text-rose-900";
  if (tone === "cyan") return "border-cyan-100 bg-cyan-50 text-cyan-900";
  return "border-slate-200 bg-slate-50 text-slate-900";
}

function ClientSignalPanel({
  title,
  summary,
  helper,
  tone = "slate",
}: {
  title: string;
  summary: string;
  helper: string;
  tone?: "slate" | "emerald" | "amber" | "rose" | "cyan";
}) {
  return (
    <div className={`rounded-2xl border p-4 ${signalToneClasses(tone)}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
      <p className="mt-2 text-lg font-semibold">{summary}</p>
      <p className="mt-1 text-sm opacity-80">{helper}</p>
    </div>
  );
}

function ClientWorkspaceListItem({
  client,
  isSelected,
  onSelect,
}: {
  client: ProjectLifecycleWorkspaceClient;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
        isSelected
          ? "border-cyan-300 bg-cyan-50/80 shadow-sm"
          : "border-border bg-card hover:border-cyan-200 hover:bg-cyan-50/40"
      }`}
      data-testid={`client-workspace-select-${client.clientId}`}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{client.clientName}</p>
            <p className="text-xs text-muted-foreground">{client.clientCode}</p>
          </div>
          <Badge variant="outline" className="shrink-0 bg-slate-50 text-slate-700 border-slate-200">
            {client.projectCount} project{client.projectCount === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {client.lifecycleDistribution.length > 0 ? (
            client.lifecycleDistribution.slice(0, 3).map((item) => (
              <Badge key={`${client.clientId}-${item.stage}`} variant="outline" className="border-emerald-100 bg-emerald-50 text-emerald-700">
                {item.stage} ({item.count})
              </Badge>
            ))
          ) : (
            <Badge variant="outline">No linked projects yet</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Latest activity: {client.latestUpdateProjectName || "No canonical update yet"}
        </p>
      </div>
    </button>
  );
}

function ClientLinkedProjectRow({
  project,
}: {
  project: ProjectLifecycleWorkspaceClient["linkedProjects"][number];
}) {
  const [, setLocation] = useLocation();
  const gateVariant = project.executionEnabled
    ? "enabled"
    : ((project.executionGateStatus || "").toUpperCase() === "ELIGIBLE" ? "eligible" : "blocked");

  return (
    <button
      type="button"
      onClick={() => setLocation(`/project/${encodeURIComponent(project.projectName)}`)}
      className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-cyan-200 hover:bg-cyan-50/40"
      data-testid={`client-linked-project-${project.projectInfoId}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{project.projectName}</span>
            {project.lifecycleStageLabel ? <Badge variant="outline">{project.lifecycleStageLabel}</Badge> : null}
            <Badge variant="outline" className={gateVariantClasses(gateVariant)}>
              {project.executionEnabled
                ? "Execution Enabled"
                : formatExecutionGateStatus(project.executionGateStatus)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {project.latestUpdateText || "No canonical latest update captured yet."}
          </p>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Revenue: <span className="font-medium text-foreground">{formatCurrency(project.totalRevenue)}</span></span>
            <span>Cost: <span className="font-medium text-foreground">{formatCurrency(project.totalCost)}</span></span>
            <span>Pending approvals: <span className="font-medium text-foreground">{project.pendingApprovals}</span></span>
            <span>Overdue work: <span className="font-medium text-foreground">{project.overdueWorkItems}</span></span>
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap gap-1">
            {project.ragStatus ? (
              <Badge variant="outline" className="border-amber-100 bg-amber-50 text-amber-700">
                RAG {project.ragStatus}
              </Badge>
            ) : null}
            {project.escalationLevel ? (
              <Badge variant="outline" className="border-rose-100 bg-rose-50 text-rose-700">
                {project.escalationLevel}
              </Badge>
            ) : null}
            {project.microsoftLinkedItems > 0 ? (
              <Badge variant="outline" className="border-cyan-100 bg-cyan-50 text-cyan-700">
                {project.microsoftLinkedItems} Microsoft
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Latest update: {formatDateTime(project.latestUpdateAt)}
          </p>
        </div>
      </div>
    </button>
  );
}

function ClientOverviewDetail({ client }: { client: ProjectLifecycleWorkspaceClient }) {
  const [, setLocation] = useLocation();
  const maxLifecycleCount = Math.max(...(client.lifecycleDistribution.map((item) => item.count) || [1]), 1);
  const microsoftItems = buildMicrosoftBreakdownItems(client.microsoft.byType);
  const riskSummary = `${client.signals.risk.blockedProjects} blocked, ${client.signals.risk.escalatedProjects} escalated`;
  const qualitySummary = `${client.signals.quality.pendingApprovals} approvals pending, ${client.signals.quality.inReviewDeliverables} in review`;

  return (
    <div className="space-y-4">
      <Card className="border-border shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-foreground">{client.clientName}</h2>
                <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                  {client.clientCode}
                </Badge>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Leadership view across linked projects, lifecycle spread, current delivery signals, and Microsoft-linked context.
                Project-client linkage remains authoritative through the shared project spine.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-cyan-100 bg-cyan-50 text-cyan-700">
                  {client.projectCount} linked projects
                </Badge>
                <Badge variant="outline" className="border-emerald-100 bg-emerald-50 text-emerald-700">
                  {client.activeProjectCount} active
                </Badge>
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  Latest activity {formatDateTime(client.latestUpdateAt)}
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setLocation("/project-create")} data-testid="button-client-overview-create-project">
                <Plus className="mr-1 h-4 w-4" />
                New Project
              </Button>
              <Button variant="outline" onClick={() => setLocation("/clients")} data-testid="button-client-overview-open-clients">
                Manage Linkages
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Linked Projects"
              value={String(client.projectCount)}
              helper={`${client.activeProjectCount} active delivery tracks`}
              icon={<FolderKanban className="h-5 w-5" />}
            />
            <MetricCard
              title="Gross Margin"
              value={formatCurrency(client.signals.financial.grossMargin)}
              helper={`${formatCurrency(client.signals.financial.totalRevenue)} revenue against ${formatCurrency(client.signals.financial.totalCost)} cost`}
              icon={<Activity className="h-5 w-5" />}
            />
            <MetricCard
              title="Quality Load"
              value={String(client.signals.quality.pendingApprovals + client.signals.quality.inReviewDeliverables)}
              helper={qualitySummary}
              icon={<CheckCircle2 className="h-5 w-5" />}
            />
            <MetricCard
              title="Microsoft Context"
              value={String(client.microsoft.totalLinkedItems)}
              helper={`${client.microsoft.linkedProjectCount} linked projects with activity`}
              icon={<Link2 className="h-5 w-5" />}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers3 className="h-4 w-4 text-cyan-700" />
              Lifecycle Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {client.lifecycleDistribution.length > 0 ? (
              client.lifecycleDistribution.map((item) => (
                <div key={`${client.clientId}-${item.stage}`} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{item.stage}</span>
                    <span className="text-muted-foreground">{item.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-cyan-600"
                      style={{ width: stageBarWidth(item.count, maxLifecycleCount) }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <EmptyPanel
                icon={<Layers3 className="h-5 w-5" />}
                title="No lifecycle spread yet"
                description="Link a project to this client to start surfacing lifecycle distribution."
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleAlert className="h-4 w-4 text-cyan-700" />
              Signal Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <ClientSignalPanel
              title="Financial"
              summary={formatCurrency(client.signals.financial.grossMargin)}
              helper={`${client.signals.financial.projectsWithFinancialData} project(s) with financial signal coverage`}
              tone="cyan"
            />
            <ClientSignalPanel
              title="Quality"
              summary={String(client.signals.quality.completedDeliverables)}
              helper={`${client.signals.quality.completedDeliverables} deliverables completed`}
              tone="emerald"
            />
            <ClientSignalPanel
              title="Risk"
              summary={riskSummary}
              helper={`${client.signals.risk.overdueWorkItems} overdue tasks, ${client.signals.risk.projectsMissingLatestUpdate} missing updates`}
              tone={client.signals.risk.blockedProjects > 0 || client.signals.risk.escalatedProjects > 0 ? "rose" : "amber"}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessagesSquare className="h-4 w-4 text-cyan-700" />
              Latest Important Updates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {client.latestUpdates.length > 0 ? (
              client.latestUpdates.map((update) => (
                <div key={update.projectInfoId} className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{update.projectName}</p>
                      {update.lifecycleStageLabel ? <Badge variant="outline">{update.lifecycleStageLabel}</Badge> : null}
                      {update.ragStatus ? (
                        <Badge variant="outline" className="border-amber-100 bg-amber-50 text-amber-700">
                          RAG {update.ragStatus}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDateTime(update.updatedAt)}</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{update.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {update.updatedBy || "No owner recorded"}
                    {update.microsoftLinkedItems > 0 ? ` - ${update.microsoftLinkedItems} Microsoft-linked items` : ""}
                  </p>
                </div>
              ))
            ) : (
              <EmptyPanel
                icon={<MessagesSquare className="h-5 w-5" />}
                title="No latest updates captured"
                description="Canonical latest updates will appear here once linked projects report delivery progress."
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-cyan-700" />
              Microsoft Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-cyan-900">
              <p className="text-xs font-semibold uppercase tracking-wide">Cross-project activity</p>
              <p className="mt-1 text-sm">
                {client.microsoft.totalLinkedItems} linked Microsoft items across {client.microsoft.linkedProjectCount} project(s).
              </p>
              <p className="mt-1 text-xs opacity-80">
                Latest activity: {formatDateTime(client.microsoft.latestActivityAt)}
              </p>
            </div>
            {microsoftItems.length > 0 ? (
              microsoftItems.map((item) => (
                <div key={`${client.clientId}-${item.key}`} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  <Badge variant="outline">{item.count}</Badge>
                </div>
              ))
            ) : (
              <EmptyPanel
                icon={<Link2 className="h-5 w-5" />}
                title="No Microsoft-linked context yet"
                description="Email, meetings, Teams, and files will surface here when linked through the canonical project spine."
              />
            )}
            {client.departmentCoverage.length > 0 ? (
              <div className="pt-1">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department coverage</p>
                <div className="flex flex-wrap gap-1">
                  {client.departmentCoverage.map((department) => (
                    <Badge key={`${client.clientId}-${department}`} variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                      {department.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderKanban className="h-4 w-4 text-cyan-700" />
            Linked Projects
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {client.linkedProjects.length > 0 ? (
            client.linkedProjects.map((project) => (
              <ClientLinkedProjectRow key={project.projectInfoId} project={project} />
            ))
          ) : (
            <EmptyPanel
              icon={<FolderKanban className="h-5 w-5" />}
              title="No linked projects"
              description="Use the existing Clients workspace to assign an unlinked project to this client without creating a second client system."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickLinkCard({
  title,
  description,
  icon,
  onClick,
  testId,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-cyan-200 hover:bg-cyan-50/40"
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
          {icon}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-background text-muted-foreground">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function getCurrentSection(pathname: string): WorkspaceSection {
  if (pathname.startsWith("/project-lifecycle/stage-gates")) return "stage-gates";
  if (pathname.startsWith("/project-lifecycle/latest-updates")) return "latest-updates";
  if (pathname.startsWith("/project-lifecycle/client-overview")) return "client-overview";
  return "overview";
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-amber-100 text-amber-700 border-amber-200",
  important: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
  low: "bg-blue-100 text-blue-700 border-blue-200",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-cyan-100 text-cyan-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-100 text-gray-500",
};

function CompanyPrioritiesManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");
  const [severity, setSeverity] = useState("normal");
  const [status, setFormStatus] = useState("active");
  const [dueDate, setDueDate] = useState("");

  const token = () => localStorage.getItem("auth_token") || "";
  const headers = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });

  const { data: priorities = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/mytool/company-priorities"],
    queryFn: async () => {
      const res = await fetch("/api/mytool/company-priorities", { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const resetForm = () => {
    setTitle(""); setDescription(""); setDepartment(""); setSeverity("normal"); setFormStatus("active"); setDueDate(""); setEditId(null); setShowForm(false);
  };

  const startEdit = (p: any) => {
    setEditId(p.id); setTitle(p.title); setDescription(p.description || ""); setDepartment(p.department || ""); setSeverity(p.severity || "normal"); setFormStatus(p.status || "active"); setDueDate(p.dueDate || ""); setShowForm(true);
  };

  const savePriority = async () => {
    if (!title.trim()) return toast({ title: "Title is required", variant: "destructive" });
    const body = { title: title.trim(), description: description.trim() || null, department: department.trim() || null, severity, status, dueDate: dueDate || null };
    const url = editId ? `/api/mytool/company-priorities/${editId}` : "/api/mytool/company-priorities";
    const method = editId ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) return toast({ title: "Save failed", variant: "destructive" });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
    resetForm();
    toast({ title: editId ? "Priority updated" : "Priority created" });
  };

  const deletePriority = async (id: number) => {
    const res = await fetch(`/api/mytool/company-priorities/${id}`, { method: "DELETE", headers: headers() });
    if (!res.ok) return toast({ title: "Delete failed", variant: "destructive" });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
    toast({ title: "Priority deleted" });
  };

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-4 w-4 text-emerald-600" />
            Company Priorities
          </CardTitle>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3" data-testid="button-add-priority">
            <Plus className="h-3.5 w-3.5 mr-1" />Add Priority
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Strategic focus areas visible to all users on the home page</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">{editId ? "Edit Priority" : "New Priority"}</span>
              <Button size="sm" variant="ghost" onClick={resetForm} className="h-6 w-6 p-0"><X className="h-4 w-4" /></Button>
            </div>
            <Input placeholder="Priority title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" data-testid="input-priority-title" />
            <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9" data-testid="input-priority-description" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input placeholder="Department" value={department} onChange={(e) => setDepartment(e.target.value)} className="h-9" data-testid="input-priority-department" />
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-priority-severity">
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
              <select value={status} onChange={(e) => setFormStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-priority-status">
                <option value="active">Active</option>
                <option value="in_progress">In Progress</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" data-testid="input-priority-due-date" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={resetForm} className="h-8">Cancel</Button>
              <Button size="sm" onClick={savePriority} className="h-8 bg-emerald-600 hover:bg-emerald-700" data-testid="button-save-priority">
                {editId ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : priorities.length === 0 ? (
          <div className="py-8 text-center">
            <Target className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No company priorities yet. Add your first strategic priority.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {priorities.map((p: any) => (
              <div key={p.id} className="flex items-start gap-3 rounded-lg border border-border bg-white p-3 hover:bg-gray-50 transition-colors" data-testid={`card-priority-${p.id}`}>
                <div className={`w-2 h-full min-h-[2.5rem] rounded-full shrink-0 ${
                  p.severity === "critical" ? "bg-red-500" : p.severity === "high" ? "bg-amber-500" : p.severity === "normal" ? "bg-emerald-500" : "bg-blue-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{p.title}</span>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${STATUS_BADGE[p.status] || STATUS_BADGE.active}`}>{p.status}</Badge>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${SEVERITY_COLORS[p.severity] || ""}`}>{p.severity}</Badge>
                  </div>
                  {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {p.department && <span>{p.department}</span>}
                    {p.dueDate && <span>Due: {p.dueDate}</span>}
                    {p.assignedTo && <span>Owner: {p.assignedTo}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-7 w-7 p-0" data-testid={`button-edit-priority-${p.id}`}>
                    <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deletePriority(p.id)} className="h-7 w-7 p-0" data-testid={`button-delete-priority-${p.id}`}>
                    <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const EMPTY_MICROSOFT_BREAKDOWN = {
  email: 0,
  event: 0,
  teams: 0,
  sharepoint_file: 0,
  other: 0,
} as const;

export function ProjectLifecyclePage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { allowed: canCreateClient, loading: clientPermissionLoading } = usePermission("pd_clients", "create");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [newClientName, setNewClientName] = useState("");

  const currentSection = getCurrentSection(location);
  const { data, isLoading, isError, isFetching, refetch } = useQuery<ProjectLifecycleWorkspacePayload>({
    queryKey: ["/api/project-lifecycle/workspace"],
    queryFn: async () => {
      const res = await fetch("/api/project-lifecycle/workspace", {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to load Project Lifecycle workspace");
      }
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const projects = data?.projects ?? [];
  const clients = data?.clients ?? [];
  const filteredProjects = useMemo(
    () => filterProjectLifecycleProjects(projects, searchTerm),
    [projects, searchTerm],
  );
  const filteredClients = useMemo(
    () => filterProjectLifecycleClients(clients, searchTerm),
    [clients, searchTerm],
  );
  const selectedClient = useMemo(
    () =>
      filteredClients.find((client) => client.clientId === selectedClientId) ||
      clients.find((client) => client.clientId === selectedClientId) ||
      null,
    [clients, filteredClients, selectedClientId],
  );

  useEffect(() => {
    if (filteredClients.length === 0) {
      setSelectedClientId(null);
      return;
    }
    if (selectedClientId && filteredClients.some((client) => client.clientId === selectedClientId)) {
      return;
    }
    setSelectedClientId(filteredClients[0].clientId);
  }, [filteredClients, selectedClientId]);

  const createClientMutation = useMutation({
    mutationFn: async (name: string) => {
      const trimmedName = name.trim();
      const existingClient = clients.find(
        (client) => normalizeClientName(client.clientName) === normalizeClientName(trimmedName),
      );
      if (existingClient) {
        return {
          existing: true,
          clientId: existingClient.clientId,
          clientCode: existingClient.clientCode,
          clientName: existingClient.clientName,
        };
      }

      const response = await fetch("/api/pd/clients", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ name: trimmedName }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create client");
      }

      return {
        existing: false,
        clientId: payload.id,
        clientCode: payload.clientId,
        clientName: payload.name,
      };
    },
    onSuccess: (result) => {
      setSelectedClientId(result.clientId);
      setNewClientName("");
      queryClient.invalidateQueries({ queryKey: ["/api/project-lifecycle/workspace"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pd/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clients-project-counts"] });
      toast({
        title: result.existing ? "Existing client opened" : "Client created",
        description: `${result.clientName} (${result.clientCode})`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Client creation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const latestProjects = useMemo(
    () => sortProjectsByLatestUpdate(filteredProjects),
    [filteredProjects],
  );
  const overviewProjects = useMemo(
    () => sortProjectsByLatestUpdate(filteredProjects).slice(0, 5),
    [filteredProjects],
  );
  const overviewClients = useMemo(
    () => filteredClients.filter((client) => client.projectCount > 0).slice(0, 5),
    [filteredClients],
  );
  const stageGateProjects = useMemo(
    () =>
      [...filteredProjects].sort((left, right) => {
        const variantDelta =
          GATE_VARIANT_ORDER[getProjectGateVariant(left)] - GATE_VARIANT_ORDER[getProjectGateVariant(right)];
        if (variantDelta !== 0) return variantDelta;
        return left.projectName.localeCompare(right.projectName);
      }),
    [filteredProjects],
  );
  const microsoftBreakdown = useMemo(
    () => buildMicrosoftBreakdownItems(data?.summary.microsoftByType ?? EMPTY_MICROSOFT_BREAKDOWN),
    [data?.summary.microsoftByType],
  );
  const maxStageCount = useMemo(
    () => Math.max(...(data?.summary.stageDistribution.map((item) => item.count) ?? [1])),
    [data?.summary.stageDistribution],
  );
  const maxDepartmentCount = useMemo(
    () => Math.max(...(data?.summary.departmentCoverage.map((item) => item.count) ?? [1])),
    [data?.summary.departmentCoverage],
  );

  const enabledGateCount = useMemo(
    () => projects.filter((project) => getProjectGateVariant(project) === "enabled").length,
    [projects],
  );
  const eligibleGateCount = useMemo(
    () => projects.filter((project) => getProjectGateVariant(project) === "eligible").length,
    [projects],
  );
  const pendingGateCount = useMemo(
    () => projects.filter((project) => getProjectGateVariant(project) === "pending").length,
    [projects],
  );
  const blockedGateCount = useMemo(
    () => projects.filter((project) => getProjectGateVariant(project) === "blocked").length,
    [projects],
  );
  const activeClientProjectCount = useMemo(
    () => clients.reduce((sum, client) => sum + client.activeProjectCount, 0),
    [clients],
  );

  const sectionSearchPlaceholder =
    currentSection === "stage-gates"
      ? "Search stage gates, projects, clients, or departments..."
      : currentSection === "latest-updates"
        ? "Search project updates, owners, clients, or departments..."
        : currentSection === "client-overview"
          ? "Search clients, linked projects, updates, or departments..."
          : "Search the lifecycle workspace...";

  if (isLoading) {
    return (
      <PageShell className="space-y-6" data-testid="project-lifecycle-loading">
        <SectionHeader
          icon={<Workflow className="h-5 w-5" />}
          title="Project Lifecycle"
          description="Loading the authoritative lifecycle workspace."
        />
        <Card className="border-border shadow-sm">
          <CardContent className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Project Lifecycle...
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (isError || !data) {
    return (
      <PageShell className="space-y-6" data-testid="project-lifecycle-error">
        <SectionHeader
          icon={<Workflow className="h-5 w-5" />}
          title="Project Lifecycle"
          description="The full-lifecycle workspace could not be loaded."
        />
        <Card className="border-border shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 h-5 w-5 text-rose-600" />
              <div>
                <p className="font-semibold text-foreground">Project Lifecycle is temporarily unavailable.</p>
                <p className="mt-1">
                  The existing lifecycle, project list, client, and project detail routes remain unchanged.
                </p>
              </div>
            </div>
            <Button onClick={() => refetch()} data-testid="button-retry-project-lifecycle">
              Retry
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-6" data-testid="project-lifecycle-page">
      <SectionHeader
        icon={<Workflow className="h-5 w-5" />}
        title="Project Lifecycle"
        description="Authoritative company lifecycle workspace across stages, clients, departments, latest updates, and Microsoft-linked context."
        meta={`Role-aware view · ${user?.role || "user"} · Updated ${formatDateTime(data.generatedAt)}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-project-lifecycle"
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <WorkspaceSubnav activeSection={currentSection} />

      <Card className="border-border shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={sectionSearchPlaceholder}
                className="pl-9"
                data-testid="input-project-lifecycle-search"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setLocation("/projects")} data-testid="button-open-project-list">
                <FolderKanban className="mr-1 h-4 w-4" />
                Project List
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/lifecycle-board")} data-testid="button-open-lifecycle">
                <Layers3 className="mr-1 h-4 w-4" />
                Lifecycle
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/clients")} data-testid="button-open-clients">
                <Users className="mr-1 h-4 w-4" />
                Clients
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Active Projects"
              value={String(data.summary.activeProjects)}
              helper={`${data.summary.totalProjects} total in the company lifecycle spine`}
              icon={<Activity className="h-5 w-5" />}
            />
            <MetricCard
              title="Stage Gates"
              value={String(enabledGateCount)}
              helper={`${eligibleGateCount} ready, ${blockedGateCount} blocked`}
              icon={<ShieldCheck className="h-5 w-5" />}
            />
            <MetricCard
              title="Latest Updates"
              value={String(data.summary.projectsWithLatestUpdate)}
              helper={`${data.summary.projectsMissingLatestUpdate} missing canonical update`}
              icon={<MessagesSquare className="h-5 w-5" />}
            />
            <MetricCard
              title="Microsoft Context"
              value={String(data.summary.totalMicrosoftLinkedItems)}
              helper={`${data.summary.microsoftLinkedProjects} projects with linked Microsoft activity`}
              icon={<Link2 className="h-5 w-5" />}
            />
          </div>
        </CardContent>
      </Card>

      {currentSection === "overview" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <QuickLinkCard
              title="Overview"
              description="Cross-functional posture, lifecycle health, and portfolio truth."
              icon={<Workflow className="h-5 w-5" />}
              onClick={() => setLocation("/project-lifecycle")}
              testId="project-lifecycle-quick-overview"
            />
            <QuickLinkCard
              title="Lifecycle"
              description="Open the existing lifecycle board for stage history and movement."
              icon={<Layers3 className="h-5 w-5" />}
              onClick={() => setLocation("/lifecycle-board")}
              testId="project-lifecycle-quick-lifecycle"
            />
            <QuickLinkCard
              title="Project List"
              description="Open the full portfolio directory without dropping lifecycle context."
              icon={<FolderKanban className="h-5 w-5" />}
              onClick={() => setLocation("/projects")}
              testId="project-lifecycle-quick-project-list"
            />
            <QuickLinkCard
              title="Client Workspace"
              description="Create clients, manage linkages, and open the client overview."
              icon={<Building2 className="h-5 w-5" />}
              onClick={() => setLocation("/project-lifecycle/client-overview")}
              testId="project-lifecycle-quick-clients"
            />
          </div>

          <CompanyPrioritiesManager />

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers3 className="h-4 w-4 text-cyan-700" />
                  Lifecycle Stage Coverage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.summary.stageDistribution.map((item) => (
                  <div key={item.stage} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{item.stage}</span>
                      <span className="text-muted-foreground">{item.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-cyan-600"
                        style={{ width: stageBarWidth(item.count, maxStageCount) }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-cyan-700" />
                  Department Visibility
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.summary.departmentCoverage.length > 0 ? data.summary.departmentCoverage.map((item) => (
                  <div key={item.department} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{item.department.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">{item.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-emerald-600"
                        style={{ width: stageBarWidth(item.count, maxDepartmentCount) }}
                      />
                    </div>
                  </div>
                )) : (
                  <EmptyPanel
                    icon={<Users className="h-5 w-5" />}
                    title="No department coverage found"
                    description="Department-linked workspaces will appear here when connected to the project spine."
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-cyan-700" />
                  Stage Gate Visibility
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Enabled</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-900">{enabledGateCount}</p>
                </div>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Ready</p>
                  <p className="mt-1 text-2xl font-semibold text-cyan-900">{eligibleGateCount}</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Pending</p>
                  <p className="mt-1 text-2xl font-semibold text-amber-900">{pendingGateCount}</p>
                </div>
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Blocked</p>
                  <p className="mt-1 text-2xl font-semibold text-rose-900">{blockedGateCount}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4 text-cyan-700" />
                  Microsoft Context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {microsoftBreakdown.length > 0 ? microsoftBreakdown.map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                    <Badge variant="outline">{item.count}</Badge>
                  </div>
                )) : (
                  <EmptyPanel
                    icon={<Link2 className="h-5 w-5" />}
                    title="No Microsoft-linked items"
                    description="Email, meetings, Teams, and files will surface here when linked back to the canonical project."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-cyan-700" />
                  Canonical Truth Guardrails
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Project Lifecycle is reading one canonical project spine, one canonical latest update, and the existing
                  stage-gate engine.
                </p>
                <p>
                  Project Management remains the execution layer after Project Development, while this workspace keeps the
                  full company lifecycle view in one place.
                </p>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-3 text-cyan-900">
                  <p className="text-xs font-semibold uppercase tracking-wide">Workspace health</p>
                  <p className="mt-1 text-sm">
                    {data.summary.projectsUpdatedInLast7Days} projects updated in the last 7 days, {data.summary.projectsWithClientLink} linked to clients,
                    and {data.summary.executionEnabledCount} enabled for execution.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderKanban className="h-4 w-4 text-cyan-700" />
                  Lifecycle Watchlist
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3" data-testid="project-lifecycle-overview-projects">
                {overviewProjects.length > 0 ? overviewProjects.map((project) => (
                  <ProjectLifecycleRow key={project.projectInfoId} project={project} compact />
                )) : (
                  <EmptyPanel
                    icon={<FolderKanban className="h-5 w-5" />}
                    title="No projects found"
                    description="Projects connected to the lifecycle spine will appear here."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessagesSquare className="h-4 w-4 text-cyan-700" />
                  Latest Update Snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {latestProjects.slice(0, 5).map((project) => (
                  <div key={project.projectInfoId} className="rounded-2xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">{project.projectName}</p>
                      <Badge variant="outline">{project.lifecycleStageLabel || "Unassigned"}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {project.latestUpdate.text || "No canonical latest update captured yet."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDateTime(project.latestUpdate.updatedAt)} · {project.latestUpdate.updatedBy || "No owner recorded"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-cyan-700" />
                Client Overview Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3" data-testid="project-lifecycle-overview-clients">
              {overviewClients.length > 0 ? overviewClients.map((client) => (
                <ClientOverviewRow key={client.clientId} client={client} />
              )) : (
                <EmptyPanel
                  icon={<Building2 className="h-5 w-5" />}
                  title="No linked clients yet"
                  description="Create clients and link projects from the Clients workspace without creating a second source of truth."
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {currentSection === "stage-gates" ? (
        <div className="space-y-4" data-testid="project-lifecycle-stage-gates">
          <Card className="border-border shadow-sm">
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Enabled" value={String(enabledGateCount)} helper="Execution already enabled" icon={<CheckCircle2 className="h-5 w-5" />} />
              <MetricCard title="Ready" value={String(eligibleGateCount)} helper="Eligible through the existing gate engine" icon={<ShieldCheck className="h-5 w-5" />} />
              <MetricCard title="Pending" value={String(pendingGateCount)} helper="Signed or in flight, not enabled yet" icon={<CircleAlert className="h-5 w-5" />} />
              <MetricCard title="Blocked" value={String(blockedGateCount)} helper="Missing gate requirements" icon={<Wrench className="h-5 w-5" />} />
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Existing stage-gate engine remains authoritative.</p>
                <p className="text-sm text-muted-foreground">
                  This view surfaces gate visibility only. Stage movement, overrides, and enforcement still run through the current lifecycle board.
                </p>
              </div>
              <Button onClick={() => setLocation("/lifecycle-board")} data-testid="button-open-stage-gate-engine">
                Open Lifecycle Board
              </Button>
            </CardContent>
          </Card>

          {stageGateProjects.length > 0 ? (
            <div className="space-y-3">
              {stageGateProjects.map((project) => (
                <ProjectLifecycleRow key={project.projectInfoId} project={project} />
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={<ShieldCheck className="h-5 w-5" />}
              title="No stage-gate matches"
              description="Try a broader search to review gate visibility across the portfolio."
            />
          )}
        </div>
      ) : null}

      {currentSection === "latest-updates" ? (
        <div className="space-y-4" data-testid="project-lifecycle-latest-updates">
          <Card className="border-border shadow-sm">
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Canonical Updates"
                value={String(data.summary.projectsWithLatestUpdate)}
                helper="Projects with a current authoritative update"
                icon={<MessagesSquare className="h-5 w-5" />}
              />
              <MetricCard
                title="Missing"
                value={String(data.summary.projectsMissingLatestUpdate)}
                helper="Projects without a canonical latest update"
                icon={<CircleAlert className="h-5 w-5" />}
              />
              <MetricCard
                title="Updated 7 Days"
                value={String(data.summary.projectsUpdatedInLast7Days)}
                helper="Fresh lifecycle communication"
                icon={<Activity className="h-5 w-5" />}
              />
              <MetricCard
                title="Projects Linked"
                value={String(data.summary.projectsWithClientLink)}
                helper="Projects already connected to clients"
                icon={<Users className="h-5 w-5" />}
              />
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">
              Project Lifecycle shows one canonical latest update per project, with history retained in the existing project event/update system.
            </CardContent>
          </Card>

          {latestProjects.length > 0 ? (
            <div className="space-y-3">
              {latestProjects.map((project) => (
                <ProjectLifecycleRow key={project.projectInfoId} project={project} />
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={<MessagesSquare className="h-5 w-5" />}
              title="No updates found"
              description="Try a broader search to review the canonical latest updates across the lifecycle."
            />
          )}
        </div>
      ) : null}

      {currentSection === "client-overview" ? (
        <div className="space-y-4" data-testid="project-lifecycle-client-overview">
          <Card className="border-border shadow-sm">
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Clients" value={String(data.summary.totalClients)} helper="Client records in the shared lifecycle workspace" icon={<Building2 className="h-5 w-5" />} />
              <MetricCard title="With Projects" value={String(data.summary.clientsWithProjects)} helper="Clients already linked to portfolio truth" icon={<Users className="h-5 w-5" />} />
              <MetricCard title="Active Client Projects" value={String(activeClientProjectCount)} helper="Active projects across linked clients" icon={<FolderKanban className="h-5 w-5" />} />
              <MetricCard title="Microsoft Items" value={String(clients.reduce((sum, client) => sum + client.microsoftLinkedItems, 0))} helper="Microsoft context linked through client-connected projects" icon={<Link2 className="h-5 w-5" />} />
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Client creation and leadership overview now sit inside Project Lifecycle.</p>
                <p className="text-sm text-muted-foreground">
                  The existing Clients page remains the operational registry for editing and bulk linkage work, but this is now the action-first client home for lifecycle planning.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setLocation("/project-create")} data-testid="button-open-project-create-from-client-workspace">
                  <Plus className="mr-1 h-4 w-4" />
                  New Project
                </Button>
                <Button onClick={() => setLocation("/clients")} data-testid="button-open-client-workspace">
                  Open Clients
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-cyan-700" />
                    Create Client
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    value={newClientName}
                    onChange={(event) => setNewClientName(event.target.value)}
                    placeholder="Enter client name"
                    data-testid="input-project-lifecycle-new-client-name"
                  />
                  <p className="text-xs text-muted-foreground">
                    New clients are created against the shared client master. Exact name matches open the existing client instead of creating a duplicate.
                  </p>
                  <Button
                    className="w-full"
                    onClick={() => createClientMutation.mutate(newClientName)}
                    disabled={
                      clientPermissionLoading ||
                      !canCreateClient ||
                      !newClientName.trim() ||
                      createClientMutation.isPending
                    }
                    data-testid="button-project-lifecycle-create-client"
                  >
                    {createClientMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Create Client
                  </Button>
                  {!canCreateClient && !clientPermissionLoading ? (
                    <p className="text-xs text-muted-foreground">
                      You have read access to the client overview, but client creation is limited by role.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Search className="h-4 w-4 text-cyan-700" />
                    Client Directory
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {filteredClients.length > 0 ? (
                    filteredClients.map((client) => (
                      <ClientWorkspaceListItem
                        key={client.clientId}
                        client={client}
                        isSelected={client.clientId === selectedClient?.clientId}
                        onSelect={() => setSelectedClientId(client.clientId)}
                      />
                    ))
                  ) : (
                    <EmptyPanel
                      icon={<Building2 className="h-5 w-5" />}
                      title="No clients found"
                      description="Try a broader search, or create a client here if your role allows it."
                    />
                  )}
                </CardContent>
              </Card>
            </div>

            <div>
              {selectedClient ? (
                <ClientOverviewDetail client={selectedClient} />
              ) : (
                <EmptyPanel
                  icon={<Building2 className="h-5 w-5" />}
                  title="Select a client"
                  description="Choose a client from the directory to review linked projects, delivery signals, latest updates, and Microsoft context."
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

export default ProjectLifecyclePage;
