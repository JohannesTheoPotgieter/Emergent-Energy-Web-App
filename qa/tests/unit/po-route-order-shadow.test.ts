import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relPath: string) => fs.readFileSync(path.join(process.cwd(), relPath), "utf8");

describe("PO route shadow prevention", () => {
  const poRoutes = read("server/po-routes.ts");

  it("registers static PO board routes before parameterized project route", () => {
    const projectIdx = poRoutes.indexOf('app.get("/api/po/:projectName"');
    const boardAllIdx = poRoutes.indexOf('app.get("/api/po/board/all"');
    const boardMineIdx = poRoutes.indexOf('app.get("/api/po/board/my-reviews"');
    const eligibleIdx = poRoutes.indexOf('app.get("/api/po/eligible-approvers"');

    expect(boardAllIdx).toBeGreaterThan(-1);
    expect(boardMineIdx).toBeGreaterThan(-1);
    expect(eligibleIdx).toBeGreaterThan(-1);
    expect(projectIdx).toBeGreaterThan(-1);

    expect(boardAllIdx).toBeLessThan(projectIdx);
    expect(boardMineIdx).toBeLessThan(projectIdx);
    expect(eligibleIdx).toBeLessThan(projectIdx);
  });
});
