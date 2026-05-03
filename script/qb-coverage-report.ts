/**
 * QuickBooks → Project resolver coverage report.
 *
 * Pulls QB Bills for a date range, runs the line-row extractor + project
 * resolver, and writes a JSON report to tmp/qb-coverage-report.json so we
 * can validate resolver accuracy BEFORE building the Tracker Gap UI.
 *
 * READ-ONLY. Never writes to normalized_cost_lines or quickbooks_invoice_links.
 *
 * Usage:
 *   tsx script/qb-coverage-report.ts --start 2025-09-01 --end 2025-10-31
 *
 * Optional:
 *   --out <path>   Override output JSON path (default tmp/qb-coverage-report.json)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initializeDatabase, db } from "../server/db.js";
import { normalizedCostLines, projectInfo } from "@shared/schema";
import { and, isNull } from "drizzle-orm";
import { getBills } from "../server/services/quickbooks-service.js";
import {
  billRawToLineRows,
  buildQbProjectResolver,
  normalizeProjectKey,
  type QbProjectResolutionStrategy,
  type QuickBooksBillLineRow,
} from "../server/services/quickbooks-reconciliation-service.js";

interface Args {
  start: string;
  end: string;
  out: string;
}

function parseArgs(): Args {
  const out: Partial<Args> = { out: resolve("tmp/qb-coverage-report.json") };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--start") out.start = argv[++i];
    else if (a === "--end") out.end = argv[++i];
    else if (a === "--out") out.out = resolve(argv[++i]!);
  }
  if (!out.start || !out.end) {
    throw new Error("Required: --start YYYY-MM-DD --end YYYY-MM-DD");
  }
  return out as Args;
}

interface CoverageRow extends QuickBooksBillLineRow {
  resolvedProjectName: string | null;
  strategy: QbProjectResolutionStrategy;
  matchedFrom: string | null;
  /** Closest matching app cost line, if any (preview of `tracker_gap`). */
  closestCostLineMatch: {
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: number | null;
    counterpartyName: string | null;
  } | null;
}

(async () => {
  const args = parseArgs();
  console.log(
    `[qb-coverage-report] window=${args.start}..${args.end} out=${args.out}`,
  );

  await initializeDatabase();

  // 1. Build the project-name universe from BOTH project_info and any
  //    project_name appearing in active normalized_cost_lines (catches
  //    legacy names that no longer have a project_info row).
  console.log("[qb-coverage-report] Loading project-name universe...");
  const projects = await db
    .select({ name: projectInfo.projectName })
    .from(projectInfo);
  const ncl = await db
    .select({ name: normalizedCostLines.projectName })
    .from(normalizedCostLines)
    .where(
      and(
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    );
  const universe = new Set<string>();
  for (const p of projects) if (p.name) universe.add(p.name);
  for (const r of ncl) if (r.name) universe.add(r.name);
  const projectNames = [...universe];
  console.log(
    `[qb-coverage-report] Project universe: ${projectNames.length} distinct names`,
  );

  // 2. Pre-bucket active cost lines by normalised project key for the
  //    `tracker_gap` preview — so we can quickly find candidate matches
  //    once a QB line has resolved to a project.
  console.log("[qb-coverage-report] Loading active cost lines...");
  const activeCostLines = await db
    .select({
      id: normalizedCostLines.id,
      projectName: normalizedCostLines.projectName,
      invoiceNumber: normalizedCostLines.invoiceNumber,
      invoiceDate: normalizedCostLines.invoiceDate,
      amountExVat: normalizedCostLines.amountExVat,
      counterpartyName: normalizedCostLines.counterpartyName,
    })
    .from(normalizedCostLines)
    .where(
      and(
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    );
  const costLinesByProjectKey = new Map<string, typeof activeCostLines>();
  for (const cl of activeCostLines) {
    const key = normalizeProjectKey(cl.projectName);
    if (!key) continue;
    if (!costLinesByProjectKey.has(key)) costLinesByProjectKey.set(key, []);
    costLinesByProjectKey.get(key)!.push(cl);
  }
  console.log(
    `[qb-coverage-report] Indexed ${activeCostLines.length} cost lines across ${costLinesByProjectKey.size} project keys`,
  );

  // 3. Pull QB bills.
  console.log("[qb-coverage-report] Fetching QB bills (paginated)...");
  const billsResp = await getBills(args.start, args.end);
  const bills: any[] = billsResp?.QueryResponse?.Bill ?? [];
  console.log(`[qb-coverage-report] Got ${bills.length} bills`);

  // 4. Build resolver + extract every bill line.
  const resolve_ = buildQbProjectResolver(projectNames);
  const rows: CoverageRow[] = [];
  for (const bill of bills) {
    const lineRows = billRawToLineRows(bill);
    for (const lr of lineRows) {
      const res = resolve_({
        classRefName: lr.classRefName,
        customerRefName: lr.customerRefName,
      });

      let closest: CoverageRow["closestCostLineMatch"] = null;
      if (res.projectName) {
        const candidates =
          costLinesByProjectKey.get(normalizeProjectKey(res.projectName)) ?? [];
        const target = lr.lineAmountExVat ?? 0;
        // Closest by amount (within R1 tolerance), then by invoice-number presence.
        const close = candidates
          .map((c) => ({
            c,
            diff: Math.abs(Number(c.amountExVat ?? 0) - target),
          }))
          .filter((x) => x.diff <= 1)
          .sort((a, b) => a.diff - b.diff)[0];
        if (close) {
          closest = {
            id: close.c.id,
            invoiceNumber: close.c.invoiceNumber,
            invoiceDate: close.c.invoiceDate
              ? String(close.c.invoiceDate)
              : null,
            amountExVat:
              close.c.amountExVat !== null && close.c.amountExVat !== undefined
                ? Number(close.c.amountExVat)
                : null,
            counterpartyName: close.c.counterpartyName,
          };
        }
      }

      rows.push({
        ...lr,
        resolvedProjectName: res.projectName,
        strategy: res.strategy,
        matchedFrom: res.matchedFrom,
        closestCostLineMatch: closest,
      });
    }
  }

  // 5. Aggregations.
  const byStrategy: Record<string, { count: number; amount: number }> = {};
  let totalAmount = 0;
  let resolvedAmount = 0;
  let trackerGapAmount = 0; // resolved but no matching cost line
  let trackerGapCount = 0;
  for (const r of rows) {
    const amt = r.lineAmountExVat ?? 0;
    totalAmount += amt;
    if (!byStrategy[r.strategy])
      byStrategy[r.strategy] = { count: 0, amount: 0 };
    byStrategy[r.strategy]!.count += 1;
    byStrategy[r.strategy]!.amount += amt;
    if (r.resolvedProjectName) {
      resolvedAmount += amt;
      if (!r.closestCostLineMatch) {
        trackerGapAmount += amt;
        trackerGapCount += 1;
      }
    }
  }

  // Unmapped Class breakdown (actionable list for finance / QB admin).
  const unmappedClasses = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    if (r.strategy === "unmapped_class" && r.classRefName) {
      const k = r.classRefName;
      if (!unmappedClasses.has(k))
        unmappedClasses.set(k, { count: 0, amount: 0 });
      const slot = unmappedClasses.get(k)!;
      slot.count += 1;
      slot.amount += r.lineAmountExVat ?? 0;
    }
  }
  const unmappedClassList = [...unmappedClasses.entries()]
    .map(([classRefName, v]) => ({ classRefName, ...v }))
    .sort((a, b) => b.amount - a.amount);

  // Fuzzy matches for human review.
  const fuzzyMatches = rows
    .filter(
      (r) =>
        r.strategy === "class_substring" || r.strategy === "customer_substring",
    )
    .map((r) => ({
      billId: r.billId,
      docNumber: r.docNumber,
      txnDate: r.txnDate,
      vendorName: r.vendorName,
      lineAmountExVat: r.lineAmountExVat,
      matchedFrom: r.matchedFrom,
      resolvedProjectName: r.resolvedProjectName,
      strategy: r.strategy,
    }));

  // Tracker-gap preview rows (resolved, no cost-line match).
  const trackerGapPreview = rows
    .filter((r) => r.resolvedProjectName && !r.closestCostLineMatch)
    .map((r) => ({
      project: r.resolvedProjectName,
      billId: r.billId,
      docNumber: r.docNumber,
      txnDate: r.txnDate,
      vendorName: r.vendorName,
      lineAmountExVat: r.lineAmountExVat,
      classRefName: r.classRefName,
      description: r.description,
    }))
    .sort((a, b) => (b.lineAmountExVat ?? 0) - (a.lineAmountExVat ?? 0));

  const report = {
    generatedAt: new Date().toISOString(),
    window: { start: args.start, end: args.end },
    summary: {
      totalBills: bills.length,
      totalLineRows: rows.length,
      totalAmountExVat: Math.round(totalAmount * 100) / 100,
      resolvedAmountExVat: Math.round(resolvedAmount * 100) / 100,
      resolvedPct:
        totalAmount > 0
          ? Math.round((resolvedAmount / totalAmount) * 10000) / 100
          : 0,
      trackerGapCount,
      trackerGapAmountExVat: Math.round(trackerGapAmount * 100) / 100,
      projectUniverseSize: projectNames.length,
    },
    byStrategy,
    unmappedClasses: unmappedClassList,
    fuzzyMatches,
    trackerGapPreview,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log("\n=== COVERAGE SUMMARY ===");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("\n=== BY STRATEGY ===");
  console.log(JSON.stringify(byStrategy, null, 2));
  console.log(`\n=== TOP 20 UNMAPPED CLASSES ===`);
  for (const u of unmappedClassList.slice(0, 20)) {
    console.log(
      `  R${u.amount.toFixed(0).padStart(12)}  (${u.count.toString().padStart(3)} lines)  ${u.classRefName}`,
    );
  }
  console.log(`\nReport written to: ${args.out}`);
  process.exit(0);
})().catch((err) => {
  console.error("[qb-coverage-report] FAILED:", err);
  process.exit(1);
});
