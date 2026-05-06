/**
 * Smart Import — counterpartyId/counterpartyType lookup tests (field-coverage gap #2).
 *
 * Tests the name/alias → {id, type} resolution logic used by
 * writeExpenditureIncremental to populate
 * normalized_cost_lines.counterpartyId and .counterpartyType.
 */

import { describe, expect, it } from "vitest";

type CounterpartyRow = { id: number; name: string; aliases: unknown; type: string };
type CounterpartyMatch = { id: number; type: string };

function buildCounterpartyMap(rows: CounterpartyRow[]): Map<string, CounterpartyMatch> {
  const map = new Map<string, CounterpartyMatch>();
  for (const cp of rows) {
    const hit: CounterpartyMatch = { id: cp.id, type: cp.type };
    map.set(cp.name.trim().toLowerCase(), hit);
    const aliases = Array.isArray(cp.aliases) ? cp.aliases : [];
    for (const alias of aliases) {
      if (typeof alias === "string" && alias.trim()) {
        map.set(alias.trim().toLowerCase(), hit);
      }
    }
  }
  return map;
}

function resolveCounterparty(name: unknown, map: Map<string, CounterpartyMatch>): CounterpartyMatch | null {
  if (!name || typeof name !== "string") return null;
  return map.get(name.trim().toLowerCase()) ?? null;
}

const FIXTURE_COUNTERPARTIES: CounterpartyRow[] = [
  { id: 1, name: "Acme Solar", aliases: ["Acme", "ACME SOLAR PTY"], type: "SUPPLIER" },
  { id: 2, name: "BuildRight Contractors", aliases: ["BuildRight", "BRC"], type: "INSTALLER" },
  { id: 3, name: "Generic Co", aliases: [], type: "OTHER" },
];

describe("counterparty alias lookup", () => {
  const map = buildCounterpartyMap(FIXTURE_COUNTERPARTIES);

  it("resolves by exact canonical name (case-insensitive)", () => {
    const match = resolveCounterparty("Acme Solar", map);
    expect(match?.id).toBe(1);
    expect(match?.type).toBe("SUPPLIER");
    expect(resolveCounterparty("acme solar", map)?.id).toBe(1);
  });

  it("resolves by alias (case-insensitive)", () => {
    expect(resolveCounterparty("Acme", map)?.id).toBe(1);
    expect(resolveCounterparty("ACME SOLAR PTY", map)?.id).toBe(1);
    expect(resolveCounterparty("brc", map)?.id).toBe(2);
  });

  it("trims whitespace before matching", () => {
    expect(resolveCounterparty("  Acme Solar  ", map)?.id).toBe(1);
    expect(resolveCounterparty(" BRC ", map)?.id).toBe(2);
  });

  it("returns correct type for INSTALLER", () => {
    const match = resolveCounterparty("BuildRight Contractors", map);
    expect(match?.type).toBe("INSTALLER");
  });

  it("returns null for unknown name", () => {
    expect(resolveCounterparty("Unknown Corp", map)).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(resolveCounterparty(null, map)).toBeNull();
    expect(resolveCounterparty(undefined, map)).toBeNull();
    expect(resolveCounterparty("", map)).toBeNull();
    expect(resolveCounterparty(42, map)).toBeNull();
  });

  it("handles counterparty with no aliases", () => {
    const match = resolveCounterparty("Generic Co", map);
    expect(match?.id).toBe(3);
    expect(match?.type).toBe("OTHER");
  });

  it("ignores non-string alias entries gracefully", () => {
    const withBadAliases: CounterpartyRow[] = [
      { id: 10, name: "Good Corp", aliases: ["good", null, 42, "also-good"], type: "SUPPLIER" },
    ];
    const m = buildCounterpartyMap(withBadAliases);
    expect(resolveCounterparty("good", m)?.id).toBe(10);
    expect(resolveCounterparty("also-good", m)?.id).toBe(10);
    // null/number aliases are silently skipped
  });
});
