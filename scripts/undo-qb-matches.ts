/**
 * Undo / wipe QuickBooks match links.
 *
 * Soft-deletes (sets `deletedAt`) every row in the three tables that
 * record a "match" the user has performed in the QB matching screen:
 *
 *   1. `qb_link_proposed_cascades`   — per-link cascade proposals
 *      (children of `quickbooks_invoice_links`; pending + accepted +
 *      declined rows are all marked deleted so they don't haunt the
 *      inbox after the parent links are gone)
 *   2. `quickbooks_invoice_links`    — the actual cost_line / revenue_line
 *      ↔ QB bill / invoice links
 *   3. `quickbooks_cost_allocations` — many-to-many allocations from
 *      `quickbooks_documents` → cost lines (same audit semantics as
 *      links: governed by `deletedAt`)
 *
 * NOT touched:
 *   - quickbooks_customer_mappings / quickbooks_vendor_mappings
 *     (these are project↔customer / vendor↔counterparty mappings, not
 *     per-row match links — wiping them would invalidate every cascade)
 *   - quickbooks_match_suggestions (audit history; safe to keep)
 *   - quickbooks_documents (the QB-side evidence snapshots; reused on
 *     re-match)
 *
 * After this runs, the partial unique indexes
 *   - quickbooks_invoice_links_unique_idx (gated on `deletedAt IS NULL`)
 *   - uq_qb_cost_alloc_doc_line_active   (same gate)
 * are cleared, so the user can re-create matches without
 * "duplicate link" errors.
 *
 * Usage:
 *   npx tsx scripts/undo-qb-matches.ts                    # wipe everything (PROD-WIDE)
 *   npx tsx scripts/undo-qb-matches.ts --dry-run          # count only, no writes
 *   npx tsx scripts/undo-qb-matches.ts --project-id=42    # restrict to one project
 *   npx tsx scripts/undo-qb-matches.ts --realm=9341...    # restrict to one QB realm
 *   npx tsx scripts/undo-qb-matches.ts --skip-allocations # skip cost allocations
 *   npx tsx scripts/undo-qb-matches.ts --skip-cascades    # skip proposed cascades
 *
 * Idempotent — re-running is a no-op (rows with `deletedAt` set are
 * skipped by the same WHERE clauses).
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, initializeDatabase } from "../server/db";
import {
  quickbooksInvoiceLinks,
  quickbooksCostAllocations,
  qbLinkProposedCascades,
} from "@shared/schema/integrations";

interface Opts {
  projectId?: number;
  realmId?: string;
  dryRun: boolean;
  skipAllocations: boolean;
  skipCascades: boolean;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    dryRun: false,
    skipAllocations: false,
    skipCascades: false,
  };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--skip-allocations") opts.skipAllocations = true;
    else if (a === "--skip-cascades") opts.skipCascades = true;
    else if (a.startsWith("--project-id=")) {
      const v = Number(a.slice("--project-id=".length));
      if (!Number.isFinite(v)) throw new Error(`Invalid --project-id: ${a}`);
      opts.projectId = v;
    } else if (a.startsWith("--realm=")) {
      opts.realmId = a.slice("--realm=".length);
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: npx tsx scripts/undo-qb-matches.ts [--dry-run] [--project-id=N] [--realm=R] [--skip-allocations] [--skip-cascades]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);
  await initializeDatabase();

  const scope = [
    opts.projectId != null ? `project=${opts.projectId}` : "ALL projects",
    opts.realmId ? `realm=${opts.realmId}` : "ALL realms",
    opts.dryRun ? "(dry-run)" : "(LIVE)",
  ].join(" ");
  console.log(`\n[undo-qb-matches] Scope: ${scope}\n`);

  // ── 1. quickbooks_invoice_links ──────────────────────────────────────
  // Build live filter so we only count/touch undeleted rows.
  const linkWhere = and(
    isNull(quickbooksInvoiceLinks.deletedAt),
    opts.projectId != null
      ? eq(quickbooksInvoiceLinks.projectId, opts.projectId)
      : undefined,
    opts.realmId
      ? eq(quickbooksInvoiceLinks.qbRealmId, opts.realmId)
      : undefined,
  );
  const [{ count: liveLinkCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quickbooksInvoiceLinks)
    .where(linkWhere);
  console.log(`  invoice_links       : ${liveLinkCount} live rows`);

  // ── 2. qb_link_proposed_cascades ─────────────────────────────────────
  let liveCascadeCount = 0;
  if (!opts.skipCascades) {
    const cascadeWhere = and(
      isNull(qbLinkProposedCascades.deletedAt),
      opts.projectId != null
        ? eq(qbLinkProposedCascades.projectId, opts.projectId)
        : undefined,
    );
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(qbLinkProposedCascades)
      .where(cascadeWhere);
    liveCascadeCount = count;
    console.log(`  proposed_cascades   : ${liveCascadeCount} live rows`);
  }

  // ── 3. quickbooks_cost_allocations ───────────────────────────────────
  let liveAllocCount = 0;
  if (!opts.skipAllocations) {
    const allocWhere = and(
      isNull(quickbooksCostAllocations.deletedAt),
      opts.projectId != null
        ? eq(quickbooksCostAllocations.projectId, opts.projectId)
        : undefined,
    );
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(quickbooksCostAllocations)
      .where(allocWhere);
    liveAllocCount = count;
    console.log(`  cost_allocations    : ${liveAllocCount} live rows`);
  }

  if (opts.dryRun) {
    console.log("\n[undo-qb-matches] dry-run; no rows mutated.\n");
    return;
  }

  if (liveLinkCount + liveCascadeCount + liveAllocCount === 0) {
    console.log("\n[undo-qb-matches] nothing to do; all clear.\n");
    return;
  }

  // ── Mutations ────────────────────────────────────────────────────────
  // Order: cascades first (children of links), then links, then
  // allocations. The DB has no hard FKs across these tables (all
  // soft-delete via deletedAt), so the order is informational, not
  // required for integrity.
  const now = new Date();

  let deletedCascades = 0;
  if (!opts.skipCascades && liveCascadeCount > 0) {
    const where = and(
      isNull(qbLinkProposedCascades.deletedAt),
      opts.projectId != null
        ? eq(qbLinkProposedCascades.projectId, opts.projectId)
        : undefined,
    );
    const res = await db
      .update(qbLinkProposedCascades)
      .set({ deletedAt: now, updatedAt: now } as any)
      .where(where)
      .returning({ id: qbLinkProposedCascades.id });
    deletedCascades = res.length;
    console.log(`  ✓ soft-deleted ${deletedCascades} proposed_cascades`);
  }

  let deletedLinks = 0;
  if (liveLinkCount > 0) {
    const res = await db
      .update(quickbooksInvoiceLinks)
      .set({ deletedAt: now, updatedAt: now } as any)
      .where(linkWhere)
      .returning({ id: quickbooksInvoiceLinks.id });
    deletedLinks = res.length;
    console.log(`  ✓ soft-deleted ${deletedLinks} invoice_links`);
  }

  let deletedAllocs = 0;
  if (!opts.skipAllocations && liveAllocCount > 0) {
    const where = and(
      isNull(quickbooksCostAllocations.deletedAt),
      opts.projectId != null
        ? eq(quickbooksCostAllocations.projectId, opts.projectId)
        : undefined,
    );
    const res = await db
      .update(quickbooksCostAllocations)
      .set({ deletedAt: now, updatedAt: now, status: "reversed" } as any)
      .where(where)
      .returning({ id: quickbooksCostAllocations.id });
    deletedAllocs = res.length;
    console.log(`  ✓ soft-deleted ${deletedAllocs} cost_allocations`);
  }

  console.log(
    `\n[undo-qb-matches] done. links=${deletedLinks} cascades=${deletedCascades} allocations=${deletedAllocs}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[undo-qb-matches] FAILED:", err);
    process.exit(1);
  });
