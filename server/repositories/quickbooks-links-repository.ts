import { and, eq, inArray, isNull } from "drizzle-orm";
import { quickbooksInvoiceLinks, type QuickBooksInvoiceLink } from "@shared/schema";
import { db } from "../db";

/** Minimal projection returned by link lookups — only the fields callers need. */
export interface QbLinkRef {
  appEntityId: number;
  qbEntityId: string;
  /** ex-VAT slice of the QB doc allocated to this app line (post-Task #142). */
  allocatedAmountExVat: string | null;
  /** Snapshot of the QB doc total at link-creation time (pre-Task #142 rows). */
  qbAmount: string | null;
}

export class QuickBooksLinksRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /**
   * Find active QB links for a set of cost-line IDs.
   * Returns (appEntityId, qbEntityId, allocatedAmountExVat, qbAmount) — the
   * fields needed both for transaction matching and per-line divergence checks.
   */
  async getActiveCostLineLinks(entityIds: number[]): Promise<QbLinkRef[]> {
    if (entityIds.length === 0) return [];
    return this.dbInstance
      .select({
        appEntityId: quickbooksInvoiceLinks.appEntityId,
        qbEntityId: quickbooksInvoiceLinks.qbEntityId,
        allocatedAmountExVat: quickbooksInvoiceLinks.allocatedAmountExVat,
        qbAmount: quickbooksInvoiceLinks.qbAmount,
      })
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.appEntityType, "cost_line"),
          inArray(quickbooksInvoiceLinks.appEntityId, entityIds),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      );
  }

  /**
   * Find active QB links for a set of revenue-line IDs.
   * Returns (appEntityId, qbEntityId, allocatedAmountExVat, qbAmount).
   */
  async getActiveRevenueLineLinks(entityIds: number[]): Promise<QbLinkRef[]> {
    if (entityIds.length === 0) return [];
    return this.dbInstance
      .select({
        appEntityId: quickbooksInvoiceLinks.appEntityId,
        qbEntityId: quickbooksInvoiceLinks.qbEntityId,
        allocatedAmountExVat: quickbooksInvoiceLinks.allocatedAmountExVat,
        qbAmount: quickbooksInvoiceLinks.qbAmount,
      })
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.appEntityType, "revenue_line"),
          inArray(quickbooksInvoiceLinks.appEntityId, entityIds),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      );
  }

  async existsActiveLink(
    appEntityType: "cost_line" | "revenue_line",
    appEntityId: number,
  ): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ id: quickbooksInvoiceLinks.id })
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
          eq(quickbooksInvoiceLinks.appEntityId, appEntityId),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      )
      .limit(1);
    return !!row;
  }

  async listLinkedQbIds(
    qbEntityType: "bill" | "invoice",
    qbRealmId: string,
    qbEntityIds: string[],
  ): Promise<Set<string>> {
    if (qbEntityIds.length === 0) return new Set();
    const rows = await this.dbInstance
      .select({ qbEntityId: quickbooksInvoiceLinks.qbEntityId })
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.qbEntityType, qbEntityType),
          eq(quickbooksInvoiceLinks.qbRealmId, qbRealmId),
          isNull(quickbooksInvoiceLinks.deletedAt),
          inArray(quickbooksInvoiceLinks.qbEntityId, qbEntityIds),
        ),
      );
    return new Set(rows.map((r: { qbEntityId: string }) => r.qbEntityId));
  }

  async getLinkById(id: number): Promise<QuickBooksInvoiceLink | null> {
    const [row] = await this.dbInstance
      .select()
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.id, id),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listActiveLinkedAppIds(
    appEntityType: "cost_line" | "revenue_line",
    appEntityIds: number[],
  ): Promise<Set<number>> {
    if (appEntityIds.length === 0) return new Set();
    const rows = await this.dbInstance
      .select({ appEntityId: quickbooksInvoiceLinks.appEntityId })
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
          inArray(quickbooksInvoiceLinks.appEntityId, appEntityIds),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      );
    return new Set(rows.map((r: { appEntityId: number }) => r.appEntityId));
  }

  /**
   * Bulk listing of all active links for a given (appEntityType,
   * qbEntityType) pair — used by COS / revenue tracker, reconciliation,
   * and month-detail endpoints that need every link of a given shape.
   */
  async listActiveLinksByPair(
    appEntityType: "cost_line" | "revenue_line",
    qbEntityType: "bill" | "invoice",
  ): Promise<QuickBooksInvoiceLink[]> {
    return this.dbInstance
      .select()
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
          eq(quickbooksInvoiceLinks.qbEntityType, qbEntityType),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      );
  }

  /**
   * All active links targeting a specific QB document. Used by the
   * manual-link allocation guard to sum sibling allocations and reject
   * over-allocation before writing a new link.
   */
  async listActiveLinksForQbDoc(
    qbEntityType: "bill" | "invoice",
    qbEntityId: string,
  ): Promise<QuickBooksInvoiceLink[]> {
    return this.dbInstance
      .select()
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.qbEntityType, qbEntityType),
          eq(quickbooksInvoiceLinks.qbEntityId, qbEntityId),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      );
  }
}
