// Verifies the Deliveries "will it make it?" planning — a procurement order is
// planned BACKWARD from the execution task it feeds (needed-on-site date):
//   not ordered → order-by = needed − lead time, vs today
//   ordered     → ETA = orderDate + lead time, vs needed
//   delivered   → did the actual delivery beat the needed date?

import { describe, it, expect } from "vitest";
import { planDelivery } from "../../../server/services/execution-board-service";

const TODAY = new Date("2026-06-24T00:00:00Z");

describe("planDelivery — will it make it", () => {
  it("not ordered, plenty of lead-time slack → green (in time) with an order-by date", () => {
    // needed 2026-09-01, lead 30d → order by 2026-08-02, ~39 days out → green
    const p = planDelivery("2026-09-01", 30, null, null, TODAY);
    expect(p.orderBy).toBe("2026-08-02");
    expect(p.eta).toBeNull();
    expect(p.willMakeIt).toBe("green");
  });

  it("not ordered, order-by within a week → amber (order soon)", () => {
    // needed 2026-07-20, lead 30d → order by 2026-06-20 ... that's past → red.
    // Use needed 2026-07-28, lead 30d → order by 2026-06-28, 4 days out → amber
    const p = planDelivery("2026-07-28", 30, null, null, TODAY);
    expect(p.orderBy).toBe("2026-06-28");
    expect(p.willMakeIt).toBe("amber");
  });

  it("not ordered, order-by already passed → red (order overdue)", () => {
    // needed 2026-07-01, lead 30d → order by 2026-06-01 (past) → red
    const p = planDelivery("2026-07-01", 30, null, null, TODAY);
    expect(p.orderBy).toBe("2026-06-01");
    expect(p.willMakeIt).toBe("red");
  });

  it("ordered, ETA beats needed with slack → green", () => {
    // ordered 2026-06-20, lead 30d → ETA 2026-07-20; needed 2026-09-01 → green
    const p = planDelivery("2026-09-01", 30, "2026-06-20", null, TODAY);
    expect(p.eta).toBe("2026-07-20");
    expect(p.orderBy).toBeNull();
    expect(p.willMakeIt).toBe("green");
  });

  it("ordered, ETA lands after needed → red (will miss)", () => {
    // ordered 2026-06-20, lead 60d → ETA 2026-08-19; needed 2026-08-01 → red
    const p = planDelivery("2026-08-01", 60, "2026-06-20", null, TODAY);
    expect(p.eta).toBe("2026-08-19");
    expect(p.willMakeIt).toBe("red");
  });

  it("delivered before needed → green; delivered after needed → red", () => {
    expect(planDelivery("2026-08-01", 30, "2026-06-01", "2026-07-15", TODAY).willMakeIt).toBe("green");
    expect(planDelivery("2026-08-01", 30, "2026-06-01", "2026-08-20", TODAY).willMakeIt).toBe("red");
  });

  it("no lead time or no needed date → null (can't assess)", () => {
    expect(planDelivery("2026-09-01", null, null, null, TODAY).willMakeIt).toBeNull();
    expect(planDelivery(null, 30, null, null, TODAY).willMakeIt).toBeNull();
  });
});
