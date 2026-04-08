/**
 * Clients Routes — Extracted from server/routes.ts (Phase 3b)
 *
 * 2 handlers:
 *   GET  /api/clients
 *   POST /api/clients
 *
 * Dependencies: promoted-core read compat, feature flags, zod, dual-write to core.clients
 */

import type { Express } from "express";
import { db } from "../db";
import { asc, sql } from "drizzle-orm";
import { z } from "zod";
import { clients } from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { logAuditFromReq } from "../audit-logger";
import { getFeatureFlag } from "../lib/feature-flags";
import {
  compareCoreClientsReadiness,
  listClientsFromPromotedCoreCompat,
} from "../services/promoted-read-compat";

export function registerClientsExtractedRoutes(app: Express): void {

  app.get("/api/clients", requireAuth, async (req, res) => {
    try {
      const usePromotedRead = await getFeatureFlag("promoted_core_clients_read");
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      const allClients = usePromotedRead
        ? await listClientsFromPromotedCoreCompat()
        : await db.select().from(clients).orderBy(asc(clients.name));

      if (compareMode || usePromotedRead) {
        const comparison = await compareCoreClientsReadiness();
        if (comparison.status !== "ready") {
          console.warn("[promoted-read][clients] mismatch detected", comparison);
        }
        res.setHeader("X-Promoted-Clients-Read", usePromotedRead ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Clients-Comparison-Status", comparison.status);
      }

      res.json(allClients);
    } catch (error) {
      console.error("Clients fetch error:", error);
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/api/clients", requireAuth, requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        clientId: z.string().optional(),
      });
      const parsed = schema.parse(req.body);
      const maxIdResult = await db.execute(sql`SELECT COALESCE(MAX(CAST(SUBSTRING(client_id FROM 5) AS INTEGER)), 0) as max_num FROM clients WHERE client_id LIKE 'EE-C%'`);
      const nextNum = ((maxIdResult.rows[0] as any)?.max_num || 0) + 1;
      const generatedClientId = parsed.clientId || `EE-C${String(nextNum).padStart(4, '0')}`;
      const [created] = await db.insert(clients).values({
        name: parsed.name,
        clientId: generatedClientId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
      }).returning();

      const dualWriteEnabled = await getFeatureFlag("promoted_core_clients_dual_write");
      let promotedMirror: { attempted: boolean; success: boolean; error: string | null } = { attempted: false, success: false, error: null };
      if (dualWriteEnabled) {
        promotedMirror.attempted = true;
        try {
          await db.execute(sql`
            INSERT INTO core.clients (id, legacy_id, client_code, name, created_by, updated_by, created_at, updated_at, source_table)
            VALUES (${created.id}, ${created.id}, ${generatedClientId}, ${parsed.name}, ${req.user?.id ?? null}, ${req.user?.id ?? null}, NOW(), NOW(), 'public.clients')
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                client_code = EXCLUDED.client_code,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
          `);
          promotedMirror.success = true;
        } catch (mirrorError: any) {
          promotedMirror.error = mirrorError?.message || "unknown_error";
          console.error("[dual-write][clients] promoted mirror write failed", {
            clientId: created.id,
            error: mirrorError,
          });
        }
      }

      logAuditFromReq(req, { entityType: "client", entityId: String(created.id), action: "create", changesJson: { name: parsed.name, clientId: generatedClientId, promotedMirror } });
      if (promotedMirror.attempted) {
        res.setHeader("X-Promoted-Clients-Dual-Write", promotedMirror.success ? "mirrored" : "mirror_failed");
      }
      res.json({ ...created, _promotedMirror: promotedMirror });
    } catch (error) {
      console.error("Client create error:", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  });
}
