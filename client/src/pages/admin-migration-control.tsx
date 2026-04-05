/**
 * Admin Migration Control — Wave 1 Step 5
 *
 * Control tower for tracking migration progress across all waves.
 * Reads from GET /api/admin/migration-status and GET /api/admin/reconciliation.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageShell } from "@/components/layout/page-shell";
import {
  CheckCircle, AlertCircle, Clock, Database, RefreshCw, Shield,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface DomainStatus {
  domain: string;
  promotedTable: string;
  legacyTable: string;
  promotedCount: number;
  legacyCount: number;
  parity: boolean;
  wave: string;
}

interface WaveStatus {
  wave: string;
  label: string;
  status: string;
}

interface MigrationStatusResponse {
  domains: DomainStatus[];
  waves: WaveStatus[];
}

const WAVE_STATUS_STYLES: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  complete: { label: "Complete", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  schema_complete: { label: "Schema Done", color: "bg-blue-100 text-blue-700", icon: Database },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700", icon: Clock },
  not_started: { label: "Not Started", color: "bg-muted text-muted-foreground", icon: Clock },
};

export default function AdminMigrationControlPage() {
  const { data: migrationData, isLoading, refetch } = useQuery<MigrationStatusResponse>({
    queryKey: ["admin-migration-status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/migration-status");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: reconData, isLoading: reconLoading, refetch: refetchRecon } = useQuery<any>({
    queryKey: ["admin-reconciliation"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/reconciliation?cached=true");
      return res.json();
    },
    staleTime: 60_000,
  });

  const totalDomains = migrationData?.domains.length ?? 0;
  const parityDomains = migrationData?.domains.filter((d) => d.parity).length ?? 0;
  const parityPct = totalDomains > 0 ? Math.round((parityDomains / totalDomains) * 100) : 0;

  return (
    <PageShell className="p-3 md:p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Migration Control
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchRecon(); }}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Wave Progress */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Wave Progress</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {migrationData?.waves.map((wave) => {
                const style = WAVE_STATUS_STYLES[wave.status] || WAVE_STATUS_STYLES.not_started;
                const Icon = style.icon;
                return (
                  <div key={wave.wave} className="text-center">
                    <div className="text-xs font-medium text-muted-foreground mb-1">{wave.wave}</div>
                    <Badge className={`text-xs ${style.color}`}>
                      <Icon className="h-3 w-3 mr-1" />
                      {style.label}
                    </Badge>
                    <div className="text-xs text-muted-foreground mt-1">{wave.label}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parity Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Schema Parity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Progress value={parityPct} className="flex-1" />
              <span className="text-sm font-medium">{parityPct}%</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {parityDomains} of {totalDomains} domains at parity
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reconciliation</CardTitle>
          </CardHeader>
          <CardContent>
            {reconLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : reconData ? (
              <div className="flex items-center gap-2">
                {reconData.overall === "PASS" ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                )}
                <span className="text-sm font-medium">
                  {reconData.overall === "PASS" ? "All checks passing" : `${reconData.failures?.length || 0} failures`}
                </span>
                {reconData.source === "cached" && (
                  <Badge variant="secondary" className="text-xs">cached</Badge>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No reconciliation data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Domain Detail Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Domain Migration Detail</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Wave</TableHead>
                  <TableHead>Promoted Table</TableHead>
                  <TableHead className="text-right">Promoted Rows</TableHead>
                  <TableHead className="text-right">Legacy Rows</TableHead>
                  <TableHead>Parity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {migrationData?.domains.map((d) => (
                  <TableRow key={d.domain}>
                    <TableCell className="font-medium">{d.domain}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{d.wave}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {d.promotedTable}
                    </TableCell>
                    <TableCell className="text-right">{d.promotedCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {d.legacyTable.startsWith("(") ? (
                        <span className="text-muted-foreground text-xs">{d.legacyTable}</span>
                      ) : (
                        d.legacyCount.toLocaleString()
                      )}
                    </TableCell>
                    <TableCell>
                      {d.parity ? (
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
