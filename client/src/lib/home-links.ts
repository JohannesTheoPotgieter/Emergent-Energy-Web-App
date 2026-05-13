export const HOME_KPI_HREF: Record<string, string> = {
  "Active Projects": "/projects",
  "Total Projects": "/projects",
  "Red RAG": "/execution-board?rag=Red",
  "Red RAG Projects": "/execution-board?rag=Red",
  "Behind Plan": "/execution-board?behindPlanOnly=true",
  "Projects Behind Plan": "/execution-board?behindPlanOnly=true",
  "Avg Progress": "/execution-board",
  "Eng. Blockers": "/execution-board?engineeringBlockersOnly=true",
  "Quality Warnings": "/execution-board?qualityIssuesOnly=true",
  "Pending Approvals": "/pm/approvals",
  "Approvals Due": "/pm/approvals",
  "Inflow (FY)": "/cashflow",
  "Inflow Received (FY)": "/cashflow",
  "Received Inflow (FY)": "/cashflow",
  "Planned Revenue (FY)": "/revenue-tracker",
  "Gross Margin": "/finance/gp/company",
  "Gross Profit": "/finance/gp/company",
  "Gross Profit (FY)": "/finance/gp/company",
  "Open Expenditure": "/cos",
  "Open Expenditure (FY)": "/cos",
  "Paid Expenditure": "/cos",
  "Overdue Inflow": "/cashflow",
  "Revenue Outstanding": "/revenue-tracker",
  "COS Outstanding": "/cos",
  "Overdue Outflow": "/cos",
  "Open Incidents": "/execution-board",
  "Corrective Actions Due": "/execution-board",
  "Safety Compliance": "/execution-board",
  "Inspections Overdue": "/execution-board",
  "Applications Pending": "/execution-board",
  "Queries Outstanding": "/execution-board",
  "Rejections Open": "/execution-board",
};

export function getHomeKpiHref(label: string): string | undefined {
  return HOME_KPI_HREF[label];
}

export function getHomeProjectHref(projectId?: number | null): string {
  return typeof projectId === "number" && Number.isFinite(projectId) && projectId > 0
    ? `/project/id/${projectId}`
    : "/execution-board";
}
