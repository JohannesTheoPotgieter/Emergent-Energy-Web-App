import { describe, it, expect } from "vitest";
import { MytoolTaskIdempotencyStore } from "../../../server/lib/mytool-task-idempotency";

describe("MytoolTaskIdempotencyStore", () => {
  it("blocks duplicate pending requests (double click)", () => {
    const store = new MytoolTaskIdempotencyStore(60_000);
    const start = store.begin(1, "abc", 1000);
    const duplicate = store.begin(1, "abc", 1100);

    expect(start.state).toBe("started");
    expect(duplicate.state).toBe("duplicate_pending");
  });

  it("returns completed task for retries with same key", () => {
    const store = new MytoolTaskIdempotencyStore(60_000);
    store.begin(1, "req-1", 1000);
    store.complete(1, "req-1", 42, 1200);

    const replay = store.begin(1, "req-1", 1500);
    expect(replay.state).toBe("duplicate_completed");
    expect(replay.taskId).toBe(42);
  });

  it("expires keys after time window", () => {
    const store = new MytoolTaskIdempotencyStore(100);
    store.begin(1, "req-2", 1000);
    store.complete(1, "req-2", 7, 1000);

    const fresh = store.begin(1, "req-2", 1201);
    expect(fresh.state).toBe("started");
  });

  it("scopes idempotency keys by user", () => {
    const store = new MytoolTaskIdempotencyStore(60_000);
    store.begin(1, "same-key", 1000);
    const user2 = store.begin(2, "same-key", 1000);
    expect(user2.state).toBe("started");
  });
});
