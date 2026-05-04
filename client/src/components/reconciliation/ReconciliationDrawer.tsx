/**
 * Reconciliation detail drawer.
 *
 * Slides in from the right when the user clicks a row in the program-wide
 * assessment or the project-level Excel-vs-App table. Shows:
 *   - What is wrong
 *   - Business impact
 *   - Source proof (Excel / App / QuickBooks)
 *   - Rule used + selected truth source
 *   - Risk + confidence
 *   - Suggested owner
 *   - Allowed actions
 *   - Audit trail (notes)
 *
 * Props:
 *   `exception` — a ProgramAssessmentException (or compatible shape).
 *   `open` / `onClose` — controlled open state.
 */
import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
  Database,
  FileSpreadsheet,
  Receipt,
  ShieldAlert,
  User,
  BookOpen,
} from "lucide-react";
import { Link } from "wouter";

// ---------------------------------------------------------------------------
// Types (mirrors server ProgramAssessmentException shape)
// ---------------------------------------------------------------------------

export interface ReconciliationException {
  id: string;
  projectId: number | null;
  projectName: string;
  tracker: string;
  issueType: string;
  displayIssue: string;
  excelValue: string | null;
  appValue: string | null;
  variance: string | null;
  risk: "high" | "medium" | "low";
  suggestedOwner: string;
  status: string;
  lastUpdated: string | null;
  drilldownUrl: string;
  businessImpact: string;
  allowBulkClose: boolean;
  requireOwnerNote: boolean;
  sourceProof: {
    app: { table: string; field: string; recordId: number | null; value: string | null };
    excel: { sheet: string | null; value: string | null } | null;
    qb: { note: string } | null;
  };
  ruleUsed: string;
  selectedTruthSource: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  exception: ReconciliationException | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function RiskBadge({ risk }: { risk: "high" | "medium" | "low" }) {
  if (risk === "high")
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <ShieldAlert className="h-3 w-3" /> High Risk
      </Badge>
    );
  if (risk === "medium")
    return (
      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 gap-1 text-xs">
        <AlertTriangle className="h-3 w-3" /> Medium Risk
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground gap-1 text-xs">
      <Info className="h-3 w-3" /> Low Risk
    </Badge>
  );
}

function ProofRow({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
  muted?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <span className="text-muted-foreground">{label}: </span>
        <span className={muted ? "text-muted-foreground" : "font-mono text-foreground"}>
          {value}
        </span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReconciliationDrawer({ open, onClose, exception: exc }: Props) {
  if (!exc) return null;

  const actionBlocked = exc.risk === "high";

  return (
    <Sheet open={open} onOpenChange={(v: boolean) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 flex-1 min-w-0">
              <SheetTitle className="text-sm leading-tight truncate">
                {exc.displayIssue}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground truncate">
                {exc.projectName} · {exc.tracker}
              </SheetDescription>
            </div>
            <RiskBadge risk={exc.risk} />
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4 space-y-5">

            {/* What is wrong */}
            <Section title="What is wrong">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-foreground">
                {exc.displayIssue}
              </div>
              {exc.variance && (
                <p className="text-xs text-muted-foreground">
                  Variance: <span className="font-mono">{exc.variance}</span>
                </p>
              )}
            </Section>

            {/* Business impact */}
            <Section title="Business impact">
              <div className="flex gap-2 text-xs text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                <span>{exc.businessImpact}</span>
              </div>
            </Section>

            <Separator />

            {/* Source proof — Excel */}
            {exc.sourceProof.excel && (
              <Section title="Excel source proof">
                <ProofRow icon={FileSpreadsheet} label="Sheet" value={exc.sourceProof.excel.sheet} />
                <ProofRow icon={FileSpreadsheet} label="Value" value={exc.sourceProof.excel.value} />
                <ProofRow icon={FileSpreadsheet} label="Excel value" value={exc.excelValue} />
              </Section>
            )}

            {/* Source proof — App */}
            <Section title="App source proof">
              <ProofRow icon={Database} label="Table" value={exc.sourceProof.app.table} />
              <ProofRow icon={Database} label="Field" value={exc.sourceProof.app.field} />
              {exc.sourceProof.app.recordId != null && (
                <ProofRow icon={Database} label="Record ID" value={String(exc.sourceProof.app.recordId)} />
              )}
              <ProofRow icon={Database} label="App value" value={exc.appValue} />
              <ProofRow icon={Database} label="Last updated" value={exc.lastUpdated} muted />
            </Section>

            {/* QuickBooks proof */}
            {exc.sourceProof.qb && (
              <Section title="QuickBooks proof">
                <ProofRow icon={Receipt} label="Note" value={exc.sourceProof.qb.note} />
              </Section>
            )}

            <Separator />

            {/* Rule + truth */}
            <Section title="Rule &amp; selected truth">
              <ProofRow icon={BookOpen} label="Rule" value={exc.ruleUsed} />
              <ProofRow icon={Database} label="Selected truth source" value={exc.selectedTruthSource} />
              <ProofRow icon={Info} label="Issue type" value={exc.issueType} muted />
            </Section>

            {/* Suggested owner */}
            <Section title="Ownership">
              <div className="flex items-center gap-2 text-xs">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Suggested owner: </span>
                <span className="font-medium text-foreground">{exc.suggestedOwner}</span>
              </div>
            </Section>

            <Separator />

            {/* Guardrails notice */}
            {actionBlocked && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex gap-2 text-xs text-red-700">
                <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  High-risk items cannot be bulk closed. An owner, note, and audit event are required.
                </span>
              </div>
            )}

            {/* Actions */}
            <Section title="Actions">
              <div className="flex flex-col gap-2">
                <Button asChild size="sm" variant="outline" className="w-full justify-start gap-2">
                  <Link href={exc.drilldownUrl}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open project reconciliation
                  </Link>
                </Button>
                {!actionBlocked && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-start gap-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                    disabled
                    title="Mark reviewed — available from project reconciliation page"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark reviewed (open project page)
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Resolution actions (accept Excel, keep app, send for approval) are available on the project reconciliation page.
              </p>
            </Section>

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
