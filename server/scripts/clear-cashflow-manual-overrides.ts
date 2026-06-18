#!/usr/bin/env tsx
/**
 * Clear weekly-cashflow MANUAL OVERRIDES so the cashflow reads only from the
 * tracker / canonical source.
 *
 * WHY THIS EXISTS
 * ---------------
 * The weekly cashflow does NOT bucket a line by its tracker date directly. For
 * inflows it buckets by an `effectiveDate` resolved in this priority order
 * (server/lib/cashflow-helpers.ts → resolveInflowEffectiveDates):
 *
 *     1. adminDateOverride            ← MANUAL override (wins over everything)
 *     2. paymentReceivedDate (paidDate, the tracker value)
 *     3. milestone_task_links.dateOverride   ← MANUAL override
 *     4. linked task date
 *     5. computedForecastReceiptDate
 *     6. plannedPaymentDate
 *
 * So a milestone whose tracker "Payment Received Date" is e.g. 02-Jul can still
 * show in the CURRENT week if an admin date override points it there. That is
 * the symptom this script removes — it strips the manual layers so every figure
 * falls back to the tracker / computed value.
 *
 * SCOPE — the six override stores surfaced to the owner, plus two consistency
 * cleanups, all cleared:
 *
 *   1. normalized_revenue_lines.admin_date_override   inflow date overrides  (current rows only)
 *   2. normalized_cost_lines.admin_date_override      outflow date overrides (current rows only)
 *   3. milestone_task_links.date_override             inflow date via task link
 *   4. expense_task_links.date_override               outflow date via task link
 *   5. cashflow_weekly_manual                         weekly opening-balance overrides   (delete all)
 *   6. opex_weekly_manual                             OPEX weekly "DIY" overrides        (delete all)
 *   7. available_payment_overrides                    available-to-pay overrides         (delete all)
 *   8. manual_edit_flags WHERE field_name='adminDateOverride'
 *        consistency cleanup — mirrors what the UI does when an override is
 *        cleared, so Smart-Import conflict detection stops protecting the now-
 *        removed date overrides.
 *
 * DELIBERATELY NOT TOUCHED (out of the approved scope — these move REV/COS
 * recognition MONTH, not the cashflow WEEK):
 *   - normalized_cost_lines.recognition_date_override / revenue recognition overrides
 *   - manual_edit_flags for any field other than adminDateOverride (invoice no.,
 *     amount, etc. corrections stay protected)
 *
 * SNAPSHOT SAFETY: the two normalized_* tables are temporal. Only CURRENT rows
 * (effective_to IS NULL AND deleted_at IS NULL) are touched; historical
 * snapshots are immutable and left alone (the cashflow only reads current rows).
 *
 * This does NOT modify any frozen finance computation code — it only clears
 * override DATA. It WILL move numbers across the grid (both sides, many weeks).
 * Run is gated, DRY-RUN by default, and wrapped in a single transaction.
 *
 * Usage:
 *   tsx server/scripts/clear-cashflow-manual-overrides.ts            # DRY RUN (counts only, no writes)
 *   tsx server/scripts/clear-cashflow-manual-overrides.ts --apply    # writes (Postgres only)
 */

import { pathToFileURL } from "node:url";

import { and, count, eq, isNotNull, isNull } from "drizzle-orm";

import { db, getDbMode, initializeDatabase } from "../db";
import {
  availablePaymentOverrides,
  cashflowWeeklyManual,
  expenseTaskLinks,
  milestoneTaskLinks,
  normalizedCostLines,
  normalizedRevenueLines,
  opexWeeklyManual,
} from "@shared/schema/finance";
import { manualEditFlags } from "@shared/schema/imports";

// `db` is intentionally typed `any` in db.ts (dual SQLite/Postgres driver), so
// the transaction handle shares that surface. No `any` literal is introduced.
type Tx = typeof db;

interface OverrideStore {
  /** Human label shown in the report. */
  label: string;
  /** Count rows that WILL be affected. */
  countAffected: () => Promise<number>;
  /** Perform the clear inside the transaction. */
  apply: (tx: Tx) => Promise<void>;
}

// Clear the admin-date-override quartet on the CURRENT rows of a temporal table.
const clearAdminDateOverride = (
  table: typeof normalizedRevenueLines | typeof normalizedCostLines,
): OverrideStore["apply"] => async (tx) => {
  await tx
    .update(table)
    .set({
      adminDateOverride: null,
      adminDateOverrideReason: null,
      adminDateOverrideBy: null,
      adminDateOverrideAt: null,
    })
    .where(
      and(
        isNull(table.effectiveTo),
        isNull(table.deletedAt),
        isNotNull(table.adminDateOverride),
      ),
    );
};

const countAdminDateOverride = (
  table: typeof normalizedRevenueLines | typeof normalizedCostLines,
): OverrideStore["countAffected"] => async () => {
  const [row] = await db
    .select({ n: count() })
    .from(table)
    .where(
      and(
        isNull(table.effectiveTo),
        isNull(table.deletedAt),
        isNotNull(table.adminDateOverride),
      ),
    );
  return Number(row?.n ?? 0);
};

// Clear the date-override pair on a task-link table.
const clearTaskLinkDateOverride = (
  table: typeof milestoneTaskLinks | typeof expenseTaskLinks,
): OverrideStore["apply"] => async (tx) => {
  await tx
    .update(table)
    .set({ dateOverride: null, dateOverrideReason: null })
    .where(isNotNull(table.dateOverride));
};

const countTaskLinkDateOverride = (
  table: typeof milestoneTaskLinks | typeof expenseTaskLinks,
): OverrideStore["countAffected"] => async () => {
  const [row] = await db
    .select({ n: count() })
    .from(table)
    .where(isNotNull(table.dateOverride));
  return Number(row?.n ?? 0);
};

const countAll = (
  // any of the small delete-all override tables
  table:
    | typeof cashflowWeeklyManual
    | typeof opexWeeklyManual
    | typeof availablePaymentOverrides,
): OverrideStore["countAffected"] => async () => {
  const [row] = await db.select({ n: count() }).from(table);
  return Number(row?.n ?? 0);
};

const stores: OverrideStore[] = [
  {
    label: "normalized_revenue_lines.admin_date_override (inflow dates)",
    countAffected: countAdminDateOverride(normalizedRevenueLines),
    apply: clearAdminDateOverride(normalizedRevenueLines),
  },
  {
    label: "normalized_cost_lines.admin_date_override (outflow dates)",
    countAffected: countAdminDateOverride(normalizedCostLines),
    apply: clearAdminDateOverride(normalizedCostLines),
  },
  {
    label: "milestone_task_links.date_override (inflow via task link)",
    countAffected: countTaskLinkDateOverride(milestoneTaskLinks),
    apply: clearTaskLinkDateOverride(milestoneTaskLinks),
  },
  {
    label: "expense_task_links.date_override (outflow via task link)",
    countAffected: countTaskLinkDateOverride(expenseTaskLinks),
    apply: clearTaskLinkDateOverride(expenseTaskLinks),
  },
  {
    label: "cashflow_weekly_manual (opening-balance overrides) — DELETE ALL",
    countAffected: countAll(cashflowWeeklyManual),
    apply: async (tx) => {
      await tx.delete(cashflowWeeklyManual);
    },
  },
  {
    label: "opex_weekly_manual (OPEX weekly overrides) — DELETE ALL",
    countAffected: countAll(opexWeeklyManual),
    apply: async (tx) => {
      await tx.delete(opexWeeklyManual);
    },
  },
  {
    label: "available_payment_overrides (available-to-pay) — DELETE ALL",
    countAffected: countAll(availablePaymentOverrides),
    apply: async (tx) => {
      await tx.delete(availablePaymentOverrides);
    },
  },
  {
    label: "manual_edit_flags (field_name='adminDateOverride') — consistency cleanup",
    countAffected: async () => {
      const [row] = await db
        .select({ n: count() })
        .from(manualEditFlags)
        .where(eq(manualEditFlags.fieldName, "adminDateOverride"));
      return Number(row?.n ?? 0);
    },
    apply: async (tx) => {
      await tx.delete(manualEditFlags).where(eq(manualEditFlags.fieldName, "adminDateOverride"));
    },
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(
    `Clear cashflow manual overrides — ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}\n`,
  );

  await initializeDatabase();

  // Hard gate: never run against the dev SQLite fallback. This is a prod data op.
  const mode = getDbMode();
  if (mode !== "postgres") {
    throw new Error(
      `Refusing to run: database mode is "${mode}", expected "postgres". ` +
        "Run this on Replit where DATABASE_URL points at the production database.",
    );
  }

  let totalAffected = 0;
  console.log("Rows that would be cleared per store:\n");
  for (const store of stores) {
    const n = await store.countAffected();
    totalAffected += n;
    console.log(`  ${n.toString().padStart(6)}  ${store.label}`);
  }
  console.log(`\n  ${totalAffected.toString().padStart(6)}  TOTAL\n`);

  if (totalAffected === 0) {
    console.log("Nothing to clear — no manual overrides found. Done.");
    return;
  }

  if (!apply) {
    console.log("Dry run — nothing written. Re-run with --apply to clear the overrides above.");
    return;
  }

  await db.transaction(async (tx: Tx) => {
    for (const store of stores) {
      await store.apply(tx);
    }
  });

  // Re-count to prove the clear landed.
  let remaining = 0;
  for (const store of stores) remaining += await store.countAffected();
  console.log(`Done. Cleared overrides. Remaining override rows across all stores: ${remaining}.`);
  if (remaining !== 0) {
    throw new Error(
      `Post-clear count is ${remaining}, expected 0 — the transaction may not have committed. Investigate.`,
    );
  }
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
