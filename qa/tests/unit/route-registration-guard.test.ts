import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRouteRegistrationGuardForTests,
  registerRouteGroupOnce,
} from "../../../server/routes/route-registration-guard";

describe("route-registration-guard", () => {
  beforeEach(() => {
    __resetRouteRegistrationGuardForTests();
  });

  it("registers a route group once and blocks duplicate registration with same owner+key", () => {
    const register = vi.fn();
    const onSkip = vi.fn();

    const first = registerRouteGroupOnce({
      key: "finance-routes",
      owner: "department-finance",
      register,
      onSkip,
    });

    const second = registerRouteGroupOnce({
      key: "finance-routes",
      owner: "department-finance",
      register,
      onSkip,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("allows same key under different owners to avoid cross-domain collisions", () => {
    const registerA = vi.fn();
    const registerB = vi.fn();

    const first = registerRouteGroupOnce({
      key: "handover-routes",
      owner: "department-handover",
      register: registerA,
    });

    const second = registerRouteGroupOnce({
      key: "handover-routes",
      owner: "legacy-shell",
      register: registerB,
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(registerA).toHaveBeenCalledTimes(1);
    expect(registerB).toHaveBeenCalledTimes(1);
  });
});
