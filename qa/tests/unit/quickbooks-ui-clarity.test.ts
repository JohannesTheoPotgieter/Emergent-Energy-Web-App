/**
 * QuickBooks UI clarity / trust-cue governance tests.
 *
 * Pins the round of UI fixes that turn the QuickBooks surface into a
 * clearly-labelled reconciliation boundary:
 *
 *   1. Cost-side labels say "bill" (QuickBooks Bill), not "invoice".
 *      - Page title: "QuickBooks Bill Linking"
 *      - Page-registry + nav label: "QB Bill Linking"
 *      - Reconciliation tab cost-side table headers: "Supplier invoice (app)"
 *        and "QB bill" (not "App invoice" / "QB invoice").
 *   2. Currency is ZAR everywhere in the QuickBooks surface (no hardcoded
 *      USD). The shared formatRand helper is the one source of truth.
 *   3. Reconciliation tab refresh button refetches the ACTIVE mode. The
 *      single refetch call in the filter card uses activeQuery.refetch(),
 *      and there is no direct reconQuery.refetch() or
 *      revenueReconQuery.refetch() call in the filter card path.
 *   4. Trust cues are present on admin-quickbooks, finance-quickbooks-links,
 *      and QuickBooksReconciliationTab (ReportTrustNotice + source /
 *      last-refresh / stale-data indicators).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const RECON_TAB = "client/src/components/tabs/QuickBooksReconciliationTab.tsx";
const LINKS_PAGE = "client/src/pages/finance-quickbooks-links.tsx";
const ADMIN_PAGE = "client/src/pages/admin-quickbooks.tsx";
const CUSTOMER_MAPPING_PAGE = "client/src/pages/finance-quickbooks-customer-mapping.tsx";
const CASHFLOW_PAGE = "client/src/pages/cashflow.tsx";
const PAGE_REGISTRY = "client/src/config/page-registry.ts";
const APP_NAV = "client/src/config/app-navigation.ts";

// ---------------------------------------------------------------------------
// 1. Cost-side label hygiene — invoice → bill where the object is a QB Bill
// ---------------------------------------------------------------------------

describe("QB UI clarity — cost-side labels say 'bill', not 'invoice'", () => {
  it("renames the finance linking page title to 'QuickBooks Bill Linking'", () => {
    const links = read(LINKS_PAGE);
    expect(links).toContain('title="QuickBooks Bill Linking"');
    // And nukes the old mislabel completely.
    expect(links).not.toContain('title="QuickBooks Invoice Linking"');
  });

  it("renames the page-registry + navigation label to 'QB Bill Linking'", () => {
    const registry = read(PAGE_REGISTRY);
    const nav = read(APP_NAV);
    expect(registry).toContain('label: "QB Bill Linking"');
    expect(registry).not.toContain('label: "QB Invoice Linking"');
    expect(nav).toContain('label: "QB Bill Linking"');
    expect(nav).not.toContain('label: "QB Invoice Linking"');
  });

  it("uses 'Supplier invoice (app)' and 'QB bill' in the cost-side matched table headers", () => {
    const recon = read(RECON_TAB);
    // New, correct headers must be present.
    expect(recon).toContain('<th className="px-2 py-1.5 text-left">Supplier invoice (app)</th>');
    expect(recon).toContain('<th className="px-2 py-1.5 text-left">QB bill</th>');
    // Old misleading headers must be gone on the cost side. The revenue-side
    // table legitimately uses "App invoice" / "QB invoice" and is out of scope.
    // Sanity: the cost-side `Linked` section starts with a `Matched` heading
    // followed by the four columns we just pinned. Grep for the exact pair
    // appearing in the same file.
    expect(recon).not.toMatch(/<th[^>]*>App invoice<\/th>\s*<th[^>]*>Supplier<\/th>\s*<th[^>]*>App amount<\/th>\s*<th[^>]*>QB invoice<\/th>/);
  });

  it("uses 'Supplier invoice #' on the app-only cost-side table", () => {
    const recon = read(RECON_TAB);
    expect(recon).toContain('<th className="px-2 py-1.5 text-left">Supplier invoice #</th>');
  });

  it("points users at 'QB bills' in the not-connected cost-side message", () => {
    const recon = read(RECON_TAB);
    expect(recon).toContain("reconcile QB bills against this project's cost lines");
  });
});

// ---------------------------------------------------------------------------
// 2. Currency is ZAR across the QuickBooks surface
// ---------------------------------------------------------------------------

describe("QB UI clarity — currency is ZAR everywhere", () => {
  it("removes hardcoded USD from admin-quickbooks", () => {
    const admin = read(ADMIN_PAGE);
    expect(admin).not.toMatch(/currency:\s*['"]USD['"]/);
  });

  it("admin-quickbooks delegates to the shared formatRand helper", () => {
    const admin = read(ADMIN_PAGE);
    expect(admin).toContain('from "@/lib/safeMoney"');
    expect(admin).toContain("formatRand(value)");
  });

  it("reconciliation tab and finance-quickbooks-links delegate to formatRand", () => {
    const recon = read(RECON_TAB);
    const links = read(LINKS_PAGE);
    expect(recon).toContain('from "@/lib/safeMoney"');
    expect(links).toContain('from "@/lib/safeMoney"');
    // No local Intl.NumberFormat(..., { currency: "ZAR" }) duplicates should
    // remain on the QuickBooks pages — the shared helper is the single home.
    expect(recon).not.toMatch(/Intl\.NumberFormat\([^)]*currency:\s*['"]ZAR['"]/s);
    expect(links).not.toMatch(/Intl\.NumberFormat\([^)]*currency:\s*['"]ZAR['"]/s);
  });
});

// ---------------------------------------------------------------------------
// 3. Refresh button refetches the ACTIVE mode
// ---------------------------------------------------------------------------

describe("QB UI clarity — refresh refetches the active mode", () => {
  const recon = read(RECON_TAB);

  it("declares an activeQuery derived from the mode toggle", () => {
    expect(recon).toMatch(/const activeQuery = mode === "cost" \? reconQuery : revenueReconQuery/);
  });

  it("wires the filter-card Refresh button to activeQuery.refetch()", () => {
    // The button's onClick must call activeQuery.refetch(), not
    // reconQuery.refetch() which was the old, broken behaviour that ignored
    // whether the user was in revenue mode.
    expect(recon).toMatch(/onClick=\{\(\) => activeQuery\.refetch\(\)\}/);
    expect(recon).toMatch(/disabled=\{activeQuery\.isFetching\}/);
  });

  it("does not call reconQuery.refetch() directly in executable code", () => {
    // Strip line-comments first so the regex only looks at actual code.
    // The forward-comment describing the old broken behaviour is allowed
    // to mention reconQuery.refetch(); a live caller is not.
    const code = recon
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(code).not.toMatch(/reconQuery\.refetch\(/);
    expect(code).not.toMatch(/revenueReconQuery\.refetch\(/);
  });

  it("exposes a data-testid so the fix can be smoke-tested", () => {
    expect(recon).toContain('data-testid="qb-recon-refresh"');
  });

  it("gates the top-level cost summary strip on mode === 'cost'", () => {
    // Otherwise switching to revenue mode briefly shows the cost summary.
    expect(recon).toMatch(/\{mode === "cost" && summary && \(/);
  });
});

// ---------------------------------------------------------------------------
// 4. Trust cues present on the QB surface
// ---------------------------------------------------------------------------

describe("QB UI clarity — trust cues surfaced", () => {
  it("reuses the shared ReportTrustNotice on every QB-facing page", () => {
    for (const file of [RECON_TAB, LINKS_PAGE, ADMIN_PAGE]) {
      const src = read(file);
      expect(src).toContain("ReportTrustNotice");
      expect(src).toContain('from "@/components/reports/ReportTrustNotice"');
    }
  });

  it("recon tab trust notice labels the source per active mode", () => {
    const recon = read(RECON_TAB);
    expect(recon).toContain("QB bills (evidence) ↔ normalized_cost_lines (truth)");
    expect(recon).toContain("QB invoices (evidence) ↔ normalized_revenue_lines (truth)");
  });

  it("links page trust notice reinforces app-as-truth language", () => {
    const links = read(LINKS_PAGE);
    expect(links).toContain("QuickBooks bills (evidence) ↔ normalized_cost_lines (truth)");
    expect(links).toContain("linking only attaches QB bill evidence");
  });

  it("admin page trust notice declares QB is read-only evidence and renders in ZAR", () => {
    const admin = read(ADMIN_PAGE);
    expect(admin).toContain("QuickBooks Online (read-only view)");
    expect(admin).toContain("rendered in ZAR");
  });

  it("surfaces an actor ('By') column on the existing-links table", () => {
    const links = read(LINKS_PAGE);
    expect(links).toContain('<th className="px-2 py-1.5 text-left">By</th>');
    expect(links).toContain("user #");
  });

  it("surfaces a stale-QB-data warning badge in the recon tab filter card", () => {
    const recon = read(RECON_TAB);
    expect(recon).toContain("stale QB data");
  });
});

// ---------------------------------------------------------------------------
// 5. Cashflow page — cost-side label clarity + freshness trust card
// ---------------------------------------------------------------------------

describe("Cashflow UI clarity — cost-side labels and freshness", () => {
  const cashflow = read(CASHFLOW_PAGE);

  it("renames the outflow detail column header from 'Invoice #' to 'Supplier invoice #'", () => {
    // The outflow row carries `expenseInvoiceNumber`, which represents the
    // supplier-issued document number (i.e. what becomes a QuickBooks Bill in
    // our books). Calling it just "Invoice #" was ambiguous because the
    // inflow detail table also has a column called "Invoice #" that refers to
    // OUR customer-facing AR invoices.
    expect(cashflow).toContain(">Supplier invoice #</th>");
  });

  it("does not call the outflow column 'Invoice #' (cost-side label hygiene)", () => {
    // The inflow table is allowed to use 'Invoice #' (those are our AR
    // invoices). We assert here that the outflow table's surrounding context
    // ('Line Item' header followed by the supplier doc column) uses the new
    // label, which guarantees we did not accidentally leave the old one in
    // the cost-side path.
    const inflowMatched = cashflow.match(
      /Line Item<\/th>\s*<th[^>]*>Supplier invoice #<\/th>/,
    );
    expect(inflowMatched).not.toBeNull();
  });

  it("rewrites the 'Risk' badge tooltip so users do not read it as a credit-risk score", () => {
    // The badge label still says "Risk" because it comes from the backend
    // status enum, but the tooltip must spell out that this means "no
    // supplier invoice on file yet" — i.e. an unbilled commitment, not a
    // counterparty / credit risk score.
    expect(cashflow).toContain("No supplier invoice on file yet");
    expect(cashflow).toContain("not a credit-risk score");
    // The old, ambiguous tooltip must be gone.
    expect(cashflow).not.toContain('title="Risk (no invoice)"');
  });

  it("surfaces a freshness trust card on the cashflow header", () => {
    expect(cashflow).toContain('data-testid="cashflow-trust-freshness"');
    // Last-refreshed wiring must use react-query's dataUpdatedAt — that's
    // the only timestamp the cashflow API surface gives us today, so use it
    // rather than fabricating a server-side generatedAt.
    expect(cashflow).toContain("dataUpdatedAt: cashflowUpdatedAt");
    expect(cashflow).toMatch(/new Date\(cashflowUpdatedAt\)\.toLocaleString\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. Customer-mapping page — trust cue surfaced
// ---------------------------------------------------------------------------

describe("QB Customer Mapping UI clarity — trust cue surfaced", () => {
  const page = read(CUSTOMER_MAPPING_PAGE);

  it("imports and renders the shared ReportTrustNotice", () => {
    expect(page).toContain("ReportTrustNotice");
    expect(page).toContain('from "@/components/reports/ReportTrustNotice"');
  });

  it("declares mapping is metadata-only (no money movement, no revenue recognition)", () => {
    // The whole point of the trust note is to disarm the worry that mapping
    // a project to a QB customer might silently affect the books.
    expect(page).toContain("metadata only");
    expect(page).toMatch(/does not move money/);
  });

  it("threads the QB lastSuccessfulSyncAt timestamp into the trust notice", () => {
    expect(page).toContain("lastSuccessfulSyncAt");
    expect(page).toMatch(/lastUpdatedAt=\{status\.lastSuccessfulSyncAt/);
  });
});
