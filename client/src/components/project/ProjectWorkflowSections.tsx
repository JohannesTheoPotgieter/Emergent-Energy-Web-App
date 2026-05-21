import { CreditCard, FileCheck, FolderOpen, History, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectProcurementTab } from "@/components/tabs/ProjectProcurementTab";
import { ProjectSubcontractorsTab } from "@/components/tabs/ProjectSubcontractorsTab";
import { LocalFolderTab } from "@/components/tabs/LocalFolderTab";
import { DocumentStrip, ProjectSharepointRootCard } from "@/components/managed-documents";
import { ProjectChangeControlTab } from "@/components/tabs/ProjectChangeControlTab";
import { ProjectHistoryTab } from "@/components/tabs/ProjectHistoryTab";
import { WeeklyReviewWizard } from "@/components/WeeklyReviewWizard";
import { ProjectApprovalsTab } from "@/components/tabs/ProjectApprovalsTab";
import { ProjectChatTab } from "@/components/tabs/ProjectChatTab";

type NavigateSubTab = (subTab: string, extraParams?: Record<string, string | number | boolean | null | undefined>, deptOverride?: string) => void;

export function ProcurementWorkflowSection({
  activeSubTab,
  canViewProcurement,
  canViewSubcontractors,
  projectInfoId,
  projectName,
  procurementFilter,
  navigateToSubTab,
}: {
  activeSubTab: string;
  canViewProcurement: boolean;
  canViewSubcontractors: boolean;
  projectInfoId: number | null;
  projectName: string;
  procurementFilter?: string | null;
  navigateToSubTab: NavigateSubTab;
}) {
  return (
    <div className="space-y-3" data-testid="dept-procurement-section">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <span className="font-semibold">Procurement controls:</span>{" "}
        PO commitments, supplier status, and invoice-without-PO exceptions stay out of the finance calculation layer.
      </div>
      <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="procurement-sub-tabs">
        {[
          { key: "procurement", label: "Procurement", icon: CreditCard, visible: canViewProcurement },
          { key: "subcontractors", label: "Subcontractors", icon: Users, visible: canViewSubcontractors },
        ].filter(st => st.visible).map(st => (
          <Button key={st.key} size="sm" variant={activeSubTab === st.key ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
            <st.icon className="h-3 w-3 mr-1" /> {st.label}
          </Button>
        ))}
      </div>
      {activeSubTab === "procurement" && canViewProcurement && projectInfoId && <ProjectProcurementTab projectId={projectInfoId} projectName={projectName} initialFilter={procurementFilter || undefined} />}
      {activeSubTab === "subcontractors" && canViewSubcontractors && <ProjectSubcontractorsTab projectName={projectName} />}
    </div>
  );
}

export function DocumentsWorkflowSection({
  activeSubTab,
  projectInfoId,
  projectName,
  navigateToSubTab,
}: {
  activeSubTab: string;
  projectInfoId: number | null;
  projectName: string;
  navigateToSubTab: NavigateSubTab;
}) {
  return (
    <div className="space-y-3" data-testid="dept-documents-section">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <span className="font-semibold">Document authority:</span> SharePoint is the source of truth. The app indexes required artefacts and approval state; it does not replace SharePoint storage.
      </div>
      <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="documents-sub-tabs">
        {[
          { key: "controlled-docs", label: "SharePoint control", icon: ShieldCheck },
          { key: "documents", label: "Project folders", icon: FolderOpen },
        ].map(st => (
          <Button key={st.key} size="sm" variant={activeSubTab === st.key ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
            <st.icon className="h-3 w-3 mr-1" /> {st.label}
          </Button>
        ))}
      </div>
      {activeSubTab === "controlled-docs" && projectInfoId && (
        <div className="space-y-4">
          <ProjectSharepointRootCard projectId={projectInfoId} readOnly />
          <DocumentStrip projectId={projectInfoId} title="Required SharePoint artefacts" />
        </div>
      )}
      {activeSubTab === "documents" && <LocalFolderTab projectName={projectName} />}
    </div>
  );
}

export function HistoryWorkflowSection({
  activeSubTab,
  canViewDecisions,
  canViewHistory,
  canViewQuality,
  canViewFinance,
  canViewEngineering,
  projectInfoId,
  projectName,
  phase,
  completion,
  totalPaidInflows,
  totalExpenses,
  overdueEngineeringCount,
  navigateToSubTab,
}: {
  activeSubTab: string;
  canViewDecisions: boolean;
  canViewHistory: boolean;
  canViewQuality: boolean;
  canViewFinance: boolean;
  canViewEngineering: boolean;
  projectInfoId: number | null;
  projectName: string;
  phase: string | null;
  completion: number | null | undefined;
  totalPaidInflows: number;
  totalExpenses: number;
  overdueEngineeringCount: number;
  navigateToSubTab: NavigateSubTab;
}) {
  return (
    <div className="space-y-3" data-testid="dept-history-section">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <span className="font-semibold">Decision history:</span> changes, reviews, approvals, and communications remain anchored to the project record.
      </div>
      <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-hide" data-testid="history-sub-tabs">
        {[
          { key: "changes", label: "Changes", icon: FileCheck, visible: canViewDecisions },
          { key: "history", label: "Reviews", icon: History, visible: canViewHistory },
          { key: "approvals", label: "Approvals", icon: ShieldCheck, visible: canViewQuality },
          { key: "comms", label: "Communications", icon: MessageSquare, visible: true },
        ].filter(st => st.visible).map(st => (
          <Button key={st.key} size="sm" variant={activeSubTab === st.key ? "default" : "ghost"} className="h-7 text-xs whitespace-nowrap shrink-0" onClick={() => navigateToSubTab(st.key)} data-testid={`subtab-${st.key}`}>
            <st.icon className="h-3 w-3 mr-1" /> {st.label}
          </Button>
        ))}
      </div>
      {activeSubTab === "changes" && canViewDecisions && projectInfoId && <ProjectChangeControlTab projectId={projectInfoId} projectName={projectName} />}
      {activeSubTab === "history" && canViewHistory && (
        <div className="space-y-2">
          <WeeklyReviewWizard
            projectName={projectName}
            snapshotMetrics={{
              phase: phase || undefined,
              completion: completion ?? undefined,
              totalRevenue: canViewFinance ? totalPaidInflows : 0,
              totalExpenses: canViewFinance ? totalExpenses : 0,
              margin: canViewFinance && totalPaidInflows > 0 ? (totalPaidInflows - totalExpenses) / totalPaidInflows : 0,
              overdueCount: canViewEngineering ? overdueEngineeringCount : 0,
            }}
          />
          <ProjectHistoryTab projectName={projectName} />
        </div>
      )}
      {activeSubTab === "approvals" && canViewQuality && <ProjectApprovalsTab projectName={projectName} projectInfoId={projectInfoId} onNavigateSubTab={(sub) => navigateToSubTab(sub)} />}
      {activeSubTab === "comms" && <ProjectChatTab projectName={projectName} projectInfoId={projectInfoId} />}
    </div>
  );
}
