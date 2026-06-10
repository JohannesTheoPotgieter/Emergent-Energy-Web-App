import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

interface SeedCostLine {
  id: number;
  projectId: number;
  projectName: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  idempotencyKey: string | null;
  updatedAt: string;
  createdAt: string;
  importRunId: number;
  expenseActualTotal: string;
  budgetTotal: string;
  expensePaymentDate: string;
  expenseLineItem: string;
  expenseCategory: string;
  rowType: "item";
}

const canonicalProjectId = 101;
const canonicalProjectName = "Alpha Canonical";
const driftedProjectName = "Alpha Legacy Drift";
const secondProjectId = 202;
const secondProjectName = "Beta Canonical";

const seededNormalizedRows: SeedCostLine[] = [
  // Scenario 1: duplicate active imported lineage key; newer row should win.
  {
    id: 11,
    projectId: canonicalProjectId,
    projectName: canonicalProjectName,
    sourceSheet: "OPS",
    sourceRow: 10,
    idempotencyKey: null,
    updatedAt: "2025-09-01T00:00:00.000Z",
    createdAt: "2025-09-01T00:00:00.000Z",
    importRunId: 1,
    expenseActualTotal: "100",
    budgetTotal: "100",
    expensePaymentDate: "2025-09-10",
    expenseLineItem: "Imported old",
    expenseCategory: "Capex",
    rowType: "item",
  },
  {
    id: 12,
    projectId: canonicalProjectId,
    projectName: canonicalProjectName,
    sourceSheet: "OPS",
    sourceRow: 10,
    idempotencyKey: null,
    updatedAt: "2025-09-03T00:00:00.000Z",
    createdAt: "2025-09-03T00:00:00.000Z",
    importRunId: 2,
    expenseActualTotal: "120",
    budgetTotal: "120",
    expensePaymentDate: "2025-09-10",
    expenseLineItem: "Imported newest",
    expenseCategory: "Capex",
    rowType: "item",
  },
  // Scenario 5: import rerun where old row incorrectly remained active; keep latest.
  {
    id: 13,
    projectId: canonicalProjectId,
    projectName: canonicalProjectName,
    sourceSheet: "OPS",
    sourceRow: 11,
    idempotencyKey: null,
    updatedAt: "2025-09-02T00:00:00.000Z",
    createdAt: "2025-09-02T00:00:00.000Z",
    importRunId: 2,
    expenseActualTotal: "80",
    budgetTotal: "80",
    expensePaymentDate: "2025-09-12",
    expenseLineItem: "Rerun old",
    expenseCategory: "Capex",
    rowType: "item",
  },
  {
    id: 14,
    projectId: canonicalProjectId,
    projectName: canonicalProjectName,
    sourceSheet: "OPS",
    sourceRow: 11,
    idempotencyKey: null,
    updatedAt: "2025-09-05T00:00:00.000Z",
    createdAt: "2025-09-05T00:00:00.000Z",
    importRunId: 3,
    expenseActualTotal: "90",
    budgetTotal: "90",
    expensePaymentDate: "2025-09-12",
    expenseLineItem: "Rerun newest",
    expenseCategory: "Capex",
    rowType: "item",
  },
  // Scenario 4: manual row with idempotency key must remain visible.
  {
    id: 15,
    projectId: canonicalProjectId,
    projectName: canonicalProjectName,
    sourceSheet: null,
    sourceRow: null,
    idempotencyKey: "manual-001",
    updatedAt: "2025-09-06T00:00:00.000Z",
    createdAt: "2025-09-06T00:00:00.000Z",
    importRunId: 99,
    expenseActualTotal: "50",
    budgetTotal: "50",
    expensePaymentDate: "2025-09-15",
    expenseLineItem: "Manual visible",
    expenseCategory: "Opex",
    rowType: "item",
  },
  // Scenario 3: project identity drift source row (legacy name) under same projectId.
  {
    id: 16,
    projectId: canonicalProjectId,
    projectName: driftedProjectName,
    sourceSheet: "OPS",
    sourceRow: 12,
    idempotencyKey: null,
    updatedAt: "2025-09-07T00:00:00.000Z",
    createdAt: "2025-09-07T00:00:00.000Z",
    importRunId: 3,
    expenseActualTotal: "0",
    budgetTotal: "0",
    expensePaymentDate: "2025-09-30",
    expenseLineItem: "Drift marker",
    expenseCategory: "Capex",
    rowType: "item",
  },
  // Project 2 duplicate imported lineage + manual row (multi-project inflation proof).
  {
    id: 21,
    projectId: secondProjectId,
    projectName: secondProjectName,
    sourceSheet: "OPS",
    sourceRow: 1,
    idempotencyKey: null,
    updatedAt: "2025-09-01T00:00:00.000Z",
    createdAt: "2025-09-01T00:00:00.000Z",
    importRunId: 4,
    expenseActualTotal: "70",
    budgetTotal: "70",
    expensePaymentDate: "2025-09-05",
    expenseLineItem: "Beta old import",
    expenseCategory: "Capex",
    rowType: "item",
  },
  {
    id: 22,
    projectId: secondProjectId,
    projectName: secondProjectName,
    sourceSheet: "OPS",
    sourceRow: 1,
    idempotencyKey: null,
    updatedAt: "2025-09-02T00:00:00.000Z",
    createdAt: "2025-09-02T00:00:00.000Z",
    importRunId: 5,
    expenseActualTotal: "75",
    budgetTotal: "75",
    expensePaymentDate: "2025-09-05",
    expenseLineItem: "Beta newest import",
    expenseCategory: "Capex",
    rowType: "item",
  },
  {
    id: 23,
    projectId: secondProjectId,
    projectName: secondProjectName,
    sourceSheet: null,
    sourceRow: null,
    idempotencyKey: "beta-manual-001",
    updatedAt: "2025-09-03T00:00:00.000Z",
    createdAt: "2025-09-03T00:00:00.000Z",
    importRunId: 5,
    expenseActualTotal: "30",
    budgetTotal: "30",
    expensePaymentDate: "2025-09-06",
    expenseLineItem: "Beta manual",
    expenseCategory: "Opex",
    rowType: "item",
  },
];

const legacyAllCostLinesSeed = [
  ...seededNormalizedRows,
];

function toCanonicalKey(row: SeedCostLine): string {
  if (row.sourceRow != null) return `${row.projectId}|${row.sourceSheet || "unknown-sheet"}|${row.sourceRow}`;
  if (row.idempotencyKey) return `${row.projectId}|manual|${row.idempotencyKey}`;
  return `${row.projectId}|manual|id:${row.id}`;
}

function dedupeByCurrentLineage(rows: SeedCostLine[]): SeedCostLine[] {
  const byKey = new Map<string, SeedCostLine>();
  for (const row of rows) {
    const key = toCanonicalKey(row);
    const existing = byKey.get(key);
    if (!existing || new Date(row.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

const passThrough = (req: any, _res: any, next: any) => {
  req.user = { id: 1, role: "COO_ADMIN" };
  next();
};

vi.mock("../../../server/departments/shared-middleware", () => ({
  requireAuth: passThrough,
  requireAdmin: passThrough,
  requireCosOverrideRole: passThrough,
}));

vi.mock("../../../server/permission-middleware", () => ({
  requirePermission: () => passThrough,
}));

vi.mock("../../../server/lib/finance-route-access", () => ({
  requireTrackerPermission: () => passThrough,
}));

vi.mock("../../../server/storage", () => ({
  storage: {
    getInflowLinesByProject: vi.fn(async () => [{ milestoneAmount: "400" }]),
    getTrackerMonthlyManual: vi.fn(async () => []),
    getExpenseTaskLinks: vi.fn(async () => []),
    getOperationalTasksByProject: vi.fn(async () => []),
    getProjectPlansByProject: vi.fn(async () => []),
    getProjectRevenueSummary: vi.fn(async () => ({ totalRevenue: 0 })),
    getAllCostLinesForCashflow: vi.fn(async () => legacyAllCostLinesSeed),
    getAllRevenueLinesForCashflow: vi.fn(async () => []),
    getAllMilestoneTaskLinks: vi.fn(async () => []),
    getAllOperationalTasks: vi.fn(async () => []),
    getAllProjectPlans: vi.fn(async () => []),
  },
}));

function mockQuery(rows: any[] = []) {
  const query: any = {
    from: () => query,
    where: () => query,
    leftJoin: () => query,
    innerJoin: () => query,
    orderBy: () => query,
    groupBy: () => query,
    limit: () => query,
    then: (resolve: any) => Promise.resolve(rows).then(resolve),
    catch: (reject: any) => Promise.resolve(rows).catch(reject),
  };
  return query;
}

vi.mock("../../../server/db", () => ({
  db: {
    select: vi.fn(() => mockQuery([])),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  },
}));

vi.mock("../../../server/work-items-adapter", () => ({
  isWorkItemsEnabled: vi.fn(async () => false),
  getWorkItemsAsOperationalTasks: vi.fn(async () => []),
}));

vi.mock("../../../server/services/dashboard-metrics", () => ({
  refreshProjectMetricsAsync: vi.fn(async () => undefined),
}));

vi.mock("../../../server/services/notification-service", () => ({
  createNotification: vi.fn(async () => undefined),
}));

vi.mock("../../../server/services/project-cost-line-read-service", () => {
  const getRowsByProjectId = (projectId: number) => {
    const filtered = seededNormalizedRows.filter((r) => r.projectId === projectId);
    return dedupeByCurrentLineage(filtered).map((row) => ({
      ...row,
      canonicalLineKey: toCanonicalKey(row),
      lineageType: row.sourceRow != null ? "IMPORTED" : row.idempotencyKey ? "MANUAL_IDEMPOTENT" : "MANUAL_FALLBACK",
      isCurrent: true,
      effectiveFrom: null,
      noRevenueLinked: false,
      expenseInvoicedDate: row.expensePaymentDate,
      expenseInvoiceNumber: `INV-${row.id}`,
    }));
  };
  const getAllRows = () => {
    const deduped = dedupeByCurrentLineage(seededNormalizedRows);
    return deduped.map((row) => ({
      ...row,
      canonicalLineKey: toCanonicalKey(row),
      lineageType: row.sourceRow != null ? "IMPORTED" : row.idempotencyKey ? "MANUAL_IDEMPOTENT" : "MANUAL_FALLBACK",
      isCurrent: true,
      effectiveFrom: null,
      noRevenueLinked: false,
      expenseInvoicedDate: row.expensePaymentDate,
      expenseInvoiceNumber: `INV-${row.id}`,
    }));
  };

  return {
    getCanonicalProjectCostLines: vi.fn(async (projectId: number) => getRowsByProjectId(projectId)),
    getCanonicalProjectCostLinesByName: vi.fn(async (projectName: string) => {
      const normalized = decodeURIComponent(projectName).trim().toLowerCase();
      if (normalized === canonicalProjectName.toLowerCase()) {
        return { projectId: canonicalProjectId, rows: getRowsByProjectId(canonicalProjectId) };
      }
      return { projectId: null, rows: [] };
    }),
    getCanonicalAllCurrentCostLines: vi.fn(async () => getAllRows()),
    resolveProjectIdByName: vi.fn(async (name: string) => (name === canonicalProjectName ? canonicalProjectId : null)),
    getCanonicalCostLineDiagnostics: vi.fn(async () => ({ totalRows: 0, duplicateCanonicalGroups: 0, duplicateRows: 0, lineageSummary: {}, duplicates: [] })),
    getCostLineRiskDiagnostics: vi.fn(async () => ({
      generatedAt: new Date().toISOString(),
      scope: canonicalProjectId,
      duplicateActiveLineageGroups: { count: 1, sample: [] },
      nullSourceImportedRows: { count: 0, sample: [] },
      projectNameDriftGroups: { count: 1, sample: [] },
    })),
  };
});

describe("canonical dedupe proof on finance endpoints (hermetic)", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    const { registerFinanceRoutes } = await import("../../../server/departments/finance-routes");
    registerFinanceRoutes(app);
  });

  it("expenditure-breakdown returns deduped logical rows with canonical metadata and manual row visible", async () => {
    const res = await request(app).get(`/api/expenditure-breakdown/${encodeURIComponent(canonicalProjectName)}`);
    expect(res.status).toBe(200);

    const items = res.body.items as any[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(4);

    const keys = items.map((i) => i.canonicalLineKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toContain(`${canonicalProjectId}|manual|manual-001`);

    const latestImported = items.find((i) => i.canonicalLineKey === `${canonicalProjectId}|OPS|10`);
    expect(Number(latestImported.expenseActualTotal)).toBe(120);

    const totalActual = items.reduce((sum, item) => sum + Number(item.expenseActualTotal || 0), 0);
    expect(totalActual).toBe(260);
    expect(totalActual).not.toBe(360); // would include old duplicate 100
    expect(totalActual).not.toBe(1259); // would include program_expense overlap seed 999
  });

  // Canonical line-level dedup proof at the project-cost-line read layer.
  // The per-project COS assertion previously hit /api/cos-tracker/project, a
  // PARALLEL endpoint retired in refactor/project-detail-finance-unify. The
  // dedup property is now inherent to the canonical § 3.3.2 read path
  // (finance-line-level-repository, consumed by /api/finance/lines, the finance
  // pages, the reconciliation board and project-detail) and is asserted by the
  // cross-surface guard in verify:finance, so it is not re-tested against a
  // retired endpoint here. (Revenue/GP totals derive from the FYE reconciliation
  // engine — owner decision 2026-06 — covered by the FYE / reconciliation suites.)

  it("diagnostics endpoint exposes risk categories", async () => {
    const res = await request(app).get(`/api/finance/cost-lines/diagnostics?projectId=${canonicalProjectId}`);
    expect(res.status).toBe(200);
    expect(res.body.risks).toHaveProperty("duplicateActiveLineageGroups");
    expect(res.body.risks).toHaveProperty("nullSourceImportedRows");
    expect(res.body.risks).toHaveProperty("projectNameDriftGroups");
  });
});
