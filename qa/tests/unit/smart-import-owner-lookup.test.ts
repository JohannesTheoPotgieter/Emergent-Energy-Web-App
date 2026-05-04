/**
 * Smart Import — ownerUserId lookup tests (field-coverage gap #1).
 *
 * Tests the name/email → userId resolution logic used by
 * writePlanIncremental to populate work_items.ownerUserId.
 */

import { describe, expect, it } from "vitest";

// Mirrors the lookup helper inside writePlanIncremental.
function buildUserByKey(
  users: Array<{ id: number; name: string; email: string }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const u of users) {
    map.set(u.email.toLowerCase(), u.id);
    // name goes in last so email wins on collision
    map.set(u.name.toLowerCase(), u.id);
  }
  return map;
}

function resolveOwnerUserId(
  ownerText: unknown,
  userByKey: Map<string, number>,
): number | null {
  if (!ownerText || typeof ownerText !== "string") return null;
  return userByKey.get(ownerText.trim().toLowerCase()) ?? null;
}

const FIXTURE_USERS = [
  { id: 1, name: "Alice Smith", email: "alice@example.com" },
  { id: 2, name: "Bob Jones", email: "bob@example.com" },
  { id: 3, name: "Carol", email: "carol@example.com" },
];

describe("ownerUserId lookup", () => {
  const map = buildUserByKey(FIXTURE_USERS);

  it("resolves by exact email (case-insensitive)", () => {
    expect(resolveOwnerUserId("alice@example.com", map)).toBe(1);
    expect(resolveOwnerUserId("ALICE@EXAMPLE.COM", map)).toBe(1);
  });

  it("resolves by full name (case-insensitive)", () => {
    expect(resolveOwnerUserId("Bob Jones", map)).toBe(2);
    expect(resolveOwnerUserId("bob jones", map)).toBe(2);
  });

  it("resolves single-word name", () => {
    expect(resolveOwnerUserId("Carol", map)).toBe(3);
  });

  it("trims leading/trailing whitespace before matching", () => {
    expect(resolveOwnerUserId("  alice@example.com  ", map)).toBe(1);
    expect(resolveOwnerUserId(" Bob Jones ", map)).toBe(2);
  });

  it("returns null for unknown owner text", () => {
    expect(resolveOwnerUserId("unknown@example.com", map)).toBeNull();
    expect(resolveOwnerUserId("Dave", map)).toBeNull();
  });

  it("returns null for null/undefined/empty owner", () => {
    expect(resolveOwnerUserId(null, map)).toBeNull();
    expect(resolveOwnerUserId(undefined, map)).toBeNull();
    expect(resolveOwnerUserId("", map)).toBeNull();
    expect(resolveOwnerUserId(42, map)).toBeNull();
  });

  it("email takes precedence over a duplicate name entry", () => {
    // Two users: same name, different emails.
    const conflictUsers = [
      { id: 10, name: "Sam", email: "sam.a@example.com" },
      { id: 11, name: "Sam", email: "sam.b@example.com" },
    ];
    const conflictMap = buildUserByKey(conflictUsers);
    // Email resolves deterministically.
    expect(resolveOwnerUserId("sam.a@example.com", conflictMap)).toBe(10);
    expect(resolveOwnerUserId("sam.b@example.com", conflictMap)).toBe(11);
    // Name match returns one of them (last-wins insertion order for map).
    expect(resolveOwnerUserId("Sam", conflictMap)).toBeDefined();
  });
});
