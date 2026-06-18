import { describe, it, expect } from "vitest";
import type { Request } from "express";
import {
  readQbOAuthStateCookie,
  statesMatch,
  QB_OAUTH_STATE_COOKIE,
} from "../../../server/lib/quickbooks-oauth-state";

function reqWithCookieHeader(header: string | undefined): Request {
  return { headers: header === undefined ? {} : { cookie: header } } as unknown as Request;
}

describe("statesMatch", () => {
  it("is true only for identical non-empty states", () => {
    expect(statesMatch("abc123", "abc123")).toBe(true);
  });

  it("is false for differing states of equal length", () => {
    expect(statesMatch("abc123", "abc124")).toBe(false);
  });

  it("is false for differing lengths and for empty/null/undefined", () => {
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch("", "")).toBe(false);
    expect(statesMatch("abc", null)).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch(null, undefined)).toBe(false);
  });
});

describe("readQbOAuthStateCookie", () => {
  it("returns null when there is no Cookie header or no matching cookie", () => {
    expect(readQbOAuthStateCookie(reqWithCookieHeader(undefined))).toBeNull();
    expect(readQbOAuthStateCookie(reqWithCookieHeader("connect.sid=xyz; csrf-token=abc"))).toBeNull();
  });

  it("extracts the state value among other cookies and URL-decodes it", () => {
    const header = `connect.sid=s%3Aabc; ${QB_OAUTH_STATE_COOKIE}=deadbeef%2D01; other=1`;
    expect(readQbOAuthStateCookie(reqWithCookieHeader(header))).toBe("deadbeef-01");
  });

  it("does not partial-match a similarly named cookie", () => {
    const header = `not_${QB_OAUTH_STATE_COOKIE}=nope`;
    expect(readQbOAuthStateCookie(reqWithCookieHeader(header))).toBeNull();
  });
});
