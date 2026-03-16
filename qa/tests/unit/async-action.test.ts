import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-error";
import { classifyAsyncFailure, runAsyncAction } from "@/lib/async-action";

describe("runAsyncAction", () => {
  it("times out long running actions and marks as retryable", async () => {
    const telemetry = vi.fn();

    await expect(runAsyncAction(async ({ signal }) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 80);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
      return "ok";
    }, {
      action: "test-timeout",
      timeoutMs: 10,
      telemetry,
    })).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });

    const statuses = telemetry.mock.calls.map(([event]) => event.status);
    expect(statuses).toEqual(["start", "timeout"]);
    expect(telemetry.mock.calls[1][0].failureType).toBe("retryable_failure");
  });

  it("preserves rejected promises and marks terminal failures", async () => {
    const telemetry = vi.fn();
    const err = new ApiError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "invalid",
    });

    await expect(runAsyncAction(async () => {
      throw err;
    }, {
      action: "test-reject",
      telemetry,
    })).rejects.toBe(err);

    expect(classifyAsyncFailure(err)).toBe("terminal_failure");
    expect(telemetry.mock.calls[1][0].status).toBe("failure");
    expect(telemetry.mock.calls[1][0].failureType).toBe("terminal_failure");
  });
});
