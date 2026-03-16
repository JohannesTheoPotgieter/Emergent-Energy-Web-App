import fs from "node:fs";
import path from "node:path";
import { PAGE_REGISTRY } from "../../client/src/config/page-registry";

export type RouteProofStatus = "pass" | "fail" | "warn";

export interface RouteProofExpectation {
  routeId: string;
  label: string;
  expectedHeadingOrAnchor: RegExp;
  expectedPrimaryActionOrWidget: RegExp;
  allowPermissionBlocked?: boolean;
  todo: string;
}

export interface RouteProofResult {
  routeId: string;
  route: string;
  label: string;
  status: RouteProofStatus;
  permissionEntity?: string;
  permissionBlockedExpected: boolean;
  routeExists: boolean;
  routeComponentMapped: boolean;
  pageFile?: string;
  pageLoadsProof: "static-route-component";
  headingOrAnchorFound: boolean;
  primaryActionOrWidgetFound: boolean;
  redirectLoopRisk: "none" | "possible";
  apiDependencies: string[];
  missingMarkers: string[];
  suspectedDeadView: boolean;
  todo: string;
}

export const PRIORITY_ROUTE_EXPECTATIONS: RouteProofExpectation[] = [
  { routeId: "dashboard", label: "Home / Dashboard", expectedHeadingOrAnchor: /(Execution Board|Action Hub|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Link\s+href=|Create|New\s+PD\s+Ticket)/i, todo: "Add workflow assertion for role-aware landing redirects and KPI card drilldowns." },
  { routeId: "projectLifecycle", label: "Project Lifecycle", expectedHeadingOrAnchor: /(Project Lifecycle|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Search|Input|Link\s+href=)/i, todo: "Add workflow tests for section switching, lifecycle watchlist drilldowns, and overview refresh." },
  { routeId: "projects", label: "Projects", expectedHeadingOrAnchor: /(Project List|Project|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|SearchableSelect|input|Link\s+href=)/i, todo: "Add tests for filters, pagination, and project-open interactions." },
  { routeId: "projectDetail", label: "Project Detail", expectedHeadingOrAnchor: /(Project|Phase|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Tabs|Dialog|Textarea|input)/i, todo: "Add route-param + tab navigation workflow tests and save flows." },
  { routeId: "engineering", label: "Engineering", expectedHeadingOrAnchor: /(Engineering|data-testid|Standup)/i, expectedPrimaryActionOrWidget: /(Button|Table|Task|input|Link\s+href=)/i, todo: "Add tests for engineering triage and status transitions." },
  { routeId: "engineeringTasks", label: "Engineering Tasks", expectedHeadingOrAnchor: /(Engineering|Task|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|TaskGridView|input|select|Link\s+href=)/i, todo: "Add task lifecycle interaction tests for assignment and completion." },
  { routeId: "quality", label: "Quality", expectedHeadingOrAnchor: /(Quality|QA|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Chart|Table|input|Link\s+href=)/i, todo: "Add quality workflow checks for scorecards and defect drilldown." },
  { routeId: "pdDashboard", label: "PD Dashboard", expectedHeadingOrAnchor: /(PD|Product Development|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Ticket|input|Link\s+href=)/i, todo: "Add ticket creation and board state workflow coverage." },
  { routeId: "collaboration", label: "Collaboration", expectedHeadingOrAnchor: /(Collaboration|Hub|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Email|Teams|Link\s+href=|input)/i, todo: "Add provider-specific interaction tests (email/chat compose)." },
  { routeId: "myWork", label: "My Work", expectedHeadingOrAnchor: /(My Work|Today|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Task|Calendar|Link\s+href=|input)/i, todo: "Add personal task update and approval action workflow tests." },
  { routeId: "pmDashboard", label: "PM Dashboard", expectedHeadingOrAnchor: /(Execution Overview|Project Manager|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Project|KPI|input|Link\s+href=)/i, todo: "Add PM-specific prioritisation and escalation workflow tests." },
  { routeId: "executionBoard", label: "Work Plan / Board", expectedHeadingOrAnchor: /(Work Plan \/ Board|Execution Dashboard|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Table|input|Link\s+href=)/i, todo: "Add execution-board workflow tests for filters, drilldowns, and action-center links." },
  { routeId: "pmApprovals", label: "PM Approvals", expectedHeadingOrAnchor: /(Approvals|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Approve|Reject|Link\s+href=)/i, todo: "Add PM approvals workflow tests for approval decisions and project drilldowns." },
  { routeId: "pmDeliverables", label: "PM Deliverables", expectedHeadingOrAnchor: /(Deliverables|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Capture Deliverable|Download|Link\s+href=)/i, todo: "Add PM deliverables workflow tests for capture, approval routing, and Microsoft link drilldowns." },
  { routeId: "subcontractor", label: "Procurement", expectedHeadingOrAnchor: /(Procurement|Subcontractor|PO|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Table|input|Link\s+href=|Upload)/i, todo: "Add procurement action tests for PO and supplier operations." },
  { routeId: "adminControlCenter", label: "Admin Control Center", expectedHeadingOrAnchor: /(Control Center|Admin|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Card|Link\s+href=|input)/i, allowPermissionBlocked: true, todo: "Add admin-only governance action workflow tests." },
  { routeId: "smartImport", label: "Smart Import", expectedHeadingOrAnchor: /(Smart Import|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Upload|Tabs|input|Link\s+href=)/i, todo: "Add import wizard workflow tests for upload, issue resolution, and commit paths." },
  { routeId: "excelUpdates", label: "Excel Updates", expectedHeadingOrAnchor: /(Excel Updates|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Confirm|Tabs|input|Link\s+href=)/i, todo: "Add reconciliation queue workflow tests for bulk confirmation and filtering." },
  { routeId: "adminRoles", label: "Roles & Permissions", expectedHeadingOrAnchor: /(Roles & Permissions|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Tabs|input|select|Switch)/i, todo: "Add role governance workflow tests for editing authority models and user assignment review." },
  { routeId: "adminSettings", label: "System Settings", expectedHeadingOrAnchor: /(System Settings|Connections|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Switch|input|select|Link\s+href=)/i, todo: "Add Microsoft integration workflow tests for connection recovery and feature toggles." },
  { routeId: "adminActivity", label: "Audit Log", expectedHeadingOrAnchor: /(Audit Log|System Activity Log|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|SearchableSelect|input|Download|Link\s+href=)/i, todo: "Add audit filtering and detail drilldown workflow tests." },
  { routeId: "handoverControl", label: "Handover Control", expectedHeadingOrAnchor: /(Site \/ Execution Controls|Handover|Gate|data-testid)/i, expectedPrimaryActionOrWidget: /(Button|Checklist|Link\s+href=|input|Table)/i, todo: "Add end-to-end handover gate progression tests." },
];

function parseRouteComponentMap(appFile: string): Map<string, string> {
  const source = fs.readFileSync(appFile, "utf8");
  const importMap = new Map<string, string>();
  const importRegex = /import\s+(\w+)\s+from\s+"@\/pages\/([^"]+)";/g;
  for (const match of source.matchAll(importRegex)) {
    importMap.set(match[1], path.join("client", "src", "pages", `${match[2]}.tsx`));
  }

  const routeComponentsBlock = source.match(/const ROUTE_COMPONENTS:[\s\S]*?=\s*\{([\s\S]*?)\};/);
  const mapped = new Map<string, string>();
  if (!routeComponentsBlock) return mapped;

  const tokenRegex = /^\s*([A-Za-z0-9_]+)\s*,?$/gm;
  for (const match of routeComponentsBlock[1].matchAll(tokenRegex)) {
    const componentKey = match[1];
    const pageFile = importMap.get(componentKey);
    if (pageFile) mapped.set(componentKey, pageFile);
  }

  return mapped;
}

function extractApiDependencies(source: string): string[] {
  return [...new Set(Array.from(source.matchAll(/\/api\/[a-zA-Z0-9_\-/:]+/g)).map((m) => m[0]))].sort();
}

function readResolvedPageSource(pageFile: string): string {
  const absolute = path.join(process.cwd(), pageFile);
  if (!fs.existsSync(absolute)) return "";
  const source = fs.readFileSync(absolute, "utf8");
  const reExportMatch = source.match(/export\s+\{\s*default\s*\}\s+from\s+"(\.\/[^\"]+)";/);
  if (!reExportMatch) return source;

  const resolved = path.join(path.dirname(pageFile), `${reExportMatch[1].replace(/^\.\//, "")}.tsx`);
  const resolvedAbsolute = path.join(process.cwd(), resolved);
  if (!fs.existsSync(resolvedAbsolute)) return source;
  return fs.readFileSync(resolvedAbsolute, "utf8");
}

export function buildRouteProofResults(): RouteProofResult[] {
  const appFile = path.join(process.cwd(), "client/src/App.tsx");
  const componentMap = parseRouteComponentMap(appFile);

  return PRIORITY_ROUTE_EXPECTATIONS.map((expectation) => {
    const page = PAGE_REGISTRY.find((entry) => entry.id === expectation.routeId);
    const routeExists = !!page;
    const route = page?.path ?? "<missing>";
    const pageFile = page?.routeComponentKey ? componentMap.get(page.routeComponentKey) : undefined;
    const routeComponentMapped = !!page?.routeComponentKey && !!pageFile;

    const source = pageFile ? readResolvedPageSource(pageFile) : "";
    const headingOrAnchorFound = !!source && expectation.expectedHeadingOrAnchor.test(source);
    const primaryActionOrWidgetFound = !!source && expectation.expectedPrimaryActionOrWidget.test(source);
    const redirectLoopRisk = page?.redirectTo && page.redirectTo === page.path ? "possible" : "none";
    const apiDependencies = source ? extractApiDependencies(source) : [];

    const missingMarkers: string[] = [];
    if (!routeExists) missingMarkers.push("route missing in PAGE_REGISTRY");
    if (routeExists && !routeComponentMapped && !page?.redirectTo) missingMarkers.push("routeComponentKey not mapped to a page component");
    if (!headingOrAnchorFound) missingMarkers.push("expected heading/anchor not found");
    if (!primaryActionOrWidgetFound) missingMarkers.push("expected primary action/widget not found");
    if (redirectLoopRisk === "possible") missingMarkers.push("possible redirect loop");

    const suspectedDeadView = routeExists && routeComponentMapped && !headingOrAnchorFound && !primaryActionOrWidgetFound;

    return {
      routeId: expectation.routeId,
      route,
      label: expectation.label,
      status: missingMarkers.length === 0 ? "pass" : suspectedDeadView ? "fail" : "warn",
      permissionEntity: page?.permissionEntity,
      permissionBlockedExpected: Boolean(page?.permissionEntity || expectation.allowPermissionBlocked),
      routeExists,
      routeComponentMapped,
      pageFile,
      pageLoadsProof: "static-route-component",
      headingOrAnchorFound,
      primaryActionOrWidgetFound,
      redirectLoopRisk,
      apiDependencies,
      missingMarkers,
      suspectedDeadView,
      todo: expectation.todo,
    };
  });
}

export function listSuspectedDeadOrIncompleteViews(): RouteProofResult[] {
  return buildRouteProofResults().filter((result) => result.suspectedDeadView || result.missingMarkers.length > 0);
}
