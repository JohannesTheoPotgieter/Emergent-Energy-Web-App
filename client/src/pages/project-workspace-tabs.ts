// ============================================================
// Project workspace tab + section mapping.
//
// PR-E of the truth/clear/simple redesign. Pulled out of the page so
// the tab → section → legacy-source mapping is testable and easy to
// read in one place.
//
// The legacy /project/id/:id has 9 departments × ~27 sub-tabs:
//
//   overview  → command, plan, gates, history, decisions, documents,
//               raid, dependencies
//   pm        → milestones, change-control, deliverables, work-items,
//               commissioning
//   finance   → revenue, expenditure, cos-tracker, revenue-tracker,
//               gp-tracker, cashflow, quickbooks
//   engineering → tasks, stages, gantt, key-dates
//   quality   → checklist, ncrs, audits
//   procurement → items, deliveries, invoices
//   documents → managed-documents
//   history   → activity, audit log
//   excel     → tracker replica
//
// The new shell collapses this into 4 tabs. Sub-departments become
// section headers, not nested tabs.
// ============================================================

export const PROJECT_WORKSPACE_TABS = [
  "plan",
  "money",
  "quality",
  "handover",
] as const;

export type ProjectWorkspaceTab = (typeof PROJECT_WORKSPACE_TABS)[number];

export const PROJECT_WORKSPACE_TAB_LABELS: Record<ProjectWorkspaceTab, string> = {
  plan: "Plan",
  money: "Money",
  quality: "Quality",
  handover: "Handover",
};

export interface WorkspaceSection {
  /** H2 title rendered above the section content. Matches the lookup in the page. */
  title: string;
  /** Owning tab. */
  tab: ProjectWorkspaceTab;
  /** Where the same content lived in the legacy detail page. Surfaced in the
   *  section header as "was: …" so users who don't trust the new layout
   *  can find the same data. */
  legacyLocation: string;
}

export const PROJECT_WORKSPACE_SECTIONS: WorkspaceSection[] = [
  // Plan tab
  { title: "Schedule (WBS)",                         tab: "plan",     legacyLocation: "Overview ▸ Plan" },
  { title: "RAID — Risks, Assumptions, Issues, Decisions", tab: "plan", legacyLocation: "Overview ▸ RAID" },
  // Money tab
  { title: "Revenue tracking",                        tab: "money",    legacyLocation: "Finance ▸ Revenue tracker" },
  { title: "Expenditure",                             tab: "money",    legacyLocation: "Finance ▸ Expenditure" },
  { title: "Cashflow",                                tab: "money",    legacyLocation: "Finance ▸ Cashflow" },
  // Quality tab
  { title: "Quality checklist",                       tab: "quality",  legacyLocation: "Quality ▸ Checklist" },
  // Handover tab
  { title: "Handover",                                tab: "handover", legacyLocation: "Overview ▸ Handover / PM ▸ Handover" },
];

/**
 * Returns the sections that should render inside the given tab, in
 * display order. Used by the page to render each tab's content and
 * by the tests to verify the mapping.
 */
export function sectionsForTab(tab: ProjectWorkspaceTab): WorkspaceSection[] {
  return PROJECT_WORKSPACE_SECTIONS.filter((s) => s.tab === tab);
}
