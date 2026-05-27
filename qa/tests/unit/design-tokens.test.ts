/**
 * PR-A — Visual system lockdown (truth · clear · simple).
 *
 * Pins the small public contract of `client/src/lib/design-tokens.ts`
 * so future drift fails CI. The palette is deliberately small;
 * adding new colours requires editing the helper and adding a test
 * case here, which is the friction we want.
 */

import { describe, expect, it } from "vitest";
import {
  statusClasses,
  statusBadgeClasses,
  statusLevel,
  ragLevel,
  TYPOGRAPHY,
  DENSITY,
} from "../../../client/src/lib/design-tokens";

describe("design tokens — palette is closed", () => {
  it("only emerald / amber / red / slate appear in the soft variant", () => {
    const all = [
      statusClasses("healthy", "soft"),
      statusClasses("warning", "soft"),
      statusClasses("critical", "soft"),
      statusClasses("neutral", "soft"),
    ].join(" ");
    // The four canonical Tailwind colour roots — and nothing else.
    expect(all).toMatch(/emerald-/);
    expect(all).toMatch(/amber-/);
    expect(all).toMatch(/red-/);
    expect(all).toMatch(/slate-/);
    // Off-palette colours that the audit banned must NEVER appear.
    expect(all).not.toMatch(/\bblue-\d/);
    expect(all).not.toMatch(/\borange-\d/);
    expect(all).not.toMatch(/\bsky-\d/);
    expect(all).not.toMatch(/\brose-\d/);
    expect(all).not.toMatch(/\bviolet-\d/);
    expect(all).not.toMatch(/\byellow-\d/);
    expect(all).not.toMatch(/\bpurple-\d/);
  });

  it("each variant returns a distinct class set per level", () => {
    const variants = ["soft", "solid", "outline", "text"] as const;
    const levels = ["healthy", "warning", "critical", "neutral"] as const;
    const seen = new Set<string>();
    for (const v of variants) for (const l of levels) {
      const cls = statusClasses(l, v);
      expect(cls.length).toBeGreaterThan(0);
      expect(seen.has(`${l}:${v}:${cls}`)).toBe(false);
      seen.add(`${l}:${v}:${cls}`);
    }
  });
});

describe("design tokens — status mapping", () => {
  it("approved / accepted / paid / done collapse to healthy", () => {
    for (const s of ["approved", "Accepted", "paid", "DONE", "complete", "passed"]) {
      expect(statusLevel(s)).toBe("healthy");
    }
  });

  it("submitted / in_review / pending / planned collapse to warning", () => {
    for (const s of ["submitted", "in_review", "pending", "planned", "in_progress", "loaded_for_payment"]) {
      expect(statusLevel(s)).toBe("warning");
    }
  });

  it("overdue / blocked / rejected / cancelled collapse to critical", () => {
    for (const s of ["overdue", "blocked", "rejected", "cancelled", "fail", "on_hold"]) {
      expect(statusLevel(s)).toBe("critical");
    }
  });

  it("unknown / null / new / not_started / na route to neutral (never guesses)", () => {
    for (const s of [undefined, null, "", "totally-unknown", "new", "not_started", "na"]) {
      expect(statusLevel(s)).toBe("neutral");
    }
  });

  it("statusBadgeClasses is case-insensitive and snake-tolerant", () => {
    expect(statusBadgeClasses("APPROVED")).toBe(statusBadgeClasses("approved"));
    expect(statusBadgeClasses("loaded-for-payment")).toBe(statusBadgeClasses("loaded_for_payment"));
  });
});

describe("design tokens — RAG mapping", () => {
  it("GREEN / AMBER / RED resolve correctly", () => {
    expect(ragLevel("GREEN")).toBe("healthy");
    expect(ragLevel("AMBER")).toBe("warning");
    expect(ragLevel("YELLOW")).toBe("warning");
    expect(ragLevel("RED")).toBe("critical");
  });

  it("unknown / null route to neutral", () => {
    expect(ragLevel(null)).toBe("neutral");
    expect(ragLevel(undefined)).toBe("neutral");
    expect(ragLevel("PURPLE")).toBe("neutral");
  });
});

describe("design tokens — typography + density constants", () => {
  it("typography exposes exactly three sizes", () => {
    expect(Object.keys(TYPOGRAPHY).sort()).toEqual(["BODY", "PAGE_TITLE", "SECTION"]);
  });

  it("density caps the KPI tile count at 5 above the fold", () => {
    expect(DENSITY.MAX_KPI_TILES_VISIBLE).toBe(5);
  });

  it("density caps badges per row at 2", () => {
    expect(DENSITY.MAX_BADGES_PER_ROW).toBe(2);
  });
});
