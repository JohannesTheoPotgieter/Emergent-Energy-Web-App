import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TRANSMITTAL_PURPOSES,
  RELEASED_FOR_STATES,
  RELEASED_FOR_TRANSITIONS,
  DRAWING_STATUSES,
} from "../../../shared/schema/engineering";

/**
 * Tests for the engineering control gap closures:
 * - Transmittal register (formal issue events)
 * - Supersede logic (revision replacement chain)
 * - Procurement-ready gate rule
 * - Handover readiness computation
 * - Drawing-to-transmittal linkage
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("transmittal register schema", () => {
  const schema = read("shared/schema/engineering.ts");

  it("exports engTransmittals table", () => {
    expect(schema).toContain('export const engTransmittals = pgTable("eng_transmittals"');
  });

  it("exports engTransmittalItems join table", () => {
    expect(schema).toContain('export const engTransmittalItems = pgTable("eng_transmittal_items"');
  });

  it("transmittal items can link to deliverables", () => {
    expect(schema).toContain("deliverableId");
    expect(schema).toContain("projectEngDeliverables");
  });

  it("transmittal items can link to drawings", () => {
    expect(schema).toContain("drawingId");
    expect(schema).toContain("drawingRegister");
  });

  it("transmittal items snapshot the releasedFor state at time of issue", () => {
    expect(schema).toContain("releasedForAtIssue");
  });
});

describe("transmittal purposes", () => {
  it("includes all required EPC issue purposes", () => {
    expect(TRANSMITTAL_PURPOSES).toContain("for_information");
    expect(TRANSMITTAL_PURPOSES).toContain("for_review");
    expect(TRANSMITTAL_PURPOSES).toContain("for_approval");
    expect(TRANSMITTAL_PURPOSES).toContain("for_construction");
    expect(TRANSMITTAL_PURPOSES).toContain("for_procurement");
    expect(TRANSMITTAL_PURPOSES).toContain("for_as_built_record");
    expect(TRANSMITTAL_PURPOSES).toContain("for_handover");
  });

  it("has exactly 7 purposes", () => {
    expect(TRANSMITTAL_PURPOSES).toHaveLength(7);
  });
});

describe("transmittal migration exists", () => {
  it("has the transmittal register migration", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, "migrations/20260416_eng_transmittal_register.sql"))
    ).toBe(true);
  });
});

describe("transmittal routes exist", () => {
  const source = read("server/eng-stage-routes.ts");

  it("has POST /api/eng-stages/transmittals", () => {
    expect(source).toContain('"/api/eng-stages/transmittals"');
    expect(source).toContain("transmittalNumber");
  });

  it("has GET /api/eng-stages/transmittals (list)", () => {
    expect(source).toContain("transmittals: rows");
  });

  it("has GET /api/eng-stages/transmittals/:id (detail)", () => {
    expect(source).toContain('"/api/eng-stages/transmittals/:id"');
  });

  it("generates a transmittal number with project+date+sequence", () => {
    expect(source).toMatch(/T-\$\{projectId\}/);
  });

  it("snapshots releasedFor at issue time", () => {
    expect(source).toContain("releasedForAtIssue");
  });

  it("has permission gate (eng_stages:create)", () => {
    // The POST transmittal route should have requirePermission
    const postLine = source.split("\n").find(l =>
      l.includes('"/api/eng-stages/transmittals"') && l.includes("app.post")
    );
    expect(postLine).toBeTruthy();
    expect(postLine).toContain("requirePermission");
  });
});

describe("supersede endpoint", () => {
  const source = read("server/eng-stage-routes.ts");

  it("has POST /api/eng-stages/deliverables/:id/supersede", () => {
    expect(source).toContain('"/api/eng-stages/deliverables/:id/supersede"');
  });

  it("sets releasedFor to superseded", () => {
    expect(source).toContain('releasedFor: "superseded"');
    expect(source).toContain("supersededById");
  });

  it("links to the replacement deliverable", () => {
    expect(source).toContain("supersededById");
    expect(source).toContain("replacement deliverable");
  });

  it("rejects if already superseded", () => {
    expect(source).toContain("already superseded");
  });

  it("has permission gate", () => {
    const supersedeLine = source.split("\n").find(l =>
      l.includes("/supersede") && l.includes("app.post")
    );
    expect(supersedeLine).toBeTruthy();
    expect(supersedeLine).toContain("requirePermission");
  });
});

describe("supersede is a valid transition from every non-terminal state", () => {
  for (const state of RELEASED_FOR_STATES) {
    if (state === "superseded") continue;
    it(`${state} → superseded is allowed`, () => {
      expect(RELEASED_FOR_TRANSITIONS[state]).toContain("superseded");
    });
  }
});

describe("procurement-ready gate rule", () => {
  const source = read("server/eng-stage-routes.ts");

  it("checks rules.requireProcurementReady in stage-complete gate", () => {
    expect(source).toContain("requireProcurementReady");
  });

  it("requires a transmittal with purpose for_procurement", () => {
    expect(source).toContain("for_procurement");
    expect(source).toContain("Procurement spec not issued");
  });
});

describe("handover readiness endpoint", () => {
  const source = read("server/eng-stage-routes.ts");

  it("has GET /api/projects/:projectId/eng-handover-readiness", () => {
    expect(source).toContain('"/api/projects/:projectId/eng-handover-readiness"');
  });

  it("computes readiness from stages, deliverables, and drawings", () => {
    expect(source).toContain("totalStages");
    expect(source).toContain("totalDeliverables");
    expect(source).toContain("totalDrawings");
  });

  it("returns a readiness level", () => {
    expect(source).toContain('"not_ready"');
    expect(source).toContain('"ifc_complete"');
    expect(source).toContain('"as_built_complete"');
    expect(source).toContain('"fully_ready"');
  });

  it("returns missing items list", () => {
    expect(source).toContain("missingItems");
    expect(source).toContain("Stage not complete");
    expect(source).toContain("Deliverable not IFC");
    expect(source).toContain("Drawing not IFC");
  });
});

describe("drawing register can be linked to transmittal items", () => {
  const schema = read("shared/schema/engineering.ts");
  const migration = read("migrations/20260416_eng_transmittal_register.sql");

  it("transmittal_items has drawing_id FK in schema", () => {
    expect(schema).toContain("drawingId");
    expect(schema).toContain("drawingRegister.id");
  });

  it("transmittal_items has drawing_id FK in migration", () => {
    expect(migration).toContain("drawing_id");
    expect(migration).toContain("drawing_register(id)");
  });
});
