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

    const typed = parsed as { budgetLine?: string; linkedMilestone?: string; paymentStatus?: string };
    expect(typed.budgetLine).toBe("BOS-Electrical");
    expect(typed.linkedMilestone).toBe("M3-Cable-Pull");
    expect(typed.paymentStatus).toBe("pending_approval");
  });

  it("keeps paid state available for closeout", () => {
    expect(procurementPaymentStatusEnum.enumValues).toContain("paid");
  });
});
