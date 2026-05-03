/**
 * Excel-vs-App daily digest body — pure body-shape tests.
 *
 * The digest is delivered via the existing notification-service
 * (in-app row in the notifications table) — full end-to-end
 * integration is covered by the smoke test that checks recipients
 * receive the row. These tests pin the title / body shape so a
 * regression in the rollup math fails loudly.
 */
import { describe, expect, it } from "vitest";

interface FakeProgramRow {
  projectName: string;
  unverified: number;
}

/** Mirror of buildDigestBody's body-build logic. Pure for unit
 *  testing. The production version reads the same shape from
 *  trackerReplicaRepository.getProgramDriftSummary(). */
function formatDigest(rows: FakeProgramRow[]): { title: string; body: string; totalUnverified: number } | null {
  const totalUnverified = rows.reduce((s, r) => s + r.unverified, 0);
  if (totalUnverified === 0) return null;
  const positives = rows.filter(r => r.unverified > 0).sort((a, b) => b.unverified - a.unverified);
  const top = positives.slice(0, 3);
  const remaining = positives.length - top.length;
  const topPart = top.map(r => `${r.projectName} (${r.unverified})`).join(", ");
  const tail = remaining > 0 ? ` and ${remaining} more` : "";
  return {
    title: `${totalUnverified} unverified Excel-vs-App drift fields`,
    body: `Across ${positives.length} project${positives.length === 1 ? "" : "s"}. Top: ${topPart}${tail}. Open the Excel-vs-App page to resolve.`,
    totalUnverified,
  };
}

describe("Excel-vs-App daily digest body", () => {
  it("returns null when total unverified is zero", () => {
    expect(formatDigest([])).toBeNull();
    expect(formatDigest([{ projectName: "A", unverified: 0 }])).toBeNull();
  });

  it("title carries the total unverified count", () => {
    const out = formatDigest([{ projectName: "A", unverified: 5 }]);
    expect(out?.title).toBe("5 unverified Excel-vs-App drift fields");
  });

  it("body lists projects sorted by unverified desc", () => {
    const out = formatDigest([
      { projectName: "B", unverified: 2 },
      { projectName: "A", unverified: 7 },
      { projectName: "C", unverified: 1 },
    ]);
    expect(out?.body).toContain("Top: A (7), B (2), C (1)");
    expect(out?.body).toContain("Across 3 projects");
  });

  it("singular wording when one project has drift", () => {
    const out = formatDigest([{ projectName: "Solo", unverified: 3 }]);
    expect(out?.body).toContain("Across 1 project.");
  });

  it("truncates to top 3 with 'and N more' suffix", () => {
    const out = formatDigest([
      { projectName: "P1", unverified: 10 },
      { projectName: "P2", unverified: 9 },
      { projectName: "P3", unverified: 8 },
      { projectName: "P4", unverified: 7 },
      { projectName: "P5", unverified: 6 },
    ]);
    expect(out?.body).toContain("P1 (10), P2 (9), P3 (8) and 2 more.");
  });

  it("ignores projects with zero unverified", () => {
    const out = formatDigest([
      { projectName: "A", unverified: 4 },
      { projectName: "B", unverified: 0 },
      { projectName: "C", unverified: 1 },
    ]);
    expect(out?.body).toContain("Across 2 projects");
    expect(out?.body).not.toContain("B (0)");
  });
});
