/**
 * Outbound HTTP resilience — retry/backoff + circuit breaker.
 *
 * These guard the freeze-hardening contract: transient upstream failures
 * (429 / 5xx / network) retry with backoff, terminal errors (auth / 4xx) do
 * NOT, and a flapping upstream trips the breaker so it fails fast instead of
 * hammering the API and blocking the page. Pure module — driven with an
 * injected clock + sleep so there are no real timers.
 */

import { describe, expect, it, vi } from "vitest";
import {
  withRetry,
  isTransientError,
  getErrorStatus,
  CircuitBreaker,
  CircuitOpenError,
  getCircuitBreaker,
  __resetCircuitBreakersForTests,
} from "../../../server/lib/http-resilience";

const noSleep = async () => {};
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`upstream returned ${status}`), { status });
}

describe("getErrorStatus / isTransientError", () => {
  it("reads status from the error object and from the message", () => {
    expect(getErrorStatus(httpError(503))).toBe(503);
    expect(getErrorStatus(new Error("QuickBooks API /x returned 429: slow down"))).toBe(429);
    expect(getErrorStatus(new Error("no status here"))).toBeNull();
  });

  it("treats 429 / 5xx / network as transient and 4xx / auth as terminal", () => {
    expect(isTransientError(httpError(429))).toBe(true);
    expect(isTransientError(httpError(500))).toBe(true);
    expect(isTransientError(httpError(503))).toBe(true);
    expect(isTransientError(new Error("fetch failed: ECONNRESET"))).toBe(true);
    expect(isTransientError(httpError(400))).toBe(false);
    expect(isTransientError(httpError(401))).toBe(false);
    expect(isTransientError(httpError(403))).toBe(false);
    expect(isTransientError(new Error("invalid_grant"))).toBe(false);
  });

  it("never treats a CircuitOpenError as transient", () => {
    expect(isTransientError(new CircuitOpenError("quickbooks", 1000))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first result without retrying on success", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw httpError(503);
      return "recovered";
    });
    const onRetry = vi.fn();
    await expect(
      withRetry(fn, { attempts: 3, sleep: noSleep, onRetry }),
    ).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a terminal (auth) error — fails immediately", async () => {
    const fn = vi.fn(async () => {
      throw httpError(401);
    });
    await expect(withRetry(fn, { attempts: 5, sleep: noSleep })).rejects.toMatchObject({
      status: 401,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts the attempt budget on a persistent transient error", async () => {
    const fn = vi.fn(async () => {
      throw httpError(500);
    });
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({
      status: 500,
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("CircuitBreaker", () => {
  it("trips open after the failure threshold, then fails fast with CircuitOpenError", async () => {
    let t = 0;
    const breaker = new CircuitBreaker("test", { failureThreshold: 2, cooldownMs: 1000, now: () => t });
    const boom = async () => {
      throw httpError(503);
    };

    await expect(breaker.exec(boom)).rejects.toMatchObject({ status: 503 });
    await expect(breaker.exec(boom)).rejects.toMatchObject({ status: 503 });

    // Now open — the next call fails fast without invoking fn.
    const fn = vi.fn(async () => "should not run");
    await expect(breaker.exec(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
    expect(breaker.snapshot().state).toBe("open");
  });

  it("does not count a non-trip error toward opening", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 2, cooldownMs: 1000 });
    const authFail = async () => {
      throw httpError(401);
    };
    // 401 is terminal — marked non-countable, so repeated calls never open.
    await expect(breaker.exec(authFail, isTransientError)).rejects.toMatchObject({ status: 401 });
    await expect(breaker.exec(authFail, isTransientError)).rejects.toMatchObject({ status: 401 });
    await expect(breaker.exec(authFail, isTransientError)).rejects.toMatchObject({ status: 401 });
    expect(breaker.snapshot().state).toBe("closed");
  });

  it("half-opens after cooldown and closes on a successful trial", async () => {
    let t = 0;
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, cooldownMs: 1000, now: () => t });
    await expect(
      breaker.exec(async () => {
        throw httpError(503);
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(breaker.snapshot().state).toBe("open");

    // Still cooling down → fail fast.
    t = 500;
    await expect(breaker.exec(async () => "x")).rejects.toBeInstanceOf(CircuitOpenError);

    // Cooldown elapsed → half-open trial allowed; success closes it.
    t = 1000;
    await expect(breaker.exec(async () => "ok")).resolves.toBe("ok");
    expect(breaker.snapshot().state).toBe("closed");
  });

  it("re-opens if the half-open trial fails", async () => {
    let t = 0;
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, cooldownMs: 1000, now: () => t });
    await expect(
      breaker.exec(async () => {
        throw httpError(503);
      }),
    ).rejects.toMatchObject({ status: 503 });
    t = 1000; // half-open window
    await expect(
      breaker.exec(async () => {
        throw httpError(503);
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(breaker.snapshot().state).toBe("open");
  });

  it("shares one breaker per key via the registry", () => {
    __resetCircuitBreakersForTests();
    const a = getCircuitBreaker("quickbooks");
    const b = getCircuitBreaker("quickbooks");
    expect(a).toBe(b);
  });
});
