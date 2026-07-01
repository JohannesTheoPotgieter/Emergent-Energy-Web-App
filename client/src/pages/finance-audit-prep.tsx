/**
 * TF-9 follow-up (audit V3) — Audit Prep page.
 *
 * Surfaces the three TF-9 CSV exports (invoices-by-project,
 * revenue-milestones, period-locks) behind a small UI shell. The
 * server endpoints are already gated on `requirePermission("financials",
 * "approve")` — this page mirrors that gate client-side so the buttons
 * aren't visible to operators who can't actually pull the bundles.
 *
 * Visual is intentionally austere: this is a Finance ops tool, not a
 * customer-facing surface. Each download triggers a real CSV file
 * (the server adds the UTF-8 BOM + Content-Disposition header).
 */
import { useMemo, useState } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileDown, ShieldCheck, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const APPROVE_ROLES = new Set([
  "COO_ADMIN",
  "CEO_ADMIN",
  "CFO",
  "PROGRAM_FINANCE_MANAGER",
]);

interface ExportConfig {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  filenameStub: string;
}

const EXPORTS: ExportConfig[] = [
  {
    id: "invoices-by-project",
    title: "Invoices by project",
    description:
      "Every AR + AP invoice in the FY, grouped by project, with PO + payment evidence. Auditors use this to tie revenue and cost back to source documents.",
    endpoint: "/api/finance/audit-export/invoices-by-project",
    filenameStub: "invoices-by-project",
  },
  {
    id: "revenue-milestones",
    title: "Revenue milestones",
    description:
      "Every revenue milestone invoiced or realised in the FY, with milestone + dispute + write-off metadata. Auditors use this to verify revenue recognition.",
    endpoint: "/api/finance/audit-export/revenue-milestones",
    filenameStub: "revenue-milestones",
  },
  {
    id: "period-locks",
    title: "Period locks",
    description:
      "Every cos_period_locks transition (lock + unlock) in the FY with authoriser + reason. Auditors use this to verify that the books were closed in a controlled way.",
    endpoint: "/api/finance/audit-export/period-locks",
    filenameStub: "period-locks",
  },
];

function defaultFy(today = new Date()): number {
  // FY ends Aug 31, SAST. Use the calendar year of the August close.
  const sast = new Date(today.getTime() + 120 * 60 * 1000);
  return sast.getUTCMonth() >= 8 ? sast.getUTCFullYear() + 1 : sast.getUTCFullYear();
}

export default function FinanceAuditPrepPage() {
  const { user } = useAuth();
  const role = String(user?.role ?? "").toUpperCase();
  const canApprove = APPROVE_ROLES.has(role);

  const [fy, setFy] = useState<number>(defaultFy());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const fyValid = useMemo(
    () => Number.isInteger(fy) && fy >= 2020 && fy <= 2100,
    [fy],
  );

  async function downloadCsv(cfg: ExportConfig) {
    setLastError(null);
    setDownloading(cfg.id);
    try {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { Accept: "text/csv" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${cfg.endpoint}?fy=${encodeURIComponent(String(fy))}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Download failed (${res.status}). ${body.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${cfg.filenameStub}-fy${String(fy).slice(-2)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <FinanceShell>
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <SectionHeader
          icon={<ShieldCheck className="h-4 w-4" />}
          eyebrow="FINANCE · AUDIT"
          title="Audit Prep"
          description="Year-end auditor bundles. Each download returns the year's activity as a CSV that opens directly in Excel. Every export is recorded against the user's audit trail."
          badges={[
            { label: "financials : approve", variant: "outline" },
          ]}
        />

        {/* Trust provenance — the facts an auditor asks about a bundle. */}
        <div className="ee-data-trust-grid">
          <div className="ee-data-trust-card">
            <div className="ee-data-trust-label">FY window</div>
            <div className="ee-data-trust-value font-mono">
              Sep {fy - 1} – Aug {fy}
            </div>
          </div>
          <div className="ee-data-trust-card">
            <div className="ee-data-trust-label">Permission scope</div>
            <div className={`ee-data-trust-value ${canApprove ? "text-status-locked" : "text-status-adverse"}`}>
              {canApprove ? "financials : approve" : "read-only (no approve)"}
            </div>
          </div>
          <div className="ee-data-trust-card">
            <div className="ee-data-trust-label">Requested by</div>
            <div className="ee-data-trust-value truncate">
              {user?.name || user?.email || "—"}
            </div>
          </div>
          <div className="ee-data-trust-card">
            <div className="ee-data-trust-label">Delivery</div>
            <div className="ee-data-trust-value">CSV · UTF-8 · Excel-ready</div>
          </div>
        </div>

        {!canApprove && (
          <WorkspaceNotice
            tone="warning"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Your role does not have financials : approve"
            description="The download buttons are visible but will return 403 — the CFO or a member of the COO/CEO admin group needs to run these."
          />
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="audit-prep-fy" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Financial year (calendar year of the August close)
                </Label>
                <Input
                  id="audit-prep-fy"
                  type="number"
                  min={2020}
                  max={2100}
                  value={fy}
                  onChange={(e) => setFy(Number(e.target.value))}
                  className="mt-1 w-40 font-mono"
                  data-testid="input-audit-prep-fy"
                />
              </div>
              <p className="text-xs text-muted-foreground pb-2">
                E.g. <code className="font-mono">2026</code> = Sep 2025 – Aug 2026.
              </p>
            </div>
          </CardContent>
        </Card>

        {lastError && (
          <WorkspaceNotice
            tone="warning"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Download failed"
          >
            <span className="font-mono text-[12px] text-muted-foreground" data-testid="text-audit-prep-error">
              {lastError}
            </span>
          </WorkspaceNotice>
        )}

        <div className="grid grid-cols-1 gap-3">
          {EXPORTS.map((cfg) => (
            <Card key={cfg.id} data-testid={`card-audit-export-${cfg.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileDown className="w-4 h-4 text-status-ties" />
                  {cfg.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <p className="text-sm text-muted-foreground">{cfg.description}</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    FY <span className="font-mono">{fy}</span> · requested by{" "}
                    <span className="font-medium text-foreground">{user?.name || user?.email || "—"}</span>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => downloadCsv(cfg)}
                    disabled={!fyValid || downloading === cfg.id}
                    data-testid={`button-download-${cfg.id}`}
                  >
                    {downloading === cfg.id ? "Downloading..." : "Download CSV"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </FinanceShell>
  );
}
