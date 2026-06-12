import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Finance compact-template conformance guard.
 *
 * The finance UI redesign rebuilt every finance page BODY onto the shared
 * compact template (FinancePageHeader → KpiRow → DrillTable → MoneyValue, with
 * shared loading/empty/error states). This static-source guard FAILS CI if a
 * finance page regresses to the legacy layout — i.e. if it reintroduces a
 * legacy-layout marker (the bespoke PageHero / DataSourceBadge / StaleIndicator
 * / DirectionDelta / DrillReconciliationFooter chrome, or the old
 * "Recon Grid" / "Tracker Gap" / "How it works" / month-detail / inline
 * "Planned → Committed → Realised" blocks) OR if it stops rendering through the
 * shared template components.
 *
 * Presentation-only intent: this asserts on the page SOURCE, never on a finance
 * number — money parity is locked separately by finance-money-format.test.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../.."); // qa/tests/unit -> repo root
const PAGES = resolve(ROOT, "client/src/pages");

const read = (file: string) => readFileSync(resolve(PAGES, file), "utf8");
const lines = (src: string) => src.split(/\r?\n/);

/**
 * The EXACT anti-shallow Gate-1 grep, applied per line (grep semantics: `.`
 * matches any single character). No finance page body may contain any of these.
 */
const LEGACY_BLOCK = /Recon Grid|Tracker Gap|How it works|Planned . Committed . Realised|month-detail/;

/** Bespoke legacy finance chrome that the compact template replaces. */
const LEGACY_CHROME = /PageHero|DataSourceBadge|StaleIndicator|DirectionDelta/;

/** DrillReconciliationFooter — legacy chrome everywhere EXCEPT the project
 *  detail page, where it is a deliberate per-line tie-out (kept by design). */
const RECON_FOOTER = /DrillReconciliationFooter/;

interface PageSpec {
  file: string;
  /** Pages that must surface a KPI strip via the shared KpiRow. */
  requiresKpiRow: boolean;
  /** Pages allowed to keep <DrillReconciliationFooter> (intentional tie-out). */
  allowsReconFooter?: boolean;
}

// Every finance page whose body was rebuilt onto the compact template.
const PAGE_SPECS: PageSpec[] = [
  { file: "revenue-tracker.tsx", requiresKpiRow: true },
  { file: "cos.tsx", requiresKpiRow: true },
  { file: "cashflow.tsx", requiresKpiRow: true },
  { file: "finance-gp-company.tsx", requiresKpiRow: true },
  { file: "finance-gp.tsx", requiresKpiRow: true },
  { file: "fye-revenue-tracking.tsx", requiresKpiRow: false },
  { file: "finance-qb-reconciliation.tsx", requiresKpiRow: true },
  { file: "finance-project-detail.tsx", requiresKpiRow: true, allowsReconFooter: true },
  // The reference implementation — guarded so the bar can never silently drop.
  { file: "finance-home.tsx", requiresKpiRow: true },
];

describe("finance pages — compact-template conformance", () => {
  for (const spec of PAGE_SPECS) {
    describe(spec.file, () => {
      const src = read(spec.file);

      it("contains no legacy-layout block marker", () => {
        const offenders = lines(src)
          .map((line, i) => ({ line, n: i + 1 }))
          .filter(({ line }) => LEGACY_BLOCK.test(line));
        expect(
          offenders,
          `legacy-layout marker(s) found:\n${offenders.map((o) => `  L${o.n}: ${o.line.trim()}`).join("\n")}`,
        ).toEqual([]);
      });

      it("contains no bespoke legacy finance chrome", () => {
        const offenders = lines(src)
          .map((line, i) => ({ line, n: i + 1 }))
          .filter(({ line }) => LEGACY_CHROME.test(line));
        expect(
          offenders,
          `legacy chrome found:\n${offenders.map((o) => `  L${o.n}: ${o.line.trim()}`).join("\n")}`,
        ).toEqual([]);
      });

      if (!spec.allowsReconFooter) {
        it("does not use the legacy DrillReconciliationFooter", () => {
          expect(RECON_FOOTER.test(src), "DrillReconciliationFooter is legacy chrome here").toBe(false);
        });
      }

      it("imports from the shared finance template", () => {
        expect(src).toContain("@/components/finance/template");
      });

      it("renders the shared FinancePageHeader", () => {
        expect(src).toContain("FinancePageHeader");
      });

      it("renders its main table through the shared DrillTable", () => {
        expect(src).toContain("DrillTable");
      });

      it("renders money through the shared MoneyValue", () => {
        expect(src).toContain("MoneyValue");
      });

      if (spec.requiresKpiRow) {
        it("renders a headline KPI strip through the shared KpiRow", () => {
          expect(src).toContain("KpiRow");
        });
      }
    });
  }
});
