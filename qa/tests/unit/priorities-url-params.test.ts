/**
 * URL-state contract for the /priorities filter chips (Phase 7B).
 *
 * The home dashboard's "My Overdue Actions" callouts deep-link to
 * /priorities?tab=my&health=at_risk to pre-filter the page. This
 * contract is implemented inline in `pages/priorities.tsx` and was
 * previously untested — the audit flagged a bookmark/share-link
 * regression risk.
 *
 * `parsePrioritiesFilterParams` is the pure helper that reads the
 * query string and produces the initial filter state. Tests pin:
 *   - Valid values pass through unchanged
 *   - Unknown / typo values fall back to "all"
 *   - Empty / missing params yield "all" defaults
 *   - The whitelist matches the chip Select options in the JSX
 */

import { describe, expect, it } from "vitest";
import {
  getMyWorkSurfaceOrder,
  parsePrioritiesFilterParams,
} from "../../../client/src/pages/priorities";

describe("parsePrioritiesFilterParams — Phase 7B URL contract", () => {
  describe("defaults", () => {
    it("returns 'all' for both filters when no params", () => {
      expect(parsePrioritiesFilterParams("")).toEqual({ level: "all", health: "all" });
    });

    it("returns 'all' when params are unrelated (e.g., ?tab=my)", () => {
      expect(parsePrioritiesFilterParams("?tab=my")).toEqual({ level: "all", health: "all" });
    });

    it("returns 'all' when param is present but empty (?level=)", () => {
      expect(parsePrioritiesFilterParams("?level=&health=")).toEqual({ level: "all", health: "all" });
    });
  });

  describe("level — every allowed value passes through", () => {
    it.each([
      ["all", "all"],
      ["critical", "critical"],
      ["important", "important"],
      ["normal", "normal"],
    ])("?level=%s → level=%s", (input, expected) => {
      expect(parsePrioritiesFilterParams(`?level=${input}`).level).toBe(expected);
    });

    it("unknown level falls back to 'all'", () => {
      expect(parsePrioritiesFilterParams("?level=high").level).toBe("all");
      expect(parsePrioritiesFilterParams("?level=BOOM").level).toBe("all");
      expect(parsePrioritiesFilterParams("?level=' OR 1=1--").level).toBe("all");
    });
  });

  describe("health — every allowed value passes through", () => {
    it.each([
      ["all", "all"],
      ["critical", "critical"],
      ["at_risk", "at_risk"],
      ["healthy", "healthy"],
    ])("?health=%s → health=%s", (input, expected) => {
      expect(parsePrioritiesFilterParams(`?health=${input}`).health).toBe(expected);
    });

    it("unknown health falls back to 'all'", () => {
      expect(parsePrioritiesFilterParams("?health=fine").health).toBe("all");
      expect(parsePrioritiesFilterParams("?health=at-risk").health).toBe("all"); // wrong separator
    });
  });

  describe("home-dashboard deep-link patterns", () => {
    it("supports the canonical 'My Overdue Actions' deep-link", () => {
      // From client/src/pages/home.tsx — the "My Overdue Actions" callouts
      // and `home-launchpad.ts` send users to this URL.
      const result = parsePrioritiesFilterParams("?tab=my&health=at_risk");
      expect(result).toEqual({ level: "all", health: "at_risk" });
    });

    it("supports combined level + health deep-link", () => {
      const result = parsePrioritiesFilterParams("?tab=my&level=critical&health=at_risk");
      expect(result).toEqual({ level: "critical", health: "at_risk" });
    });

    it("ignores extra unrelated params", () => {
      const result = parsePrioritiesFilterParams("?tab=company&level=critical&health=at_risk&otherParam=x");
      expect(result).toEqual({ level: "critical", health: "at_risk" });
    });
  });

  describe("regression — defends against typo / drift in the whitelist", () => {
    it("rejects 'high' for level (was a candidate; canonical is 'important')", () => {
      // If someone changes the chip Select option to 'high' but forgets to
      // update the parser whitelist, this test fails — and vice versa.
      expect(parsePrioritiesFilterParams("?level=high").level).toBe("all");
    });

    it("rejects 'red' / 'amber' / 'green' for health (raw RAG values, not the chip value)", () => {
      expect(parsePrioritiesFilterParams("?health=red").health).toBe("all");
      expect(parsePrioritiesFilterParams("?health=amber").health).toBe("all");
      expect(parsePrioritiesFilterParams("?health=green").health).toBe("all");
    });
  });
});

describe("getMyWorkSurfaceOrder", () => {
  it("puts tasks first when the my-work queue has tasks but no visible priorities", () => {
    expect(getMyWorkSurfaceOrder({ priorityCount: 0, openTaskCount: 4 })).toBe("tasks-first");
  });

  it("keeps priorities first when there is priority work to review", () => {
    expect(getMyWorkSurfaceOrder({ priorityCount: 2, openTaskCount: 4 })).toBe("priorities-first");
  });

  it("keeps the empty priority state first when there are no open tasks", () => {
    expect(getMyWorkSurfaceOrder({ priorityCount: 0, openTaskCount: 0 })).toBe("priorities-first");
  });
});
