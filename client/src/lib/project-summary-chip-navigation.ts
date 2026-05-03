export type ProjectSummaryChipKey =
  | "handover-blocked"
  | "quality-risk"
  | "evidence-gaps"
  | "pending-approvals"
  | "procurement"
  | "raid"
  | "changes"
  | "commissioning"
  | "overdue-plan-tasks"
  | "overdue-engineering-tasks"
  | "overdue-supplier-costs"
  | "pending-quality-approvals";

export interface ProjectSummaryChipDestination {
  path: string;
  title: string;
  ariaLabel: string;
}

function projectPath(projectName: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/project/${encodeURIComponent(projectName)}${query ? `?${query}` : ""}`;
}

export function buildProjectSummaryChipDestinations(projectName: string): Partial<Record<ProjectSummaryChipKey, ProjectSummaryChipDestination>> {
  return {
    "handover-blocked": {
      path: projectPath(projectName, { dept: "quality", sub: "checklist", qualityFilter: "handover_blocking", chip: "handover-blocked" }),
      title: "Open QC items blocking handover",
      ariaLabel: "Open quality checklist filtered to handover-blocking items",
    },
    "quality-risk": {
      path: projectPath(projectName, { dept: "quality", sub: "checklist", qualityFilter: "critical_contributors", chip: "quality-critical" }),
      title: "Open QC items contributing to critical risk",
      ariaLabel: "Open quality checklist filtered to critical risk contributors",
    },
    "evidence-gaps": {
      path: projectPath(projectName, { dept: "quality", sub: "checklist", qualityFilter: "evidence_gap", chip: "quality-evidence-gaps" }),
      title: "Open quality evidence gaps",
      ariaLabel: "Open quality checklist filtered to evidence gaps",
    },
    "pending-approvals": {
      path: projectPath(projectName, { dept: "quality", sub: "checklist", qualityFilter: "review", chip: "quality-pending-approvals" }),
      title: "Open pending quality approvals",
      ariaLabel: "Open quality checklist filtered to in-review items",
    },
    procurement: {
      path: projectPath(projectName, { dept: "finance", sub: "procurement", procurementFilter: "overdue_open", chip: "procurement-overdue" }),
      title: "Open overdue procurement items",
      ariaLabel: "Open procurement tab filtered to overdue open items",
    },
    raid: {
      path: projectPath(projectName, { dept: "pm", sub: "raid", chip: "open-raid" }),
      title: "Open RAID register",
      ariaLabel: "Open project RAID tab",
    },
    changes: {
      path: projectPath(projectName, { dept: "pd", sub: "changes", chip: "active-changes" }),
      title: "Open active change requests",
      ariaLabel: "Open project change control tab",
    },
    commissioning: {
      path: projectPath(projectName, { dept: "pm", sub: "commissioning", chip: "incomplete-commissioning" }),
      title: "Open incomplete commissioning items",
      ariaLabel: "Open project commissioning tab",
    },
    "overdue-plan-tasks": {
      path: projectPath(projectName, { dept: "pm", sub: "plan", chip: "overdue-plan-tasks" }),
      title: "Open plan tasks",
      ariaLabel: "Open project plan tab",
    },
    "overdue-engineering-tasks": {
      path: projectPath(projectName, { dept: "eng", sub: "tasks", engFilter: "overdue", chip: "overdue-engineering-tasks" }),
      title: "Open overdue engineering tasks",
      ariaLabel: "Open engineering tasks filtered to overdue",
    },
    "pending-quality-approvals": {
      path: projectPath(projectName, { dept: "quality", sub: "checklist", qualityFilter: "review", chip: "pending-quality-approvals" }),
      title: "Open pending quality approvals",
      ariaLabel: "Open quality checklist filtered to review",
    },
    "overdue-supplier-costs": {
      path: projectPath(projectName, { dept: "finance", sub: "cost-lines", costFilter: "overdue_supplier", chip: "overdue-supplier-costs" }),
      title: "Open overdue supplier costs",
      ariaLabel: "Open cost lines filtered to overdue supplier costs",
    },
  };
}
