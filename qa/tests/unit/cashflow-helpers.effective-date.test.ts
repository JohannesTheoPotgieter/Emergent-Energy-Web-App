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
      [{ projectName: "P2", rowNumber: 12, linkedTaskDueDate: "2026-04-25", computedForecastReceiptDate: "2026-05-01", plannedPaymentDate: "2026-05-05" }],
      [{ projectName: "P2", milestoneRowNumber: 12, taskId: 101, dateOverride: null }],
      [{ id: 101, dueDate: "2026-04-25" }],
      [],
    );
    expect(withTaskDueDate.effectiveDate).toBe("2026-04-25");
  });

  it("keeps full hierarchy parity: admin > paid > link override > linked task > forecast", () => {
    const inflow = {
      projectName: "P4",
      rowNumber: 41,
      adminDateOverride: "2026-07-01",
      paymentReceivedDate: "2026-06-30",
      linkedTaskDueDate: "2026-06-25",
      computedForecastReceiptDate: "2026-07-15",
      plannedPaymentDate: "2026-07-20",
    };
    const [row] = resolveInflowEffectiveDates(
      [inflow],
      [{ projectName: "P4", milestoneRowNumber: 41, dateOverride: "2026-06-28" }],
      [],
      [],
    );

    expect(row.effectiveDate).toBe("2026-07-01");
  });

  it("does not read legacy operational/plan task arrays", () => {
    const failOnRead = new Proxy([], {
      get() {
        throw new Error("legacy array accessed");
      },
    });

    const [row] = resolveInflowEffectiveDates(
      [{ projectName: "P5", rowNumber: 9, linkedTaskDueDate: "2026-08-10", computedForecastReceiptDate: "2026-08-20" }],
      [{ projectName: "P5", milestoneRowNumber: 9, dateOverride: null }],
      failOnRead as any,
      failOnRead as any,
    );

    expect(row.effectiveDate).toBe("2026-08-10");
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
