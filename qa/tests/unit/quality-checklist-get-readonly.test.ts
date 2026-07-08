/**
 * Task 0.6 — the checklist GET is read-only.
 *
 * `GET /api/quality/project/:name/checklist` used to backfill missing
 * item-instances / risk-answers inside the read — a `quality:view` request
 * performed writes. The backfill now lives in a shared helper invoked from
 * the create/sync POST path; the GET only reads. The client "start quality
 * process" action likewise POSTs instead of a GET that wrote.
 *
 * Source-analysis test (no live DB in unit tests): pins that the GET
 * handler body contains no inserts and that the backfill runs on POST.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = fs.readFileSync(path.join(process.cwd(), "server/quality-routes.ts"), "utf8");
const CLIENT = fs.readFileSync(path.join(process.cwd(), "client/src/pages/qm-dashboard.tsx"), "utf8");

// The GET checklist handler body runs from its route registration up to the
// next route (the explicit POST create).
const getStart = SERVER.indexOf('app.get(\n    "/api/quality/project/:projectName/checklist"');
const getStartFallback = getStart >= 0 ? getStart : SERVER.indexOf('"/api/quality/project/:projectName/checklist"');
const postStart = SERVER.indexOf('app.post(\n    "/api/quality/project/:projectName/checklist"');
const GET_HANDLER = SERVER.slice(getStartFallback, postStart);

describe("checklist GET is read-only (Task 0.6)", () => {
  it("locates the GET handler ahead of the POST create route", () => {
    expect(getStartFallback).toBeGreaterThanOrEqual(0);
    expect(postStart).toBeGreaterThan(getStartFallback);
  });

  it("the GET handler performs no inserts", () => {
    expect(GET_HANDLER).not.toContain(".insert(qcItemInstance)");
    expect(GET_HANDLER).not.toContain(".insert(qcRiskAnswer)");
    expect(GET_HANDLER).not.toMatch(/\.insert\(/);
  });

  it("the GET handler no longer contains the on-read backfill block", () => {
    expect(GET_HANDLER).not.toContain("missingTplItems");
    expect(GET_HANDLER).not.toContain("missingRiskQs");
  });
});

describe("backfill moved to the create/sync POST path", () => {
  it("a shared backfill helper exists", () => {
    expect(SERVER).toContain("async function backfillMissingChecklistRows");
  });

  it("the POST create path invokes the backfill for an existing checklist", () => {
    const postHandler = SERVER.slice(postStart, postStart + 4000);
    expect(postHandler).toContain("backfillMissingChecklistRows(tx, checklist.id, checklist.templateId)");
  });
});

describe("client starts a quality process with POST, not GET", () => {
  it("startQmMutation POSTs to the checklist endpoint", () => {
    const start = CLIENT.indexOf("const startQmMutation");
    const block = CLIENT.slice(start, start + 700);
    expect(block).toContain("/checklist`");
    expect(block).toMatch(/\/checklist`,\s*\{\s*method:\s*"POST"\s*\}/);
  });
});
