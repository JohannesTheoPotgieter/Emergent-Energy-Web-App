/**
 * Finance single-source-of-truth guard.
 *
 * Every finance BUSINESS RULE must resolve through its ONE canonical function —
 * no parallel/inline re-implementations. This static guard fails CI if a future
 * change reintroduces duplicated logic, complementing the behavioural guards
 * (realisation-single-predicate, read-map-single-read-path, revenue-settlement-
 * logic, settlement-status).
 *
 * Canonical sources:
 *   §3.2 COS realised   → server/lib/finance/cos-realisation.ts  (isCanonicalCosRealised)
 *   §3.4 revenue settled→ server/lib/finance/revenue-ar-status.ts (isRevenueSettled)
 *   §3.7 date colour    → shared/finance/date-confirmation.ts     (isDateColourConfirmed)
 *   client status badge → client/src/lib/finance/settlement-status.ts (deriveSettlementStatus)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDateColourConfirmed } from "@shared/finance/date-confirmation";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** All non-test .ts/.tsx source files under the given roots. */
function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(full);
      } else if (
        (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
        !e.name.endsWith(".d.ts") &&
        !e.name.endsWith(".test.ts") &&
        !e.name.endsWith(".test.tsx") &&
        !e.name.endsWith(".spec.ts")
      ) {
        out.push(path.relative(ROOT, full));
      }
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return out;
}

const SOURCE = sourceFiles(["server", "client/src", "shared"]);

describe("finance single source of truth", () => {
  describe("§3.7 date-colour confirmation — one rule, no inline copies", () => {
    it("isDateColourConfirmed implements the colour-first rule (black=confirmed, red=unconfirmed)", () => {
      expect(isDateColourConfirmed(null, "black")).toBe(true);
      expect(isDateColourConfirmed(null, "red")).toBe(false);
      expect(isDateColourConfirmed(true, null)).toBe(true);
      expect(isDateColourConfirmed(false, null)).toBe(false);
      // colour wins over the stored flag
      expect(isDateColourConfirmed(true, "red")).toBe(false);
      expect(isDateColourConfirmed(false, "black")).toBe(true);
    });

    it("the server colour-confirmation helpers delegate to the canonical (do not redefine the rule)", () => {
      for (const f of [
        "server/lib/cashflow-helpers.ts",
        "server/lib/calculations/stateClassifier.ts",
        "server/departments/finance-routes.ts",
      ]) {
        expect(read(f), f).toContain("isDateColourConfirmed");
      }
    });

    it("no source file re-implements the colour→confirmed idiom inline", () => {
      // The tell-tale of a re-implementation: a RED font yields "unconfirmed"
      // (`=== 'red') return false` or `=== 'red' ? false`). Anything matching
      // must import isDateColourConfirmed instead.
      const RED_IDIOM = /===\s*['"]red['"]\s*(?:\)\s*return\s+false|\?\s*false)/;
      const ALLOW = new Set<string>([
        // The one canonical definition is allowed to contain the rule.
        "shared/finance/date-confirmation.ts",
      ]);
      const offenders = SOURCE.filter(
        (f) => !ALLOW.has(f) && RED_IDIOM.test(read(f)),
      );
      expect(
        offenders,
        "These files re-implement the §3.7 colour rule inline — import isDateColourConfirmed from @shared/finance/date-confirmation instead.",
      ).toEqual([]);
    });
  });

  describe("canonical predicates — exactly one definition each", () => {
    function definingFiles(pattern: RegExp): string[] {
      return SOURCE.filter((f) => pattern.test(read(f))).sort();
    }

    it("isCanonicalCosRealised (§3.2) is defined only in cos-realisation.ts", () => {
      expect(definingFiles(/export function isCanonicalCosRealised\b/)).toEqual([
        "server/lib/finance/cos-realisation.ts",
      ]);
    });

    it("isRevenueSettled (§3.4) is defined only in revenue-ar-status.ts", () => {
      expect(definingFiles(/export function isRevenueSettled\b/)).toEqual([
        "server/lib/finance/revenue-ar-status.ts",
      ]);
    });

    it("isDateColourConfirmed (§3.7) is defined only in shared/finance/date-confirmation.ts", () => {
      expect(definingFiles(/export function isDateColourConfirmed\b/)).toEqual([
        "shared/finance/date-confirmation.ts",
      ]);
    });

    it("deriveSettlementStatus (client status badge) is defined only in settlement-status.ts", () => {
      expect(definingFiles(/export function deriveSettlementStatus\b/)).toEqual([
        "client/src/lib/finance/settlement-status.ts",
      ]);
    });
  });
});
