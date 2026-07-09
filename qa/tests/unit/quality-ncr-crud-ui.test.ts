/**
 * Task 1.1 — NCR create/edit/close UI.
 *
 * The Quality surface previously only listed NCRs. This adds a drawer that
 * supports raise / edit / assign / comment / transition / waive / close,
 * opened from the dashboard row click and the ?ncr= deep link. Source-contract
 * test over the drawer component + its dashboard wiring.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DRAWER = fs.readFileSync(path.join(process.cwd(), "client/src/components/quality/NcrDrawer.tsx"), "utf8");
const DASH = fs.readFileSync(path.join(process.cwd(), "client/src/pages/qm-dashboard.tsx"), "utf8");

describe("NcrDrawer covers the NCR lifecycle", () => {
  it("edits + saves via PUT /api/quality/ncrs/:id", () => {
    expect(DRAWER).toContain("`/api/quality/ncrs/${ncrId}`");
    expect(DRAWER).toContain('method: "PUT"');
  });

  it("supports assign (assigned_to) and can clear it (null)", () => {
    expect(DRAWER).toContain("assigned_to: edit.assignedTo.trim() === \"\" ? null : Number(edit.assignedTo)");
  });

  it("adds comments via POST /comments", () => {
    expect(DRAWER).toContain("/comments`");
    expect(DRAWER).toContain("ncr-comment-submit");
  });

  it("transitions status and waives", () => {
    expect(DRAWER).toContain("updateMutation.mutate({ status: advanceTo })");
    expect(DRAWER).toContain("/waive`");
    expect(DRAWER).toContain("override_reason");
  });

  it("respects the pd_quality edit permission", () => {
    expect(DRAWER).toContain('usePermission("pd_quality", "edit")');
    expect(DRAWER).toContain("canEdit");
  });

  it("handles loading + error + empty states", () => {
    expect(DRAWER).toContain("isLoading");
    expect(DRAWER).toContain("ncr-drawer-error");
    expect(DRAWER).toContain("No comments yet");
  });

  it("raise flow posts to /api/quality/ncrs", () => {
    expect(DRAWER).toContain("NcrCreateDialog");
    expect(DRAWER).toContain("project_id: Number(projectId)");
  });
});

describe("dashboard opens the drawer reactively on ?ncr=", () => {
  it("derives the drawer id from the reactive search string", () => {
    expect(DASH).toContain("useSearch");
    expect(DASH).toContain('new URLSearchParams(ncrSearch).get("ncr")');
    expect(DASH).toContain("<NcrDrawer");
  });

  it("has a New NCR button that opens the create dialog", () => {
    expect(DASH).toContain("btn-new-ncr");
    expect(DASH).toContain("<NcrCreateDialog");
  });

  it("closing the drawer clears the deep-link param", () => {
    expect(DASH).toContain('if (!o) setLocation("/quality")');
  });
});
