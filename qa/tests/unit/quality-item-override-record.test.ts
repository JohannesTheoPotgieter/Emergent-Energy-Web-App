/**
 * Task 0.1 — evidence_override_records written on QC item override.
 *
 * Before this fix the item update (`pass`) and dedicated approve handlers
 * read the project id from `(existing as any).projectId`. But
 * `qc_item_instance` has NO project_id column, so the value was always
 * null and the guarded `evidence_override_records` insert never ran — an
 * authorised COO/CEO override left no queryable override record, only a
 * generic audit line.
 *
 * These tests pin two things:
 *   1. The pure record builder produces the correct, complete row shape
 *      (behavioural — exercises the real function).
 *   2. Both handlers now resolve the project id via
 *      `resolveProjectIdForItemInstance()` and no longer read the
 *      non-existent column (regression guard against re-introducing the
 *      bug).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildQcEvidenceOverrideRecord } from "../../../server/lib/quality-evidence-override";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("buildQcEvidenceOverrideRecord — override row shape", () => {
  it("builds a complete record with the resolved project id", () => {
    const record = buildQcEvidenceOverrideRecord({
      projectId: 42,
      itemInstanceId: 1007,
      completionType: "qc_item_pass",
      evidenceCount: 0,
      reason: "COO sign-off: site inspection verbally confirmed",
      authorizedByUserId: 9,
      authorizedByName: "Jane COO",
      authorizedByRole: "COO_ADMIN",
    });

    expect(record).toEqual({
      projectId: 42,
      completionType: "qc_item_pass",
      sourceType: "qc_item_instance",
      sourceRef: "1007",
      scorePercent: 0,
      thresholdPercent: 100,
      reason: "COO sign-off: site inspection verbally confirmed",
      authorizedByUserId: 9,
      authorizedByName: "Jane COO",
      authorizedByRole: "COO_ADMIN",
    });
  });

  it("scores 100 when evidence exists, 0 when missing", () => {
    const withEvidence = buildQcEvidenceOverrideRecord({
      projectId: 1,
      itemInstanceId: 2,
      completionType: "qc_item_approve",
      evidenceCount: 3,
      reason: "r",
      authorizedByUserId: 1,
    });
    expect(withEvidence.scorePercent).toBe(100);
    expect(withEvidence.thresholdPercent).toBe(100);

    const withoutEvidence = buildQcEvidenceOverrideRecord({
      projectId: 1,
      itemInstanceId: 2,
      completionType: "qc_item_approve",
      evidenceCount: 0,
      reason: "r",
      authorizedByUserId: 1,
    });
    expect(withoutEvidence.scorePercent).toBe(0);
  });

  it("distinguishes the two acting endpoints via completionType", () => {
    const passRec = buildQcEvidenceOverrideRecord({
      projectId: 1, itemInstanceId: 2, completionType: "qc_item_pass",
      evidenceCount: 1, reason: "r", authorizedByUserId: 1,
    });
    const approveRec = buildQcEvidenceOverrideRecord({
      projectId: 1, itemInstanceId: 2, completionType: "qc_item_approve",
      evidenceCount: 1, reason: "r", authorizedByUserId: 1,
    });
    expect(passRec.completionType).toBe("qc_item_pass");
    expect(approveRec.completionType).toBe("qc_item_approve");
    // Both share the QC-appropriate source surface.
    expect(passRec.sourceType).toBe("qc_item_instance");
    expect(approveRec.sourceType).toBe("qc_item_instance");
  });

  it("defaults optional authoriser name/role to null", () => {
    const record = buildQcEvidenceOverrideRecord({
      projectId: 1, itemInstanceId: 2, completionType: "qc_item_pass",
      evidenceCount: 0, reason: "r", authorizedByUserId: 5,
    });
    expect(record.authorizedByName).toBeNull();
    expect(record.authorizedByRole).toBeNull();
  });
});

describe("QC item override handlers resolve the project id correctly", () => {
  const source = read("server/quality-routes.ts");

  it("no longer reads the non-existent (existing as any).projectId for overrides", () => {
    expect(source).not.toContain("const projectIdForOverride = (existing as any).projectId");
  });

  it("both override paths resolve project id via resolveProjectIdForItemInstance", () => {
    const overrideResolves = source.match(
      /projectIdForOverride = await resolveProjectIdForItemInstance\(itemId\)/g,
    );
    expect(overrideResolves, "expected both override sites to resolve project id").not.toBeNull();
    expect(overrideResolves!.length).toBe(2);
  });

  it("both override paths write through the shared builder", () => {
    const builderCalls = source.match(/buildQcEvidenceOverrideRecord\(/g) || [];
    expect(builderCalls.length).toBeGreaterThanOrEqual(2);
  });
});
