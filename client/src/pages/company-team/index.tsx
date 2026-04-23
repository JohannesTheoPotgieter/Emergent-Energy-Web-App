import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { RefreshCw, Users, Activity, AlertTriangle, UserPlus, Search, Info } from "lucide-react";

type TeamSummary = {
  headcount: number | null;
  avgUtilisation: number | null;
  overAllocated: number | null;
  openRoles: number | null;
};

type TeamPerson = {
  id: number;
  fullName: string;
  initials: string;
  jobTitle: string | null;
  location: string | null;
  utilisationPct: number | null;
  activeProjectCount: number | null;
  status: string;
};

type CompanyTeamData = {
  summary: TeamSummary;
  people: TeamPerson[];
  meta: {
    refreshedAt: string;
    confidence: "high" | "partial" | "low";
    sourceNotes: string[];
  };
};

const NA = "Data unavailable";

function formatPct(value: number | null): string {
  return value == null ? NA : `${value}%`;
}

function formatNumber(value: number | null): string {
  return value == null ? NA : value.toLocaleString();
}

function utilisationTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct > 100) return "text-destructive";
  if (pct >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

function statusBandClasses(status: string, utilisationPct: number | null): string {
  if (status !== "active") return "bg-muted";
  if (utilisationPct != null && utilisationPct > 100) return "bg-destructive";
  if (utilisationPct != null && utilisationPct >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

function statusLabel(status: string): string {
  if (!status) return NA;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  testId,
  hint,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  hint?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-semibold ${value === NA ? "text-muted-foreground text-base font-normal italic" : "text-foreground"}`}
          data-testid={`${testId}-value`}
        >
          {value}
        </div>
        {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function PersonCard({ person }: { person: TeamPerson }) {
  return (
    <Card
      className="overflow-hidden hover:shadow-sm transition-shadow"
      data-testid={`card-team-person-${person.id}`}
    >
      <div
        className={`h-1 w-full ${statusBandClasses(person.status, person.utilisationPct)}`}
        data-testid={`status-band-person-${person.id}`}
      />
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold"
            aria-hidden="true"
            data-testid={`avatar-person-${person.id}`}
          >
            {person.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="font-medium text-sm text-foreground truncate"
              data-testid={`text-person-name-${person.id}`}
            >
              {person.fullName}
            </div>
            <div
              className={`text-xs truncate ${person.jobTitle ? "text-muted-foreground" : "text-muted-foreground italic"}`}
              data-testid={`text-person-jobtitle-${person.id}`}
            >
              {person.jobTitle ?? NA}
            </div>
          </div>
          {person.utilisationPct != null && person.utilisationPct > 100 && (
            <Badge variant="destructive" className="shrink-0 text-[10px]">
              Over
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 text-xs">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Location
            </div>
            <div
              className={person.location ? "text-foreground" : "text-muted-foreground italic"}
              data-testid={`text-person-location-${person.id}`}
            >
              {person.location ?? NA}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Status
            </div>
            <div
              className="text-foreground"
              data-testid={`text-person-status-${person.id}`}
            >
              {statusLabel(person.status)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Active Projects
            </div>
            <div
              className={person.activeProjectCount == null ? "text-muted-foreground italic" : "text-foreground"}
              data-testid={`text-person-projects-${person.id}`}
            >
              {person.activeProjectCount ?? NA}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Utilisation
            </div>
            <div
              className={`text-sm font-semibold ${utilisationTone(person.utilisationPct)}`}
              data-testid={`text-person-utilisation-${person.id}`}
            >
              {person.utilisationPct == null ? (
                <span className="text-xs italic font-normal text-muted-foreground">{NA}</span>
              ) : (
                `${person.utilisationPct}%`
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompanyTeamPage() {
  useAuth();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CompanyTeamData>({
    queryKey: ["/api/company/team"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/company/team");
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.people ?? []).filter((p) => {
      if (!q) return true;
      return (
        p.fullName.toLowerCase().includes(q) ||
        (p.jobTitle ?? "").toLowerCase().includes(q) ||
        (p.location ?? "").toLowerCase().includes(q)
      );
    });
  }, [data?.people, search]);

  return (
    <PageShell data-testid="company-team-page">
      {isError && (
        <div className="mb-4">
          <QueryErrorBanner error={error} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
            data-testid="text-page-title"
          >
            Team
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Workforce directory and resourcing summary across the company
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.meta?.confidence && (
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wide"
              data-testid="badge-data-confidence"
            >
              Confidence: {data.meta.confidence}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8"
            data-testid="button-refresh-team"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] w-full" />
          ))
        ) : (
          <>
            <SummaryCard
              title="Headcount"
              value={formatNumber(data?.summary.headcount ?? null)}
              icon={Users}
              testId="card-summary-headcount"
            />
            <SummaryCard
              title="Avg Utilisation"
              value={formatPct(data?.summary.avgUtilisation ?? null)}
              icon={Activity}
              testId="card-summary-utilisation"
              hint={
                data?.summary.avgUtilisation == null
                  ? "No allocation data on active work items"
                  : undefined
              }
            />
            <SummaryCard
              title="Over-allocated"
              value={formatNumber(data?.summary.overAllocated ?? null)}
              icon={AlertTriangle}
              testId="card-summary-overallocated"
              hint={
                data?.summary.overAllocated == null
                  ? "No allocation data on active work items"
                  : undefined
              }
            />
            <SummaryCard
              title="Open Roles"
              value={formatNumber(data?.summary.openRoles ?? null)}
              icon={UserPlus}
              testId="card-summary-openroles"
              hint={
                data?.summary.openRoles == null
                  ? "No active projects"
                  : "Unassigned functional leads on active projects"
              }
            />
          </>
        )}
      </section>

      <section className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, title, location"
            className="pl-8 h-8 text-sm"
            data-testid="input-search-team"
          />
        </div>
      </section>

      <section data-testid="section-team-directory">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[200px] w-full" />
            ))}
          </div>
        ) : filteredPeople.length === 0 ? (
          <Card>
            <CardContent
              className="py-10 text-center text-sm text-muted-foreground"
              data-testid="text-team-empty"
            >
              {data?.people?.length === 0
                ? "No active users found."
                : "No team members match the current search."}
            </CardContent>
          </Card>
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
            data-testid="grid-team-people"
          >
            {filteredPeople.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        )}
      </section>

      {data?.meta?.sourceNotes && data.meta.sourceNotes.length > 0 && (
        <section className="mt-6 pt-4 border-t" data-testid="section-source-notes">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <ul className="space-y-1">
              {data.meta.sourceNotes.map((note, i) => (
                <li key={i} data-testid={`text-source-note-${i}`}>{note}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </PageShell>
  );
}
