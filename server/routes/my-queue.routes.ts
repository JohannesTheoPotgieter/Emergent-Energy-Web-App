// ============================================================
// /api/my-queue — "What needs me right now?"
//
// PR-C of the truth/clear/simple redesign. Single endpoint that
// returns every Project Delivery action waiting on the calling user,
// grouped by category:
//
//   1. POs awaiting my approval
//   2. Payment requests awaiting my review
//   3. Change requests where I'm the assigned approver
//   4. Stage-gate exceptions where I'm the assigned approver
//
// Replaces the per-board scatter pattern (open each board, filter to
// "My Reviews", repeat). Truth: the user sees exactly what's blocked
// on them; clear: each item has one action verb; simple: one fetch.
//
// All queries use parameterised SQL via `sql\`\`` templates. Snapshot
// guards apply where relevant. Each branch is wrapped so a single
// query failure (e.g. a missing table on a stale environment) still
// returns the other categories.
// ============================================================

import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { jwtAuth, requireAuth, getEffectiveUser } from "../auth-context";

interface QueueItem {
  /** Stable identifier within the source domain. */
  id: number;
  /** Free-text title shown in the row. */
  title: string;
  /** Optional sub-line — "Mondi · R 240k" / project name · supplier. */
  subtitle?: string;
  /** Project ID — used for deep-link to /project/id/:id. */
  projectId: number | null;
  /** ISO date string when this item was raised — drives the "Xd waiting" pill. */
  raisedAt: string | null;
  /** Open-this-item href. */
  href: string;
  /** Primary action label — "Approve" / "Review" / "Decide". */
  actionLabel: string;
}

interface QueueBucket {
  /** Bucket count — matches items.length, included for fast header rendering. */
  count: number;
  items: QueueItem[];
  /** Set when the underlying query failed; UI surfaces "couldn't load" instead
   *  of treating it as an empty bucket. Truth principle. */
  error: string | null;
}

interface MyQueueResponse {
  pos: QueueBucket;
  paymentRequests: QueueBucket;
  changeRequests: QueueBucket;
  stageExceptions: QueueBucket;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    const r = (result as { rows?: unknown[] }).rows;
    return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
  }
  return [];
}

async function loadPos(userId: number): Promise<QueueBucket> {
  try {
    const res = await db.execute(sql`
      SELECT po.id, po.po_ref, po.project_id, po.project_name, po.supplier_name,
             po.total, po.created_at
      FROM po_review_assignments pra
      JOIN purchase_orders po ON pra.purchase_order_id = po.id
      WHERE pra.reviewer_user_id = ${userId}
        AND pra.decision = 'pending'
        AND pra.delegated_to_user_id IS NULL
        AND po.status IN ('submitted', 'in_review')
      ORDER BY po.created_at ASC
    `);
    const items: QueueItem[] = rows(res).map((r) => ({
      id: Number(r.id),
      title: `PO ${String(r.po_ref || "")}`,
      subtitle: [r.project_name, r.supplier_name].filter(Boolean).join(" · ") + ` · R ${Number(r.total || 0).toLocaleString("en-ZA")}`,
      projectId: r.project_id != null ? Number(r.project_id) : null,
      raisedAt: r.created_at ? String(r.created_at) : null,
      href: `/po-approval-board?focus=${r.id}`,
      actionLabel: "Approve",
    }));
    return { count: items.length, items, error: null };
  } catch (err) {
    return { count: 0, items: [], error: err instanceof Error ? err.message : "Failed to load POs" };
  }
}

async function loadPaymentRequests(userId: number): Promise<QueueBucket> {
  try {
    // A PR is "on my desk" when status = 'in_review'. The current
    // schema doesn't carry a reviewer_user_id, so this returns every
    // in_review PR system-wide — the UI labels it "awaiting review"
    // rather than implying personal assignment. Once payment_requests
    // gains a reviewer column the WHERE can narrow to userId. The
    // userId parameter is intentionally kept here so the contract is
    // stable for that future change.
    void userId;
    const res = await db.execute(sql`
      SELECT pr.id, pr.project_id, p.project_name, c.name_canonical AS supplier,
             pr.amount, pr.created_at,
             ic.invoice_number, po.po_ref
      FROM payment_requests pr
      LEFT JOIN project_info p ON pr.project_id = p.id
      LEFT JOIN counterparties c ON pr.counterparty_id = c.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      LEFT JOIN invoice_captures ic ON pr.invoice_capture_id = ic.id
      WHERE pr.status = 'in_review'
      ORDER BY pr.created_at ASC
      LIMIT 50
    `);
    const items: QueueItem[] = rows(res).map((r) => ({
      id: Number(r.id),
      title: r.invoice_number
        ? `Invoice ${String(r.invoice_number)}`
        : r.po_ref
          ? `Payment for PO ${String(r.po_ref)}`
          : `Payment request #${r.id}`,
      subtitle: [r.project_name, r.supplier].filter(Boolean).join(" · ") + ` · R ${Number(r.amount || 0).toLocaleString("en-ZA")}`,
      projectId: r.project_id != null ? Number(r.project_id) : null,
      raisedAt: r.created_at ? String(r.created_at) : null,
      href: `/payment-request-board?focus=${r.id}`,
      actionLabel: "Review",
    }));
    return { count: items.length, items, error: null };
  } catch (err) {
    return { count: 0, items: [], error: err instanceof Error ? err.message : "Failed to load payment requests" };
  }
}

async function loadChangeRequests(userId: number): Promise<QueueBucket> {
  try {
    // Per the wave-2 audit, change_requests now carries
    // reviewer_user_id. Items waiting for the caller are status
    // 'submitted' (no reviewer set yet, anyone with approve perm can
    // take it) OR 'under_review' with reviewer_user_id = me.
    const res = await db.execute(sql`
      SELECT cr.id, cr.project_id, p.project_name, cr.title, cr.change_type,
             cr.cost_impact, cr.created_at, cr.status, cr.submitted_at
      FROM change_requests cr
      LEFT JOIN project_info p ON cr.project_id = p.id
      WHERE cr.deleted_at IS NULL
        AND (
          cr.status = 'submitted'
          OR (cr.status = 'under_review' AND cr.reviewer_user_id = ${userId})
        )
      ORDER BY COALESCE(cr.submitted_at, cr.created_at) ASC
      LIMIT 50
    `);
    const items: QueueItem[] = rows(res).map((r) => {
      const cost = Number(r.cost_impact ?? 0);
      const costSuffix = cost ? ` · R ${cost.toLocaleString("en-ZA")} impact` : "";
      return {
        id: Number(r.id),
        title: String(r.title || `Change request #${r.id}`),
        subtitle: [r.project_name, r.change_type].filter(Boolean).join(" · ") + costSuffix,
        projectId: r.project_id != null ? Number(r.project_id) : null,
        raisedAt: (r.submitted_at ?? r.created_at) ? String(r.submitted_at ?? r.created_at) : null,
        href: r.project_id ? `/project/id/${r.project_id}?dept=overview&sub=change-control&focus=${r.id}` : "/",
        actionLabel: r.status === "under_review" ? "Decide" : "Review",
      };
    });
    return { count: items.length, items, error: null };
  } catch (err) {
    return { count: 0, items: [], error: err instanceof Error ? err.message : "Failed to load change requests" };
  }
}

async function loadStageExceptions(userId: number): Promise<QueueBucket> {
  try {
    // project_stage_exceptions carries approver_user_id and status.
    // Anything REQUESTED (not yet decided) where I'm the assigned
    // approver belongs in my queue.
    const res = await db.execute(sql`
      SELECT pse.id, pse.project_id, p.project_name, pse.stage_code,
             pse.requirement_code, pse.reason_text, pse.risk_level,
             pse.created_at
      FROM project_stage_exceptions pse
      LEFT JOIN project_info p ON pse.project_id = p.id
      WHERE pse.status = 'REQUESTED'
        AND pse.approver_user_id = ${userId}
      ORDER BY
        CASE pse.risk_level
          WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4
        END,
        pse.created_at ASC
      LIMIT 50
    `);
    const items: QueueItem[] = rows(res).map((r) => ({
      id: Number(r.id),
      title: `Stage exception · ${String(r.stage_code || "")} · ${String(r.requirement_code || "")}`,
      subtitle: [r.project_name, r.risk_level ? `risk: ${String(r.risk_level).toLowerCase()}` : null]
        .filter(Boolean).join(" · ") + (r.reason_text ? ` · ${String(r.reason_text).slice(0, 80)}` : ""),
      projectId: r.project_id != null ? Number(r.project_id) : null,
      raisedAt: r.created_at ? String(r.created_at) : null,
      href: r.project_id ? `/project/id/${r.project_id}?dept=overview&sub=stage-gates&focus=${r.id}` : "/",
      actionLabel: "Decide",
    }));
    return { count: items.length, items, error: null };
  } catch (err) {
    return { count: 0, items: [], error: err instanceof Error ? err.message : "Failed to load stage exceptions" };
  }
}

export function registerMyQueueRoutes(app: Express) {
  app.get(
    "/api/my-queue",
    jwtAuth,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = getEffectiveUser(req);
        if (!user?.id) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        // Run the four loaders concurrently — they share no state
        // and each is wrapped to never throw.
        const [pos, paymentRequests, changeRequests, stageExceptions] = await Promise.all([
          loadPos(user.id),
          loadPaymentRequests(user.id),
          loadChangeRequests(user.id),
          loadStageExceptions(user.id),
        ]);

        const body: MyQueueResponse = { pos, paymentRequests, changeRequests, stageExceptions };
        res.json(body);
      } catch (err) {
        console.error("[my-queue] aggregator error:", err);
        res.status(500).json({ error: "Failed to load queue" });
      }
    },
  );
}
