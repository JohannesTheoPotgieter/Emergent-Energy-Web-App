import { useEffect, useMemo, useReducer, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageEmpty, PageError, PageSkeleton } from "@/components/ui/page-states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleOff,
  Clock,
  FileEdit,
  FileStack,
  Loader2,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Sun,
  TicketPlus,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { OPPORTUNITY_INTAKE_VIEW_ROLES } from "@shared/roles/pd-roles";
import { statusColorClasses, priorityColorClasses } from "@/lib/status-colors";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { TablePagination } from "@/components/ui/table-pagination";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ExportDropdown } from "@/components/ui/export-dropdown";
import { PD_REQUEST_TYPES_FILTERABLE } from "@/lib/pd/request-types";
import { OpportunityDrawer } from "@/components/opportunities/OpportunityDrawer";
import { OpportunitiesKanban, OpportunitiesCalendar } from "@/components/opportunities/OpportunityViews";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LayoutList, KanbanSquare, CalendarDays } from "lucide-react";
import { pdStageLifecycleLabel } from "@/lib/pdStageLifecycle";

// App-phase label: capitalizes the stored stage value so the column reads
// "Qualification" instead of "qualification". These are the values produced
// by resolvePipedriveStageMapping() during Pipedrive sync (see PR #671).
function appPhaseLabel(stage: string | null): string {
  if (!stage) return "—";
  const s = String(stage).trim();
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const TICKET_STATUSES = ["Draft", "In Progress", "On Hold", "Completed", "Cancelled"];
const TICKET_PRIORITIES = ["Critical", "High", "Medium", "Low"];

interface WorkingOpportunityRow {
  id: number;
  dealName: string;
  pipedriveDealId: string | null;
  orgClientName: string | null;
  dealOwner: string | null;
  projectDeveloper: string | null;
  projectDeveloperOverridden: boolean;
  stage: string | null;
  status: string | null;
  siteLocation: string | null;
  province: string | null;
  fundingType: string | null;
  estimatedValue: number | null;
  estimatedKwp: number | null;
  nextActivityDate: string | null;
  nextActivitySubject: string | null;
  hasLinkedClient: boolean;
  hasLinkedProject: boolean;
  linkedProjectCount: number;
  linkedProjectId: number | null;
  linkedProjectName: string | null;
  existingEngineeringTicketCount: number;
  openEngineeringTaskCount: number;
  closedEngineeringTaskCount: number;
  oldestOpenEngineeringAt: string | null;
  lastTicketClientId: number | null;
  lastTicketProjectId: number | null;
  lastUpdated: string | null;
  signedDate?: string | null;
  expectedCloseDate?: string | null;
}

const FUNDING_LABELS: Record<string, string> = {
  self_funded: "Self-funded",
  third_party: "3rd-party",
  blended: "Blended",
  PPA: "PPA",
  EPC: "EPC",
  lease: "Lease",
  hybrid: "Hybrid",
};

function fundingLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return FUNDING_LABELS[value] ?? value;
}

function formatZAR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${n.toFixed(0)}`;
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}

type MappingMode = "existing_existing" | "existing_new" | "new_new";

interface MappingContextResponse {
  opportunity: { id: number; dealName: string; pipedriveDealId: string | null; stage: string | null; status: string | null; clientId: number | null; clientName: string | null };
  linkedClient: { id: number; name: string | null } | null;
  linkedProject: { id: number; projectName: string; clientId: number | null } | null;
  likelyClients: Array<{ id: number; name: string; clientId: string }>;
  likelyProjects: Array<{ id: number; projectName: string; clientId: number | null }>;
  existingEngineeringTicketCount: number;
}

interface EngineeringPhaseTemplate {
  id: number;
  phase: string;
  name: string;
  version: number;
  itemCount: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function hasTerminalMarker(value: unknown): boolean {
  const v = normalized(value);
  return ["lost", "won", "closed", "signed", "contracted", "deleted"].some((m) => v.includes(m));
}

function stageBadgeClass(stage: string | null): string {
  const s = normalized(stage);
  if (s.includes("prospect")) return "bg-slate-100 text-slate-700";
  if (s.includes("qualification")) return "bg-blue-50 text-blue-700";
  if (s.includes("proposal")) return "bg-indigo-50 text-indigo-700";
  if (s.includes("negotiation")) return "bg-amber-50 text-amber-700";
  return "bg-muted text-muted-foreground";
}

function statusBadgeClass(status: string | null): string {
  const s = normalized(status);
  if (s.includes("active") || s.includes("open")) return "bg-emerald-50 text-emerald-700";
  if (s.includes("at risk")) return "bg-amber-50 text-amber-700";
  return "bg-muted text-muted-foreground";
}

interface DialogState {
  target: WorkingOpportunityRow | null;
  mappingMode: MappingMode;
  existingClientId: string;
  existingProjectId: string;
  newClientName: string;
  newProjectName: string;
  mappingWarnings: string[];
  resolvedClientId: number | null;
  resolvedProjectId: number | null;
  /**
   * When `true`, the dialog opens straight to the "add ticket" form,
   * pre-populating `resolvedClientId`/`resolvedProjectId` from the
   * opportunity's most recent existing ticket. Mapping is suppressed
   * because the user has already mapped the deal at least once.
   */
  skipMapping: boolean;
  ticketMode: "phase_template" | "custom";
  selectedTemplateId: string;
  templateBaseDueDate: string;
  customTitle: string;
  customPhase: string;
  customDescriptionScope: string;
  customDueDate: string;
  customPriority: string;
  customRequiredOutput: string;
  // Operational metadata — mirrors PD ticket fields so this in-dialog
  // form is the canonical "manual ticket" surface.
  customFundingType: string;
  customSizeKwp: string;
  customProvince: string;
  customGpsCoordinates: string;
  customBatteriesNeeded: boolean;
  customBatterySize: string;
}

const DIALOG_INITIAL: DialogState = {
  target: null,
  mappingMode: "existing_existing",
  existingClientId: "",
  existingProjectId: "",
  newClientName: "",
  newProjectName: "",
  mappingWarnings: [],
  resolvedClientId: null,
  resolvedProjectId: null,
  skipMapping: false,
  ticketMode: "phase_template",
  selectedTemplateId: "",
  templateBaseDueDate: "",
  customTitle: "",
  customPhase: "",
  customDescriptionScope: "",
  customDueDate: "",
  customPriority: "Medium",
  customRequiredOutput: "",
  customFundingType: "",
  customSizeKwp: "",
  customProvince: "",
  customGpsCoordinates: "",
  customBatteriesNeeded: false,
  customBatterySize: "",
};

/**
 * Engineering tickets cell for the working list.
 *
 * Layout:
 *   [open]/[closed] · [Nd]
 * where:
 *   - open = open ticket count, emerald pill (links to project if linked)
 *   - closed = total closed (Completed/Cancelled) tickets, slate
 *   - Nd = days since the oldest still-open ticket was created (in-progress age)
 *
 * Empty state: a single dim "·" centered in the cell.
 */
function EngCell({ row }: { row: WorkingOpportunityRow }) {
  const open = row.openEngineeringTaskCount;
  const closed = row.closedEngineeringTaskCount;
  const total = open + closed;

  if (total === 0) {
    return <span className="text-slate-300" aria-label="No engineering tickets">·</span>;
  }

  const ageDays = daysSince(row.oldestOpenEngineeringAt);
  const ageLabel = open > 0 && ageDays != null ? `${ageDays}d` : null;

  const openPill = row.linkedProjectName ? (
    <Link
      href={`/project/${encodeURIComponent(row.linkedProjectName)}`}
      onClick={(e) => e.stopPropagation()}
      title={`Open project ${row.linkedProjectName} • ${open} open ticket${open === 1 ? "" : "s"}`}
      data-testid={`link-eng-project-${row.id}`}
      className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${
        open > 0 ? "bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow" : "bg-slate-100 text-slate-500"
      }`}
    >
      {open}
    </Link>
  ) : (
    <span
      className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${
        open > 0 ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
      }`}
      title={open > 0 ? `${open} open engineering ticket${open === 1 ? "" : "s"}` : "No open tickets"}
    >
      {open}
    </span>
  );

  return (
    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums">
      {openPill}
      <span className="text-slate-400">/</span>
      <span
        className="text-slate-600"
        title={`${closed} closed (Completed or Cancelled)`}
        data-testid={`text-eng-closed-${row.id}`}
      >
        {closed}
      </span>
      {ageLabel ? (
        <>
          <span className="text-slate-300">·</span>
          <span
            className={
              ageDays! >= 14
                ? "text-amber-700 font-medium"
                : "text-slate-500"
            }
            title={`Oldest open ticket is ${ageDays}d old`}
            data-testid={`text-eng-age-${row.id}`}
          >
            {ageLabel}
          </span>
        </>
      ) : null}
    </span>
  );
}

export default function OpportunitiesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { allowed: canViewEntity } = usePermission("opportunities", "view");
  const [, navigate] = useLocation();

  const role = String(user?.role || "");
  const roleIsPdApproved = (OPPORTUNITY_INTAKE_VIEW_ROLES as readonly string[]).includes(role);
  const canView = canViewEntity && roleIsPdApproved;

  // Unified drawer (2026-04-20 merge) — opens for any row click and
  // surfaces CRM (Pipedrive) + PD shadow + Convert-to-Project together.
  const [drawerOppId, setDrawerOppId] = useState<number | null>(null);

  // Deep-link support: PD Dashboard links use /opportunities?open={id}
  // to jump straight to a specific deal. Read once on mount, then strip
  // the param so the URL doesn't pin the drawer permanently.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("open");
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id) && id > 0) {
      setDrawerOppId(id);
      params.delete("open");
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", next);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pipedrive "last synced" indicator — driven entirely client-side from
  // the most recent successful pull.
  const [lastPullAt, setLastPullAt] = useState<Date | null>(null);

  const [dlg, updateDlg] = useReducer(
    (prev: DialogState, action: Partial<DialogState> | "reset") =>
      action === "reset" ? DIALOG_INITIAL : { ...prev, ...action },
    DIALOG_INITIAL,
  );
  const mappingResolved = dlg.resolvedClientId != null && dlg.resolvedProjectId != null;

  // Search + sort UI state for the List view.
  type SortKey = "dealName" | "stage" | "projectDeveloper" | "province" | "estimatedKwp" | "estimatedValue" | "expectedCloseDate" | "nextActivityDate" | "openEngineeringTaskCount";
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("expectedCloseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // (Legacy PD Tickets section state was removed 2026-04-20 — replaced by
  // the unified OpportunityDrawer which fetches per-row /workflow on open.)

  const { data = [], isLoading, isError, error, refetch } = useQuery<WorkingOpportunityRow[]>({
    queryKey: ["/api/opportunities/working"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/opportunities/working");
      if (!res.ok) throw new Error(`Failed to fetch opportunities (${res.status})`);
      return res.json();
    },
    enabled: canView,
  });

  const { data: mappingContext, isLoading: mappingLoading } = useQuery<MappingContextResponse>({
    queryKey: ["/api/opportunities", dlg.target?.id, "mapping-context"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/opportunities/${dlg.target!.id}/mapping-context`);
      if (!res.ok) throw new Error(`Failed to load mapping context (${res.status})`);
      return res.json();
    },
    enabled: !!dlg.target?.id,
  });

  const { data: phaseTemplates = [] } = useQuery<EngineeringPhaseTemplate[]>({
    queryKey: ["/api/opportunities/engineering-phase-templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/opportunities/engineering-phase-templates");
      if (!res.ok) throw new Error(`Failed to load phase templates (${res.status})`);
      return res.json();
    },
    enabled: !!dlg.target?.id,
  });

  // If templates are empty, force the dialog into "custom" mode so the
  // user isn't shown a dropdown with nothing to pick.
  useEffect(() => {
    if (dlg.target?.id && phaseTemplates.length === 0 && dlg.ticketMode === "phase_template") {
      updateDlg({ ticketMode: "custom" });
    }
  }, [dlg.target?.id, phaseTemplates.length, dlg.ticketMode]);

  // Scope metadata for the "Pull from Pipedrive" button. The server
  // derives `scope` from the caller's role — COO/CEO/CCO get the
  // whole pipeline, everyone else only their own deals.
  const {
    data: pullScope,
    isLoading: pullScopeLoading,
    isError: pullScopeError,
    error: pullScopeErrorObj,
  } = useQuery<{
    role: string;
    scope: "all" | "owner";
    ownerEmail: string | null;
    configured: boolean;
    canPull: boolean;
    blockedReason: string | null;
  }>({
    queryKey: ["/api/pipedrive/pull/scope"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pipedrive/pull/scope");
      if (!res.ok) throw new Error(`Failed to load pipedrive pull scope (${res.status})`);
      return res.json();
    },
    enabled: canView,
    staleTime: 60_000,
  });

  const pullPipedriveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipedrive/pull");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          body?.message ||
          body?.error ||
          `Pipedrive pull failed (${res.status}).`;
        throw new Error(message);
      }
      return body as {
        dealsProcessed: number;
        dealsCreated: number;
        dealsUpdated: number;
        errors: string[];
        syncStatus: "completed" | "partial" | "failed";
        scope: "all" | "owner";
        ownerEmail: string | null;
      };
    },
    onSuccess: (result) => {
      const scopeLabel = result.scope === "all" ? "all Pipedrive deals" : "your Pipedrive deals";
      const summary = `${result.dealsProcessed} processed · ${result.dealsCreated} new · ${result.dealsUpdated} updated`;
      const variant = result.syncStatus === "completed" ? undefined : "destructive";
      toast({
        title:
          result.syncStatus === "completed"
            ? `Pulled ${scopeLabel}`
            : result.syncStatus === "partial"
              ? `Partial pull: ${scopeLabel}`
              : `Pull failed: ${scopeLabel}`,
        description:
          result.errors.length > 0
            ? `${summary}. ${result.errors.length} error${result.errors.length === 1 ? "" : "s"} — see Admin → Pipedrive for details.`
            : summary,
        variant,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities/working"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      setLastPullAt(new Date());
    },
    onError: (err: Error) => {
      toast({ title: "Pipedrive pull failed", description: err.message, variant: "destructive" });
    },
  });

  const resolveMappingMutation = useMutation({
    mutationFn: async () => {
      if (!dlg.target?.id) throw new Error("No opportunity selected");
      const body = {
        mode: dlg.mappingMode,
        existingClientId: dlg.existingClientId ? Number(dlg.existingClientId) : undefined,
        existingProjectId: dlg.existingProjectId ? Number(dlg.existingProjectId) : undefined,
        newClientName: dlg.newClientName.trim() || undefined,
        newProjectName: dlg.newProjectName.trim() || undefined,
      };
      const res = await apiRequest("POST", `/api/opportunities/${dlg.target.id}/resolve-mapping`, body);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
        updateDlg({ mappingWarnings: warnings });
        throw new Error(payload?.error || "Failed to resolve mapping");
      }
      return payload;
    },
    onSuccess: (payload: Record<string, unknown>) => {
      const client = payload?.client as { id: number } | undefined;
      const project = payload?.project as { id: number } | undefined;
      updateDlg({ resolvedClientId: client?.id ?? null, resolvedProjectId: project?.id ?? null, mappingWarnings: [] });
    },
    onError: (err: Error) => {
      toast({
        title: "Mapping failed",
        description: err?.message || "Unable to resolve opportunity mapping.",
        variant: "destructive",
      });
    },
  });

  const createEngineeringTicketsMutation = useMutation({
    mutationFn: async () => {
      if (!dlg.target?.id || !dlg.resolvedClientId || !dlg.resolvedProjectId) {
        throw new Error("Resolve client/project mapping before creating tickets.");
      }
      const body: Record<string, unknown> = {
        mode: dlg.ticketMode,
        clientId: dlg.resolvedClientId,
        projectId: dlg.resolvedProjectId,
      };
      if (dlg.ticketMode === "phase_template") {
        body.phaseTemplateId = dlg.selectedTemplateId ? Number(dlg.selectedTemplateId) : undefined;
        body.templateBaseDueDate = dlg.templateBaseDueDate || undefined;
      } else {
        // Inline required-field check so users see a friendly inline
        // error rather than a generic "Bad Request" toast.
        const missing: string[] = [];
        if (!dlg.customTitle.trim()) missing.push("Title");
        if (!dlg.customPhase.trim()) missing.push("Phase");
        if (!dlg.customDescriptionScope.trim()) missing.push("Description / Scope");
        if (!dlg.customDueDate) missing.push("Due date");
        if (!dlg.customRequiredOutput.trim()) missing.push("Required output");
        if (missing.length > 0) {
          throw new Error(`Please fill in: ${missing.join(", ")}`);
        }
        body.customTicket = {
          title: dlg.customTitle.trim(),
          phase: dlg.customPhase.trim(),
          descriptionScope: dlg.customDescriptionScope.trim(),
          dueDate: dlg.customDueDate,
          priority: dlg.customPriority,
          requiredOutput: dlg.customRequiredOutput.trim(),
          ...(dlg.customFundingType.trim() ? { fundingType: dlg.customFundingType.trim() } : {}),
          ...(dlg.customSizeKwp.trim() ? { sizeKwp: dlg.customSizeKwp.trim() } : {}),
          ...(dlg.customProvince.trim() ? { province: dlg.customProvince.trim() } : {}),
          ...(dlg.customGpsCoordinates.trim() ? { gpsCoordinates: dlg.customGpsCoordinates.trim() } : {}),
          batteriesNeeded: dlg.customBatteriesNeeded,
          ...(dlg.customBatterySize.trim() ? { batterySize: dlg.customBatterySize.trim() } : {}),
        };
      }
      const res = await apiRequest("POST", `/api/opportunities/${dlg.target.id}/create-engineering-tickets`, body);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Extract field-level Zod messages from validateBody's
        // `details` envelope so the toast tells the user exactly which
        // fields are wrong instead of just "Bad Request".
        const fieldErrors = payload?.details?.fieldErrors;
        const formErrors = payload?.details?.formErrors;
        const fieldMsgs: string[] = [];
        if (fieldErrors && typeof fieldErrors === "object") {
          for (const [k, v] of Object.entries(fieldErrors)) {
            if (Array.isArray(v) && v.length > 0) fieldMsgs.push(`${k}: ${(v as string[]).join("; ")}`);
          }
        }
        if (Array.isArray(formErrors) && formErrors.length > 0) fieldMsgs.push(...formErrors);
        const msg = fieldMsgs.length > 0
          ? fieldMsgs.join(" | ")
          : payload?.error || `Failed to create engineering tickets (HTTP ${res.status})`;
        throw new Error(msg);
      }
      return payload;
    },
    onSuccess: (payload: Record<string, unknown>) => {
      const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
      if (warnings.length > 0) {
        toast({ title: "Tickets created with duplicate warnings", description: warnings.join(" "), variant: "default" });
      } else {
        toast({ title: "Engineering tickets created", description: `${payload?.createdCount || 0} ticket(s) created with traceability links.` });
      }
      updateDlg("reset");
      refetch();
    },
    onError: (err: Error) => {
      toast({
        title: "Engineering ticket creation failed",
        description: err?.message || "Unable to create engineering ticket(s).",
        variant: "destructive",
      });
    },
  });

  // The server (`server/lib/opportunity-working-filter.ts`) is the
  // authoritative gate for which deals appear here — terminal status,
  // signed date, and linked project all exclude. We re-apply the same
  // checks client-side as a defensive safety net (cached responses,
  // mid-flight mutations, role-stale data); in DEV we log when the
  // safety net actually trips so any drift between client/server is
  // visible. See review item C1 (2026-04-21).
  const activeRows = useMemo(() => {
    const filtered = data.filter(
      (row) =>
        !row.hasLinkedProject &&
        !hasTerminalMarker(row.status) &&
        !hasTerminalMarker(row.stage) &&
        !row.signedDate,
    );
    if (import.meta.env.DEV && filtered.length !== data.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[opportunities] client safety-net dropped ${data.length - filtered.length} row(s) the server returned — check isActivePdWorkingOpportunity().`,
      );
    }
    return filtered;
  }, [data]);

  // Derived list for the table view: applies the search filter and the
  // current sort. Kanban/Calendar tabs continue to use `activeRows`
  // directly (their own sort behavior is in the child components).
  const displayRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? activeRows.filter((row) => {
          const haystack = [
            row.dealName,
            row.orgClientName,
            row.projectDeveloper,
            row.province,
            row.pipedriveDealId,
            row.stage,
            row.fundingType,
            row.siteLocation,
            row.nextActivitySubject,
          ]
            .map((v) => String(v ?? "").toLowerCase())
            .join(" ");
          return haystack.includes(q);
        })
      : activeRows;

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: WorkingOpportunityRow, b: WorkingOpportunityRow): number => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Push nullish to the bottom regardless of direction.
      const aNull = av == null || av === "";
      const bNull = bv == null || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      if (sortKey === "expectedCloseDate" || sortKey === "nextActivityDate") {
        const at = new Date(String(av)).getTime();
        const bt = new Date(String(bv)).getTime();
        if (Number.isFinite(at) && Number.isFinite(bt)) return (at - bt) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    };
    return [...filtered].sort(cmp);
  }, [activeRows, searchTerm, sortKey, sortDir]);

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (
      <span className="ml-1 text-emerald-700 font-bold" aria-hidden="true">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    ) : (
      <span className="ml-1 text-slate-300" aria-hidden="true">↕</span>
    );
  const sortHeaderClass = (key: SortKey) =>
    sortKey === key
      ? "text-emerald-900 font-bold underline decoration-emerald-300 underline-offset-2"
      : "";

  const clientOptions = useMemo(() => {
    const base = mappingContext?.likelyClients || [];
    if (mappingContext?.linkedClient && !base.some((c) => c.id === mappingContext.linkedClient!.id)) {
      return [{ id: mappingContext.linkedClient.id, name: mappingContext.linkedClient.name || "Linked client", clientId: "" }, ...base];
    }
    return base;
  }, [mappingContext]);

  const projectOptions = useMemo(() => {
    const base = mappingContext?.likelyProjects || [];
    if (mappingContext?.linkedProject && !base.some((p) => p.id === mappingContext.linkedProject!.id)) {
      return [{ id: mappingContext.linkedProject.id, projectName: mappingContext.linkedProject.projectName, clientId: mappingContext.linkedProject.clientId }, ...base];
    }
    return base;
  }, [mappingContext]);

  function openMapping(row: WorkingOpportunityRow) {
    // Fast path: if this opportunity already has tickets AND we know
    // which client/project the latest one was filed against, skip the
    // mapping selection entirely and open straight to the ticket form.
    // Re-mapping the same deal every time you add a ticket is friction
    // PDs explicitly asked us to remove (2026-04-21 user feedback).
    const totalTickets = row.openEngineeringTaskCount + row.closedEngineeringTaskCount;
    const canSkipMapping =
      totalTickets > 0 && row.lastTicketClientId != null && row.lastTicketProjectId != null;

    updateDlg({
      ...DIALOG_INITIAL,
      target: row,
      newClientName: row.orgClientName || "",
      newProjectName: row.dealName || "",
      templateBaseDueDate: new Date().toISOString().slice(0, 10),
      customTitle: row.dealName || "",
      customPhase: "First Assessment",
      customFundingType: row.fundingType || "",
      customSizeKwp: row.estimatedKwp != null ? String(row.estimatedKwp) : "",
      customProvince: row.province || "",
      ...(canSkipMapping
        ? {
            skipMapping: true,
            resolvedClientId: row.lastTicketClientId,
            resolvedProjectId: row.lastTicketProjectId,
          }
        : {}),
    });
  }

  if (!canView) {
    return (
      <PageShell className="p-4 md:p-6">
        <PageError
          title="Access restricted"
          message="This active Opportunities working view is limited to Project Development approved roles."
        />
      </PageShell>
    );
  }

  if (isLoading) return <PageSkeleton lines={6} />;

  if (isError) {
    return (
      <PageShell className="p-4 md:p-6">
        <PageError
          title="Unable to load active opportunities"
          message={error instanceof Error ? error.message : "Failed to fetch active opportunities."}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-opportunities-working">
      <SectionHeader
        icon={<TrendingUp className="h-5 w-5" />}
        eyebrow="Project Development"
        title="Opportunities (Active Working List)"
        description="Only active Pipedrive opportunities are shown here. Lost, won/signed/closed, and converted deals are excluded."
        actions={
          <div className="flex items-center gap-2">
            {lastPullAt && (
              <span
                className="text-[11px] text-slate-500 hidden sm:inline"
                title={`Last successful Pipedrive pull: ${lastPullAt.toLocaleString()}`}
                data-testid="text-last-pulled-at"
              >
                Synced {formatRelative(lastPullAt)}
              </span>
            )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={
              pullScopeLoading ||
              pullScopeError ||
              !pullScope?.configured ||
              !pullScope?.canPull ||
              pullPipedriveMutation.isPending
            }
            onClick={() => pullPipedriveMutation.mutate()}
            title={
              pullScopeLoading
                ? "Checking Pipedrive configuration…"
                : pullScopeError
                  ? `Unable to reach the Pipedrive endpoint: ${pullScopeErrorObj instanceof Error ? pullScopeErrorObj.message : "unknown error"}`
                  : !pullScope?.configured
                    ? "Pipedrive is not configured. Ask an admin to set PIPEDRIVE_API_TOKEN in the server environment."
                    : pullScope.blockedReason ??
                      (pullScope.scope === "all"
                        ? "Pulls every deal from Pipedrive. Existing opportunities are updated in place — no duplicates."
                        : `Pulls only deals owned by ${pullScope.ownerEmail ?? "you"} in Pipedrive. Existing opportunities are updated in place.`)
            }
            data-testid="btn-pull-from-pipedrive"
          >
            {pullPipedriveMutation.isPending || pullScopeLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {pullScopeLoading
              ? "Checking Pipedrive…"
              : pullScopeError
                ? "Pipedrive unavailable"
                : !pullScope?.configured
                  ? "Pipedrive not configured"
                  : pullScope.scope === "all"
                    ? "Pull all from Pipedrive"
                    : "Pull my Pipedrive deals"}
          </Button>
          </div>
        }
      />

      {pullScopeError && (
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">Pipedrive pull status unavailable</p>
              <p className="text-red-700">
                The server did not return Pipedrive pull scope. Reason: {pullScopeErrorObj instanceof Error ? pullScopeErrorObj.message : "unknown"}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {pullScope && !pullScope.configured && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900">Pipedrive is not configured on this environment</p>
              <p className="text-amber-800">
                Set <code>PIPEDRIVE_API_TOKEN</code> in the server environment to enable pulls. Until then, this list only shows opportunities that were created manually or imported previously.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {pullScope?.configured && pullScope.blockedReason && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900">Pull is blocked for your account</p>
              <p className="text-amber-800">{pullScope.blockedReason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="p-3 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
          <div>
            <p className="font-medium text-emerald-800">Active-only engineering intake list</p>
            <p className="text-emerald-700">{activeRows.length} active opportunity row{activeRows.length === 1 ? "" : "s"} ready for next-step action scaffolding.</p>
          </div>
        </CardContent>
      </Card>

      {activeRows.length === 0 ? (
        <PageEmpty
          icon={Sun}
          title="No active opportunities"
          description="No active Pipedrive opportunities currently qualify for this working list."
        />
      ) : (
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="bg-emerald-50/60 border border-emerald-200 h-9 p-0.5" data-testid="tabs-views">
            <TabsTrigger value="list" className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-emerald-800" data-testid="tab-list">
              <LayoutList className="h-3.5 w-3.5" /> List
            </TabsTrigger>
            <TabsTrigger value="kanban" className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-emerald-800" data-testid="tab-kanban">
              <KanbanSquare className="h-3.5 w-3.5" /> Kanban
            </TabsTrigger>
            <TabsTrigger value="calendar" className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-emerald-800" data-testid="tab-calendar">
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </TabsTrigger>
          </TabsList>

          {/* ── List view (compact) ───────────────────────────────────── */}
          <TabsContent value="list" className="mt-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by deal, client, developer, province, deal #…"
                  className="pl-8 h-8 text-xs"
                  data-testid="input-search-opportunities"
                />
              </div>
              <div className="text-[11px] text-slate-500 whitespace-nowrap" data-testid="text-opportunities-count">
                {displayRows.length} of {activeRows.length} shown
                {sortKey && <span className="text-slate-400"> • sorted by {sortKey}{sortDir === "desc" ? " ↓" : " ↑"}</span>}
              </div>
            </div>
            <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
              <div className="overflow-x-auto max-h-[calc(100vh-300px)]">
                <table className="w-full text-xs border-collapse" data-testid="table-opportunities-working">
                  <thead className="bg-emerald-50/60 text-[10px] uppercase tracking-wide text-emerald-900/80 sticky top-0 z-10 shadow-[inset_0_-1px_0_0_rgb(229,231,235)]">
                    <tr>
                      <th className={`text-left px-2.5 py-1.5 font-semibold cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("dealName")}`} onClick={() => toggleSort("dealName")} data-testid="sort-dealName">Client / Project{sortIndicator("dealName")}</th>
                      <th className={`text-left px-2 py-1.5 font-semibold cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("stage")}`} onClick={() => toggleSort("stage")} data-testid="sort-stage">Stage{sortIndicator("stage")}</th>
                      <th className={`text-left px-2 py-1.5 font-semibold cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("projectDeveloper")}`} onClick={() => toggleSort("projectDeveloper")} data-testid="sort-projectDeveloper">Project Developer{sortIndicator("projectDeveloper")}</th>
                      <th className={`text-left px-2 py-1.5 font-semibold cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("province")}`} onClick={() => toggleSort("province")} data-testid="sort-province">Province{sortIndicator("province")}</th>
                      <th className={`text-right px-2 py-1.5 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("estimatedKwp")}`} onClick={() => toggleSort("estimatedKwp")} data-testid="sort-estimatedKwp">Size{sortIndicator("estimatedKwp")}</th>
                      <th className={`text-right px-2 py-1.5 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("estimatedValue")}`} onClick={() => toggleSort("estimatedValue")} data-testid="sort-estimatedValue">Value{sortIndicator("estimatedValue")}</th>
                      <th className={`text-left px-2 py-1.5 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("expectedCloseDate")}`} onClick={() => toggleSort("expectedCloseDate")} data-testid="sort-expectedCloseDate">Est. Sig.{sortIndicator("expectedCloseDate")}</th>
                      <th className={`text-left px-2 py-1.5 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("nextActivityDate")}`} onClick={() => toggleSort("nextActivityDate")} data-testid="sort-nextActivityDate">Next Activity{sortIndicator("nextActivityDate")}</th>
                      <th className={`text-center px-2 py-1.5 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-emerald-900 ${sortHeaderClass("openEngineeringTaskCount")}`} onClick={() => toggleSort("openEngineeringTaskCount")} title="Open engineering tasks" data-testid="sort-openEngineeringTaskCount">Eng.{sortIndicator("openEngineeringTaskCount")}</th>
                      <th className="text-right px-2 py-1.5 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, idx) => (
                      <tr
                        key={row.id}
                        className={`border-t border-slate-100 cursor-pointer transition-colors hover:bg-emerald-50/50 ${idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"}`}
                        data-testid={`opportunity-row-${row.id}`}
                        onClick={() => setDrawerOppId(row.id)}
                      >
                        <td className="px-2.5 py-1.5 align-middle min-w-[240px] max-w-[320px]">
                          <p className="font-semibold text-slate-900 truncate leading-tight" title={row.dealName}>
                            {row.dealName || `Deal #${row.id}`}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate flex items-center gap-1 leading-tight" title={row.orgClientName || ""}>
                            <span className="truncate">{row.orgClientName || "Unlinked"}</span>
                            {!row.hasLinkedClient && <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />}
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-400 shrink-0">#{row.pipedriveDealId || "—"}</span>
                          </p>
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <div className="flex flex-col items-start gap-0.5">
                            {pdStageLifecycleLabel(row.stage) ? (
                              <Badge
                                className="text-[10px] font-medium px-1.5 py-0 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
                                data-testid={`row-lifecycle-${row.id}`}
                                title={`Company lifecycle phase: ${pdStageLifecycleLabel(row.stage)}`}
                              >
                                {pdStageLifecycleLabel(row.stage)}
                              </Badge>
                            ) : (
                              <Badge className={`text-[10px] font-medium px-1.5 py-0 ${stageBadgeClass(row.stage)}`}>{appPhaseLabel(row.stage)}</Badge>
                            )}
                            {pdStageLifecycleLabel(row.stage) && row.stage && (
                              <span
                                className="text-[9px] lowercase text-slate-500 leading-none"
                                title={`Pipedrive stage: ${row.stage}`}
                              >
                                {String(row.stage).toLowerCase()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 align-middle min-w-[120px]">
                          <p className="text-slate-800 truncate text-xs" title={row.projectDeveloper || ""}>{row.projectDeveloper || "—"}</p>
                          {row.projectDeveloperOverridden && (
                            <span className="text-[9px] text-emerald-700 font-medium">override</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          {row.province ? (
                            <span className="inline-flex items-center px-1.5 py-0 rounded bg-sky-50 text-sky-700 text-[10px] font-medium border border-sky-100">
                              {row.province}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-middle text-right whitespace-nowrap">
                          {row.estimatedKwp != null ? (
                            <span className="tabular-nums font-medium text-slate-800">
                              {row.estimatedKwp >= 1000 ? `${(row.estimatedKwp / 1000).toFixed(2)} MWp` : `${row.estimatedKwp.toFixed(0)} kWp`}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-middle text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatZAR(row.estimatedValue)}
                        </td>
                        <td className="px-2 py-1.5 align-middle text-[11px] text-slate-700 whitespace-nowrap">
                          {formatDate(row.expectedCloseDate)}
                        </td>
                        <td className="px-2 py-1.5 align-middle min-w-[130px]">
                          {row.nextActivityDate ? (
                            <div className="leading-tight">
                              <p className="text-[11px] font-medium text-slate-800 whitespace-nowrap">{formatDate(row.nextActivityDate)}</p>
                              {row.nextActivitySubject && (
                                <p className="text-[10px] text-slate-500 truncate max-w-[160px]" title={row.nextActivitySubject}>
                                  {row.nextActivitySubject}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-middle text-center">
                          <EngCell row={row} />
                        </td>
                        <td className="px-2 py-1.5 align-middle text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-6 text-[10px] px-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
                            data-testid={`btn-create-engineering-ticket-${row.id}`}
                            onClick={(e) => { e.stopPropagation(); openMapping(row); }}
                          >
                            <TicketPlus className="h-3 w-3" />
                            Eng.
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-1.5 bg-slate-50 border-t text-[11px] text-slate-500 flex items-center justify-between">
                <span>
                  {searchTerm
                    ? `${displayRows.length} match${displayRows.length === 1 ? "" : "es"} of ${activeRows.length} active`
                    : `${activeRows.length} active opportunit${activeRows.length === 1 ? "y" : "ies"}`}
                </span>
                <span className="text-slate-400">Click any row for full detail</span>
              </div>
            </div>
          </TabsContent>

          {/* ── Kanban view ───────────────────────────────────────────── */}
          <TabsContent value="kanban" className="mt-3">
            <OpportunitiesKanban
              rows={activeRows}
              onCardClick={(id) => setDrawerOppId(id)}
            />
          </TabsContent>

          {/* ── Calendar view ─────────────────────────────────────────── */}
          <TabsContent value="calendar" className="mt-3">
            <OpportunitiesCalendar
              rows={activeRows}
              onEventClick={(id) => setDrawerOppId(id)}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* ------------------------------------------------------------------ */}

      {/* Unified Opportunity drawer (2026-04-20 merge) — opens on row click. */}
      <OpportunityDrawer
        opportunityId={drawerOppId}
        open={drawerOppId != null}
        onClose={() => setDrawerOppId(null)}
      />

      <Dialog open={!!dlg.target} onOpenChange={(open) => { if (!open) updateDlg("reset"); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {dlg.skipMapping ? "Add Engineering Ticket" : "Create Engineering Ticket — Mapping"}
            </DialogTitle>
            <DialogDescription>
              {dlg.skipMapping
                ? "This opportunity already has tickets — re-using the existing client/project mapping. Add another ticket below."
                : "Project Developer is the mapping authority. Choose how this opportunity maps to client/project before ticket creation."}
            </DialogDescription>
          </DialogHeader>

          {mappingLoading ? (
            <div className="text-sm text-muted-foreground">Loading mapping context…</div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                <p>Deal: <span className="font-medium text-foreground">{mappingContext?.opportunity?.dealName || dlg.target?.dealName}</span></p>
                <p>Linked client: {mappingContext?.linkedClient ? "Yes" : "No"} • Linked project: {mappingContext?.linkedProject ? "Yes" : "No"}</p>
              </div>

              {!dlg.skipMapping && (
              <div className="space-y-2">
                <Label className="text-xs">Mapping mode</Label>
                <div className="grid gap-1 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" checked={dlg.mappingMode === "existing_existing"} onChange={() => updateDlg({ mappingMode: "existing_existing" })} /> Existing client + existing project</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={dlg.mappingMode === "existing_new"} onChange={() => updateDlg({ mappingMode: "existing_new" })} /> Existing client + create new project shell</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={dlg.mappingMode === "new_new"} onChange={() => updateDlg({ mappingMode: "new_new" })} /> Create new client + new project shell</label>
                </div>
              </div>
              )}

              {!dlg.skipMapping && dlg.mappingMode !== "new_new" && (
                <div className="space-y-1">
                  <Label className="text-xs">Client</Label>
                  <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.existingClientId} onChange={(e) => updateDlg({ existingClientId: e.target.value })}>
                    <option value="">Select client…</option>
                    {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {!dlg.skipMapping && dlg.mappingMode === "existing_existing" && (
                <div className="space-y-1">
                  <Label className="text-xs">Project</Label>
                  <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.existingProjectId} onChange={(e) => updateDlg({ existingProjectId: e.target.value })}>
                    <option value="">Select project…</option>
                    {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
                  </select>
                </div>
              )}

              {!dlg.skipMapping && dlg.mappingMode === "existing_new" && (
                <div className="space-y-1">
                  <Label className="text-xs">New project shell name</Label>
                  <Input value={dlg.newProjectName} onChange={(e) => updateDlg({ newProjectName: e.target.value })} placeholder="Enter project shell name" />
                </div>
              )}

              {!dlg.skipMapping && dlg.mappingMode === "new_new" && (
                <div className="grid gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">New client name</Label>
                    <Input value={dlg.newClientName} onChange={(e) => updateDlg({ newClientName: e.target.value })} placeholder="Enter client name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">New project shell name</Label>
                    <Input value={dlg.newProjectName} onChange={(e) => updateDlg({ newProjectName: e.target.value })} placeholder="Enter project shell name" />
                  </div>
                </div>
              )}

              {dlg.mappingWarnings.length > 0 && (
                <div className="text-xs rounded border border-amber-300 bg-amber-50 p-2 text-amber-800">
                  {dlg.mappingWarnings.map((w, i) => <p key={i}>• {w}</p>)}
                </div>
              )}

              {mappingResolved && (
                <div className="space-y-3 border-t pt-3">
                  <div className="text-xs text-muted-foreground">
                    Mapping resolved • client #{dlg.resolvedClientId} • project #{dlg.resolvedProjectId}
                  </div>

                  {phaseTemplates.length > 0 ? (
                    <div className="space-y-2">
                      <Label className="text-xs">Ticket creation mode</Label>
                      <div className="grid gap-1 text-sm">
                        <label className="flex items-center gap-2"><input type="radio" checked={dlg.ticketMode === "phase_template"} onChange={() => updateDlg({ ticketMode: "phase_template" })} /> Phase template</label>
                        <label className="flex items-center gap-2"><input type="radio" checked={dlg.ticketMode === "custom"} onChange={() => updateDlg({ ticketMode: "custom" })} /> Custom ticket</label>
                      </div>
                    </div>
                  ) : (
                    // No phase templates seeded — only "custom" makes sense.
                    // We coerce ticketMode to "custom" so the form below
                    // renders the right inputs.
                    <p className="text-[11px] text-slate-500 italic">
                      No phase templates are configured. Use the custom ticket form below.
                    </p>
                  )}

                  {dlg.ticketMode === "phase_template" && phaseTemplates.length > 0 ? (
                    <div className="grid gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Predefined phase template</Label>
                        <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.selectedTemplateId} onChange={(e) => updateDlg({ selectedTemplateId: e.target.value })}>
                          <option value="">Select template…</option>
                          {phaseTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.phase} • {t.name} (v{t.version}, {t.itemCount} item{t.itemCount === 1 ? "" : "s"})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Template base due date</Label>
                        <Input type="date" value={dlg.templateBaseDueDate} onChange={(e) => updateDlg({ templateBaseDueDate: e.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Title <span className="text-red-600">*</span></Label>
                        <Input value={dlg.customTitle} onChange={(e) => updateDlg({ customTitle: e.target.value })} data-testid="input-custom-title" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Phase <span className="text-red-600">*</span></Label>
                        <Input value={dlg.customPhase} onChange={(e) => updateDlg({ customPhase: e.target.value })} placeholder="e.g. First Assessment" data-testid="input-custom-phase" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description / Scope <span className="text-red-600">*</span></Label>
                        <Input value={dlg.customDescriptionScope} onChange={(e) => updateDlg({ customDescriptionScope: e.target.value })} data-testid="input-custom-scope" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Due date <span className="text-red-600">*</span></Label>
                          <Input type="date" value={dlg.customDueDate} onChange={(e) => updateDlg({ customDueDate: e.target.value })} data-testid="input-custom-due" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Priority</Label>
                          <select className="w-full border rounded-md h-9 px-2 text-sm" value={dlg.customPriority} onChange={(e) => updateDlg({ customPriority: e.target.value })} data-testid="select-custom-priority">
                            {["Critical", "High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Required output <span className="text-red-600">*</span></Label>
                        <Input value={dlg.customRequiredOutput} onChange={(e) => updateDlg({ customRequiredOutput: e.target.value })} data-testid="input-custom-required-output" />
                      </div>

                      <div className="border-t pt-2 mt-1">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                          Operational metadata <span className="font-normal normal-case text-slate-400">(optional — pre-filled from opportunity)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Funding type</Label>
                            <Input value={dlg.customFundingType} onChange={(e) => updateDlg({ customFundingType: e.target.value })} placeholder="e.g. Cash, PPA, Lease" data-testid="input-custom-funding" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Size (kWp)</Label>
                            <Input type="number" inputMode="decimal" value={dlg.customSizeKwp} onChange={(e) => updateDlg({ customSizeKwp: e.target.value })} data-testid="input-custom-kwp" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Province</Label>
                            <Input value={dlg.customProvince} onChange={(e) => updateDlg({ customProvince: e.target.value })} data-testid="input-custom-province" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">GPS coordinates</Label>
                            <Input value={dlg.customGpsCoordinates} onChange={(e) => updateDlg({ customGpsCoordinates: e.target.value })} placeholder="-26.1234, 28.1234" data-testid="input-custom-gps" />
                          </div>
                        </div>
                        <div className="grid grid-cols-[auto_1fr] gap-2 mt-2 items-end">
                          <label className="flex items-center gap-2 text-xs h-9">
                            <input type="checkbox" checked={dlg.customBatteriesNeeded} onChange={(e) => updateDlg({ customBatteriesNeeded: e.target.checked })} data-testid="checkbox-custom-batteries" />
                            Batteries needed
                          </label>
                          <div className="space-y-1">
                            <Label className="text-xs">Battery size (kWh)</Label>
                            <Input type="number" inputMode="decimal" value={dlg.customBatterySize} onChange={(e) => updateDlg({ customBatterySize: e.target.value })} disabled={!dlg.customBatteriesNeeded} data-testid="input-custom-battery-size" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => updateDlg("reset")}>Cancel</Button>
            {!mappingResolved ? (
              <Button onClick={() => resolveMappingMutation.mutate()} disabled={resolveMappingMutation.isPending || mappingLoading}>
                {resolveMappingMutation.isPending ? "Resolving…" : "Resolve Mapping"}
              </Button>
            ) : (
              <Button onClick={() => createEngineeringTicketsMutation.mutate()} disabled={createEngineeringTicketsMutation.isPending}>
                {createEngineeringTicketsMutation.isPending ? "Creating…" : dlg.ticketMode === "phase_template" ? "Generate Template Ticket(s)" : "Create Custom Ticket"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
