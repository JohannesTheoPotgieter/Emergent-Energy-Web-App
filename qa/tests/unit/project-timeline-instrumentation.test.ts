import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

describe("project timeline instrumentation", () => {
  it("records stage transition events", () => {
    const source = read("server/lifecycle-routes.ts");
    expect(source).toContain('eventType: "project.stage_changed"');
  });

  it("records gate and override events", () => {
    const source = read("server/lifecycle-routes.ts");
    expect(source).toContain('"project.gate_passed"');
    expect(source).toContain('"project.gate_failed"');
    expect(source).toContain('"project.override_granted"');
  });

  it("records approvals, procurement, and invoice events", () => {
    const approvals = read("server/approvals-routes.ts");
    const procurement = read("server/procurement-routes.ts");
    const invoices = read("server/invoice-capture-routes.ts");

    expect(approvals).toContain('"approval.requested"');
    expect(approvals).toContain('"approval.approved"');
    expect(approvals).toContain('"approval.rejected"');

    expect(procurement).toContain('"procurement.item_created"');
    expect(procurement).toContain('"procurement.po_issued"');
    expect(procurement).toContain('"procurement.delivery_captured"');

    expect(invoices).toContain('"invoice.captured"');
    expect(invoices).toContain('"invoice.approved"');
    expect(invoices).toContain('"invoice.payment_status_changed"');
  });

  it("records RAID and change control status events", () => {
    const raid = read("server/raid-routes.ts");
    const changes = read("server/change-control-routes.ts");

    expect(raid).toContain('"raid.created"');
    expect(raid).toContain('"raid.status_changed"');

    expect(changes).toContain('"change.created"');
    expect(changes).toContain('"change.status_changed"');
  });

  it("adds project timeline UI and filter controls", () => {
    const page = read("client/src/pages/project-detail.tsx");
    const tab = read("client/src/components/tabs/ProjectTimelineTab.tsx");

    expect(page).toContain('subtab-timeline');
    expect(tab).toContain('Timeline filters');
    expect(tab).toContain('eventTypes');
    expect(tab).toContain('actorUserId');
  });
});
