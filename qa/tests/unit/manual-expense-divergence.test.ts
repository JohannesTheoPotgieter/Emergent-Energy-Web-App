/**
 * Manual Expense — projectId Policy Tests
 *
 * Validates the policy that manual expenses require a valid projectId.
 * The finance-policy.ts module exports requireProjectId which throws
 * MissingProjectIdError for null/undefined/0 values and passes for
 * valid positive integers.
 */

import { describe, expect, it } from "vitest";
import {
  requireProjectId,
  MissingProjectIdError,
} from "../../../server/policies/finance-policy";

describe("finance-policy: requireProjectId export", () => {
  it("requireProjectId is exported as a function", () => {
    expect(typeof requireProjectId).toBe("function");
  });

  it("MissingProjectIdError is exported as a class", () => {
    expect(typeof MissingProjectIdError).toBe("function");
    const err = new MissingProjectIdError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MissingProjectIdError");
  });
});

describe("finance-policy: requireProjectId throws for invalid values", () => {
  it("throws MissingProjectIdError for null", () => {
    expect(() => requireProjectId(null)).toThrow(MissingProjectIdError);
  });

  it("throws MissingProjectIdError for undefined", () => {
    expect(() => requireProjectId(undefined)).toThrow(MissingProjectIdError);
  });

  it("throws MissingProjectIdError for 0", () => {
    expect(() => requireProjectId(0)).toThrow(MissingProjectIdError);
  });

  it("throws MissingProjectIdError for negative numbers", () => {
    expect(() => requireProjectId(-1)).toThrow(MissingProjectIdError);
    expect(() => requireProjectId(-100)).toThrow(MissingProjectIdError);
  });

  it("error message mentions projectId requirement", () => {
    try {
      requireProjectId(null);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("projectId");
    }
  });
});

describe("finance-policy: requireProjectId passes for valid positive integers", () => {
  it("passes for projectId = 1", () => {
    expect(() => requireProjectId(1)).not.toThrow();
  });

  it("passes for projectId = 42", () => {
    expect(() => requireProjectId(42)).not.toThrow();
  });

  it("passes for large positive integer", () => {
    expect(() => requireProjectId(999999)).not.toThrow();
  });
});
