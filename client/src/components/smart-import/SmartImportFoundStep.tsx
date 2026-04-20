/**
 * Smart Import v2 — "What we found" step
 *
 * Shows the user what was detected in their uploaded file:
 * - Which project
 * - Import type (first-time or update)
 * - Sections found
 * - Sheets not used
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileSpreadsheet, ArrowRight, ArrowLeft, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { useState } from "react";
import { SECTION_LABELS, IMPORT_MODE_LABELS } from "./labels";
import { SmartImportQbProtectionsCallout } from "./SmartImportQbProtectionsCallout";
import { SmartImportPlanNarrative } from "./SmartImportPlanNarrative";

interface FoundStepProps {
  preview: any;
  planning: any | null;
  onContinue: () => void;
  onBack: () => void;
  /** Run id is needed to fetch QuickBooks protection summary. */
  runId?: number | null;
}

export function SmartImportFoundStep({ preview, planning, onContinue, onBack, runId }: FoundStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const detection = preview?.detection;
  const sections = detection?.sections || [];
  const unmatched = detection?.unmatched || [];
  const projectInfo = detection?.projectInfo;
  const importMode = planning?.importMode || "BASELINE";

  return (
    <Card data-testid="found-step">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-blue-600" />
          What we found in your spreadsheet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* UX-2: plain-English narrative at the top of the step. */}
        <SmartImportPlanNarrative planning={planning} preview={preview} />

        {/* Project */}
        <div data-testid="found-project">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600 w-28">Project</span>
            <span className="text-sm font-semibold" data-testid="found-project-name">
              {String(projectInfo?.name || "Unknown project")}
            </span>
          </div>
          {projectInfo && (projectInfo.sizeKwp || projectInfo.pm || projectInfo.pd || projectInfo.contractValue) && (
            <div className="ml-[7.5rem] mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground" data-testid="found-project-details">
              {projectInfo.sizeKwp && <span>Size: {String(projectInfo.sizeKwp)} kWp</span>}
              {projectInfo.pd && <span>PD: {String(projectInfo.pd)}</span>}
              {projectInfo.pm && <span>PM: {String(projectInfo.pm)}</span>}
              {projectInfo.contractValue && (
                <span>Contract: R {Number(projectInfo.contractValue).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</span>
              )}
            </div>
          )}
        </div>

        {/* Import type */}
        <div className="flex items-center gap-3" data-testid="found-import-type">
          <span className="text-sm font-medium text-slate-600 w-28">Import type</span>
          <Badge
            className={importMode === "BASELINE"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-blue-50 text-blue-700 border-blue-200"
            }
            data-testid="found-import-mode-badge"
          >
            {IMPORT_MODE_LABELS[importMode as keyof typeof IMPORT_MODE_LABELS] || importMode}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {importMode === "BASELINE"
              ? "All data will be added as new"
              : "Only changes will be applied"
            }
          </span>
        </div>

        {/* QuickBooks protections — shown high so the user sees what is
            locked before they look at section counts. The component itself
            decides how loud to be (full vs compact vs muted note). */}
        {runId && (
          <SmartImportQbProtectionsCallout runId={runId} />
        )}

        {/* Sections found */}
        <div data-testid="found-sections">
          <span className="text-sm font-medium text-slate-600 block mb-2">Sections found</span>
          <div className="grid gap-2">
            {sections.map((sec: any, idx: number) => {
              const rowCount = sec.dataRows ?? (sec.dataEndRowIndex != null && sec.dataStartRowIndex != null
                ? sec.dataEndRowIndex - sec.dataStartRowIndex + 1
                : null);
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-2.5 border"
                  data-testid={`found-section-${sec.section}`}
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-medium flex-1">
                    {SECTION_LABELS[sec.section] || String(sec.section || "")}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {rowCount != null && (
                      <span data-testid={`found-section-${sec.section}-rows`}>
                        {rowCount} row{rowCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    <span>from sheet &quot;{String(sec.sheetName || "")}&quot;</span>
                  </div>
                </div>
              );
            })}
            {sections.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                No recognized sections found. Please check the file format.
              </p>
            )}
          </div>
        </div>

        {/* Sheets not used */}
        {unmatched.length > 0 && (
          <div data-testid="found-unmatched">
            <span className="text-sm font-medium text-slate-600 block mb-2">Sheets not used</span>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
              <p className="mb-1 font-medium">
                {unmatched.length} sheet{unmatched.length > 1 ? "s were" : " was"} skipped
              </p>
              <ul className="text-xs space-y-0.5">
                {unmatched.map((u: any, i: number) => (
                  <li key={i}>&quot;{String(u.sheetName || "")}&quot; {u.reason ? `\u2014 ${String(u.reason)}` : ""}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Key dates */}
        {projectInfo && (projectInfo.constructionStartDate || projectInfo.commissioningDate || projectInfo.pdHandoverDate) && (
          <div data-testid="found-key-dates">
            <span className="text-sm font-medium text-slate-600 block mb-2">Key dates</span>
            <div className="flex flex-wrap gap-x-5 gap-y-1 bg-slate-50 rounded-lg px-4 py-2.5 border text-xs text-muted-foreground">
              {projectInfo.pdHandoverDate && (
                <span>PD Handover: <strong className="text-foreground">{new Date(projectInfo.pdHandoverDate).toLocaleDateString("en-ZA")}</strong></span>
              )}
              {projectInfo.constructionStartDate && (
                <span>Construction: <strong className="text-foreground">{new Date(projectInfo.constructionStartDate).toLocaleDateString("en-ZA")}</strong></span>
              )}
              {projectInfo.commissioningDate && (
                <span>Commissioning: <strong className="text-foreground">{new Date(projectInfo.commissioningDate).toLocaleDateString("en-ZA")}</strong></span>
              )}
              {projectInfo.clientHandoverDate && (
                <span>Client Handover: <strong className="text-foreground">{new Date(projectInfo.clientHandoverDate).toLocaleDateString("en-ZA")}</strong></span>
              )}
            </div>
          </div>
        )}

        {/* Multi-project notice */}
        {detection?.multiProject?.isMultiProject && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm text-blue-800" data-testid="found-multi-project">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Multi-project tracker detected</p>
                <p className="text-xs mt-0.5">
                  This file contains data for {detection.multiProject.subProjects?.length || "multiple"} sub-projects.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Advanced details */}
        <div className="border-t pt-3">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-slate-700 transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
            data-testid="found-advanced-toggle"
          >
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Advanced details
          </button>
          {showAdvanced && (
            <div className="mt-2 bg-slate-50 rounded-lg p-3 text-xs space-y-2" data-testid="found-advanced-panel">
              {planning?.warnings?.length > 0 && (
                <div>
                  <p className="font-medium text-slate-600 mb-1">Planner warnings</p>
                  <ul className="space-y-0.5 text-slate-500">
                    {planning.warnings.map((w: any, i: number) => <li key={i}>{typeof w === "object" ? JSON.stringify(w) : String(w)}</li>)}
                  </ul>
                </div>
              )}
              {sections.map((sec: any, i: number) => (
                <div key={i}>
                  <p className="font-medium text-slate-600">{String(sec.section || "")}</p>
                  <p className="text-slate-500">
                    Sheet: {String(sec.sheetName || "")}, Header row: {sec.headerRowIndex + 1}, Data rows: {sec.dataStartRowIndex + 1}–{sec.dataEndRowIndex + 1}
                    {sec.layoutVariant && sec.layoutVariant !== "UNKNOWN" ? `, Layout: ${String(sec.layoutVariant)}` : ""}
                    , Confidence: {Math.round(sec.confidence * 100)}%
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onBack} data-testid="found-back-btn">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Back
          </Button>
          <Button size="sm" onClick={onContinue} disabled={sections.length === 0} data-testid="found-continue-btn">
            Continue
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
