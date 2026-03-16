import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

describe("project-client linkage contract", () => {
  it("creates projects against the authoritative client linkage in the existing project route", () => {
    const source = read("server/template-routes.ts");

    expect(source).toContain("clientId: resolvedClient.client?.id ?? null");
    expect(source).toContain("clientResolution:");
    expect(source).toContain("linkedClientId: resolvedClient.client?.id ?? null");
    expect(source).toContain("pd: null");
  });

  it("records client-link changes in project history through the shared project info patch route", () => {
    const source = read("server/routes.ts");

    expect(source).toContain("projectClientHistory");
    expect(source).toContain('Object.prototype.hasOwnProperty.call(projectInfoPatch, "clientId")');
    expect(source).toContain("await db.insert(projectClientHistory).values");
  });

  it("sends clientId from Project Create and PD ticket project creation flows", () => {
    const projectCreateSource = read("client/src/pages/project-create.tsx");
    const pdTicketCreateSource = read("client/src/pages/pd-ticket-create.tsx");

    expect(projectCreateSource).toContain("clientId: form.clientId ? Number(form.clientId) : null");
    expect(projectCreateSource).toContain('setLocation("/project-lifecycle/client-overview")');
    expect(pdTicketCreateSource).toContain("clientId: selectedClient?.id || null");
    expect(pdTicketCreateSource).toContain("clientName: selectedClient?.name || null");
  });
});
