/**
 * Misc Read Routes — Extracted from server/routes.ts (Phase 5)
 *
 * 2 handlers:
 *   GET /api/search     — universal search across projects, work items, costs, revenue
 *   GET /api/projects   — list all projects (legacy compat read)
 */

import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth-context";
import { FINANCE_ONLY_MODE } from "@shared/config/enabled-modules";

export function registerMiscExtractedRoutes(app: Express): void {

  // ==================== UNIVERSAL SEARCH ====================

  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim().toLowerCase();
      if (!q || q.length < 2) return res.json({ results: [] });
      const lim = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const startsWithPattern = `${q}%`;
      const containsPattern = `%${q}%`;

      // Finance-only: skip the work-items (task) query entirely so no
      // non-finance results are computed or returned by global search.
      const workItemQuery = FINANCE_ONLY_MODE
        ? Promise.resolve({ rows: [] as unknown[] })
        : db.execute(sql`
            SELECT w.id, w.title, w.status, p.project_name, w.type as task_type, w.owner_name as assigned_to, w.percent_complete
            FROM work_items w
            LEFT JOIN project_info p ON w.project_id = p.id
            WHERE LOWER(w.title) LIKE ${containsPattern}
               OR LOWER(p.project_name) LIKE ${containsPattern}
            ORDER BY CASE WHEN LOWER(w.title) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, w.title
            LIMIT ${lim}
          `);

      const [projectRows, workItemRows, costRows, revenueRows] = await Promise.all([
        db.execute(sql`
          SELECT id, project_name, phase, pd, pm, size_kwp
          FROM project_info
          WHERE LOWER(project_name) LIKE ${startsWithPattern}
             OR LOWER(project_name) LIKE ${containsPattern}
          ORDER BY CASE WHEN LOWER(project_name) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, project_name
          LIMIT ${lim}
        `),
        workItemQuery,
        db.execute(sql`
          SELECT id, description, project_name, cost_category as category, counterparty_name as supplier, amount_ex_vat as total_cost, cost_line_status as status, invoice_number, po_number
          FROM normalized_cost_lines
          WHERE effective_to IS NULL
            AND deleted_at IS NULL
            AND (LOWER(description) LIKE ${containsPattern}
              OR LOWER(counterparty_name) LIKE ${containsPattern}
              OR LOWER(cost_category) LIKE ${containsPattern}
              OR LOWER(COALESCE(invoice_number, '')) LIKE ${containsPattern}
              OR LOWER(COALESCE(po_number, '')) LIKE ${containsPattern})
          ORDER BY CASE WHEN LOWER(COALESCE(invoice_number, '')) LIKE ${startsWithPattern} OR LOWER(COALESCE(po_number, '')) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, description
          LIMIT ${lim}
        `),
        db.execute(sql`
          SELECT id, description, project_name, milestone_name, amount_ex_vat as amount, status, invoice_number
          FROM normalized_revenue_lines
          WHERE effective_to IS NULL
            AND deleted_at IS NULL
            AND (LOWER(description) LIKE ${containsPattern}
              OR LOWER(milestone_name) LIKE ${containsPattern}
              OR LOWER(COALESCE(invoice_number, '')) LIKE ${containsPattern})
          ORDER BY CASE WHEN LOWER(COALESCE(invoice_number, '')) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, description
          LIMIT ${lim}
        `),
      ]);

      const results: any[] = [];
      const getRows = (result: any): any[] => Array.isArray(result) ? result : (result?.rows || []);

      for (const r of getRows(projectRows)) {
        results.push({
          type: "project",
          id: r.project_name,
          title: r.project_name,
          subtitle: [r.phase, r.pm ? `PM: ${r.pm}` : null, r.size_kwp ? `${r.size_kwp} kWp` : null].filter(Boolean).join(" · "),
          url: `/project/${encodeURIComponent(r.project_name)}`,
        });
      }
      for (const r of getRows(workItemRows)) {
        results.push({
          type: "task",
          id: `wi-${r.id}`,
          title: r.title,
          subtitle: [r.project_name, r.task_type, r.status, r.percent_complete != null ? `${Math.round(r.percent_complete * 100)}%` : null].filter(Boolean).join(" · "),
          url: r.project_name ? `/project/${encodeURIComponent(r.project_name)}?tab=plan` : null,
        });
      }
      for (const r of getRows(costRows)) {
        results.push({
          type: "cost",
          id: `cost-${r.id}`,
          title: r.description || r.category || "Cost item",
          subtitle: [r.project_name, r.supplier, r.invoice_number ? `INV: ${r.invoice_number}` : null, r.po_number ? `PO: ${r.po_number}` : null, r.category, r.total_cost ? `R${Number(r.total_cost).toLocaleString()}` : null].filter(Boolean).join(" · "),
          url: r.project_name ? `/project/${encodeURIComponent(r.project_name)}?tab=expenditure` : null,
        });
      }
      for (const r of getRows(revenueRows)) {
        results.push({
          type: "revenue",
          id: `rev-${r.id}`,
          title: r.description || r.milestone_name || "Revenue item",
          subtitle: [r.project_name, r.milestone_name, r.invoice_number ? `INV: ${r.invoice_number}` : null, r.amount ? `R${Number(r.amount).toLocaleString()}` : null].filter(Boolean).join(" · "),
          url: r.project_name ? `/project/${encodeURIComponent(r.project_name)}?tab=revenue` : null,
        });
      }

      res.json({ results: results.slice(0, lim) });
    } catch (err: any) {
      console.error("Search error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  // GET /api/projects — retired: department project-routes handler wins by registration order
}
