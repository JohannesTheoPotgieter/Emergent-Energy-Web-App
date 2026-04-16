/**
 * B3: Opportunities CRUD routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { eq, desc, isNull, and } from "drizzle-orm";
import { opportunities } from "@shared/schema/projects";
import { z, ZodError } from "zod";
import { logAuditFromReq } from "../audit-logger";

// Validation for user-driven opportunity create/update. Intentionally
// narrower than the raw table schema:
//   - `pipedriveDealId` is NOT accepted — only the Pipedrive sync engine
//     writes that column.
//   - `source` is accepted but restricted to 'internal' on the create
//     path; flipping a row to 'pipedrive' is reserved for the sync engine.
//   - The old `name` field that this schema used to accept has been
//     dropped because the `opportunities` table has no `name` column.
//     It was being silently ignored by drizzle and leaking validation
//     errors when clients guessed at the shape.
const opportunityCreateSchema = z.object({
  clientId: z.number().int().optional(),
  siteId: z.number().int().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
  contractType: z.string().optional(),
  estimatedValue: z.union([z.string(), z.number()]).optional(),
  estimatedKwp: z.union([z.string(), z.number()]).optional(),
  estimatedKwh: z.union([z.string(), z.number()]).optional(),
  expectedCloseDate: z.string().optional(),
  signedDate: z.string().optional(),
  notes: z.string().optional(),
  fundingType: z.string().optional(),
  commercialRisks: z.string().optional(),
  source: z.literal("internal").optional(),
});

const router = Router();

router.get("/api/opportunities", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    const stage = req.query.stage as string | undefined;
    const conditions = [isNull(opportunities.deletedAt)];
    if (clientId) conditions.push(eq(opportunities.clientId, clientId));
    if (stage) conditions.push(eq(opportunities.stage, stage));

    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunities" });
  }
});

router.get("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, Number(req.params.id)));

    if (!row) return res.status(404).json({ error: "Opportunity not found" });
    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunity" });
  }
});

router.post("/api/opportunities", requireAuth, requirePermission("opportunities", "create"), async (req: Request, res: Response) => {
  try {
    const parsed = opportunityCreateSchema.parse(req.body);
    // Force `source` to 'internal' on the manual create path — the
    // Pipedrive sync engine is the only writer allowed to set 'pipedrive'.
    const [row] = await db
      .insert(opportunities)
      .values({ ...parsed, source: "internal" })
      .returning();

    logAuditFromReq(req, {
      entityType: "opportunity",
      entityId: String(row.id),
      action: "create",
      changesJson: {
        source: "internal",
        clientId: row.clientId ?? null,
        stage: row.stage,
        status: row.status,
        estimatedValue: row.estimatedValue ?? null,
      },
    });

    res.status(201).json(row);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Opportunities] Failed to create:", err);
    res.status(500).json({ error: "Failed to create opportunity" });
  }
});

router.patch("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "edit"), async (req: Request, res: Response) => {
  try {
    const parsed = opportunityCreateSchema.partial().parse(req.body);

    // Guard: if this opportunity is Pipedrive-sourced, the CRM-owned
    // fields will be overwritten by the next sync. We still allow the
    // update so the user can unblock themselves, but we warn on the
    // response so the UI can surface it. App-only fields (notes,
    // commercialRisks, fundingType) are always safe to edit.
    const [existing] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, Number(req.params.id)));
    if (!existing) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    // Never allow the PATCH path to mutate `source` or `pipedriveDealId`.
    // Both identify the row's origin and must only be written by the
    // sync engine.
    const { source: _source, ...safeFields } = parsed as typeof parsed & { source?: unknown };
    void _source;

    const [row] = await db
      .update(opportunities)
      .set({ ...safeFields, updatedAt: new Date() })
      .where(eq(opportunities.id, Number(req.params.id)))
      .returning();

    const crmOverwriteFields = ["stage", "status", "estimatedValue", "expectedCloseDate", "signedDate", "clientId"] as const;
    const touchesCrmField = existing.source === "pipedrive"
      && crmOverwriteFields.some(f => (safeFields as Record<string, unknown>)[f] !== undefined);

    // Only log the fields the user actually sent. `safeFields` already
    // excludes `source` and `pipedriveDealId` so the audit trail cannot
    // claim the user changed origin when they couldn't.
    const changedKeys = Object.keys(safeFields).filter(
      k => (safeFields as Record<string, unknown>)[k] !== undefined,
    );
    if (changedKeys.length > 0) {
      logAuditFromReq(req, {
        entityType: "opportunity",
        entityId: String(row.id),
        action: touchesCrmField ? "update_crm_field_on_synced_row" : "update",
        changesJson: {
          source: existing.source,
          changed: changedKeys,
          values: changedKeys.reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (safeFields as Record<string, unknown>)[k];
            return acc;
          }, {}),
        },
      });
    }

    res.json({
      ...row,
      _warning: touchesCrmField
        ? "This opportunity is synced from Pipedrive. The next sync run will overwrite stage, status, estimated value, expected close date, signed date, and clientId with the Pipedrive values. App-only fields (notes, commercial risks, funding type) will be preserved."
        : undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Opportunities] Failed to update:", err);
    res.status(500).json({ error: "Failed to update opportunity" });
  }
});

router.delete("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "delete"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(opportunities)
      .set({ deletedAt: new Date() })
      .where(eq(opportunities.id, Number(req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Opportunity not found" });

    logAuditFromReq(req, {
      entityType: "opportunity",
      entityId: String(row.id),
      action: "soft_delete",
      changesJson: { source: row.source, pipedriveDealId: row.pipedriveDealId ?? null },
    });

    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to delete:", err);
    res.status(500).json({ error: "Failed to delete opportunity" });
  }
});

export function registerOpportunitiesRoutes(app: Express) {
  app.use(router);
}
