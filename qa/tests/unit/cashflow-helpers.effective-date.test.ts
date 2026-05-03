import { describe, expect, it } from "vitest";
import { resolveInflowEffectiveDates } from "../../../server/lib/cashflow-helpers";

describe("cashflow helper — inflow effective date hierarchy", () => {
  it("keeps paymentReceivedDate as cashflow source when no admin override exists", () => {
    const [row] = resolveInflowEffectiveDates(
      [{ projectName: "P1", rowNumber: 10, paymentReceivedDate: "2026-03-11", computedForecastReceiptDate: "2026-03-20", plannedPaymentDate: "2026-03-25" }],
      [],
      [],
      [],
    );

    expect(row.effectiveDate).toBe("2026-03-11");
  });

  it("uses linked task override hierarchy before forecast fallback", () => {
    const [withLinkDateOverride] = resolveInflowEffectiveDates(
      [{ projectName: "P2", rowNumber: 12, computedForecastReceiptDate: "2026-05-01", plannedPaymentDate: "2026-05-05" }],
      [{ projectName: "P2", milestoneRowNumber: 12, taskId: 101, dateOverride: "2026-04-20" }],
      [{ id: 101, dueDate: "2026-04-25" }],
      [],
    );
    expect(withLinkDateOverride.effectiveDate).toBe("2026-04-20");

    const [withTaskDueDate] = resolveInflowEffectiveDates(
      [{ projectName: "P2", rowNumber: 12, computedForecastReceiptDate: "2026-05-01", plannedPaymentDate: "2026-05-05" }],
      [{ projectName: "P2", milestoneRowNumber: 12, taskId: 101, dateOverride: null }],
      [{ id: 101, dueDate: "2026-04-25" }],
      [],
    );
    expect(withTaskDueDate.effectiveDate).toBe("2026-04-25");
  });

  it("retains plannedPaymentDate as explicit legacy fallback", () => {
    const [row] = resolveInflowEffectiveDates(
      [{ projectName: "P3", rowNumber: 99, computedForecastReceiptDate: null, plannedPaymentDate: "2026-06-09" }],
      [],
      [],
      [],
    );

    expect(row.effectiveDate).toBe("2026-06-09");
  });
});
