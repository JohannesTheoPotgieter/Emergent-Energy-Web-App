/**
 * MsReadinessChecklist — the "what's missing before Microsoft 365 works"
 * card for System Settings → Connections.
 *
 * Turns silent 401s into a plain-English checklist (credentials · encryption
 * key · signed in · SharePoint root) with a what-to-do hint per item, plus a
 * Connect / Reconnect button that runs the existing OAuth flow. Reads
 * /api/ms-integration/readiness (booleans + hints only — never secrets).
 */

import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

type CheckStatus = "ok" | "warn" | "missing";
interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
interface ReadinessResponse {
  overall: CheckStatus;
  mocked: boolean;
  checks: ReadinessCheck[];
}

const ICON: Record<CheckStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  missing: XCircle,
};
const TONE: Record<CheckStatus, string> = {
  ok: "text-emerald-600",
  warn: "text-amber-600",
  missing: "text-rose-600",
};

export function MsReadinessChecklist() {
  const { data, isLoading } = useQuery<ReadinessResponse>({
    queryKey: ["/api/ms-integration/readiness"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  return (
    <Card data-testid="ms-readiness">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Connection readiness</CardTitle>
          <CardDescription>What's needed before Microsoft 365 features work.</CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="btn-connect-m365"
          onClick={() => {
            window.location.href = "/api/auth/microsoft";
          }}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          {data?.overall === "ok" ? "Reconnect" : "Connect Microsoft 365"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Checking…</p>
        ) : !data ? (
          <p className="text-xs text-muted-foreground">Could not load readiness.</p>
        ) : (
          <>
            {data.mocked && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Dev mode — running on mock Microsoft data.
              </p>
            )}
            {data.checks.map((c) => {
              const Icon = ICON[c.status];
              return (
                <div key={c.key} className="flex items-start gap-2" data-testid={`readiness-${c.key}`}>
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${TONE[c.status]}`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.detail}</div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
