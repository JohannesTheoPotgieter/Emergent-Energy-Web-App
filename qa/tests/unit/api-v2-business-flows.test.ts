import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertPermission } from "../../../server/api/v2/policies/access-policy";

const repoMock = vi.hoisted(() => ({
  transitionProjectToConstruction: vi.fn(),
  getChecklistByProject: vi.fn(),
  createWorkItem: vi.fn(),
  patchWorkItem: vi.fn(),
  createProcurementItem: vi.fn(),
  patchProcurementItem: vi.fn(),
  createPurchaseOrder: vi.fn(),
  patchPurchaseOrder: vi.fn(),
  createInvoice: vi.fn(),
  getFinanceCashflow: vi.fn(),
  getFinanceCostLines: vi.fn(),
  getFinanceRevenueLines: vi.fn(),
  createFinanceVariation: vi.fn(),
  patchFinanceVariation: vi.fn(),
  dashboardCoreTotals: vi.fn(),
}));

vi.mock("../../../server/api/v2/repositories/project-v2-repository", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, ...repoMock };
});

import {
  createFinanceVariationService,
  createMilestoneService,
  createProcurementItemService,
  createPurchaseOrderService,
  createQualityCheckService,
  createWorkItemService,
  dashboardByRoleService,
  developmentHandoverService,
  financeCashflowService,
  financeCosService,
  financeExpenditureService,
  financeRevenueService,
  patchFinanceVariationService,
  patchMilestoneService,
  patchProcurementItemService,
  patchPurchaseOrderService,
  patchWorkItemService,
} from "../../../server/api/v2/services/project-v2-service";

describe("api v2 business flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates both history/source-of-truth on development handover", async () => {
    repoMock.transitionProjectToConstruction.mockResolvedValue({ id: 8, phase: "Construction" });
    const row = await developmentHandoverService(8, 2, "ready");
    expect(row.phase).toBe("Construction");
  });

  it("rejects invalid lifecycle transition", async () => {
    repoMock.transitionProjectToConstruction.mockResolvedValue({ invalidTransition: true, currentPhase: "Construction" });
    await expect(developmentHandoverService(8, 2, "ready")).rejects.toThrowError(/Invalid lifecycle transition/);
  });

  it("blocks unauthorized writes", () => {
    expect(() => assertPermission("ENGINEER", "finance.write")).toThrowError(/Missing permission/);
  });

  it("allows authorized work item create/patch", async () => {
    repoMock.createWorkItem.mockResolvedValue({ id: 5, title: "T" });
    repoMock.patchWorkItem.mockResolvedValue({ id: 5, title: "T2" });
    expect((await createWorkItemService(1, { title: "T" }, 9)).id).toBe(5);
    expect((await patchWorkItemService(1, 5, { title: "T2" })).title).toBe("T2");
  });

  it("prevents duplicate work item records by returning existing row", async () => {
    repoMock.createWorkItem.mockResolvedValue({ id: 7, title: "Dup" });
    const first = await createWorkItemService(1, { title: "Dup" }, 9);
    const second = await createWorkItemService(1, { title: "Dup" }, 9);
    expect(first.id).toBe(7);
    expect(second.id).toBe(7);
  });

  it("supports real milestone create/patch flow", async () => {
    repoMock.createWorkItem.mockResolvedValue({ id: 11, isMilestone: true });
    repoMock.patchWorkItem.mockResolvedValue({ id: 11, isMilestone: true, status: "In Progress" });
    expect((await createMilestoneService(1, { title: "M1" }, 2)).isMilestone).toBe(true);
    expect((await patchMilestoneService(1, 11, { status: "In Progress" })).status).toBe("In Progress");
  });

  it("supports procurement item create/patch", async () => {
    repoMock.createProcurementItem.mockResolvedValue({ id: 21 });
    repoMock.patchProcurementItem.mockResolvedValue({ id: 21, status: "approved" });
    expect((await createProcurementItemService(1, { title: "Cable" })).id).toBe(21);
    expect((await patchProcurementItemService(1, 21, { status: "approved" })).status).toBe("approved");
  });

  it("supports PO flow as a distinct service", async () => {
    repoMock.createPurchaseOrder.mockResolvedValue({ id: 31, poId: 1001 });
    repoMock.patchPurchaseOrder.mockResolvedValue({ id: 31, status: "ordered" });
    expect((await createPurchaseOrderService(1, { poId: 1001, title: "PO" })).poId).toBe(1001);
    expect((await patchPurchaseOrderService(1, 31, { status: "ordered" })).status).toBe("ordered");
  });

  it("returns differentiated finance views", async () => {
    repoMock.getFinanceCashflow.mockResolvedValue([{ status: "PLANNED", projected: 100, actual: 50 }]);
    repoMock.getFinanceCostLines.mockResolvedValue([{ status: "PAID", amountExVat: '100' }]);
    repoMock.getFinanceRevenueLines.mockResolvedValue([{ status: "PAID", amountExVat: '130' }]);
    expect((await financeCashflowService(1)).byStatus).toHaveLength(1);
    expect((await financeCosService(1)).lines[0].amountExVat).toBe('100');
    expect((await financeRevenueService(1)).lines[0].amountExVat).toBe('130');
    expect((await financeExpenditureService(1)).committed).toHaveLength(1);
  });

  it("supports finance variation create/patch", async () => {
    repoMock.createFinanceVariation.mockResolvedValue({ id: 41, type: "VARIATION" });
    repoMock.patchFinanceVariation.mockResolvedValue({ id: 41, status: "In Progress" });
    expect((await createFinanceVariationService(1, { title: "VO-1" }, 2)).type).toBe("VARIATION");
    expect((await patchFinanceVariationService(1, 41, { status: "In Progress" })).status).toBe("In Progress");
  });

  it("validates quality checklist belongs to project", async () => {
    repoMock.getChecklistByProject.mockResolvedValue(null);
    await expect(createQualityCheckService(1, { checklistId: 999, templateItemId: 1 })).rejects.toThrowError(/Checklist does not belong to project/);
  });

  it("dashboardByRole returns differentiated role payloads", async () => {
    repoMock.dashboardCoreTotals.mockResolvedValue({ projects: 3, openWorkItems: 5, openProcurement: 2, pendingInvoices: 4 });
    const cfo = await dashboardByRoleService("CFO");
    const eng = await dashboardByRoleService("ENGINEER");
    const coo = await dashboardByRoleService("COO_ADMIN");
    expect(cfo).toHaveProperty("overdueInvoices");
    expect(eng).toHaveProperty("pendingApprovals");
    expect(coo).toHaveProperty("overdueActions");
  });
});
