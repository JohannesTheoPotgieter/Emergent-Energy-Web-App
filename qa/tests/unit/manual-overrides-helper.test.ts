/**
 * Manual-overrides helper tests.
 *
 * Two suites:
 *   1. Pure-function field-merge logic — runs anywhere; covers
 *      `buildOverrideMap` / `removeOverrideFromMap` /
 *      `readOverridesMap`.
 *   2. DB-backed integration — covers `applyManualOverride` /
 *      `clearManualOverride` / `getManualOverrides` against a real
 *      `normalized_cost_lines` row. Skipped when `DATABASE_URL` is
 *      unset (the SQLite dev fallback's bootstrap DDL omits
 *      columns that drizzle's full-row insert requires; running on
 *      postgres dev DB or staging is the supported path).
 *
 * Invariants verified across both:
 *   - Live column is NEVER touched.
 *   - First override seeds `fromValue` from the live column.
 *   - Repeat override updates `value` / `editedAt` / `editedBy` /
 *     `note` but PRESERVES the original `fromValue`.
 *   - `clearManualOverride` removes the entry.
 *   - Schema validation throws on malformed input.
 *   - `undefined` value coerces to `null`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  buildOverrideMap,
  removeOverrideFromMap,
  readOverridesMap,
  withOverridesOverlay,
  applyOverridesOverlay,
} from "../../../server/lib/manual-overrides";
import type { ManualOverridesMap } from "@shared/excel-vs-app/contract";

// ---------------------------------------------------------------------------
// 1. Pure field-merge logic
// ---------------------------------------------------------------------------

describe("manual-overrides helper — pure field-merge logic", () => {
  const NOW = new Date("2026-04-30T12:00:00.000Z");
  const LATER = new Date("2026-04-30T12:05:00.000Z");

  it("buildOverrideMap creates a new entry when field has none, seeding fromValue from liveValue", () => {
    const next = buildOverrideMap({}, "amountExVat", "1700.00", "1500.00", 7, NOW);
    expect(next.amountExVat).toEqual({
      value: "1700.00",
      editedBy: 7,
      editedAt: NOW.toISOString(),
      fromValue: "1500.00",
    });
  });

  it("buildOverrideMap updates value/editedBy/editedAt but preserves fromValue from the FIRST override", () => {
    const first = buildOverrideMap({}, "amountExVat", "1700.00", "1500.00", 1, NOW);
    const second = buildOverrideMap(first, "amountExVat", "1900.00", "1500.00", 2, LATER, "Operator confirmed");
    expect(second.amountExVat).toEqual({
      value: "1900.00",
      editedBy: 2,
      editedAt: LATER.toISOString(),
      fromValue: "1500.00", // unchanged from first override
      note: "Operator confirmed",
    });
  });

  it("buildOverrideMap on a third edit STILL preserves the original fromValue", () => {
    const first = buildOverrideMap({}, "status", "approved", "draft", 1, NOW);
    const second = buildOverrideMap(first, "status", "paid", "draft", 1, LATER);
    const third = buildOverrideMap(second, "status", "queried", "draft", 1, LATER);
    expect(third.status.fromValue).toBe("draft");
  });

  it("buildOverrideMap coerces undefined value to null at the boundary", () => {
    const next = buildOverrideMap({}, "invoiceNumber", undefined, "INV-100", 1, NOW);
    expect(next.invoiceNumber.value).toBeNull();
  });

  it("buildOverrideMap coerces undefined liveValue to null in fromValue when seeding", () => {
    const next = buildOverrideMap({}, "comments", "operator note", undefined, 1, NOW);
    expect(next.comments.fromValue).toBeNull();
  });

  it("buildOverrideMap supports null as a deliberate operator value", () => {
    const next = buildOverrideMap({}, "invoiceNumber", null, "INV-100", 1, NOW);
    expect(next.invoiceNumber.value).toBeNull();
    expect(next.invoiceNumber.fromValue).toBe("INV-100");
  });

  it("buildOverrideMap leaves other fields untouched", () => {
    const seed: ManualOverridesMap = {
      amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW.toISOString(), fromValue: "1500.00" },
    };
    const next = buildOverrideMap(seed, "status", "paid", "draft", 1, LATER);
    expect(next.amountExVat).toEqual(seed.amountExVat);
    expect(next.status.value).toBe("paid");
  });

  it("buildOverrideMap throws on schema-invalid editedBy (e.g. string)", () => {
    expect(() =>
      buildOverrideMap({}, "amountExVat", "1.00", "0.50", "not-a-number" as unknown as number, NOW),
    ).toThrow();
  });

  it("removeOverrideFromMap removes an existing entry", () => {
    const seed: ManualOverridesMap = {
      amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW.toISOString(), fromValue: "1500.00" },
      status: { value: "paid", editedBy: 1, editedAt: NOW.toISOString(), fromValue: "draft" },
    };
    const next = removeOverrideFromMap(seed, "amountExVat");
    expect(next.amountExVat).toBeUndefined();
    expect(next.status).toEqual(seed.status);
  });

  it("removeOverrideFromMap is a referentially-stable no-op when the field has no entry", () => {
    const seed: ManualOverridesMap = {
      amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW.toISOString(), fromValue: "1500.00" },
    };
    const next = removeOverrideFromMap(seed, "status");
    // Same reference signals "no change" to the caller.
    expect(next).toBe(seed);
  });

  it("readOverridesMap returns {} for null / undefined / non-object input", () => {
    expect(readOverridesMap(null)).toEqual({});
    expect(readOverridesMap(undefined)).toEqual({});
    expect(readOverridesMap("a string")).toEqual({});
    expect(readOverridesMap([])).toEqual({});
  });

  it("readOverridesMap returns the map for a valid object input", () => {
    const map: ManualOverridesMap = {
      amountExVat: { value: "1.00", editedBy: 1, editedAt: NOW.toISOString(), fromValue: null },
    };
    expect(readOverridesMap(map)).toEqual(map);
  });
});

// ---------------------------------------------------------------------------
// Read-side overlay
// ---------------------------------------------------------------------------

describe("manual-overrides helper — read-side overlay", () => {
  const NOW = "2026-04-30T12:00:00.000Z";

  function makeRow(over: Record<string, unknown> = {}) {
    return {
      id: 1,
      amountExVat: "1500.00",
      status: "approved",
      invoiceNumber: "INV-100",
      manualOverrides: null as unknown,
      ...over,
    };
  }

  it("withOverridesOverlay returns the row unchanged when no overrides exist", () => {
    const row = makeRow({ manualOverrides: null });
    const out = withOverridesOverlay(row, ["amountExVat", "status"]);
    expect(out).toBe(row);
  });

  it("withOverridesOverlay returns the row unchanged when manualOverrides is an empty object", () => {
    const row = makeRow({ manualOverrides: {} });
    const out = withOverridesOverlay(row, ["amountExVat", "status"]);
    expect(out).toBe(row);
  });

  it("withOverridesOverlay replaces a field's value when an override exists", () => {
    const row = makeRow({
      manualOverrides: {
        amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW, fromValue: "1500.00" },
      },
    });
    const out = withOverridesOverlay(row, ["amountExVat", "status"]);
    expect(out.amountExVat).toBe("1700.00"); // override applied
    expect(out.status).toBe("approved"); // field not overridden, live value preserved
    expect(out).not.toBe(row); // shallow-cloned
  });

  it("withOverridesOverlay does NOT touch the live column on the input row", () => {
    const row = makeRow({
      manualOverrides: {
        amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW, fromValue: "1500.00" },
      },
    });
    withOverridesOverlay(row, ["amountExVat"]);
    expect(row.amountExVat).toBe("1500.00"); // input row's live column intact
  });

  it("withOverridesOverlay only acts on fields in the list (skips overridden fields not in `fields`)", () => {
    const row = makeRow({
      manualOverrides: {
        amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW, fromValue: "1500.00" },
        status: { value: "paid", editedBy: 1, editedAt: NOW, fromValue: "approved" },
      },
    });
    // Only request overlay on `amountExVat`; `status` override should not be applied.
    const out = withOverridesOverlay(row, ["amountExVat"]);
    expect(out.amountExVat).toBe("1700.00");
    expect(out.status).toBe("approved"); // status override NOT applied
  });

  it("withOverridesOverlay supports null override values (operator cleared the field)", () => {
    const row = makeRow({
      manualOverrides: {
        invoiceNumber: { value: null, editedBy: 1, editedAt: NOW, fromValue: "INV-100" },
      },
    });
    const out = withOverridesOverlay(row, ["invoiceNumber"]);
    expect(out.invoiceNumber).toBeNull();
  });

  it("withOverridesOverlay preserves the manualOverrides JSONB on the output for client metadata access", () => {
    const overrides = {
      amountExVat: { value: "1700.00", editedBy: 1, editedAt: NOW, fromValue: "1500.00" },
    };
    const row = makeRow({ manualOverrides: overrides });
    const out = withOverridesOverlay(row, ["amountExVat"]);
    expect(out.manualOverrides).toEqual(overrides);
  });

  it("applyOverridesOverlay applies to every row in an array", () => {
    const rows = [
      makeRow({
        id: 1,
        manualOverrides: { status: { value: "paid", editedBy: 1, editedAt: NOW, fromValue: "approved" } },
      }),
      makeRow({ id: 2, manualOverrides: null }),
      makeRow({
        id: 3,
        manualOverrides: { amountExVat: { value: "2000.00", editedBy: 1, editedAt: NOW, fromValue: "1500.00" } },
      }),
    ];
    const out = applyOverridesOverlay(rows, ["amountExVat", "status"]);
    expect(out[0].status).toBe("paid");
    expect(out[1].status).toBe("approved");
    expect(out[2].amountExVat).toBe("2000.00");
  });
});

// ---------------------------------------------------------------------------
// 2. DB-backed integration (skipped without DATABASE_URL)
// ---------------------------------------------------------------------------

const hasDb = !!process.env.DATABASE_URL;
const dbDescribe = hasDb ? describe : describe.skip;

dbDescribe("manual-overrides helper — DB integration", () => {
  let dbModule: typeof import("../../../server/db");
  let helpers: typeof import("../../../server/lib/manual-overrides");
  let financeSchema: typeof import("../../../shared/schema/finance");
  let projectsSchema: typeof import("../../../shared/schema/projects");
  let importsSchema: typeof import("../../../shared/schema/imports");

  let projectId: number;
  let importRunId: number;
  let costRowId: number;
  const MARKER = `__manual_overrides_db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    await dbModule.initializeDatabase();
    helpers = await import("../../../server/lib/manual-overrides");
    financeSchema = await import("../../../shared/schema/finance");
    projectsSchema = await import("../../../shared/schema/projects");
    importsSchema = await import("../../../shared/schema/imports");

    const [p] = await dbModule.db
      .insert(projectsSchema.projectInfo)
      .values({ projectName: MARKER })
      .returning({ id: projectsSchema.projectInfo.id });
    projectId = p.id;

    // smart_import_runs is the parent FK for normalized_cost_lines —
    // required because import_run_id is NOT NULL in the schema.
    const [r] = await dbModule.db
      .insert(importsSchema.smartImportRuns)
      .values({ sourceFileName: MARKER, projectName: MARKER })
      .returning({ id: importsSchema.smartImportRuns.id });
    importRunId = r.id;

    const [row] = await dbModule.db
      .insert(financeSchema.normalizedCostLines)
      .values({
        projectId,
        projectName: MARKER,
        description: "Test cost line",
        amountExVat: "1500.00",
        invoiceNumber: "INV-100",
        status: "approved",
        importRunId,
      } as any)
      .returning({ id: financeSchema.normalizedCostLines.id });
    costRowId = row.id;
  });

  afterAll(async () => {
    if (costRowId) {
      await dbModule.db
        .delete(financeSchema.normalizedCostLines)
        .where(eq(financeSchema.normalizedCostLines.id, costRowId));
    }
    if (importRunId) {
      await dbModule.db
        .delete(importsSchema.smartImportRuns)
        .where(eq(importsSchema.smartImportRuns.id, importRunId));
    }
    if (projectId) {
      await dbModule.db
        .delete(projectsSchema.projectInfo)
        .where(eq(projectsSchema.projectInfo.id, projectId));
    }
  });

  it("first override: live column unchanged, override populated, fromValue seeded from live", async () => {
    await helpers.applyManualOverride({
      table: "normalized_cost_lines",
      rowId: costRowId,
      fieldName: "amountExVat",
      value: "1700.00",
      editedBy: 1,
    });
    const [row] = await dbModule.db
      .select()
      .from(financeSchema.normalizedCostLines)
      .where(eq(financeSchema.normalizedCostLines.id, costRowId))
      .limit(1);
    expect(row.amountExVat).toBe("1500.00");
    expect((row.manualOverrides as any).amountExVat.value).toBe("1700.00");
    expect((row.manualOverrides as any).amountExVat.fromValue).toBe("1500.00");
  });

  it("repeat override preserves original fromValue", async () => {
    await helpers.applyManualOverride({
      table: "normalized_cost_lines",
      rowId: costRowId,
      fieldName: "amountExVat",
      value: "1900.00",
      editedBy: 2,
      note: "Operator confirmed",
    });
    const overrides = await helpers.getManualOverrides("normalized_cost_lines", costRowId);
    expect(overrides.amountExVat.value).toBe("1900.00");
    expect(overrides.amountExVat.fromValue).toBe("1500.00");
    expect(overrides.amountExVat.note).toBe("Operator confirmed");
  });

  it("clearManualOverride removes the entry; live column already at Excel-truth", async () => {
    await helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat");
    const overrides = await helpers.getManualOverrides("normalized_cost_lines", costRowId);
    expect(overrides.amountExVat).toBeUndefined();
    const [row] = await dbModule.db
      .select()
      .from(financeSchema.normalizedCostLines)
      .where(eq(financeSchema.normalizedCostLines.id, costRowId))
      .limit(1);
    expect(row.amountExVat).toBe("1500.00");
  });

  it("throws when row id does not exist", async () => {
    await expect(
      helpers.applyManualOverride({
        table: "normalized_cost_lines",
        rowId: 999_999_999,
        fieldName: "amountExVat",
        value: "1.00",
        editedBy: 1,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("getManualOverrides returns {} for unknown row id (caller-friendly)", async () => {
    const result = await helpers.getManualOverrides("normalized_cost_lines", 999_999_999);
    expect(result).toEqual({});
  });
});
