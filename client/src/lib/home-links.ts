export const HOME_KPI_HREF: Record<string, string> = {
  "Active Projects": "/projects",
  "Total Projects": "/projects",
  "Red RAG": "/execution?rag=Red",
  "Red RAG Projects": "/execution?rag=Red",
  "Behind Plan": "/execution?behindPlanOnly=true",
  "Projects Behind Plan": "/execution?behindPlanOnly=true",
  "Avg Progress": "/execution",
  "Eng. Blockers": "/execution?engineeringBlockersOnly=true",
  "Quality Warnings": "/execution?qualityIssuesOnly=true",
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
  "Open Incidents": "/execution",
  "Corrective Actions Due": "/execution",
  "Safety Compliance": "/execution",
  "Inspections Overdue": "/execution",
  "Applications Pending": "/execution",
  "Queries Outstanding": "/execution",
  "Rejections Open": "/execution",
};

export function getHomeKpiHref(label: string): string | undefined {
  return HOME_KPI_HREF[label];
}

export function getHomeProjectHref(projectId?: number | null): string {
  return typeof projectId === "number" && Number.isFinite(projectId) && projectId > 0
    ? `/project/id/${projectId}`
    : "/execution";
}
