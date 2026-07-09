/**
 * Task 2.2 — transactional item approve + observable warning recompute.
 *
 * The approve handler wrote the evidence-override row and the item update as
 * separate awaits (a mid-sequence failure could leave an orphan override
 * record), and fired `recalculateWarnings(...).catch(console.error)` — a
 * fire-and-forget that both allowed read-after-write staleness and swallowed
 * failures silently. This pins:
 *   - the override insert + item update run inside one db.transaction;
 *   - warning recompute is awaited (fresh on return) and failures are
 *     recorded (observable), not console.error-only.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = fs.readFileSync(path.join(process.cwd(), "server/quality-routes.ts"), "utf8");

describe("approve handler wraps override + update in a transaction", () => {
  const approve = SOURCE.slice(
    SOURCE.indexOf('item/:itemInstanceId/approve'),
    SOURCE.indexOf('item/:itemInstanceId/evidence"'),
  );

  it("defers the override insert into the transaction", () => {
    expect(approve).toContain("let deferredOverride");
    expect(approve).toContain("deferredOverride = buildQcEvidenceOverrideRecord");
  });

  it("runs the override insert + item update inside db.transaction", () => {
    expect(approve).toMatch(/await db\.transaction\(async \(tx: QualityDb\) => \{/);
    expect(approve).toContain("tx.insert(evidenceOverrideRecords).values(deferredOverride)");
    expect(approve).toContain("tx.update(qcItemInstance)");
  });

  it("records the override audit only after the transaction commits", () => {
    const txIdx = approve.indexOf("await db.transaction");
    const auditIdx = approve.indexOf("if (deferredOverrideAudit) await recordAudit(deferredOverrideAudit)");
    expect(auditIdx).toBeGreaterThan(txIdx);
  });
});

describe("warning recompute is awaited + observable, not fire-and-forget", () => {
  it("no recompute site swallows failures with .catch(console.error)", () => {
    expect(SOURCE).not.toMatch(/recalculateWarnings\([^)]*\)\.catch\(\(err\) => console\.error/);
  });

  it("the correctness-critical handlers await the observable recompute", () => {
    const awaited = SOURCE.match(/await recomputeWarningsObservable\(/g) || [];
    // update, approve, send-for-approval, item-status, plan-link create/delete.
    expect(awaited.length).toBeGreaterThanOrEqual(5);
  });

  it("recompute failures are recorded as an audit event, not console-only", () => {
    expect(SOURCE).toContain("async function recomputeWarningsObservable");
    expect(SOURCE).toContain('action: "WARNING_RECOMPUTE_FAILED"');
  });
});
