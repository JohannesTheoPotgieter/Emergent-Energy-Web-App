// Regression guard for the lifecycle-board hard-delete (DELETE
// /api/lifecycle-board/projects/:id). The final `DELETE FROM project_info`
// fails with a foreign-key violation (a 500 to the user) if ANY table has a
// NO-ACTION FK to project_info and isn't cleared first. New such tables get
// added over time and silently break delete — this test parses the schema for
// every non-cascade project_info FK and asserts the delete handler clears it.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function schemaFiles(): string[] {
  const dir = path.join(ROOT, "shared/schema");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => path.join(dir, f));
}

/** Tables with a project_info FK that is ON DELETE CASCADE / SET NULL — those
 *  clean up automatically and need no explicit DELETE in the handler. */
function isManagedByDb(afterId: string): boolean {
  // `references(() => projectInfo.id, { onDelete: "cascade" | "set null" })`
  return /^\s*,\s*\{[^}]*onDelete\s*:\s*["'](cascade|set null)["']/s.test(afterId);
}

/** Every table whose project_info FK is NO ACTION (blocks DELETE FROM project_info). */
function blockingTables(): Set<string> {
  const out = new Set<string>();
  for (const file of schemaFiles()) {
    const src = fs.readFileSync(file, "utf8");
    // index pgTable("name") declarations by position
    const decls = [...src.matchAll(/pgTable\(\s*["']([^"']+)["']/g)].map((m) => ({ pos: m.index ?? 0, name: m[1] }));
    for (const m of src.matchAll(/references\(\(\)\s*=>\s*projectInfo\.id/g)) {
      const at = m.index ?? 0;
      const afterId = src.slice(at + m[0].length, at + m[0].length + 160);
      if (isManagedByDb(afterId)) continue; // cascades — fine
      // nearest preceding pgTable
      let tbl: string | null = null;
      for (const d of decls) { if (d.pos < at) tbl = d.name; else break; }
      if (tbl) out.add(tbl);
    }
  }
  return out;
}

function deleteHandlerSource(): string {
  const src = fs.readFileSync(path.join(ROOT, "server/lifecycle-routes.ts"), "utf8");
  const del = src.indexOf("app.delete(");
  // the lifecycle hard-delete is the only app.delete in this file that hits this path
  const pathIdx = src.indexOf("/api/lifecycle-board/projects/:id", del);
  const end = src.indexOf("DELETE FROM project_info WHERE id", pathIdx);
  expect(del).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(pathIdx);
  return src.slice(pathIdx, end);
}

describe("lifecycle-board hard-delete FK coverage", () => {
  it("clears every non-cascade project_info FK table before deleting the project", () => {
    const handler = deleteHandlerSource();
    const blocking = blockingTables();
    // project_info itself references nothing of interest; ignore self.
    blocking.delete("project_info");
    const uncovered = [...blocking].filter((t) => !handler.includes(t)).sort();
    expect(uncovered, `These tables FK into project_info (NO ACTION) but are not cleared in the lifecycle delete handler — DELETE FROM project_info will 500 for any project with rows here:\n  ${uncovered.join("\n  ")}`).toEqual([]);
  });

  it("found a non-trivial set of blocking tables (sanity — parser didn't silently match nothing)", () => {
    expect(blockingTables().size).toBeGreaterThan(10);
  });
});
