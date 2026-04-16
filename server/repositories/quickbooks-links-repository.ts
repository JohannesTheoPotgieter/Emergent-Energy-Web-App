import { and, eq, inArray, isNull } from "drizzle-orm";
import { quickbooksInvoiceLinks } from "@shared/schema";
import { db } from "../db";

/** Minimal projection returned by link lookups — only the fields callers need. */
export interface QbLinkRef {
  appEntityId: number;
  qbEntityId: string;
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
   * Returns only (appEntityId, qbEntityId) — the minimum needed for matching.
   */
  async getActiveCostLineLinks(entityIds: number[]): Promise<QbLinkRef[]> {
    if (entityIds.length === 0) return [];
    return this.dbInstance
      .select({
        appEntityId: quickbooksInvoiceLinks.appEntityId,
        qbEntityId: quickbooksInvoiceLinks.qbEntityId,
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
   * Returns only (appEntityId, qbEntityId) — the minimum needed for matching.
   */
  async getActiveRevenueLineLinks(entityIds: number[]): Promise<QbLinkRef[]> {
    if (entityIds.length === 0) return [];
    return this.dbInstance
      .select({
        appEntityId: quickbooksInvoiceLinks.appEntityId,
        qbEntityId: quickbooksInvoiceLinks.qbEntityId,
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
}
