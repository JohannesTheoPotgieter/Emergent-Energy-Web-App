/**
 * H5 — project-match variant hardening.
 *
 * Imports the REAL matcher (not a reimplementation) and pins that two distinct
 * projects sharing a leading prefix but carrying DIFFERENT trailing tokens
 * ("Coega Steels BESS" vs "Coega Steels Ph2") do NOT auto-map onto each other —
 * the collision that rotated one project's snapshot into the other on every
 * auto-import. Genuine re-imports and phase variants must keep working.
 */
import { describe, it, expect } from "vitest";
import {
  computeSimilarity,
  extractProjectNameFromFilename,
} from "../../../server/lib/import/project-match";

// The scheduler auto-maps a name match at >= this score (file-always-wins mode);
// see server/services/scheduled-import-v2.ts (AUTO_MATCH_THRESHOLD).
const AUTO_MATCH_THRESHOLD = 0.75;

describe("project-match — distinct trailing token ⇒ different project (H5)", () => {
  it("Coega Steels BESS does NOT auto-map onto Coega Steels Ph2", () => {
    const r = computeSimilarity("Coega Steels BESS", "Coega Steels Ph2");
    expect(r.matchReason).toBe("same_base_different_variant");
    expect(r.score).toBe(0.7);
    expect(r.score).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it("holds when derived from the real filename", () => {
    const name = extractProjectNameFromFilename("Coega Steels BESS_Tracker.xlsm");
    expect(name).toBe("Coega Steels BESS");
    const r = computeSimilarity(name, "Coega Steels Ph2");
    expect(r.score).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it("different trailing site names stay separate (… Citrusdal vs … Mossel Bay)", () => {
    const r = computeSimilarity("Hungry Lion Citrusdal", "Hungry Lion Mossel Bay");
    expect(r.matchReason).toBe("same_base_different_variant");
    expect(r.score).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  // ── Regressions the hardening must NOT break ──────────────────────────────
  it("phase variants keep their dedicated reason (Ph2 vs Ph1)", () => {
    const r = computeSimilarity("Coega Steels Ph2", "Coega Steels Ph1");
    expect(r.score).toBe(0.7);
    expect(r.matchReason).toBe("same_project_different_phase");
  });

  it("an exact re-import still auto-maps (rev-stripped filename → project)", () => {
    expect(computeSimilarity("Mondi", "Mondi").score).toBe(1.0);
    const name = extractProjectNameFromFilename("Mondi_Tracker_Rev02.xlsm");
    expect(computeSimilarity(name, "Mondi").score).toBe(1.0);
  });

  it("a pure prefix extension is intentionally left matchable (shorter filename → fuller project)", () => {
    // One side has NO extra token — not the two-distinct-suffix case — so the
    // existing containment match is preserved on purpose.
    expect(computeSimilarity("Mondi", "Mondi Solar").score).toBeGreaterThanOrEqual(
      AUTO_MATCH_THRESHOLD,
    );
  });

  it("completely different names stay low", () => {
    expect(computeSimilarity("Alpha Corp", "Beta Inc").score).toBeLessThan(0.5);
  });
});
