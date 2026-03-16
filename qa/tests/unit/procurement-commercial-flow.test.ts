import { describe, expect, it } from "vitest";
import { insertProcurementItemSchema, procurementPaymentStatusEnum } from "@shared/schema";

describe("procurement commercial flow schema", () => {
  it("supports unified commercial linkage fields", () => {
    const parsed = insertProcurementItemSchema.parse({
      projectId: 10,
      title: "Cable tray and install",
      category: "material",
      expectedCost: 100000,
      budgetLine: "BOS-Electrical",
      linkedDeliverableId: 55,
      linkedMilestone: "M3-Cable-Pull",
      progressPercent: 40,
      receiptRef: "GRN-123",
      paymentStatus: "pending_approval",
      linkedInvoiceCaptureId: 99,
    });

    expect(parsed.budgetLine).toBe("BOS-Electrical");
    expect(parsed.linkedMilestone).toBe("M3-Cable-Pull");
    expect(parsed.paymentStatus).toBe("pending_approval");
  });

  it("keeps paid state available for closeout", () => {
    expect(procurementPaymentStatusEnum.enumValues).toContain("paid");
  });
});
