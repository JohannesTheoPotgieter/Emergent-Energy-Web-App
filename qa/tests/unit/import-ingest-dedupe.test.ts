/**
 * SharePoint scheduled-import ingest hygiene + per-project dedupe.
 *
 * Goal: one project = one candidate per ingest cycle; junk never enters the
 * pipeline; nothing is silently dropped. These tests pin the pure logic in
 * server/lib/import/ingest-hygiene.ts plus the scheduler wiring that guarantees
 * quarantined / skipped files never reach the finance commit path.
 *
 * Acceptance scenarios:
 *   (a) two copies of one project in a cycle -> one candidate + one quarantined
 *   (b) a ~$ lock file is skipped entirely
 *   (c) a "(conflicted copy)" file parks and does not auto-commit
 *   (d) reported totals are unchanged by anything staged / quarantined
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  classifyIngestFile,
  isDuplicateArtifactName,
  isOfficeLockFile,
  pickLatestRevisionPerProject,
  planFolderIngest,
  type IngestFile,
} from "../../../server/lib/import/ingest-hygiene";

function file(partial: Partial<IngestFile> & { name: string }): IngestFile {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    size: partial.size ?? 1024,
    lastModifiedDateTime: partial.lastModifiedDateTime ?? "2026-01-01T00:00:00Z",
  };
}

describe("ingest-hygiene — classification", () => {
  it("(b) skips Office lock files (~$...) entirely", () => {
    expect(isOfficeLockFile("~$Solar Tracker.xlsx")).toBe(true);
    const decision = classifyIngestFile(file({ name: "~$Solar Tracker.xlsx" }));
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("lock");
  });

  it("skips zero-byte files; an unknown (null) size is NOT treated as empty", () => {
    expect(classifyIngestFile(file({ name: "Solar Tracker.xlsx", size: 0 })).action).toBe("skip");
    expect(classifyIngestFile(file({ name: "Solar Tracker.xlsx", size: null })).action).toBe("process");
    expect(classifyIngestFile(file({ name: "Solar Tracker.xlsx", size: 2048 })).action).toBe("process");
  });

  it("(c) quarantines conflicted-copy / Copy of / - Copy / numbered duplicates", () => {
    for (const name of [
      "Solar Tracker (conflicted copy 2026-01-02).xlsx",
      "Copy of Solar Tracker.xlsx",
      "Solar Tracker - Copy.xlsx",
      "Solar Tracker - Copy (2).xlsx",
      "Solar Tracker (1).xlsx",
    ]) {
      expect(isDuplicateArtifactName(name), name).toBe(true);
      const decision = classifyIngestFile(file({ name }));
      expect(decision.action, name).toBe("quarantine");
      if (decision.action === "quarantine") expect(decision.kind).toBe("conflicted_copy");
    }
  });

  it("leaves normal tracker names (and year suffixes) as process candidates", () => {
    for (const name of [
      "Solar Tracker.xlsx",
      "Acme Solar Phase 2 Tracker.xlsx",
      "Acme Solar (2024).xlsx",
    ]) {
      expect(isDuplicateArtifactName(name), name).toBe(false);
      expect(classifyIngestFile(file({ name })).action, name).toBe("process");
    }
  });
});

describe("ingest-hygiene — latest-revision-per-project dedupe", () => {
  it("(a) two revisions of one project -> newest is the candidate, older quarantined naming the keeper", () => {
    const older = {
      ...file({ name: "Acme Solar Tracker.xlsx", id: "old", lastModifiedDateTime: "2026-01-01T00:00:00Z" }),
      projectKey: 7,
    };
    const newer = {
      ...file({ name: "Acme Solar Tracker rev2.xlsx", id: "new", lastModifiedDateTime: "2026-02-01T00:00:00Z" }),
      projectKey: 7,
    };

    const { candidates, quarantined } = pickLatestRevisionPerProject([older, newer]);

    expect(candidates.map((c) => c.id)).toEqual(["new"]);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].file.id).toBe("old");
    expect(quarantined[0].kind).toBe("older_revision");
    expect(quarantined[0].chosenFile).toBe("Acme Solar Tracker rev2.xlsx");
    expect(quarantined[0].reason).toContain("Acme Solar Tracker rev2.xlsx");
  });

  it("keeps distinct projects as separate candidates with no quarantine", () => {
    const a = { ...file({ name: "A.xlsx", id: "a" }), projectKey: 1 };
    const b = { ...file({ name: "B.xlsx", id: "b" }), projectKey: 2 };
    const { candidates, quarantined } = pickLatestRevisionPerProject([a, b]);
    expect(candidates).toHaveLength(2);
    expect(quarantined).toHaveLength(0);
  });

  it("never dedupes unmatched files (projectKey null) against each other", () => {
    const a = { ...file({ name: "A.xlsx", id: "a" }), projectKey: null };
    const b = { ...file({ name: "B.xlsx", id: "b" }), projectKey: null };
    const { candidates, quarantined } = pickLatestRevisionPerProject([a, b]);
    expect(candidates).toHaveLength(2);
    expect(quarantined).toHaveLength(0);
  });
});

describe("ingest-hygiene — planFolderIngest end-to-end", () => {
  // Resolver mirrors the scheduler's project match: "acme" -> 7, "beta" -> 9.
  const resolve = async (name: string): Promise<number | null> => {
    const n = name.toLowerCase();
    if (n.includes("acme")) return 7;
    if (n.includes("beta")) return 9;
    return null;
  };

  it("classifies a mixed folder: skip lock+zero, quarantine copy + older revision, one candidate per project", async () => {
    const files: IngestFile[] = [
      file({ name: "~$Acme.xlsx", id: "lock" }),                       // lock -> skip
      file({ name: "Empty.xlsx", id: "empty", size: 0 }),             // zero-byte -> skip
      file({ name: "Acme Solar (conflicted copy).xlsx", id: "conf" }), // dup name -> quarantine
      file({ name: "Acme Solar Tracker.xlsx", id: "acme-old", lastModifiedDateTime: "2026-01-01T00:00:00Z" }),
      file({ name: "Acme Solar Tracker rev3.xlsx", id: "acme-new", lastModifiedDateTime: "2026-03-01T00:00:00Z" }),
      file({ name: "Beta Plant Tracker.xlsx", id: "beta" }),
    ];

    const plan = await planFolderIngest(files, resolve);

    expect(plan.skipped.map((s) => s.file.id).sort()).toEqual(["empty", "lock"]);
    // Acme: newest survives; Beta: its own candidate.
    expect(plan.candidates.map((c) => c.id).sort()).toEqual(["acme-new", "beta"]);

    const olderRev = plan.quarantined.find((q) => q.kind === "older_revision");
    expect(olderRev?.file.id).toBe("acme-old");
    expect(olderRev?.chosenFile).toBe("Acme Solar Tracker rev3.xlsx");
    expect(plan.quarantined.some((q) => q.kind === "conflicted_copy" && q.file.id === "conf")).toBe(true);
  });

  it("(d) staged/quarantined files are disjoint from candidates, and each project yields at most ONE candidate (reported totals cannot move)", async () => {
    const files: IngestFile[] = [
      file({ name: "Acme One.xlsx", id: "a1", lastModifiedDateTime: "2026-01-01T00:00:00Z" }),
      file({ name: "Acme Two.xlsx", id: "a2", lastModifiedDateTime: "2026-02-01T00:00:00Z" }),
      file({ name: "Acme (conflicted copy).xlsx", id: "a3" }),
      file({ name: "~$Acme.xlsx", id: "a4" }),
      file({ name: "Beta.xlsx", id: "b1" }),
    ];

    const plan = await planFolderIngest(files, resolve);

    // Nothing skipped or quarantined is also a candidate -> staged data can
    // never reach the commit (finance) path, so reported totals can't move.
    const candidateIds = new Set(plan.candidates.map((c) => c.id));
    const stagedIds = [
      ...plan.skipped.map((s) => s.file.id),
      ...plan.quarantined.map((q) => q.file.id),
    ];
    for (const id of stagedIds) expect(candidateIds.has(id)).toBe(false);

    // One project = one candidate per cycle: never two commits for one project.
    const perProject = new Map<number, number>();
    for (const c of plan.candidates) {
      const key = await resolve(c.name);
      if (key == null) continue;
      perProject.set(key, (perProject.get(key) ?? 0) + 1);
    }
    for (const count of perProject.values()) expect(count).toBeLessThanOrEqual(1);
  });
});

// Source-level guards mirroring scheduled-import-error-surface.test.ts: the
// scheduler must route through the hygiene plan, park quarantines as
// awaiting_review, and never auto-commit a quarantined file.
describe("scheduled-import-v2 + sharepoint — quarantine wiring", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  const schedulerSrc = read("server/services/scheduled-import-v2.ts");
  const sharepointSrc = read("server/sharepoint.ts");

  it("routes the folder listing through planFolderIngest", () => {
    expect(schedulerSrc).toContain('from "../lib/import/ingest-hygiene"');
    expect(schedulerSrc).toContain("planFolderIngest(");
  });

  it("parks quarantined files as awaiting_review and never auto-commits them", () => {
    expect(schedulerSrc).toContain("parkQuarantinedFile");
    // The quarantine row is awaiting_review ...
    expect(schedulerSrc).toMatch(/parkQuarantinedFile[\s\S]*?status:\s*"awaiting_review"/);
    // ... and the commit service is never invoked from the quarantine helper.
    expect(schedulerSrc).not.toMatch(/parkQuarantinedFile[\s\S]*?commitSmartImportRunAsSystem/);
  });

  it("(b) skips lock/zero-byte with a debug log, not a parked run", () => {
    expect(schedulerSrc).toMatch(/plan\.skipped[\s\S]*?console\.debug/);
    expect(schedulerSrc).toContain("result.filesSkipped++");
  });

  it("listFolderChildren no longer drops lock/conflicted files (hygiene moved to the scheduler)", () => {
    const start = sharepointSrc.indexOf("export async function listFolderChildren");
    const after = sharepointSrc.indexOf("export async function", start + 1);
    const body = sharepointSrc.slice(start, after);
    // The listing must no longer CALL the clean-only tracker predicate (a
    // comment may still reference it); it now filters by extension only.
    expect(body).not.toContain("isTrackerWorkbookName(item.name)");
    expect(body).toContain("xlsx|xlsm|xls");
  });
});
